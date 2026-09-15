'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeCompetitorData, compareCompetitorSnapshots } = require('../../../../skills/competitor-analysis/src/analyzer');

test('same title in another shop or a different item never establishes hot overlap', () => {
  const hot = [{ shopKey: 'a', itemId: '1', title: '保温水杯' }];
  const fresh = [{ shopKey: 'b', itemId: '1', title: '保温水杯' }, { shopKey: 'a', itemId: '2', title: '保温水杯' }];
  assert.equal(analyzeCompetitorData([], hot, fresh).totals.hotNewOverlap, 0);
  const renamed = [{ shopKey: 'a', itemId: '1', title: '新标题保温杯' }];
  assert.equal(analyzeCompetitorData([], hot, renamed).totals.hotNewOverlap, 1);
});

test('duplicate list memberships cannot invent frequent keywords', () => {
  const product = { shopKey: 'a', itemId: '1', title: '保温水杯' };
  const result = analyzeCompetitorData([], [product, product], [product]);
  assert.deepEqual(result.opportunityKeywords, []);
  assert.equal(result.totals.hotProducts, 1);
});

test('keyword coverage includes distinct shops and traceable products', () => {
  const products = ['a', 'b'].map(shopKey => ({ shopKey, itemId: '1', title: '保温水杯' }));
  const result = analyzeCompetitorData([], products, products);
  assert.ok(result.opportunityKeywords.length > 0);
  for (const word of result.opportunityKeywords) {
    assert.equal(word.productCount, 2);
    assert.equal(word.shopCount, 2);
    assert.equal(word.sources.length, 2);
  }
});

test('adding a large unrelated shop does not change the original shop score', () => {
  const product = { shopKey: 'a', itemId: '1', title: '保温水杯', rank: 1, paymentLowerBound: 10 };
  const first = analyzeCompetitorData([], [], [product]).newProducts[0].potential;
  const second = analyzeCompetitorData([], [], [product, { ...product, shopKey: 'b', paymentLowerBound: 100000 }]).newProducts[0].potential;
  assert.deepEqual(first, second);
});

test('missing payment is not treated as a decrease to zero', () => {
  const product = { shopKey: 'a', itemId: '1', title: '保温水杯' };
  const baseline = { hotProducts: [{ ...product, paymentLowerBound: 10 }] };
  assert.deepEqual(compareCompetitorSnapshots({ hotProducts: [product] }, baseline).paymentChanges, []);
  assert.equal(compareCompetitorSnapshots({ hotProducts: [{ ...product, paymentLowerBound: 0 }] }, baseline).paymentChanges[0].deltaLowerBound, -10);
});

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
