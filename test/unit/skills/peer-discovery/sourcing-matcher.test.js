'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  matchSourcing,
  titleSimilarity,
  checkSpecConsistency
} = require('../../../../skills/peer-discovery/src/sourcing-matcher');

test('titleSimilarity computes Jaccard similarity', () => {
  const simA = titleSimilarity('纯银项链女锁骨链', '纯银项链女款');
  assert.ok(simA >= 0.4, `Expected >= 0.4, got ${simA}`);

  const simB = titleSimilarity('手机壳防摔硅胶', '纯棉连衣裙长款');
  assert.ok(simB < 0.2, `Expected < 0.2, got ${simB}`);
});

test('checkSpecConsistency: consistent vs inconsistent vs unknown', () => {
  // Material match
  assert.equal(checkSpecConsistency('925纯银项链女', '纯银锁骨链女款'), 'consistent');

  // Material mismatch
  assert.equal(checkSpecConsistency('纯银项链女', '钛钢不锈钢项链女'), 'inconsistent');

  // Quantity mismatch
  assert.equal(checkSpecConsistency('纯银项链 1条', '纯银项链 2条'), 'inconsistent');

  // Unknown
  assert.equal(checkSpecConsistency('高级感小众项链女', '简约高级感项链'), 'unknown');
});

test('matchSourcing: four-level verdicts', async () => {
  const product = {
    title: '纯银项链女款锁骨链',
    taobaoPrice: 29.9,
    price: 29.9
  };

  // 1. confirmed (single piece price)
  const confRes = await matchSourcing(product, {
    similarityThreshold: 0.4,
    searcher: async () => ({
      ok: true,
      products: [
        {
          title: '纯银项链女款锁骨链简约',
          singlePiecePrice: 6.8,
          minOrderQuantity: 1,
          priceBand: { minPrice: 6.8 }
        }
      ]
    })
  });
  assert.equal(confRes.level, 'confirmed');
  assert.equal(confRes.reason, 'matched');

  // 2. confirmed (minOrderQuantity=1 and not tiered)
  const confMinRes = await matchSourcing(product, {
    similarityThreshold: 0.4,
    searcher: async () => ({
      ok: true,
      products: [
        {
          title: '纯银项链女款锁骨链',
          singlePiecePrice: null,
          minOrderQuantity: 1,
          priceBand: { minPrice: 6.8, prices: [6.8] }
        }
      ]
    })
  });
  assert.equal(confMinRes.level, 'confirmed');

  // 3. rejected (price too high)
  const rejPrice = await matchSourcing(product, {
    similarityThreshold: 0.4,
    priceRatioThreshold: 0.7,
    searcher: async () => ({
      ok: true,
      products: [
        {
          title: '纯银项链女款锁骨链',
          singlePiecePrice: 25.0,
          minOrderQuantity: 1
        }
      ]
    })
  });
  assert.equal(rejPrice.level, 'rejected');
  assert.equal(rejPrice.reason, 'price_too_high');

  // 4. rejected (low similarity)
  const rejSim = await matchSourcing(product, {
    similarityThreshold: 0.9,
    searcher: async () => ({
      ok: true,
      products: [
        {
          title: '不同标题',
          singlePiecePrice: 6.8,
          minOrderQuantity: 1
        }
      ]
    })
  });
  assert.equal(rejSim.level, 'rejected');
  assert.equal(rejSim.reason, 'low_similarity');

  // 5. suspected (spec unknown)
  const susRes = await matchSourcing({ title: '高级感锁骨链女', taobaoPrice: 29.9 }, {
    similarityThreshold: 0.4,
    searcher: async () => ({
      ok: true,
      products: [
        {
          title: '高级感锁骨链百搭',
          singlePiecePrice: 6.8,
          minOrderQuantity: 1
        }
      ]
    })
  });
  assert.equal(susRes.level, 'suspected');
  assert.equal(susRes.reason, 'spec_unknown');

  // 6. rejected (spec mismatch)
  const rejSpec = await matchSourcing({ title: '纯银项链女款锁骨链高级感', taobaoPrice: 29.9 }, {
    similarityThreshold: 0.3,
    searcher: async () => ({
      ok: true,
      products: [
        {
          title: '不锈钢项链女款锁骨链高级感',
          singlePiecePrice: 6.8,
          minOrderQuantity: 1
        }
      ]
    })
  });
  assert.equal(rejSpec.level, 'rejected');
  assert.equal(rejSpec.reason, 'spec_mismatch');

  // 7. rejected (spec mismatch and price too high)
  const rejMixed = await matchSourcing({ title: '纯银项链女款锁骨链高级感', taobaoPrice: 29.9 }, {
    similarityThreshold: 0.3,
    priceRatioThreshold: 0.7,
    searcher: async () => ({
      ok: true,
      products: [
        { title: '钛钢项链女款锁骨链高级感', singlePiecePrice: 5.0, minOrderQuantity: 1 },
        { title: '纯银项链女款锁骨链高级感', singlePiecePrice: 28.0, minOrderQuantity: 1 }
      ]
    })
  });
  assert.equal(rejMixed.level, 'rejected');
  assert.equal(rejMixed.reason, 'spec_mismatch_and_price_too_high');

  // 8. inconclusive (tiered price not comparable)
  const incTiered = await matchSourcing(product, {
    similarityThreshold: 0.4,
    searcher: async () => ({
      ok: true,
      products: [
        {
          title: '纯银项链女款锁骨链',
          singlePiecePrice: null,
          minOrderQuantity: 1,
          priceBand: { prices: [10, 8, 6] }
        }
      ]
    })
  });
  assert.equal(incTiered.level, 'inconclusive');
  assert.equal(incTiered.reason, 'tiered_price_not_comparable');

  // 9. inconclusive (minOrderQuantity unknown)
  const incMoq = await matchSourcing(product, {
    similarityThreshold: 0.4,
    searcher: async () => ({
      ok: true,
      products: [
        {
          title: '纯银项链女款锁骨链',
          singlePiecePrice: null,
          minOrderQuantity: null
        }
      ]
    })
  });
  assert.equal(incMoq.level, 'inconclusive');
  assert.equal(incMoq.reason, 'min_order_qty_unknown');

  // 10. inconclusive (missing taobao price)
  const incNoPrice = await matchSourcing({ title: '纯银项链', taobaoPrice: 0 }, {
    searcher: async () => ({ ok: true, products: [{ title: '纯银项链' }] })
  });
  assert.equal(incNoPrice.level, 'inconclusive');
  assert.equal(incNoPrice.reason, 'missing_taobao_price');

  // 11. inconclusive (no 1688 results)
  const incNoRes = await matchSourcing(product, {
    searcher: async () => ({ ok: true, products: [] })
  });
  assert.equal(incNoRes.level, 'inconclusive');
  assert.equal(incNoRes.reason, 'no_1688_result');
});
