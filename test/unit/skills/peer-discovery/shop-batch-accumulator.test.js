'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createShopBatchAccumulator } = require('../../../../skills/peer-discovery/src/shop-batch-accumulator');
const snapshot = (ids, time = 10) => ({ shopKey: 'shop', sort: 'hot', observedAt: time, expiresAt: time + 100, products: ids.map(itemId => ({ itemId, observedAt: time, expiresAt: time + 100 })) });

test('scroll batches deduplicate in first-seen order and retain evidence age', () => {
  const batches = createShopBatchAccumulator(3);
  assert.equal(batches.add(snapshot(['1', '2'])).stopReason, null);
  const result = batches.add(snapshot(['2', '3', '4'], 20));
  assert.deepEqual(result.products.map(p => p.itemId), ['1', '2', '3']);
  assert.equal(result.observedAt, 10);
  assert.equal(result.expiresAt, 110);
  assert.equal(result.stopReason, 'limit_reached');
  assert.equal(result.completeness, 'uncertain');
});

test('unchanged pages remain incomplete and shop/sort changes fail', () => {
  const batches = createShopBatchAccumulator(10);
  batches.add(snapshot(['1']));
  assert.equal(batches.add(snapshot(['1'])).added, 0);
  assert.throws(() => batches.add({ ...snapshot(['2']), sort: 'new' }));
  assert.throws(() => createShopBatchAccumulator(0));
});
