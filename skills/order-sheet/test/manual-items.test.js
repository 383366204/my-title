'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
  isAllowedDomain,
  isAllowedEndpoint,
  fetchTaobaoItemPage,
  parseTaobaoItemHtml,
  parseManualItem,
  parseManualItems,
  enrichManualItems
} = require('../src/manual-items');

describe('manual items parser', () => {
  it('validates allowed Taobao, Tmall, and short link domains', () => {
    assert.equal(isAllowedDomain('item.taobao.com'), true);
    assert.equal(isAllowedDomain('detail.tmall.com'), true);
    assert.equal(isAllowedDomain('detail.tmall.hk'), true);
    assert.equal(isAllowedDomain('h5.m.taobao.com'), true);
    assert.equal(isAllowedDomain('m.tb.cn'), true);
    assert.equal(isAllowedDomain('e.tb.cn'), true);
    assert.equal(isAllowedDomain('tb.cn'), true);
    assert.equal(isAllowedDomain('evil.com'), false);
    assert.equal(isAllowedDomain('1688.com'), false);
    assert.equal(isAllowedEndpoint(new URL('https://e.tb.cn/h.test')), true);
    assert.equal(isAllowedEndpoint(new URL('https://item.taobao.com:8443/item.htm?id=1')), false);
  });

  it('parses pure numeric IDs and constructs standard Taobao URLs', () => {
    const item = parseManualItem('748392010293');
    assert.deepEqual(item, {
      itemId: '748392010293',
      title: '',
      productUrl: 'https://item.taobao.com/item.htm?id=748392010293',
      imageUrl: '',
      storeName: '',
      orderAmount: null,
      paymentAmount: null,
      sourceType: 'manual',
      enrichmentStatus: 'normalized'
    });
  });

  it('parses taobao.com, tmall.com, tmall.hk, and mobile direct links', () => {
    const taobao = parseManualItem('https://item.taobao.com/item.htm?id=1001&spm=a21');
    assert.equal(taobao.itemId, '1001');
    assert.equal(taobao.productUrl, 'https://item.taobao.com/item.htm?id=1001&spm=a21');

    const tmall = parseManualItem('https://detail.tmall.com/item.htm?id=2002');
    assert.equal(tmall.itemId, '2002');

    const tmallHk = parseManualItem('https://detail.tmall.hk/item.htm?id=3003');
    assert.equal(tmallHk.itemId, '3003');

    const mobile = parseManualItem('https://h5.m.taobao.com/awp/core/detail.htm?id=4004');
    assert.equal(mobile.itemId, '4004');
  });

  it('keeps unresolved short links for the safe enrichment stage', () => {
    const shortWithId = parseManualItem('https://m.tb.cn/h.xxx?id=5005');
    assert.equal(shortWithId.itemId, '5005');
    assert.equal(shortWithId.productUrl, 'https://m.tb.cn/h.xxx?id=5005');

    const shortNoId = parseManualItem('https://m.tb.cn/h.xyzShort');
    assert.equal(shortNoId.itemId, '');
    assert.equal(shortNoId.sourceKey, 'url:https://m.tb.cn/h.xyzShort');

    const SSRFAttempt = parseManualItem('https://evil.com/redirect?url=http://169.254.169.254');
    assert.equal(SSRFAttempt, null);
    assert.equal(parseManualItem('https://item.taobao.com:8443/item.htm?id=5005'), null);
  });

  it('parses object inputs with explicit user title, orderAmount, and storeName without faking title', () => {
    const item = parseManualItem({
      url: 'https://item.taobao.com/item.htm?id=6006',
      title: '用户真实标题',
      storeName: '官方旗舰店',
      orderAmount: 99.5
    });

    assert.equal(item.itemId, '6006');
    assert.equal(item.title, '用户真实标题');
    assert.equal(item.storeName, '官方旗舰店');
    assert.equal(item.orderAmount, 99.5);
    assert.equal(item.paymentAmount, null);

    const emptyTitleItem = parseManualItem({ id: '7007' });
    assert.equal(emptyTitleItem.itemId, '7007');
    assert.equal(emptyTitleItem.title, '');
  });

  it('deduplicates items by itemId stably and caps at 100 items', () => {
    const textInput = `
      1001
      https://item.taobao.com/item.htm?id=1002
      1001
      https://detail.tmall.com/item.htm?id=1002
      1003
    `;

    const parsed = parseManualItems([], textInput);
    assert.deepEqual(parsed.map(i => i.itemId), ['1001', '1002', '1003']);

    const oversized = Array.from({ length: 150 }, (_, idx) => `${1000 + idx}`);
    const capped = parseManualItems([], oversized.join('\n'));
    assert.equal(capped.length, 100);
    assert.equal(capped[0].itemId, '1000');
    assert.equal(capped[99].itemId, '1099');
  });

  it('can disable network enrichment for deterministic callers', async () => {
    const rawItems = [{ itemId: '1001', title: '测试' }];
    const enriched = await enrichManualItems(rawItems, { autoEnrichManualItems: false });
    assert.deepEqual(enriched, [{ itemId: '1001', title: '测试', enrichmentStatus: 'complete' }]);
  });

  it('extracts product metadata without treating page price as paid metrics', async () => {
    const html = `
      <meta property="og:title" content="测试淘宝商品">
      <meta property="og:image" content="https://img.alicdn.com/test.jpg">
      <meta property="product:price:amount" content="39.90">
      <script>{"shopName":"测试店铺"}</script>
    `;
    const parsed = parseTaobaoItemHtml(html, 'https://item.taobao.com/item.htm?id=8899');
    assert.equal(parsed.itemId, '8899');
    assert.equal(parsed.title, '测试淘宝商品');
    assert.equal(parsed.storeName, '测试店铺');
    assert.equal(parsed.referencePrice, 39.9);
    assert.equal(parsed.paymentAmount, undefined);

    const fetched = await fetchTaobaoItemPage(
      { productUrl: 'https://m.tb.cn/short' },
      { request: async (_url, config) => {
        assert.equal(config.maxRedirects, 4);
        return {
          data: html,
          request: { res: { responseUrl: 'https://detail.tmall.com/item.htm?id=8899' } }
        };
      } }
    );
    assert.equal(fetched.itemId, '8899');
    assert.equal(fetched.referencePrice, 39.9);
  });
});
