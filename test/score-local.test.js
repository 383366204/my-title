const { describe, it } = require('node:test');
const assert = require('node:assert');

// 引入被测试的模块
const { scoreLocally } = require('../src/score-local');

describe('scoreLocally', () => {
  // Test 1: scoreLocally returns array with score and passed fields
  it('返回数组，每个元素包含 score 和 passed 字段', () => {
    const products = [{ title: '测试商品' }];
    const result = scoreLocally(products, '项链', '', []);
    assert.ok(Array.isArray(result));
    assert.ok('score' in result[0]);
    assert.ok('passed' in result[0]);
  });

  // Test 2: Product with coreWord in title gets +30 points
  it('标题包含核心词加30分', () => {
    const products = [{ title: '纯银项链女高级感' }];
    const result = scoreLocally(products, '项链', '', []);
    assert.strictEqual(result[0].score, 30);
  });

  // Test 3: Product with rigid modifiers gets +10 points each
  it('标题包含每个刚性修饰词加10分', () => {
    const products = [{ title: '纯银项链女高级感' }];
    const modifiers = ['纯银', '女'];
    const result = scoreLocally(products, '项链', '', modifiers);
    // 核心词30 + 纯银10 + 女10 = 50
    assert.strictEqual(result[0].score, 50);
  });

  // Test 4: Product with blueOceanWord gets +20 points
  it('标题包含蓝海词加20分', () => {
    const products = [{ title: '纯银项链女高级感' }];
    const result = scoreLocally(products, '项链', '高级感', []);
    // 核心词30 + 蓝海词20 = 50
    assert.strictEqual(result[0].score, 50);
  });

  // Test 5: Products with score >=40 have passed=true
  it('分数>=40的产品 passed 为 true', () => {
    const products = [
      { title: '纯银项链女高级感' }, // 30+10+10+20=70
    ];
    const modifiers = ['纯银', '女'];
    const result = scoreLocally(products, '项链', '高级感', modifiers);
    assert.strictEqual(result[0].passed, true);
  });
});