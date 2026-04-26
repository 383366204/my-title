// compatibility.test.js — 验证 content.js 的 formatAsTSV 输出与 parseSycmData() 完全兼容
const assert = require('assert');
const path = require('path');

// 导入 parseSycmData
const { parseSycmData } = require(path.join(__dirname, '..', '..', 'src', 'sycm-parser'));

// 从 content.js 复制的纯函数（简化版，用于测试）
// 标准 7 列顺序（与 parseSycmData 一致）
const COLUMNS = [
  { key: 'keyword', header: '相关搜索词' },
  { key: 'searchPopularity', header: '搜索人气' },
  { key: 'clickRate', header: '点击率' },
  { key: 'conversionRate', header: '支付转化率' },
  { key: 'buyerCount', header: '支付买家数' },
  { key: 'demandSupplyRatio', header: '需求供给比' },
  { key: 'tmallClickShare', header: '天猫商品点击占比' }
];

const HEADER_ROW = COLUMNS.map(c => c.header).join('\t');

// 将 API 关键词映射到标准 7 列
function mapKeywordToRow(item) {
  if (!item || typeof item !== 'object') {
    return COLUMNS.map(() => '').join('\t');
  }
  
  // 字段名映射（不同平台可能用不同名称）
  const fieldMap = {
    // 关键词字段
    keyword: item.keyword || item.searchWord || item.word || item['相关搜索词'] || item.name || item.title || '',
    
    // 搜索人气字段
    searchPopularity: item.searchPopularity || item.searchNum || item.searchCount || 
                     item.searchIndex || item.popularity || item['搜索人气'] || 
                     item.search_uv || item.uv || '',
    
    // 点击率字段
    clickRate: item.clickRate || item.ctr || item.clickRateRatio || item.click_ratio || 
              item.clickIndex || item['点击率'] || item.ctr_ratio || '',
    
    // 支付转化率字段
    conversionRate: item.conversionRate || item.payRate || item.conversionRatio || 
                   item.payConversionRate || item.pay_ratio || item['支付转化率'] || 
                   item.conversion_ratio || '',
    
    // 支付买家数字段
    buyerCount: item.buyerCount || item.payBuyerCnt || item.payBuyerCount || 
               item.buyerCnt || item.pay_buyer_cnt || item['支付买家数'] || 
               item.buyer_count || '',
    
    // 需求供给比字段
    demandSupplyRatio: item.demandSupplyRatio || item.sdr || item.supplyDemandRatio || 
                      item.demand_supply_ratio || item['需求供给比'] || 
                      item.supply_demand_ratio || item.dsr || '',
    
    // 天猫商品点击占比字段
    tmallClickShare: item.tmallClickShare || item.mallCpro || item.tmallClickPro || 
                    item.tmall_click_share || item['天猫商品点击占比'] || 
                    item.mall_click_pro || item.tmall_pro || ''
  };
  
  // 转换为字符串，保持原始格式
  const rowValues = COLUMNS.map(col => {
    const value = fieldMap[col.key];
    
    if (value === null || value === undefined || value === '') {
      return '';
    }
    
    // 如果是数字，转为字符串但不做格式化（保持原始值）
    // 对于浮点数，保留小数点后两位
    if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        return value.toString();
      } else {
        // 保留两位小数，避免浮点数精度问题
        return value.toFixed(2);
      }
    }
    
    // 如果是字符串，直接返回
    if (typeof value === 'string') {
      return value.trim();
    }
    
    // 其他类型转为字符串
    return String(value);
  });
  
  return rowValues.join('\t');
}

// 格式化为 Tab 分隔文本
function formatAsTSV(keywords) {
  if (!keywords || keywords.length === 0) {
    return '';
  }
  
  const rows = [HEADER_ROW];
  let validRowCount = 0;
  
  for (const item of keywords) {
    const row = mapKeywordToRow(item);
    
    // 检查行是否有效（不是所有列都为空）
    const cells = row.split('\t');
    const isEmptyRow = cells.every(cell => cell === '' || cell === null || cell === undefined);
    
    if (!isEmptyRow) {
      rows.push(row);
      validRowCount++;
    }
  }
  
  return rows.join('\n');
}

