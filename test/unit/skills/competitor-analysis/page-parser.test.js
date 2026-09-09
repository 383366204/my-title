'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseShopPage, parseSortedProducts } = require('../../../../skills/competitor-analysis/src/page-parser');
const { collectSortedShopProducts, enrichCompetitorProduct, openSortedShopPage, sortedShopUrl } = require('../../../../skills/competitor-analysis/src/collector');
const { collectionFailureMessage, isTaobaoPlatformBlocker } = require('../../../../skills/competitor-analysis/index');
const { parseToolOutput, TaobaoNativeError } = require('../../../../skills/competitor-analysis/src/taobao-native-client');

const PAGE_PREFIX = `搜索
搜本店
云间有个小卖铺
查看资质
扫码进店
2151粉丝
近半年2千88VIP好评
近一年3000+88VIP下单
近90天9百回头客
近30天3万件宝贝被加购
客服
关注
全部宝贝
明星周边
盒蛋扭蛋
冰箱贴
综合
销量
新品
价格`;

test('parses canonical shop profile from a resolved share page', () => {
  const shop = parseShopPage({
    url: 'https://shop369638840.taobao.com/?shareurl=true',
    title: '首页-云间有个小卖铺-淘宝网',
    content: PAGE_PREFIX
  });
  assert.equal(shop.shopKey, 'shop:369638840');
  assert.equal(shop.shopName, '云间有个小卖铺');
  assert.equal(shop.shopUrl, 'https://shop369638840.taobao.com/');
  assert.equal(shop.followerLowerBound, 2151);
  assert.deepEqual(shop.categories, ['明星周边', '盒蛋扭蛋', '冰箱贴']);
});

test('parses sorted product titles and payment lower bounds without false precision', () => {
  const rows = parseSortedProducts(`${PAGE_PREFIX}
东米萌宠企鹅按动笔可爱搞怪小鸟磁吸笔学生速干0.5ST考试刷题笔
满2件9.5折
已降0.01元
¥
700+人付款
柴米油盐创意树脂立体浮雕磁吸冰箱贴冰箱装饰送朋友小礼品
已降0.01元
¥
600+人付款`, { sortType: 'hot', limit: 20 });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, '东米萌宠企鹅按动笔可爱搞怪小鸟磁吸笔学生速干0.5ST考试刷题笔');
  assert.equal(rows[0].paymentLowerBound, 700);
  assert.equal(rows[0].paymentExact, false);
  assert.equal(rows[1].rank, 2);
});

test('builds stable shop-list URLs without relying on visual sort clicks', () => {
  assert.equal(
    sortedShopUrl('https://shop369638840.taobao.com/', 'hot'),
    'https://shop369638840.taobao.com/search.htm?orderType=hotsell_desc'
  );
  assert.equal(
    sortedShopUrl('https://shop369638840.taobao.com/', 'new'),
    'https://shop369638840.taobao.com/search.htm?orderType=newOn_desc'
  );
});

test('uses the visible shop sort control before parsing products', async () => {
  const calls = [];
  const client = {
    async navigateToUrl(url) { calls.push(['navigate', url]); },
    async clickByText(label) { calls.push(['click', label]); },
    async readPageContent() {
      calls.push(['read']);
      return { content: `${PAGE_PREFIX}\n测试爆款商品标题足够长用于解析\n¥\n900+人付款` };
    },
    async scrollPage() { calls.push(['scroll']); }
  };
  const result = await collectSortedShopProducts({
    shopKey: 'shop:1',
    shopName: '测试店铺',
    shopUrl: 'https://shop1.taobao.com/'
  }, 'hot', { client, limit: 1, waitMs: 1 });

  assert.deepEqual(calls.slice(0, 2), [
    ['navigate', 'https://shop1.taobao.com/'],
    ['click', '销量']
  ]);
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].paymentLowerBound, 900);
});

test('describes an empty dynamic list as retryable instead of a login failure', () => {
  const message = collectionFailureMessage([
    { code: 'TAOBAO_PRODUCT_LIST_EMPTY' }
  ], 20);
  assert.match(message, /重新采集失败榜单/);
  assert.doesNotMatch(message, /完成登录/);
});

test('closes a temporary product page after resolving its stable link', async () => {
  let closed = 0;
  const title = '测试爆款商品标题足够长用于解析链接';
  const client = {
    async navigateToUrl() {},
    async clickByText() {},
    async readPageContent() { return { content: `${PAGE_PREFIX}\n${title}\n¥\n900+人付款` }; },
    async scanPageElements() { return { dom: `[42] <div>${title}</div>` }; },
    async clickElement() {},
    async getCurrentTab() { return { url: 'https://item.taobao.com/item.htm?id=123456', title }; },
    async closePage() { closed += 1; }
  };

  const result = await enrichCompetitorProduct({ shopUrl: 'https://shop1.taobao.com/' }, {
    sortType: 'hot', rank: 1, title
  }, { client, waitMs: 1 });
  assert.equal(result.itemId, '123456');
  assert.equal(result.productUrl, 'https://item.taobao.com/item.htm?id=123456');
  assert.equal(closed, 1);
});

test('preserves Taobao client readiness errors instead of reporting an empty list', async () => {
  const client = {
    async navigateToUrl() { throw new TaobaoNativeError('工具层未就绪', 'TAOBAO_NATIVE_TOOL_ERROR'); }
  };
  await assert.rejects(
    () => openSortedShopPage(client, { shopUrl: 'https://shop1.taobao.com/' }, 'hot'),
    error => error.code === 'TAOBAO_NATIVE_TOOL_ERROR'
  );
});

test('classifies Taobao login failures for actionable workflow recovery', () => {
  assert.throws(
    () => parseToolOutput(JSON.stringify({ error: '未登录，已打开登录页面，请先登录淘宝账号' })),
    error => error.code === 'TAOBAO_LOGIN_REQUIRED'
  );
});

test('classifies Taobao desktop access restrictions separately from page failures', () => {
  assert.throws(
    () => parseToolOutput(JSON.stringify({ error: '内测期间仅开放部分用户使用，请关注后续公告' })),
    error => error.code === 'TAOBAO_NATIVE_ACCESS_RESTRICTED'
  );
  assert.match(collectionFailureMessage([
    { code: 'TAOBAO_NATIVE_ACCESS_RESTRICTED' }
  ], 0), /完全退出并重新启动客户端/);
});

test('classifies an unready Taobao tool layer as a client recovery action', () => {
  assert.throws(
    () => parseToolOutput(JSON.stringify({ error: 'Tool 执行层未就绪，请确保应用已加载完成' })),
    error => error.code === 'TAOBAO_NATIVE_NOT_READY'
  );
  assert.match(collectionFailureMessage([
    { code: 'TAOBAO_NATIVE_NOT_READY' }
  ], 0), /完全退出并重新打开淘宝桌面版/);
});

test('stops batch link enrichment on platform failures but not individual product failures', () => {
  assert.equal(isTaobaoPlatformBlocker({ code: 'TAOBAO_NATIVE_NOT_READY' }), true);
  assert.equal(isTaobaoPlatformBlocker({ code: 'TAOBAO_NATIVE_ACCESS_RESTRICTED' }), true);
  assert.equal(isTaobaoPlatformBlocker({ code: 'TAOBAO_PRODUCT_ID_NOT_FOUND' }), false);
  assert.equal(isTaobaoPlatformBlocker({ code: 'TAOBAO_PRODUCT_NOT_FOUND' }), false);
});
