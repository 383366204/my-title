import test from 'node:test';
import assert from 'node:assert/strict';
import { productSelectionView } from '../../../apps/web/src/features/workflow/product-selection-view.js';

test('502 failures are diagnostics, not nameless selectable products', () => {
  const result = productSelectionView([{ status: 'select_failed', keyword: '收纳盒', error: 'Request failed with status code 502' }]);
  assert.equal(result.products.length, 0);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].error, /HTTP 502/);
});

test('actual products retain source title and category aliases alongside failures', () => {
  const result = productSelectionView([
    { keyword: '杯垫', product: { '产品链接': 'https://detail.1688.com/offer/123.html', subject: '硅藻土杯垫', stats: { categoryListName: '家居 > 杯垫' } } },
    { status: 'enrich_failed', url: 'https://detail.1688.com/offer/456.html', enrichError: '资料读取失败' }
  ]);
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].sourceTitle, '硅藻土杯垫');
  assert.equal(result.products[0].recommendedCategory, '家居 > 杯垫');
  assert.equal(result.failures.length, 1);
});
