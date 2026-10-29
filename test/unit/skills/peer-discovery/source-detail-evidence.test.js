'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSourceDetailEvidence, attachSourceSpecification } = require('../../../../skills/peer-discovery/src/source-detail-evidence');
const { collectSourceDetail } = require('../../../../skills/peer-discovery/src/source-detail-collector');

const raw = {
  url: 'https://detail.1688.com/offer/919085178721.html', title: '示例项链',
  minimumOrderTexts: ['首件预估到手价', '1PCS起批'], dimensions: ['颜色'], promotionText: '新人价 ¥27起',
  rows: [
    { specification: '4n60cm光面龙骨项链【30g】', priceTexts: ['¥28'], stockText: '库存5436PCS' },
    { specification: '6n60cm光面龙骨项链【60g】', priceTexts: ['¥32'], stockText: '库存5399PCS' }
  ]
};
const options = { offerId: '919085178721', now: 100, maxAgeMs: 1000 };

test('SKU prices remain separate from promotional minimum price', () => {
  const detail = normalizeSourceDetailEvidence(raw, options);
  assert.deepEqual(detail.skus.map(s => s.priceText), ['28', '32']);
  assert.ok(detail.skus.every(s => s.singlePiecePriceVerified));
  assert.equal(detail.minimumOrderQuantity, 1);
});

test('bulk tiers, packs, unknown dimensions and price ranges cannot be verified single-piece prices', () => {
  for (const delta of [
    { minimumOrderTexts: ['10PCS起批'] }, { minimumOrderTexts: ['1PCS起批', '100PCS起批'] },
    { dimensions: ['颜色', '尺寸'] }, { dimensions: [] },
    { rows: [{ ...raw.rows[0], priceTexts: ['¥1~28'] }] },
    { rows: [{ ...raw.rows[0], specification: '10个装' }] },
    { rows: [{ ...raw.rows[0], stockText: '库存100包' }] },
    { rows: [raw.rows[0], raw.rows[0]] }
  ]) {
    const detail = normalizeSourceDetailEvidence({ ...raw, ...delta }, options);
    assert.ok(detail.skus.every(s => !s.singlePiecePriceVerified && s.priceText === null));
  }
});

test('zero stock remains unavailable and missing stock remains unknown', () => {
  const detail = normalizeSourceDetailEvidence({ ...raw, rows: [
    { ...raw.rows[0], stockText: '库存0PCS' }, { ...raw.rows[1], stockText: '' }
  ] }, options);
  assert.equal(detail.skus[0].available, false);
  assert.equal(detail.skus[1].available, null);
});

test('returning-customer price restrictions remain explicit even with a one-piece minimum', () => {
  const detail = normalizeSourceDetailEvidence({ ...raw, minimumOrderTexts: ['1个起批60天老客价'], rows: [{ ...raw.rows[0], stockText: '库存49898个' }] }, options);
  assert.equal(detail.minimumOrderQuantity, 1);
  assert.equal(detail.skus[0].skuPriceText, '28');
  assert.equal(detail.skus[0].priceText, null);
  assert.deepEqual(detail.skus[0].issues, ['pricing_conditions_unverified']);
});

test('explicit selection is required and does not claim semantic matching or extend expiry', () => {
  const detail = normalizeSourceDetailEvidence(raw, options);
  const candidate = { offerId: options.offerId, observedAt: 50, expiresAt: 500, specStatus: 'consistent' };
  assert.throws(() => attachSourceSpecification(candidate, detail, { now: 150 }), /请选择/);
  const result = attachSourceSpecification(candidate, detail, { now: 150, specKey: detail.skus[1].specKey });
  assert.equal(result.priceText, '32');
  assert.equal(result.specStatus, 'unknown');
  assert.equal(result.observedAt, 50);
  assert.equal(result.expiresAt, 500);
  assert.throws(() => attachSourceSpecification(candidate, detail, { now: 500, specKey: detail.skus[0].specKey }), /过期/);
  assert.throws(() => normalizeSourceDetailEvidence(raw, { ...options, offerId: '123' }), /不一致/);
});

test('invalid identity and cancellation stop detail collection before browser access', async () => {
  await assert.rejects(collectSourceDetail('../123'), /无效/);
  await assert.rejects(collectSourceDetail('123', { signal: AbortSignal.abort() }), { code: 'PLATFORM_ACCESS_INTERRUPTED' });
});

test('real probe fixture details match verification expectations', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const fixturePath = path.join(__dirname, '../../../fixtures/peer-discovery/s0-probe-source-details.json');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert.equal(fixture.samples.length, 2);

  const sample1 = fixture.samples[0].data;
  assert.equal(sample1.offerId, '919085178721');
  assert.equal(sample1.minimumOrderQuantity, 1);
  assert.ok(sample1.skus.every(s => s.singlePiecePriceVerified));

  const sample2 = fixture.samples[1].data;
  assert.equal(sample2.offerId, '981227737111');
  assert.equal(sample2.minimumOrderQuantity, 1);
  assert.ok(sample2.skus.every(s => !s.singlePiecePriceVerified));
  assert.ok(sample2.skus.every(s => s.issues.includes('pricing_conditions_unverified')));
});

