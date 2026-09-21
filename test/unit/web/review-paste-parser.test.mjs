import assert from 'node:assert/strict';
import test from 'node:test';

import { applyPastedOrders, parsePastedOrders } from '../../../apps/web/src/features/workflow/review-paste-parser.js';

const sample = `
订单编号：3316868653089013989
买家旺旺：penguin玄珠
收货电话：14727236390-8997
`;

test('parses the canonical pasted order format', () => {
  const records = parsePastedOrders(sample);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    orderNumber: '3316868653089013989',
    buyerName: 'penguin玄珠',
    buyerPhone: '14727236390-8997'
  });
});

test('supports half-width colons and alternative labels', () => {
  const records = parsePastedOrders('订单号: A1\n旺旺: 买家甲\n手机号: 13800000000');
  assert.deepEqual(records[0], { orderNumber: 'A1', buyerName: '买家甲', buyerPhone: '13800000000' });
});

test('splits multiple orders when the same field appears again', () => {
  const text = '订单编号：111\n买家旺旺：甲\n收货电话：13800000001\n订单编号：222\n买家旺旺：乙\n收货电话：13800000002';
  const records = parsePastedOrders(text);
  assert.equal(records.length, 2);
  assert.equal(records[0].orderNumber, '111');
  assert.equal(records[1].buyerName, '乙');
});

test('ignores unrelated lines', () => {
  const records = parsePastedOrders('商品名称：测试商品\n订单编号：A9\n物流单号：SF123\n买家旺旺：测试买家');
  assert.equal(records.length, 1);
  assert.equal(records[0].orderNumber, 'A9');
  assert.equal(records[0].buyerName, '测试买家');
  assert.equal(records[0].buyerPhone, '');
});

test('fills groups by exact order number first', () => {
  const groups = [
    { id: 'g1', orderNumber: '222', buyerName: '', buyerPhone: '' },
    { id: 'g2', orderNumber: '111', buyerName: '', buyerPhone: '' }
  ];
  const result = applyPastedOrders(groups, [
    { orderNumber: '111', buyerName: '甲', buyerPhone: '13800000001' },
    { orderNumber: '222', buyerName: '乙', buyerPhone: '13800000002' }
  ]);
  assert.equal(result.groups[0].buyerName, '乙');
  assert.equal(result.groups[1].buyerName, '甲');
  assert.equal(result.summary.byOrderNumber, 2);
  assert.equal(result.summary.sequential, 0);
});

test('sequentially fills inferred groups without order numbers', () => {
  const groups = [
    { id: 'g1', orderNumber: '', buyerName: '', buyerPhone: '' },
    { id: 'g2', orderNumber: '', buyerName: '', buyerPhone: '' }
  ];
  const result = applyPastedOrders(groups, [
    { orderNumber: 'A1', buyerName: '甲', buyerPhone: '13800000001' },
    { orderNumber: 'A2', buyerName: '乙', buyerPhone: '13800000002' }
  ]);
  assert.equal(result.groups[0].orderNumber, 'A1');
  assert.equal(result.groups[0].buyerName, '甲');
  assert.equal(result.groups[1].orderNumber, 'A2');
  assert.equal(result.summary.sequential, 2);
});

test('never overwrites manually filled fields', () => {
  const groups = [{ id: 'g1', orderNumber: 'A1', buyerName: '人工填的', buyerPhone: '' }];
  const result = applyPastedOrders(groups, [
    { orderNumber: 'A1', buyerName: '粘贴的', buyerPhone: '13800000000' }
  ]);
  assert.equal(result.groups[0].buyerName, '人工填的');
  assert.equal(result.groups[0].buyerPhone, '13800000000');
});

test('reports leftover records as skipped when groups run out', () => {
  const result = applyPastedOrders([{ id: 'g1', orderNumber: 'A1', buyerName: '', buyerPhone: '' }], [
    { orderNumber: 'A1', buyerName: '甲', buyerPhone: '1' },
    { orderNumber: 'A2', buyerName: '乙', buyerPhone: '2' }
  ]);
  assert.equal(result.summary.byOrderNumber, 1);
  assert.equal(result.summary.skipped, 1);
});