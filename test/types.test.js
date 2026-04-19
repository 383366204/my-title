const { test } = require('node:test');
const assert = require('node:assert');
const {
  PRODUCT_TEMPLATE,
  RELEVANCE_RESULT_TEMPLATE,
  SELECTION_PRODUCT_TEMPLATE,
  SELECTION_RESULT_TEMPLATE,
  SEARCH_RESULT_TEMPLATE,
  SELECTION_ADVICE_TEMPLATE
} = require('../src/types');

test('PRODUCT_TEMPLATE has required fields', () => {
  const required = ['id', 'title', 'price', 'url', 'stats'];
  required.forEach(field => {
    assert.ok(field in PRODUCT_TEMPLATE, `Product must have ${field}`);
  });
});

test('PRODUCT_TEMPLATE.stats has required fields', () => {
  const required = [
    'last30DaysSales',
    'goodRates',
    'repurchaseRate',
    'downstreamOffer',
    'totalSales',
    'remarkCnt',
    'categoryListName',
    'earliestListingTime'
  ];
  required.forEach(field => {
    assert.ok(field in PRODUCT_TEMPLATE.stats, `Product.stats must have ${field}`);
  });
});

test('RELEVANCE_RESULT_TEMPLATE has required fields', () => {
  const required = ['productId', 'score', 'reason'];
  required.forEach(field => {
    assert.ok(field in RELEVANCE_RESULT_TEMPLATE, `RelevanceResult must have ${field}`);
  });
});

test('SELECTION_PRODUCT_TEMPLATE has all 11 output fields', () => {
  const required = [
    '链接原标题',
    '产品链接',
    '铺货标题',
    '商品原价',
    '30天销量',
    '好评率',
    '复购率',
    '蓝海词',
    '选品理由',
    '定价建议',
    '风险提示'
  ];
  required.forEach(field => {
    assert.ok(field in SELECTION_PRODUCT_TEMPLATE, `SelectionProduct must have ${field}`);
  });
});

test('SELECTION_RESULT_TEMPLATE has required fields', () => {
  assert.ok('蓝海词' in SELECTION_RESULT_TEMPLATE, 'SelectionResult must have 蓝海词');
  assert.ok('products' in SELECTION_RESULT_TEMPLATE, 'SelectionResult must have products');
  assert.ok(Array.isArray(SELECTION_RESULT_TEMPLATE.products), 'SelectionResult.products must be array');
});

test('SEARCH_RESULT_TEMPLATE has required fields', () => {
  const required = ['products', 'totalCount', 'dataId'];
  required.forEach(field => {
    assert.ok(field in SEARCH_RESULT_TEMPLATE, `SearchResult must have ${field}`);
  });
  assert.ok(Array.isArray(SEARCH_RESULT_TEMPLATE.products), 'SearchResult.products must be array');
});

test('All templates are objects (not functions)', () => {
  assert.strictEqual(typeof PRODUCT_TEMPLATE, 'object');
  assert.strictEqual(typeof RELEVANCE_RESULT_TEMPLATE, 'object');
  assert.strictEqual(typeof SELECTION_PRODUCT_TEMPLATE, 'object');
  assert.strictEqual(typeof SELECTION_RESULT_TEMPLATE, 'object');
  assert.strictEqual(typeof SEARCH_RESULT_TEMPLATE, 'object');
});

test('Stats fields have correct types in template', () => {
  assert.strictEqual(typeof PRODUCT_TEMPLATE.stats.last30DaysSales, 'number');
  assert.strictEqual(typeof PRODUCT_TEMPLATE.stats.goodRates, 'number');
  assert.strictEqual(typeof PRODUCT_TEMPLATE.stats.repurchaseRate, 'number');
  assert.strictEqual(typeof PRODUCT_TEMPLATE.stats.downstreamOffer, 'number');
  assert.strictEqual(typeof PRODUCT_TEMPLATE.stats.totalSales, 'number');
  assert.strictEqual(typeof PRODUCT_TEMPLATE.stats.remarkCnt, 'number');
  assert.strictEqual(typeof PRODUCT_TEMPLATE.stats.categoryListName, 'string');
  assert.strictEqual(typeof PRODUCT_TEMPLATE.stats.earliestListingTime, 'number');
});

test('SelectionProduct 11 output fields exist and have correct initial types', () => {
  assert.strictEqual(typeof SELECTION_PRODUCT_TEMPLATE['链接原标题'], 'string');
  assert.strictEqual(typeof SELECTION_PRODUCT_TEMPLATE['产品链接'], 'string');
  assert.strictEqual(typeof SELECTION_PRODUCT_TEMPLATE['铺货标题'], 'string');
  assert.strictEqual(typeof SELECTION_PRODUCT_TEMPLATE['商品原价'], 'string');
  assert.strictEqual(typeof SELECTION_PRODUCT_TEMPLATE['30天销量'], 'number');
  assert.strictEqual(typeof SELECTION_PRODUCT_TEMPLATE['好评率'], 'number');
  assert.strictEqual(typeof SELECTION_PRODUCT_TEMPLATE['复购率'], 'number');
  assert.strictEqual(typeof SELECTION_PRODUCT_TEMPLATE['蓝海词'], 'string');
  assert.strictEqual(typeof SELECTION_PRODUCT_TEMPLATE['选品理由'], 'string');
  assert.strictEqual(typeof SELECTION_PRODUCT_TEMPLATE['定价建议'], 'string');
  assert.strictEqual(typeof SELECTION_PRODUCT_TEMPLATE['风险提示'], 'string');
});

test('SELECTION_ADVICE_TEMPLATE has required fields', () => {
  const required = ['productId', 'reason', 'priceAdvice', 'riskLevel', 'suggestedTitle'];
  required.forEach(field => {
    assert.ok(field in SELECTION_ADVICE_TEMPLATE, `SelectionAdvice must have ${field}`);
  });
});

test('SELECTION_ADVICE_TEMPLATE fields have correct types', () => {
  assert.strictEqual(typeof SELECTION_ADVICE_TEMPLATE.productId, 'string');
  assert.strictEqual(typeof SELECTION_ADVICE_TEMPLATE.reason, 'string');
  assert.strictEqual(typeof SELECTION_ADVICE_TEMPLATE.priceAdvice, 'string');
  assert.strictEqual(typeof SELECTION_ADVICE_TEMPLATE.riskLevel, 'string');
  assert.strictEqual(typeof SELECTION_ADVICE_TEMPLATE.suggestedTitle, 'string');
});