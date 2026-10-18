'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { judgeImageCandidate, verifyImageSources } = require('../../../../skills/peer-discovery/src/image-sourcing-matcher');

const source = { priceText: '100', singlePiecePriceVerified: true, currency: 'CNY', imageDigest: 'img1', observedAt: 100, expiresAt: 200 };
const candidate = { offerId: '1', priceText: '79.99', currency: 'CNY', similarity: 0.8, singlePiecePriceVerified: true, available: true, specStatus: 'consistent', observedAt: 100, expiresAt: 200 };
const options = { now: 150, imagePriceRatioThreshold: '0.8' };

test('image judgement requires positive, current and comparable evidence', () => {
  assert.equal(judgeImageCandidate(source, candidate, options).level, 'confirmed');
  assert.equal(judgeImageCandidate({ ...source, singlePiecePriceVerified: false }, candidate, options).reason, 'price_not_comparable');
  for (const [delta, level] of [
    [{ priceText: '80' }, 'rejected'], [{ specStatus: 'unknown' }, 'suspected'],
    [{ specStatus: 'inconsistent' }, 'rejected'], [{ currency: 'USD' }, 'inconclusive'],
    [{ singlePiecePriceVerified: false }, 'inconclusive'], [{ available: false }, 'rejected'],
    [{ available: undefined }, 'inconclusive'], [{ priceText: '1-2' }, 'inconclusive'],
    [{ observedAt: 151 }, 'inconclusive'], [{ expiresAt: 150 }, 'inconclusive'],
    [{ similarity: 0.1 }, 'rejected'], [{ similarity: undefined }, 'inconclusive']
  ]) assert.equal(judgeImageCandidate(source, { ...candidate, ...delta }, options).level, level);
});

test('verifies all image candidates without five-result early exit', async () => {
  const provider = { search: async () => ({ ok: true, complete: true, candidates: Array.from({ length: 8 }, (_, i) => ({ ...candidate, offerId: String(i) })) }) };
  const result = await verifyImageSources(source, { ...options, provider });
  assert.equal(result.confirmedCount, 8);
  assert.equal(result.noSources, false);
});

test('uploaded image digest fills source identity without weakening other evidence gates', async () => {
  const provider = { search: async () => ({ ok: true, imageDigest: 'actual-upload', candidates: [candidate] }) };
  const input = { ...source, imageDigest: undefined };
  assert.equal((await verifyImageSources(input, { ...options, provider })).confirmedCount, 1);
  assert.equal(input.imageDigest, undefined);
  assert.equal((await verifyImageSources({ ...input, singlePiecePriceVerified: false }, { ...options, provider })).confirmedCount, 0);
});

test('missing provider, platform failure and incomplete response never pretend no sources', async () => {
  await assert.rejects(() => verifyImageSources(source), { code: 'IMAGE_SEARCH_PROVIDER_UNAVAILABLE' });
  const error = Object.assign(new Error('captcha'), { code: 'CAPTCHA_REQUIRED' });
  await assert.rejects(() => verifyImageSources(source, { provider: { search: async () => { throw error; } } }), e => e === error);
  for (const complete of [false, true]) {
    const result = await verifyImageSources(source, { provider: { search: async () => ({ ok: true, complete, candidates: [] }) } });
    assert.equal(result.noSources, complete);
  }
  await assert.rejects(() => verifyImageSources(source, { provider: { search: async () => ({ ok: false, candidates: [] }) } }));
});
