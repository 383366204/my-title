const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  createProductDiversityState,
  selectDiverseProducts,
  titleSimilarity
} = require('../src/product-diversity');

function row(id, score, shopName = '店铺A', title = `商品${id}`) {
  return {
    opportunityScore: score,
    url: `https://detail.1688.com/offer/${id}.html`,
    sourceTitle: title,
    product: { id, shopName, title }
  };
}

describe('product diversity', () => {
  test('filters recently distributed offers and selects a fresh source', () => {
    const result = selectDiverseProducts([
      row('100001', 95),
      row('100002', 82, '店铺B')
    ], {
      history: {
        offers: {
          'offer:100001': { status: 'distributed', lastSeenAt: '2026-07-30T00:00:00.000Z', runCount: 3 }
        }
      },
      now: '2026-07-31T00:00:00.000Z',
      limit: 1
    });

    assert.strictEqual(result.selected[0].offerId, '100002');
    assert.strictEqual(result.selected[0].productDiversity.noveltyStatus, 'new_offer');
    assert.strictEqual(result.stats.filteredReasons.recent_distributed_offer, 1);
  });

  test('limits suppliers across a shared batch state', () => {
    const state = createProductDiversityState();
    const first = selectDiverseProducts([
      row('100001', 90), row('100002', 89), row('100003', 88)
    ], { state, limit: 3, maxPerSupplier: 2 });
    const second = selectDiverseProducts([
      row('100004', 95), row('100005', 80, '店铺B')
    ], { state, limit: 1, maxPerSupplier: 2 });

    assert.strictEqual(first.selected.length, 2);
    assert.strictEqual(second.selected[0].offerId, '100005');
  });

  test('uses one explicit history fallback only when no fresh offer exists', () => {
    const result = selectDiverseProducts([row('100001', 95)], {
      history: {
        offers: {
          'offer:100001': { status: 'distributed', lastSeenAt: '2026-07-30T00:00:00.000Z', runCount: 3 }
        }
      },
      now: '2026-07-31T00:00:00.000Z',
      limit: 3,
      allowHistoryFallback: true
    });

    assert.strictEqual(result.selected.length, 1);
    assert.strictEqual(result.selected[0].productDiversity.noveltyStatus, 'history_fallback');
    assert.strictEqual(result.stats.historyFallbackCount, 1);
  });

  test('detects nearly identical normalized titles', () => {
    assert.ok(titleSimilarity('宿舍学生遮光床帘下铺专用', '宿舍学生遮光床帘下铺专用款') > 0.9);
  });
});
