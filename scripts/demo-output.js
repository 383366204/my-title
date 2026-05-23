const { formatResult } = require('../skills/title-gen/src/output-formatter');

const mockResults = [
  {
    链接原标题: 'S925纯银项链女锁骨链',
    产品链接: 'https://detail.1688.com/offer/p1.html',
    铺货标题: '纯银项链女高级感 S925纯银项链女锁骨链轻奢小众设计',
    商品原价: '45.00',
    '30天销量': 12580,
    好评率: 0.982,
    复购率: 0.457,
    蓝海词: '纯银项链女高级感'
  },
  {
    链接原标题: '纯银项链女款高级感轻奢',
    产品链接: 'https://detail.1688.com/offer/p2.html',
    铺货标题: '纯银项链女高级感 纯银项链女款高级感轻奢ins风',
    商品原价: '68.00',
    '30天销量': 8432,
    好评率: 0.956,
    复购率: 0.389,
    蓝海词: '纯银项链女高级感'
  }
];

console.log('=== 电商选品标题生成工具 - 输出演示 ===\n');
console.log('关键词: 纯银项链女高级感\n');

console.log('【TABLE 格式输出】');
console.log(formatResult(mockResults, 'table'));

console.log('\n\n【JSON 格式输出】');
console.log(formatResult(mockResults, 'json'));

console.log('\n\n【BOTH 格式输出】');
console.log(formatResult(mockResults, 'both'));
