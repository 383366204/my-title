'use strict';

const { test, describe } = require('node:test');
const assert = require('assert');
const { selectSycmTitleKeywords } = require('../src/sycm-keyword-selector');

describe('selectSycmTitleKeywords', () => {
  test('accepts high value matching keywords and rejects category conflicts', () => {
    const result = selectSycmTitleKeywords({
      sycmRows: [
        { keyword: '锁骨链', searchPopularity: 10000, clickRate: 8, conversionRate: 3, demandSupplyRatio: 3 },
        { keyword: '轻奢项链', searchPopularity: 8000, clickRate: 7, conversionRate: 2.8, demandSupplyRatio: 2.5 },
        { keyword: '耳环', searchPopularity: 20000, clickRate: 10, conversionRate: 5, demandSupplyRatio: 10 }
      ],
      coreWord: '项链',
      blueOceanWord: '纯银项链女高级感',
      modifiers: [{ word: '纯银', rigidity: 'rigid' }, { word: '女', rigidity: 'rigid' }],
      products: [{ title: '纯银项链女锁骨链轻奢小众设计' }],
      maxKeywords: 5
    });

    assert.ok(result.accepted.some(k => k.keyword === '锁骨链'));
    assert.ok(result.accepted.some(k => k.keyword === '轻奢项链'));
    assert.ok(result.rejected.some(k => k.keyword === '耳环' && k.reason.includes('品类冲突')));
  });

  test('rejects rigid material conflicts', () => {
    const result = selectSycmTitleKeywords({
      sycmRows: [
        { keyword: '钛钢项链', searchPopularity: 10000, clickRate: 8, conversionRate: 3, demandSupplyRatio: 3 }
      ],
      coreWord: '项链',
      blueOceanWord: '纯银项链女高级感',
      modifiers: [{ word: '纯银', rigidity: 'rigid' }],
      products: [{ title: '纯银项链女高级感锁骨链' }]
    });

    assert.strictEqual(result.accepted.length, 0);
    assert.ok(result.rejected[0].reason.includes('刚性属性冲突'));
  });
});