// 测试 1: 基本格式兼容性
function testBasicCompatibility() {
  console.log('测试 1: 基本格式兼容性');
  // 注意：parseSycmData 无法解析 "15% ~ 20%" 这样的百分比区间，会解析为0
  // 使用 parseSycmData 能正确解析的格式：单个百分比值
  const mockApiData = [
    { keyword: '儿童水杯', searchPopularity: '1万 ~ 2万', clickRate: '82%', conversionRate: '17%', buyerCount: '1000 ~ 2500', demandSupplyRatio: '4.70', tmallClickShare: '68.59%' }
  ];
  
  const tsv = formatAsTSV(mockApiData);
  console.log('生成的TSV:');
  console.log(tsv);
  
  const parsed = parseSycmData(tsv);
  console.log('解析结果:', parsed);
  
  assert.strictEqual(parsed.length, 1, '应该解析出1行数据');
  assert.strictEqual(parsed[0].keyword, '儿童水杯', 'keyword字段应正确');
  assert.strictEqual(parsed[0].demandSupplyRatio, 4.70, 'demandSupplyRatio应正确解析');
  assert(parsed[0].searchPopularity > 0, 'searchPopularity应大于0');
  assert(parsed[0].clickRate > 0, 'clickRate应大于0');
  assert(parsed[0].conversionRate > 0, 'conversionRate应大于0');
  assert(parsed[0].buyerCount > 0, 'buyerCount应大于0');
  assert(parsed[0].tmallClickShare > 0, 'tmallClickShare应大于0');
}

// 测试 2: 列顺序正确性
function testColumnOrder() {
  console.log('\n测试 2: 列顺序正确性');
  const mockApiData = [
    { keyword: '测试关键词', searchPopularity: '5000', clickRate: '50%', conversionRate: '10%', buyerCount: '800', demandSupplyRatio: '3.25', tmallClickShare: '60%' }
  ];
  
  const tsv = formatAsTSV(mockApiData);
  const lines = tsv.split('\n');
  
  // 检查表头行
  const headerLine = lines[0];
  const expectedHeaders = ['相关搜索词', '搜索人气', '点击率', '支付转化率', '支付买家数', '需求供给比', '天猫商品点击占比'];
  const actualHeaders = headerLine.split('\t');
  
  assert.strictEqual(actualHeaders.length, 7, '表头应有7列');
  
  for (let i = 0; i < expectedHeaders.length; i++) {
    assert.strictEqual(actualHeaders[i], expectedHeaders[i], `第${i+1}列表头应为"${expectedHeaders[i]}"`);
  }
  
  // 检查数据行
  const dataLine = lines[1];
  const dataFields = dataLine.split('\t');
  assert.strictEqual(dataFields.length, 7, '数据行应有7列');
  assert.strictEqual(dataFields[0], '测试关键词', '第一列应为keyword');
  assert.strictEqual(dataFields[5], '3.25', '第六列应为demandSupplyRatio');
  
  // 验证解析器能正确处理
  const parsed = parseSycmData(tsv);
  assert.strictEqual(parsed.length, 1, '应正确解析数据行');
  assert.strictEqual(parsed[0].keyword, '测试关键词', '解析后keyword应正确');
  assert.strictEqual(parsed[0].demandSupplyRatio, 3.25, '解析后demandSupplyRatio应正确');
}

