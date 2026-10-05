import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePastedOrder } from '../../../apps/web/src/features/workflow/review-paste-parser.js';

const sample = `
订单编号：3316868653089013989
买家旺旺：penguin玄珠
收货电话：14727236390-8997
`;

test('parses the canonical pasted order format', () => {
  assert.deepEqual(parsePastedOrder(sample), {
    orderNumber: '3316868653089013989',
    buyerName: 'penguin玄珠',
    buyerPhone: '14727236390-8997'
  });
});

test('splits fields even when newlines are stripped by a single-line input', () => {
  const flattened = '订单编号：3316868653089013989买家旺旺：penguin玄珠收货电话：14727236390-8997';
  assert.deepEqual(parsePastedOrder(flattened), {
    orderNumber: '3316868653089013989',
    buyerName: 'penguin玄珠',
    buyerPhone: '14727236390-8997'
  });
});

test('supports half-width colons and alternative labels', () => {
  assert.deepEqual(parsePastedOrder('订单号: A1\n旺旺: 买家甲\n手机号: 13800000000'), {
    orderNumber: 'A1',
    buyerName: '买家甲',
    buyerPhone: '13800000000'
  });
});

test('ignores unrelated lines', () => {
  const record = parsePastedOrder('商品名称：测试商品\n订单编号：A9\n物流单号：SF123\n买家旺旺：测试买家');
  assert.equal(record.orderNumber, 'A9');
  assert.equal(record.buyerName, '测试买家');
  assert.equal(record.buyerPhone, '');
});

test('keeps the first occurrence of each field', () => {
  const record = parsePastedOrder('订单编号：A1\n订单编号：A2\n买家旺旺：买家甲');
  assert.equal(record.orderNumber, 'A1');
  assert.equal(record.buyerName, '买家甲');
});

test('returns null when nothing recognizable is pasted', () => {
  assert.equal(parsePastedOrder('商品名称：测试商品\n备注：无'), null);
  assert.equal(parsePastedOrder(''), null);
});