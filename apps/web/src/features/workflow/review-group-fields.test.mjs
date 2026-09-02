import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REVIEW_GROUP_FIELDS,
  REQUIRED_REVIEW_GROUP_FIELDS,
  describeRequiredReviewGroupFields,
  findMissingReviewGroupFields
} from './review-group-fields.js';

test('only the date and store name are required for a review order group', () => {
  assert.deepEqual(REQUIRED_REVIEW_GROUP_FIELDS, ['orderDate', 'storeName']);
  assert.deepEqual(
    REVIEW_GROUP_FIELDS.filter(item => !item.required).map(item => item.field),
    ['buyerName', 'buyerPhone', 'orderNumber']
  );
  assert.equal(describeRequiredReviewGroupFields(), '刷单日期、店铺名');
});

test('missing fields are reported per group and ignore optional blanks', () => {
  assert.deepEqual(findMissingReviewGroupFields([]), []);
  assert.deepEqual(findMissingReviewGroupFields([
    { id: 'group-1', orderDate: '2026-09-01', storeName: '拾珀天晶' }
  ]), []);
  assert.deepEqual(findMissingReviewGroupFields([
    { id: 'group-1', orderDate: '2026-09-01', storeName: '拾珀天晶' },
    { id: 'group-2', orderDate: '  ', storeName: '' }
  ]), ['2:orderDate', '2:storeName']);
});
