'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { extractSourceProducts, extractItemId } = require('../../../../skills/peer-discovery/src/source-extractor');

test('extractItemId extracts numeric ID from various Taobao/Tmall URLs', () => {
  assert.equal(extractItemId('https://item.taobao.com/item.htm?id=892291403015'), '892291403015');
  assert.equal(extractItemId('https://detail.tmall.com/item.htm?id=782190334120&spm=a21bo.1'), '782190334120');
  assert.equal(extractItemId('https://item.taobao.com/item/691028374619.htm'), '691028374619');
  assert.equal(extractItemId('https://www.taobao.com'), null);
  assert.equal(extractItemId('invalid-url'), null);
});

test('extractSourceProducts blocks empty or non-trusted inputs', async () => {
  const result = await extractSourceProducts({ inputs: ['not-a-link', 'https://evil.com/item.htm?id=123'] });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'manual_action_required');
  assert.equal(result.totalValid, 0);
  assert.equal(result.errors[0].code, 'NO_VALID_INPUTS');
});

test('extractSourceProducts deduplicates links and writes peer-input.json', async t => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'source-extract-'));
  t.after(() => fs.rm(runDir, { recursive: true, force: true }));

  const inputs = [
    'https://item.taobao.com/item.htm?id=892291403015',
    'https://item.taobao.com/item.htm?id=892291403015', // 重复
    'https://detail.tmall.com/item.htm?id=782190334120'
  ];

  const extractor = async link => ({
    title: `商品_${extractItemId(link.inputUrl)}`,
    price: 99.9,
    mainImageUrl: `https://img.alicdn.com/img_${extractItemId(link.inputUrl)}.jpg`,
    shopName: '测试金饰店',
    shopUrl: 'https://shop123.taobao.com/'
  });

  const result = await extractSourceProducts({ inputs, runDir, extractor });
  assert.equal(result.ok, true);
  assert.equal(result.totalValid, 2);
  assert.equal(result.products.length, 2);
  assert.equal(result.products[0].itemId, '892291403015');
  assert.equal(result.products[0].shopKey, 'shop:123');

  // 验证 peer-input.json
  const peerInput = JSON.parse(await fs.readFile(path.join(runDir, 'peer-input.json'), 'utf8'));
  assert.equal(peerInput.links.length, 2);
  assert.equal(peerInput.duplicateCount, 1);

  // 验证 source-products.jsonl
  const lines = (await fs.readFile(path.join(runDir, 'source-products.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 2);
  const row0 = JSON.parse(lines[0]);
  assert.equal(row0.itemId, '892291403015');
});

test('extractSourceProducts handles missing_main_image without breaking remaining items', async () => {
  const inputs = [
    'https://item.taobao.com/item.htm?id=111',
    'https://item.taobao.com/item.htm?id=222'
  ];

  const extractor = async link => {
    if (link.inputUrl.includes('111')) {
      return { title: '无图商品', mainImageUrl: '', price: 10 };
    }
    return { title: '正常商品', mainImageUrl: 'https://img.alicdn.com/222.jpg', price: 20 };
  };

  const result = await extractSourceProducts({ inputs, extractor });
  assert.equal(result.ok, true);
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].itemId, '222');
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, 'MISSING_MAIN_IMAGE');
});

test('extractSourceProducts respects AbortSignal', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => extractSourceProducts({ inputs: ['https://item.taobao.com/item.htm?id=123'], signal: controller.signal }),
    { name: 'AbortError' }
  );
});

test('share links resolve item identity after navigation and failed retries clear stale products', async t => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'source-share-'));
  t.after(() => fs.rm(runDir, { recursive: true, force: true }));
  const inputs = ['https://e.tb.cn/h.example'];
  const result = await extractSourceProducts({ inputs, runDir, extractor: async () => ({
    resolvedUrl: 'https://item.taobao.com/item.htm?id=123', title: '商品', mainImageUrl: 'https://img.alicdn.com/test.jpg'
  }) });
  assert.equal(result.products[0].itemId, '123');
  const failed = await extractSourceProducts({ inputs, runDir, extractor: async () => ({ resolvedUrl: inputs[0] }) });
  assert.equal(failed.ok, false);
  assert.equal(await fs.readFile(path.join(runDir, 'source-products.jsonl'), 'utf8'), '');
  await fs.writeFile(path.join(runDir, 'source-products.jsonl'), '{"stale":true}\n');
  await extractSourceProducts({ inputs: [], runDir });
  assert.equal(await fs.readFile(path.join(runDir, 'source-products.jsonl'), 'utf8'), '');
});

test('DOM extraction rejects generic images and open-shop links', () => {
  const vm = require('node:vm');
  const { DOM_EXTRACT_EXPRESSION } = require('../../../../skills/peer-discovery/src/source-extractor');
  const state = vm.runInNewContext(DOM_EXTRACT_EXPRESSION, {
    URL, location: { href: 'https://item.taobao.com/item.htm?id=123' },
    document: {
      title: '商品',
      querySelectorAll: selector => selector === 'a[href]' ? [
        { href: 'https://ishop.taobao.com/openshop/tb_open_shop_landing.htm' },
        { href: 'https://shop123.taobao.com/category.htm' },
      ] : [],
      querySelector: selector => selector.includes('priceInt') ? { textContent: '￥ 29.80' } : null,
    },
  });
  assert.equal(state.mainImageUrl, '');
  assert.equal(state.shopUrl, 'https://shop123.taobao.com/category.htm');
  assert.equal(state.price, 29.8);
});
