'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  findSimilarProducts,
  standardizeSimilarProduct,
  parseNativeProducts
} = require('../../../../skills/peer-discovery/src/similar-finder');

test('parseNativeProducts extracts products from various native output structures', () => {
  assert.deepEqual(parseNativeProducts(null), []);
  assert.deepEqual(parseNativeProducts({ products: [{ title: 'p1' }] }), [{ title: 'p1' }]);
  const nested = {
    data: {
      result: {
        categories: [
          { products: [{ title: 'c1' }, { title: 'c2' }] },
          { products: [{ title: 'c3' }] }
        ]
      }
    }
  };
  assert.deepEqual(parseNativeProducts(nested).map(p => p.title), ['c1', 'c2', 'c3']);
});

test('standardizeSimilarProduct formats fields and excludes items without title or itemId', () => {
  const source = { inputUrl: 'https://item.taobao.com/item.htm?id=100', shopKey: 'shop:100', itemId: '100' };
  assert.equal(standardizeSimilarProduct(null, source), null);
  assert.equal(standardizeSimilarProduct({ title: '' }, source), null);
  assert.equal(standardizeSimilarProduct({ title: '有标题无ID' }, source), null);

  const raw = {
    title: '沙金项链',
    itemId: '200',
    displayPriceText: '¥68.5',
    imageUrl: 'https://img.alicdn.com/200.jpg',
    shopUrl: 'https://shop555.taobao.com/?spm=1',
    shopName: '好金店'
  };
  const item = standardizeSimilarProduct(raw, source, 2);
  assert.equal(item.productId, '100');
  assert.equal(item.itemId, '200');
  assert.equal(item.rank, 2);
  assert.equal(item.price, 68.5);
  assert.equal(item.shopKey, 'shop:555');
  assert.equal(item.shopUrl, 'https://shop555.taobao.com/');
});

test('findSimilarProducts excludes source shop and aggregates candidates correctly', async t => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'similar-find-'));
  t.after(() => fs.rm(runDir, { recursive: true, force: true }));

  const sourceProducts = [
    { inputUrl: 'https://item.taobao.com/item.htm?id=src1', itemId: 'src1', title: '源商品1', shopKey: 'shop:A', mainImageUrl: 'https://img.alicdn.com/src1.jpg' },
    { inputUrl: 'https://item.taobao.com/item.htm?id=src2', itemId: 'src2', title: '源商品2', shopKey: 'shop:B', mainImageUrl: 'https://img.alicdn.com/src2.jpg' }
  ];

  const imageSearcher = async (source) => {
    if (source.itemId === 'src1') {
      return [
        { itemId: 'sim1', title: '同款1', shopKey: 'shop:A', shopUrl: 'https://shopA.taobao.com/' }, // 应该被排除（源商品自家店）
        { itemId: 'sim2', title: '同款2', shopKey: 'shop:C', shopName: '店铺C', shopUrl: 'https://shopC.taobao.com/' },
        { itemId: 'sim3', title: '同款3', shopKey: 'shop:D', shopName: '店铺D', shopUrl: 'https://shopD.taobao.com/' }
      ];
    }
    if (source.itemId === 'src2') {
      return [
        { itemId: 'sim4', title: '同款4', shopKey: 'shop:C', shopName: '店铺C', shopUrl: 'https://shopC.taobao.com/' } // 店铺C命中两个源商品
      ];
    }
    return [];
  };

  const result = await findSimilarProducts({ sourceProducts, runDir, imageSearcher });
  assert.equal(result.ok, true);
  assert.equal(result.similarCount, 3); // 排除 shop:A 后剩余 sim2, sim3, sim4

  // 店铺C命中了 2 个源商品，排序第一
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].shopKey, 'shop:C');
  assert.equal(result.candidates[0].sourceCount, 2);
  assert.equal(result.candidates[0].similarProductCount, 2);
  assert.deepEqual(result.candidates[0].representativeProducts, ['sim2', 'sim4']);

  // 店铺D命中了 1 个源商品，排序第二
  assert.equal(result.candidates[1].shopKey, 'shop:D');
  assert.equal(result.candidates[1].sourceCount, 1);

  // 验证持久化输出
  const similarLines = (await fs.readFile(path.join(runDir, 'similar-products.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(similarLines.length, 3);

  const candidateLines = (await fs.readFile(path.join(runDir, 'candidate-shops.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(candidateLines.length, 2);
  const cand0 = JSON.parse(candidateLines[0]);
  assert.equal(cand0.shopKey, 'shop:C');
  assert.ok(cand0.shopUrl);
});

test('findSimilarProducts handles maxCandidateShops limit and empty sources', async () => {
  assert.equal((await findSimilarProducts({ sourceProducts: [] })).ok, false);

  const sourceProducts = [
    { itemId: 's1', title: '商品', mainImageUrl: 'https://img.alicdn.com/s1.jpg', shopKey: 'shop:own' }
  ];
  const imageSearcher = async () => Array.from({ length: 10 }, (_, i) => ({
    itemId: `item_${i}`,
    title: `同款_${i}`,
    shopKey: `shop:${i}`,
    shopUrl: `https://shop${i}.taobao.com/`
  }));

  const result = await findSimilarProducts({ sourceProducts, maxCandidateShops: 3, imageSearcher });
  assert.equal(result.candidates.length, 3);
});

test('findSimilarProducts routes explicit web channel to the web provider', async () => {
  const sourceProducts = [
    { itemId: 's1', title: '商品', mainImageUrl: 'https://img.alicdn.com/s1.jpg' }
  ];
  let called = false;
  const result = await findSimilarProducts({ sourceProducts, channel: 'web', port: 9333,
    webImageSearcher: async (source, options) => {
      called = true;
      assert.equal(options.port, 9333);
      return { products: [{ itemId: '12', title: '同款', shopUrl: 'https://shop123.taobao.com/' }] };
    },
  });
  assert.equal(called, true);
  assert.equal(result.candidates.length, 1);
});

test('findSimilarProducts unconditionally overwrites candidate-shops.jsonl on zero results rerun', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'similar-overwrite-test-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  // Simulate previous run having old candidate shops
  const oldCandidate = { shopKey: 'old_shop', shopName: '旧店铺', shopUrl: 'https://old.taobao.com' };
  await fs.writeFile(path.join(tempDir, 'candidate-shops.jsonl'), JSON.stringify(oldCandidate) + '\n', 'utf8');

  const sourceProducts = [
    { itemId: 's1', title: '商品', mainImageUrl: 'https://img.alicdn.com/s1.jpg' }
  ];
  // imageSearcher returns 0 similar products
  const imageSearcher = async () => [];

  const result = await findSimilarProducts({
    runDir: tempDir,
    sourceProducts,
    imageSearcher
  });

  assert.equal(result.ok, false);
  assert.equal(result.candidates.length, 0);

  // File on disk must now be empty, not containing the old candidate!
  const content = await fs.readFile(path.join(tempDir, 'candidate-shops.jsonl'), 'utf8');
  assert.equal(content.trim(), '');
});
