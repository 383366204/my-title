const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  normalizeHistoryKeyword,
  buildHistoryKeys,
  normalizeHistoryRecord,
  shouldSuppressHistoryRecord
} = require('../history-record');

describe('history-record', () => {
  test('normalizes keyword and builds stable keys', () => {
    const keys = buildHistoryKeys({
      keyword: '  纯银 吊坠 ',
      signature: '吊坠|纯银',
      coreProduct: '吊坠'
    });

    assert.strictEqual(keys.normalizedKeyword, '纯银吊坠');
    assert.strictEqual(keys.keywordKey, 'kw:纯银吊坠');
    assert.strictEqual(keys.signatureKey, 'sig:吊坠|纯银');
    assert.strictEqual(keys.coreProductKey, 'core:吊坠');
  });

  test('normalizes candidate records for browser and desktop stores', () => {
    const record = normalizeHistoryRecord({
      keyword: '纯银吊坠',
      signature: '吊坠|纯银',
      coreProduct: '吊坠',
      gateStatus: 'verified',
      canDistribute: true,
      marketMetrics: { searchPopularity: 128, demandSupplyRatio: 1.4 },
      source: 'local'
    }, { now: '2026-06-27T00:00:00.000Z' });

    assert.strictEqual(record.id, 'sig:吊坠|纯银');
    assert.strictEqual(record.status, 'verified');
    assert.strictEqual(record.seenCount, 1);
    assert.strictEqual(record.firstSeenAt, '2026-06-27T00:00:00.000Z');
    assert.strictEqual(record.lastSeenAt, '2026-06-27T00:00:00.000Z');
    assert.strictEqual(record.canDistribute, true);
  });

  test('does not suppress candidate-only records by default', () => {
    const candidate = {
      signature: '吊坠|纯银',
      lastSeenAt: '2026-06-26T00:00:00.000Z',
      status: 'candidate'
    };

    assert.strictEqual(shouldSuppressHistoryRecord(candidate, {
      now: '2026-06-27T00:00:00.000Z'
    }).suppress, false);
  });

  test('suppresses recent generated signatures but allows old records', () => {
    const recent = {
      signature: '吊坠|纯银',
      lastSeenAt: '2026-06-20T00:00:00.000Z',
      status: 'generated'
    };
    const old = {
      signature: '吊坠|纯银',
      lastSeenAt: '2026-04-01T00:00:00.000Z',
      status: 'generated'
    };

    assert.strictEqual(shouldSuppressHistoryRecord(recent, {
      now: '2026-06-27T00:00:00.000Z',
      generatedCooldownDays: 30
    }).suppress, true);
    assert.strictEqual(shouldSuppressHistoryRecord(old, {
      now: '2026-06-27T00:00:00.000Z',
      generatedCooldownDays: 30
    }).suppress, false);
  });

  test('treats pending review records as recent generated work', () => {
    const pending = {
      signature: '吊坠|纯银',
      lastSeenAt: '2026-06-26T00:00:00.000Z',
      status: 'pending_review'
    };

    const decision = shouldSuppressHistoryRecord(pending, {
      now: '2026-06-27T00:00:00.000Z',
      generatedCooldownDays: 30
    });

    assert.strictEqual(decision.suppress, true);
    assert.strictEqual(decision.reason, 'recent_generated_signature');
  });

  test('uses longer cooldown for rejected records', () => {
    const rejected = {
      signature: '宿舍好物|收纳',
      lastSeenAt: '2026-05-01T00:00:00.000Z',
      status: 'rejected'
    };

    const decision = shouldSuppressHistoryRecord(rejected, {
      now: '2026-06-27T00:00:00.000Z',
      rejectedCooldownDays: 90
    });

    assert.strictEqual(decision.suppress, true);
    assert.strictEqual(decision.reason, 'recent_rejected_signature');
  });
});