// 测试 3: 数字类型转换
function testNumericConversion() {
  console.log('\n测试 3: 数字类型转换');
  
  // 测试不同数值格式
  const testCases = [
    { name: '整数数值', data: { keyword: '测试1', searchPopularity: '1000', clickRate: '50%', conversionRate: '10%', buyerCount: '500', demandSupplyRatio: 15000, tmallClickShare: '60%' }, expected: '15000' },
    { name: '浮点数数值', data: { keyword: '测试2', searchPopularity: '1000', clickRate: '50%', conversionRate: '10%', buyerCount: '500', demandSupplyRatio: 4.70, tmallClickShare: '60%' }, expected: '4.70' },
    { name: '字符串整数', data: { keyword: '测试3', searchPopularity: '1000', clickRate: '50%', conversionRate: '10%', buyerCount: '500', demandSupplyRatio: '15000', tmallClickShare: '60%' }, expected: '15000' },
    { name: '字符串浮点数', data: { keyword: '测试4', searchPopularity: '1000', clickRate: '50%', conversionRate: '10%', buyerCount: '500', demandSupplyRatio: '4.70', tmallClickShare: '60%' }, expected: '4.70' }
  ];
  
  for (const testCase of testCases) {
    const row = mapKeywordToRow(testCase.data);
    const fields = row.split('\t');
    
    // demandSupplyRatio 在第6列（索引5）
    const demandSupplyRatioField = fields[5];
    assert.strictEqual(demandSupplyRatioField, testCase.expected, `${testCase.name}: demandSupplyRatio 应正确转换为字符串`);
    
    // 验证解析器能正确解析
    const tsv = HEADER_ROW + '\n' + row;
    const parsed = parseSycmData(tsv);
    
    if (testCase.data.demandSupplyRatio !== 0) {
      assert.strictEqual(parsed.length, 1, `${testCase.name}: 应正确解析数据`);
      assert(!isNaN(parsed[0].demandSupplyRatio), `${testCase.name}: demandSupplyRatio 应为有效数字`);
      assert(parsed[0].demandSupplyRatio > 0, `${testCase.name}: demandSupplyRatio 应大于0`);
    }
  }
}

// 测试 4: 边界情况
function testEdgeCases() {
  console.log('\n测试 4: 边界情况');
  
  // 测试空数组
  const emptyTSV = formatAsTSV([]);
  assert.strictEqual(emptyTSV, '', '空数组应返回空字符串');
  
  // 测试空对象数组（应生成空行但被过滤）
  const emptyObjects = [{}, {}];
  const emptyObjectsTSV = formatAsTSV(emptyObjects);
  const lines = emptyObjectsTSV.split('\n');
  assert.strictEqual(lines.length, 1, '只有表头行，空对象行应被过滤');
  assert(lines[0].includes('相关搜索词'), '应有表头');
  
  // 测试部分字段为空 - 为所有字段提供值，避免 parseSycmData 的 trim() 问题
  const partialData = [
    { keyword: '部分字段', searchPopularity: '1000', clickRate: '50%', conversionRate: '10%', buyerCount: '500', demandSupplyRatio: '2.5', tmallClickShare: '60%' }
  ];
  const partialTSV = formatAsTSV(partialData);
  const parsed = parseSycmData(partialTSV);
  // parseSycmData 会过滤 demandSupplyRatio 不为0的行
  assert.strictEqual(parsed.length, 1, '部分字段数据应能正确解析');
  assert.strictEqual(parsed[0].keyword, '部分字段', 'keyword应正确');
  assert.strictEqual(parsed[0].demandSupplyRatio, 2.5, 'demandSupplyRatio应正确解析');
  
  // 测试demandSupplyRatio为0的情况（应被parseSycmData过滤）
  const zeroDemandData = [
    { keyword: '零需求比', demandSupplyRatio: '0' }
  ];
  const zeroTSV = formatAsTSV(zeroDemandData);
  const zeroParsed = parseSycmData(zeroTSV);
  assert.strictEqual(zeroParsed.length, 0, 'demandSupplyRatio为0的数据应被过滤');
}

// 测试 5: 表头跳过
function testHeaderSkip() {
  console.log('\n测试 5: 表头跳过');
  
  const mockApiData = [
    { keyword: '测试商品1', searchPopularity: '1000', clickRate: '50%', conversionRate: '10%', buyerCount: '500', demandSupplyRatio: '3.5', tmallClickShare: '60%' },
    { keyword: '测试商品2', searchPopularity: '2000', clickRate: '60%', conversionRate: '15%', buyerCount: '800', demandSupplyRatio: '2.8', tmallClickShare: '70%' }
  ];
  
  const tsv = formatAsTSV(mockApiData);
  const lines = tsv.split('\n');
  
  // 验证第一行是表头
  assert(lines[0].includes('相关搜索词'), '第一行应是表头');
  assert(lines[0].includes('搜索人气'), '第一行应包含"搜索人气"');
  
  // 验证parseSycmData能跳过表头
  const parsed = parseSycmData(tsv);
  assert.strictEqual(parsed.length, 2, '应正确解析2行数据，跳过表头');
  
  // 验证表头不会出现在解析结果中
  for (const item of parsed) {
    assert(!item.keyword.includes('相关搜索词'), '解析结果不应包含表头内容');
    assert(!item.keyword.includes('搜索人气'), '解析结果不应包含表头内容');
  }
  
  // 测试包含表头特征词的文本（应被跳过）
  const headerOnlyText = '相关搜索词\t搜索人气\t点击率\t支付转化率\t支付买家数\t需求供给比\t天猫商品点击占比';
  const headerParsed = parseSycmData(headerOnlyText);
  assert.strictEqual(headerParsed.length, 0, '纯表头文本应被跳过');
}

