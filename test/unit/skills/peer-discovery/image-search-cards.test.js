'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeImageSearchCard } = require('../../../../skills/peer-discovery/src/image-search-cards');

const card = {
  renderKey: '1_0_normal_b2b-example_919085178721', title: '测试项链',
  displayPrice: '¥26\n.6', descriptions: ['运费3.5元', '200+件', '1件起批'],
  imageUrl: 'https://cbu01.alicdn.com/example.jpg'
};

test('card identity and split decimal are extracted without verifying SKU price', () => {
  const result = normalizeImageSearchCard(card, { now: 1000, maxAgeMs: 5000 });
  assert.equal(result.offerId, '919085178721');
  assert.equal(result.displayPriceText, '26.6');
  assert.equal(result.minimumOrderQuantity, 1);
  assert.equal(result.priceText, null);
  assert.equal(result.singlePiecePriceVerified, false);
  assert.equal(result.similarity, null);
  assert.equal(result.expiresAt, 6000);
});

test('promotions and price ranges cannot silently become comparable prices', () => {
  const result = normalizeImageSearchCard({ ...card, displayPrice: '¥3-27', promotionText: '新人价', descriptions: ['10件起批'] });
  assert.equal(result.displayPriceText, null);
  assert.equal(result.promotionalPrice, true);
  assert.equal(result.minimumOrderQuantity, 10);
});

test('missing card identity or title is not a usable candidate', () => {
  assert.equal(normalizeImageSearchCard({ ...card, renderKey: '' }), null);
  assert.equal(normalizeImageSearchCard({ ...card, title: ' ' }), null);
  assert.throws(() => normalizeImageSearchCard(card, { maxAgeMs: -1 }));
});

test('real probe fixture cards are all normalized with 100% identity and MOQ coverage', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const fixturePath = path.join(__dirname, '../../../fixtures/peer-discovery/s0-probe-1688-image-search.json');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert.equal(fixture.totalCards, 60);
  const normalized = fixture.rawCards.map(c => normalizeImageSearchCard(c)).filter(Boolean);
  assert.equal(normalized.length, 60);
  assert.ok(normalized.every(c => c.offerId && Number.isInteger(c.minimumOrderQuantity) && c.minimumOrderQuantity >= 1));
  assert.equal(normalized.filter(c => c.minimumOrderQuantity === 1).length, 53);
  assert.equal(normalized.filter(c => c.minimumOrderQuantity > 1).length, 7);
  assert.ok(normalized.every(c => c.singlePiecePriceVerified === false));
});

