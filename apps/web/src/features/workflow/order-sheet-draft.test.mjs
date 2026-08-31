import assert from 'node:assert/strict';
import test from 'node:test';

import { toDraftPayload, trimDraftProduct } from './order-sheet-draft.js';

const product = {
  itemId: '1001',
  productUrl: 'https://item.taobao.com/item.htm?id=1001',
  role: 'main',
  title: '测试商品',
  orderAmount: 39.9,
  storeName: '测试店',
  imageUrl: 'https://img.alicdn.com/main.jpg',
  skuOptions: Array.from({ length: 20 }, (_unused, index) => ({
    skuId: `s${index}`,
    name: `规格${index}`,
    price: 10 + index,
    available: true,
    imageUrl: `https://img.alicdn.com/${'x'.repeat(40)}${index}.jpg`
  })),
  selectedSkuId: 's3',
  selectedSkuName: '规格3',
  selectedSkuPrice: 13,
  selectedSkuImageUrl: 'https://img.alicdn.com/s3.jpg',
  lowestSkuId: 's0',
  lowestSkuName: '规格0',
  lowestSkuPrice: 10,
  skuSelectionMode: 'manual',
  visitorCount: 1234,
  paidItemCount: 5,
  rank: 2,
  sourcePage: 1,
  enrichmentStatus: 'complete',
  sortMetric: 'itmUv'
};

test('draft payload drops bulky static fields but keeps identity and edits', () => {
  const trimmed = trimDraftProduct(product);
  assert.equal(trimmed.skuOptions, undefined);
  assert.equal(trimmed.imageUrl, undefined);
  assert.equal(trimmed.visitorCount, undefined);
  assert.equal(trimmed.enrichmentStatus, undefined);
  assert.equal(trimmed.itemId, '1001');
  assert.equal(trimmed.productUrl, 'https://item.taobao.com/item.htm?id=1001');
  assert.equal(trimmed.title, '测试商品');
  assert.equal(trimmed.orderAmount, 39.9);
  assert.equal(trimmed.selectedSkuId, 's3');
  assert.equal(trimmed.selectedSkuImageUrl, 'https://img.alicdn.com/s3.jpg');
  assert.equal(trimmed.skuSelectionMode, 'manual');
});

test('explicit empty edits survive trimming so clearing a value still reaches the server', () => {
  const trimmed = trimDraftProduct({ ...product, orderAmount: null, storeName: '' });
  assert.equal('orderAmount' in trimmed, true);
  assert.equal(trimmed.orderAmount, null);
  assert.equal('storeName' in trimmed, true);
  assert.equal(trimmed.storeName, '');
});

test('group structure survives and the payload shrinks by more than 80%', () => {
  const groups = [{ id: 'group_1', name: '组 1', mainProduct: product, subProducts: [product, product] }];
  const unassignedItems = [product];
  const payload = toDraftPayload({ revision: 7, dragCount: 3, groups, unassignedItems });

  assert.equal(payload.revision, 7);
  assert.equal(payload.dragCount, 3);
  assert.equal(payload.groups[0].id, 'group_1');
  assert.equal(payload.groups[0].name, '组 1');
  assert.equal(payload.groups[0].subProducts.length, 2);
  assert.equal(payload.groups[0].mainProduct.skuOptions, undefined);
  assert.equal(payload.unassignedItems[0].skuOptions, undefined);

  const full = JSON.stringify({ groups, unassignedItems }).length;
  const minimal = JSON.stringify(payload).length;
  assert.ok(minimal < full * 0.2, `负载应显著缩小，实际 ${minimal} / ${full}`);
});
