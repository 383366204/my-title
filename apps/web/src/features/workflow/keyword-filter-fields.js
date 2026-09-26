export const KEYWORD_FILTER_FIELDS = [
  { key: 'demandSupplyRatio', label: '需求供给比', operator: '>', value: 1, step: '0.01' },
  { key: 'searchPopularity', label: '搜索人气', operator: '>', value: 50, step: '1' },
  { key: 'conversionRate', label: '支付转化率', operator: '>', value: 1, step: '0.01', unit: '%', max: 100 },
  { key: 'tmallClickShare', label: '天猫商品点击占比', operator: '<', value: 50, step: '0.01', unit: '%', max: 100 }
];

/** @param {object} config 运行配置。 @returns {object} 独立的表单草稿。 */
export function keywordFilterDraft(config = {}) {
  return Object.fromEntries(KEYWORD_FILTER_FIELDS.map(field => [field.key, {
    enabled: config[field.key]?.enabled !== false,
    value: config[field.key]?.value ?? field.value
  }]));
}
