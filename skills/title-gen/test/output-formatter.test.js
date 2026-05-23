const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  formatTable,
  formatJSON,
  formatResult
} = require('../src/output-formatter');

const mockResult = {
  '链接原标题': 'Test Title',
  '产品链接': 'https://example.com',
  '铺货标题': 'Generated Title',
  '商品原价': '10.00',
  '30天销量': 12680,
  '好评率': 0.962,
  '复购率': 0.457,
  '蓝海词': '纯银项链女高级感'
};

const mockResults = [mockResult];

describe('output-formatter', () => {
  test('Test 1: formatTable returns string with all 8 columns', () => {
    const result = formatTable(mockResults);
    
    assert.ok(typeof result === 'string', 'Should return a string');
    assert.ok(result.length > 0, 'Should not be empty');
    assert.ok(result.includes('链接原标题'), 'Should contain originalTitle column');
    assert.ok(result.includes('产品链接'), 'Should contain productUrl column');
    assert.ok(result.includes('铺货标题'), 'Should contain listingTitle column');
    assert.ok(result.includes('商品原价'), 'Should contain originalPrice column');
    assert.ok(result.includes('30天销量'), 'Should contain sales30Days column');
    assert.ok(result.includes('好评率'), 'Should contain positiveRate column');
    assert.ok(result.includes('复购率'), 'Should contain repurchaseRate column');
    assert.ok(result.includes('蓝海词'), 'Should contain blueOceanWords column');
  });

  test('Test 2: formatJSON returns valid JSON with data', () => {
    const result = formatJSON(mockResults);
    
    assert.ok(typeof result === 'string', 'Should return a string');
    const parsed = JSON.parse(result);
    assert.ok(Array.isArray(parsed), 'Should parse to an array');
    assert.ok(parsed.length === 1, 'Should have one item');
    assert.ok(parsed[0]['好评率'] === 0.962, '好评率 should be 0.962');
    assert.ok(parsed[0]['复购率'] === 0.457, '复购率 should be 0.457');
  });

  test('Test 3: formatNumber adds thousands separator (12680 → 12,680)', () => {
    const result = formatJSON(mockResults);
    const parsed = JSON.parse(result);
    // 30天销量应为数字类型
    assert.ok(parsed[0]['30天销量'] === 12680, '30天销量 should be 12680');
    assert.ok(parsed[0]['商品原价'] === '10.00', '商品原价 should remain 10.00');
  });

  test('Test 4: formatResult with "table" returns only table', () => {
    const result = formatResult(mockResults, 'table');
    
    assert.ok(typeof result === 'string', 'Should return a string');
    assert.ok(result.includes('链接原标题'), 'Should contain table headers');
    assert.ok(!result.includes('--- JSON 输出 ---'), 'Should NOT contain JSON section');
    assert.ok(!result.includes('"好评率"'), 'Should NOT contain JSON key in table');
  });

  test('Test 5: formatResult with "json" returns only JSON', () => {
    const result = formatResult(mockResults, 'json');
    
    assert.ok(typeof result === 'string', 'Should return a string');
    assert.ok(result.includes('"好评率"'), 'Should contain Chinese JSON key');
    // JSON should contain quoted field names, not plain text table format
    assert.ok(result.includes('"链接原标题"'), 'Should contain quoted Chinese field name');
  });

  test('Test 6: formatResult with "both" returns object with table and json', () => {
    const result = formatResult(mockResults, 'both');
    
    assert.ok(typeof result === 'string', 'Should return a string');
    assert.ok(result.includes('链接原标题'), 'Should contain table headers');
    assert.ok(result.includes('--- JSON 输出 ---'), 'Should contain JSON section divider');
    assert.ok(result.includes('"好评率"'), 'Should contain Chinese JSON data');
  });
});
