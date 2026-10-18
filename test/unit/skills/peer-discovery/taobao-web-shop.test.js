'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTaobaoWebShop } = require('../../../../skills/peer-discovery/src/taobao-web-shop');
const { validateWebShopUrl } = require('../../../../skills/peer-discovery/src/taobao-web-shop-collector');
const product = { url: 'https://item.taobao.com/item.htm?id=123', title: '商品', paymentText: '200+人付款', displayPriceText: '6??', priceLabel: '首单价' };

test('shop snapshots preserve masked promotional prices and incomplete collection', () => {
  const snapshot = normalizeTaobaoWebShop({ sortLabel: '销量', products: [product] }, { shopKey: 'shop:123', now: 10, maxAgeMs: 20 });
  assert.equal(snapshot.completeness, 'uncertain');
  assert.equal(snapshot.expiresAt, 30);
  assert.equal(snapshot.products[0].displayPriceText, '6??');
  assert.equal(snapshot.products[0].priceLabel, '首单价');
  assert.equal(snapshot.products[0].priceText, null);
  assert.equal(snapshot.products[0].evidenceScope, 'shop_loaded_cards');
});

test('wrong sort and empty pages cannot become valid shop snapshots', () => {
  assert.throws(() => normalizeTaobaoWebShop({ sortLabel: '综合', products: [product] }, { shopKey: 's' }), { code: 'SHOP_SORT_UNVERIFIED' });
  assert.throws(() => normalizeTaobaoWebShop({ sortLabel: '新品', products: [] }, { shopKey: 's', sort: 'new' }), { code: 'SHOP_PRODUCTS_UNVERIFIED' });
  assert.equal(normalizeTaobaoWebShop({ sortLabel: '新品', products: [product] }, { shopKey: 's', sort: 'new' }).sort, 'new');
});

test('shop navigation rejects ads, product pages and foreign hosts', () => {
  assert.equal(validateWebShopUrl('http://shop123.taobao.com/'), 'https://shop123.taobao.com/');
  assert.equal(validateWebShopUrl('https://store.taobao.com/shop/view_shop.htm?appUid=abc'), 'https://store.taobao.com/shop/view_shop.htm?appUid=abc');
  for (const url of ['https://mclick.simba.taobao.com/cc_im', 'https://item.taobao.com/', 'https://shop123.taobao.com.evil.test/', 'https://user:pass@shop123.taobao.com/']) {
    assert.throws(() => validateWebShopUrl(url));
  }
});
