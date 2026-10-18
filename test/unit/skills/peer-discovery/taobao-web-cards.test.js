'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTaobaoWebCards } = require('../../../../skills/peer-discovery/src/taobao-web-cards');

test('web cards retain display evidence without certifying promotional price', () => {
  const row = { url: 'https://item.taobao.com/item.htm?id=123&spm=tracking', title: '商品', displayPriceText: '38.8', paymentText: '100+人付款', shopUrl: 'https://store.taobao.com/shop/view_shop.htm?appUid=abc&spm=tracking' };
  const [product] = normalizeTaobaoWebCards([row, row], { now: 100, maxAgeMs: 200 });
  assert.equal(normalizeTaobaoWebCards([row, row]).length, 1);
  assert.equal(product.url, 'https://item.taobao.com/item.htm?id=123');
  assert.equal(product.displayPriceText, '38.8');
  assert.equal(product.priceText, null);
  assert.equal(product.singlePiecePriceVerified, false);
  assert.equal(product.paymentText, '100+人付款');
  assert.equal(product.expiresAt, 300);
  assert.equal(product.shopUrl, 'https://store.taobao.com/shop/view_shop.htm?appUid=abc');
});

test('invalid product identities are rejected; missing shop remains unknown', () => {
  assert.deepEqual(normalizeTaobaoWebCards([null, { title: '商品', url: 'https://item.taobao.com.evil.test/item.htm?id=1' }]), []);
  const [product] = normalizeTaobaoWebCards([{ title: '商品', url: 'https://detail.tmall.com/item.htm?id=1', shopUrl: 'javascript:alert(1)' }]);
  assert.equal(product.shopUrl, null);
  assert.throws(() => normalizeTaobaoWebCards([], { maxAgeMs: -1 }));
});

test('real probe fixture taobao web cards normalize cleanly with payment and shop evidence', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const fixturePath = path.join(__dirname, '../../../fixtures/peer-discovery/s0-probe-taobao-web-cards.json');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert.equal(fixture.totalSamples, 6);
  const normalized = normalizeTaobaoWebCards(fixture.rawCards, { now: 1000, maxAgeMs: 5000 });
  assert.equal(normalized.length, 6);
  assert.ok(normalized.every(p => p.itemId && p.title && p.channel === 'web'));
  assert.equal(normalized.filter(p => p.shopUrl !== null).length, 5);
  assert.equal(normalized.find(p => p.itemId === '739102847192').shopUrl, null);
});

