'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isCandidateCurrent, selectCurrentImageResults } = require('../../../../skills/peer-discovery/src/evidence');

const candidate = { offerId: '1', observedAt: 100, expiresAt: 200, verdict: { level: 'confirmed', expiresAt: 200 } };
const options = { now: 150, maxAgeMs: 1000, searchConfigHash: 's', judgeConfigHash: 'j' };

test('candidate timestamps must be present, valid and current', () => {
  assert.equal(isCandidateCurrent(candidate, options), true);
  for (const field of ['observedAt', 'expiresAt']) {
    for (const value of [undefined, null, '100', NaN, Infinity, -1, 1.5]) {
      assert.equal(isCandidateCurrent({ ...candidate, [field]: value }, options), false, `${field}=${value}`);
    }
  }
  assert.equal(isCandidateCurrent({ ...candidate, observedAt: 151 }, options), false);
  assert.equal(isCandidateCurrent({ ...candidate, expiresAt: 150 }, options), false);
});

test('verdict expiry is mandatory while omitted observation time inherits candidate time', () => {
  for (const value of [undefined, null, '200', NaN, Infinity, 100, 149]) {
    assert.equal(isCandidateCurrent({ ...candidate, verdict: { level: 'confirmed', expiresAt: value } }, options), false);
  }
  for (const verdict of [null, [], 'confirmed', { ...candidate.verdict, observedAt: null }, { ...candidate.verdict, observedAt: '100' }]) {
    assert.equal(isCandidateCurrent({ ...candidate, verdict }, options), false);
  }
  assert.equal(isCandidateCurrent(candidate, options), true);
});

test('current outer result cannot authorize a confirmed candidate without timestamps', () => {
  const product = { productKey: 'p', snapshotRevision: 'v' };
  const row = { ...product, observedAt: 100, expiresAt: 200, searchConfigHash: 's', judgeConfigHash: 'j', candidates: [{ offerId: '1', verdict: { level: 'confirmed' } }] };
  const result = selectCurrentImageResults([product], [row], options);
  assert.equal(result.results.length, 0);
  assert.equal(result.pending.length, 1);
});