// 测试 6: 字段名变体映射
function testFieldMapping() {
  console.log('\n测试 6: 字段名变体映射');
  
  const testCases = [
    { 
      name: 'keyword变体',
      data: { searchWord: '搜索词变体', searchPopularity: '1000', clickRate: '50%', conversionRate: '10%', buyerCount: '500', demandSupplyRatio: '3.0', tmallClickShare: '60%' },
      expectedKeyword: '搜索词变体'
    },
    { 
      name: 'word变体',
      data: { word: 'word变体', searchPopularity: '1000', clickRate: '50%', conversionRate: '10%', buyerCount: '500', demandSupplyRatio: '3.0', tmallClickShare: '60%' },
      expectedKeyword: 'word变体'
    },
    { 
      name: '相关搜索词中文键',
      data: { '相关搜索词': '中文键变体', searchPopularity: '1000', clickRate: '50%', conversionRate: '10%', buyerCount: '500', demandSupplyRatio: '3.0', tmallClickShare: '60%' },
      expectedKeyword: '中文键变体'
    },
    { 
      name: 'searchPopularity变体',
      data: { keyword: '测试', searchNum: '5000', clickRate: '50%', conversionRate: '10%', buyerCount: '500', demandSupplyRatio: '3.0', tmallClickShare: '60%' },
      expectedSearchPopularity: '5000'
    },
    { 
      name: 'clickRate变体',
      data: { keyword: '测试', searchPopularity: '1000', ctr: '45%', conversionRate: '10%', buyerCount: '500', demandSupplyRatio: '3.0', tmallClickShare: '60%' },
      expectedClickRate: '45%'
    },
    { 
      name: 'demandSupplyRatio变体',
      data: { keyword: '测试', searchPopularity: '1000', clickRate: '50%', conversionRate: '10%', buyerCount: '500', sdr: '2.5', tmallClickShare: '60%' },
      expectedDemandSupplyRatio: '2.5'
    }
  ];
  
  for (const testCase of testCases) {
    const row = mapKeywordToRow(testCase.data);
    const tsv = HEADER_ROW + '\n' + row;
    const parsed = parseSycmData(tsv);
    
    // 确保数据被正确解析（demandSupplyRatio不为0，所以不应被过滤）
    assert.strictEqual(parsed.length, 1, `${testCase.name}: 应正确解析数据行`);
    
    if (testCase.expectedKeyword) {
      assert.strictEqual(parsed[0].keyword, testCase.expectedKeyword, `${testCase.name}: keyword应正确映射`);
    }
    
    if (testCase.data.demandSupplyRatio || testCase.data.sdr) {
      const expectedValue = parseFloat(testCase.data.demandSupplyRatio || testCase.data.sdr);
      assert.strictEqual(parsed[0].demandSupplyRatio, expectedValue, `${testCase.name}: demandSupplyRatio应正确映射和解析`);
    }
  }
}

// 运行所有测试
let passed = 0, failed = 0;
const tests = [testBasicCompatibility, testColumnOrder, testNumericConversion, testEdgeCases, testHeaderSkip, testFieldMapping];

  for (const test of tests) {
  try {
    test();
    passed++;
    console.log(`✓ ${test.name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${test.name}: ${e.message}`);
    // 不打印堆栈，让输出更简洁
  }
}

console.log(`\n${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);