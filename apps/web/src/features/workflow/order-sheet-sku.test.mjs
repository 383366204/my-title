import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTO_LOWEST_SKU,
  applySkuSelection,
  availableSkuOptions,
  skuSelectionValue
} from './order-sheet-sku.js';

const item = {
  imageUrl: 'https://img.alicdn.com/main.jpg',
  skuOptions: [
    { skuId: 'high', name: '黑色 / XL', price: 39, quantity: 3, available: true, imageUrl: 'https://img.alicdn.com/high.jpg' },
    { skuId: 'sold', name: '白色 / L', price: 9, quantity: 0, available: false },
    { skuId: 'low', name: '蓝色 / M', price: 19.9, quantity: 8, available: true, imageUrl: 'https://img.alicdn.com/low.jpg' }
  ]
};

test('SKU selection defaults to the lowest available price', () => {
  assert.deepEqual(availableSkuOptions(item).map(option => option.skuId), ['low', 'high']);
  assert.deepEqual(applySkuSelection(item, AUTO_LOWEST_SKU), {
    selectedSkuId: 'low',
    selectedSkuName: '蓝色 / M',
    selectedSkuPrice: 19.9,
    lowestSkuId: 'low',
    lowestSkuName: '蓝色 / M',
    lowestSkuPrice: 19.9,
    skuSelectionMode: 'lowest',
    orderAmount: 19.9,
    selectedSkuImageUrl: 'https://img.alicdn.com/low.jpg'
  });
  assert.equal(skuSelectionValue(item), AUTO_LOWEST_SKU);
});

test('SKU selection uses the manually selected SKU price', () => {
  const selected = applySkuSelection(item, 'high');
  assert.equal(selected.selectedSkuId, 'high');
  assert.equal(selected.selectedSkuPrice, 39);
  assert.equal(selected.orderAmount, 39);
  assert.equal(selected.skuSelectionMode, 'manual');
  assert.equal(selected.selectedSkuImageUrl, 'https://img.alicdn.com/high.jpg');
  assert.equal(skuSelectionValue(selected), 'high');
});

test('SKU selection never replaces the product main image used by the sheet', () => {
  const patch = applySkuSelection(item, 'high');
  assert.equal('imageUrl' in patch, false);
  const merged = { ...item, ...patch };
  assert.equal(merged.imageUrl, 'https://img.alicdn.com/main.jpg');
  assert.equal(merged.selectedSkuImageUrl, 'https://img.alicdn.com/high.jpg');
});
