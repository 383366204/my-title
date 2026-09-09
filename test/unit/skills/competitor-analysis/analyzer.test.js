'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeCompetitorData, compareCompetitorSnapshots } = require('../../../../skills/competitor-analysis/src/analyzer');

test('identifies new products that also occur in the hot list', () => {
  const shops = [{ shopKey: 'shop:1', shopName: '测试店', shopUrl: 'https://shop1.taobao.com/', categories: [] }];
  const hot = [{ shopKey: 'shop:1', shopName: '测试店', sortType: 'hot', rank: 1, title: '树脂立体冰箱贴旅游纪念品', paymentText: '600+人付款', paymentLowerBound: 600 }];
  const fresh = [{ shopKey: 'shop:1', shopName: '测试店', sortType: 'new', rank: 2, title: '树脂立体冰箱贴旅游纪念品', paymentText: '100+人付款', paymentLowerBound: 100 }];
  const result = analyzeCompetitorData(shops, hot, fresh);
  assert.equal(result.totals.hotNewOverlap, 1);
  assert.equal(result.newProducts[0].potential.hotOverlap, true);
  assert.ok(result.newProducts[0].potential.reasons.includes('同时进入销量榜'));
});

test('compares list samples without claiming missing rows were removed from sale', () => {
  const comparison = compareCompetitorSnapshots({
    hotProducts: [{ shopKey: 'shop:1', title: '新品A', paymentLowerBound: 20 }],
    newProducts: [{ shopKey: 'shop:1', title: '新品B', paymentLowerBound: 5 }]
  }, {
    hotProducts: [{ shopKey: 'shop:1', title: '旧品A', paymentLowerBound: 10 }],
    newProducts: [{ shopKey: 'shop:1', title: '新品B', paymentLowerBound: 2 }]
  }, { baselineRunId: 'prior-run' });

  assert.equal(comparison.baselineRunId, 'prior-run');
  assert.deepEqual(comparison.newlyObservedHot.map(item => item.title), ['新品A']);
  assert.deepEqual(comparison.noLongerObservedHot.map(item => item.title), ['旧品A']);
  assert.equal(comparison.paymentChanges[0].deltaLowerBound, 3);
  assert.match(comparison.evidenceNotice, /未出现不等于下架/);
});
