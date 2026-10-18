'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePriceRatio, parsePrice, belowPriceRatio } = require('../../../../skills/peer-discovery/src/price-comparison');
const { normalizePeerDiscoveryParams } = require('../../../../skills/peer-discovery/src/params');
const { createAllocationPlan, splitAllocationBatches } = require('../../../../skills/peer-discovery/src/allocation-plan');
const { evidenceStatus, selectCurrentImageResults } = require('../../../../skills/peer-discovery/src/evidence');

test('price ratios canonicalize equivalent values and reject unsafe input', () => {
  assert.equal(normalizePriceRatio('001.000000'), '1');
  assert.equal(normalizePriceRatio(0.8), '0.8');
  for (const input of ['', true, null, [], {}, '0', '-1', '1e-7', '0.1234567', Infinity, '9'.repeat(65)]) assert.throws(() => normalizePriceRatio(input));
});

test('price comparison uses a shared scale and strict boundaries', () => {
  assert.equal(parsePrice('0.125'), 1250n);
  assert.equal(belowPriceRatio('29.89', '29.9'), true);
  assert.equal(belowPriceRatio('29.9', '29.90'), false);
  assert.equal(belowPriceRatio('79.99', '100', '0.8'), true);
  assert.equal(belowPriceRatio('80', '100', '0.8'), false);
  for (const value of ['0', '1-2', '1e2', '0.00001', 0.125]) assert.throws(() => parsePrice(value));
});

test('parameters fail before requests for bad TTL/count/branch and retain stable defaults', () => {
  const params = normalizePeerDiscoveryParams();
  assert.equal(params.evidenceMaxAgeMs, 86400000);
  assert.equal(params.imagePriceRatioThreshold, '1');
  assert.equal(params.port, 9222);
  assert.equal(params.similarityThreshold, 0.45);
  assert.equal(params.priceRatioThreshold, 0.7);
  assert.equal(normalizePeerDiscoveryParams({ allocationMethod: 'duplicate' }).allocationMethod, 'repeat');
  assert.equal(normalizePeerDiscoveryParams({ allocationMethod: 'sequential' }).allocationMethod, 'sequential-average');
  assert.throws(() => normalizePeerDiscoveryParams({ similarityThreshold: true }));
  assert.throws(() => normalizePeerDiscoveryParams({ similarityThreshold: 2 }));
  for (const value of [true, 1.9, '1.9', null, [], '', 0, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => normalizePeerDiscoveryParams({ evidenceMaxAgeMs: value }));
  assert.throws(() => normalizePeerDiscoveryParams({ collectLimit: 20, minProducts: 30 }));
  assert.doesNotThrow(() => normalizePeerDiscoveryParams({ discoveryBranch: 'image-selection', collectLimit: 20, minProducts: 30 }));
  assert.throws(() => normalizePeerDiscoveryParams({ discoveryBranch: 'unknown' }));
});

const options = { offerIds: ['1', '2', '3', '4', '5'], shopIds: ['B', 'A', 'C'], draftRevision: 'r1', seed: 'fixture' };

test('sequential average respects confirmed order and balances remainders', () => {
  const plan = createAllocationPlan(options);
  assert.deepEqual(plan.items.map(row => row.targetShopId), ['B', 'B', 'A', 'A', 'C']);
  assert.deepEqual(plan.counts.map(row => row.count), [2, 2, 1]);
  assert.deepEqual(options.offerIds, ['1', '2', '3', '4', '5']);
});

test('random modes are reproducible, no duplicates or lost offers', () => {
  for (const mode of ['random', 'random-average']) {
    const first = createAllocationPlan({ ...options, mode });
    const second = createAllocationPlan({ ...options, mode });
    assert.deepEqual(first.items, second.items);
    assert.deepEqual(first.items.map(row => row.offerId).sort(), options.offerIds);
    if (mode === 'random-average') assert.deepEqual(first.counts.map(row => row.count), [2, 2, 1]);
  }
});

test('allocation covers empty, fewer products than shops and repeat', () => {
  assert.equal(createAllocationPlan({ ...options, offerIds: [] }).items.length, 0);
  assert.deepEqual(createAllocationPlan({ ...options, offerIds: ['1'] }).counts.map(row => row.count), [1, 0, 0]);
  assert.equal(createAllocationPlan({ ...options, mode: 'repeat' }).items.length, 15);
  assert.throws(() => createAllocationPlan({ ...options, shopIds: [] }));
  assert.throws(() => createAllocationPlan({ ...options, offerIds: ['1', '1'] }));
  assert.throws(() => createAllocationPlan({ ...options, mode: 'manual' }));
});

test('batching round-trip exactly matches persisted plan, does not allocate again', () => {
  const plan = JSON.parse(JSON.stringify(createAllocationPlan({ ...options, mode: 'repeat' })));
  const batches = splitAllocationBatches(plan, 2);
  assert.equal(batches.length, 9);
  const pairs = batches.flatMap(batch => {
    assert.ok(batch.offerIds.length <= 2);
    assert.equal(batch.distributionMode, 'sequential-average');
    return batch.offerIds.map(offerId => `${batch.targetShopId}/${offerId}`);
  });
  assert.deepEqual(pairs.sort(), plan.items.map(row => `${row.targetShopId}/${row.offerId}`).sort());
  assert.deepEqual(splitAllocationBatches(plan, 2), batches);
  assert.equal(splitAllocationBatches(createAllocationPlan({ ...options, offerIds: [] })).length, 0);
  assert.throws(() => splitAllocationBatches(plan, 0));
});

test('evidence expiry is exclusive, missing/future dates do not become current', () => {
  const row = { observedAt: 100, expiresAt: 200 };
  assert.equal(evidenceStatus(row, { now: 100 }), 'current');
  assert.equal(evidenceStatus(row, { now: 199 }), 'current');
  assert.equal(evidenceStatus(row, { now: 200 }), 'expired');
  assert.equal(evidenceStatus(row, { now: 150, maxAgeMs: 50 }), 'expired');
  assert.equal(evidenceStatus(row, { now: 99 }), 'invalid');
  assert.equal(evidenceStatus({}, { now: 150 }), 'invalid');
  assert.throws(() => evidenceStatus(row, { now: NaN }));
});

test('latest current-version evidence wins; expiry never resurrects older confirmed', () => {
  const products = [{ productKey: 'A', snapshotRevision: 'v1' }];
  const config = { searchConfigHash: 's1', judgeConfigHash: 'j1', now: 150 };
  const row = { ...products[0], searchConfigHash: 's1', judgeConfigHash: 'j1', observedAt: 100, expiresAt: 200, verdict: 'confirmed' };
  assert.equal(selectCurrentImageResults(products, [row], config).results.length, 1);
  const stale = selectCurrentImageResults(products, [row, { ...row, expiresAt: 140 }], config);
  assert.deepEqual(stale, { results: [], pending: [{ productKey: 'A', reason: 'expired' }] });
  assert.equal(selectCurrentImageResults([], [row], config).results.length, 0);
  assert.equal(selectCurrentImageResults(products, [{ ...row, snapshotRevision: 'old' }], config).pending[0].reason, 'missing');
  assert.throws(() => selectCurrentImageResults(products, [row], {}));
});
