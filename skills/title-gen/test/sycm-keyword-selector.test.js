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

  test('rejects low role avoid keywords instead of accepting them', () => {
    const result = selectSycmTitleKeywords({
      sycmRows: [
        { keyword: '女孩电子宠物玩具', searchPopularity: '150 ~ 300 45%', clickRate: 72, conversionRate: '10% ~ 15% 15%', demandSupplyRatio: 1.97 }
      ],
      coreWord: '玩具',
      blueOceanWord: '宠物玩具',
      modifiers: [{ word: '宠物', rigidity: 'rigid' }],
      semanticGroups: { '宠物系': ['宠物', '猫咪', '狗狗'] },
      products: [{ title: '狗狗磨牙耐咬宠物玩具猫咪自嗨解闷用品' }]
    });

    assert.strictEqual(result.accepted.length, 0);
    assert.strictEqual(result.rejected[0].keyword, '女孩电子宠物玩具');
    assert.ok(result.rejected[0].reason.includes('人群语义冲突'));
  });

  test('parses SYCM range metrics and accepts matching long-tail keywords', () => {
    const result = selectSycmTitleKeywords({
      sycmRows: [
        {
          keyword: '逗猫棒室内猫咪玩具不倒翁猫咪解闷自嗨神器猫咪用品猫咪小玩具',
          searchPopularity: '50 ~ 150 5%',
          clickRate: 66,
          conversionRate: '0% ~ 1%',
          demandSupplyRatio: 17.75
        }
      ],
      coreWord: '逗猫棒',
      blueOceanWord: '逗猫棒',
      modifiers: [],
      semanticGroups: { '宠物系': ['猫咪', '逗猫棒', '宠物'] },
      products: [{ title: '逗猫棒长杆羽毛铃铛猫咪玩具自嗨解闷宠物用品' }]
    });

    assert.strictEqual(result.accepted.length, 1);
    assert.strictEqual(result.accepted[0].role, 'must_keep');
  });
});
