'use strict';
const { normalizeSycmMetrics } = require('../../sycm-research/src/metric-parser');

const RULES = [
  { key: 'demandSupplyRatio', label: '需求供给比', operator: '>', threshold: 1, display: '1' },
  { key: 'searchPopularity', label: '搜索人气', operator: '>', threshold: 50, display: '50' },
  { key: 'conversionRate', label: '转化率', operator: '>', threshold: 0.01, display: '1%' },
  { key: 'tmallClickShare', label: '天猫占比', operator: '<', threshold: 0.5, display: '50%' }
];

/**
 * 按四项严格阈值筛选，不计算分数；缺失或跨界区间等待人工判断。
 * @param {object} row 生意参谋原始或带解析证据的数据行。
 * @param {object} [config] 运行级筛选配置。
 * @returns {object} 每项筛选结果及整体通过状态。
 */
function filterKeywordMetrics(row = {}, config) {
  const settings = normalizeKeywordFilter(config);
  const normalized = normalizeSycmMetrics(row);
  const checks = RULES.map(base => {
    const setting = settings[base.key];
    const percent = ['conversionRate', 'tmallClickShare'].includes(base.key);
    const rule = { ...base, enabled: setting.enabled, value: setting.value,
      threshold: setting.value / (percent ? 100 : 1), display: `${setting.value}${percent ? '%' : ''}` };
    const metric = normalized.metrics[rule.key];
    const valid = ['exact', 'range'].includes(metric.status);
    const passed = !rule.enabled || valid && (rule.operator === '>' ? metric.lower > rule.threshold : metric.upper < rule.threshold);
    const failed = valid && (rule.operator === '>' ? metric.upper <= rule.threshold : metric.lower >= rule.threshold);
    const status = passed ? 'passed' : failed ? 'failed' : 'review';
    const reason = !rule.enabled ? '未启用' : passed ? '符合条件' : failed ? '未达到条件' : metric.status === 'missing' ? '缺少指标' : '指标不明确或区间跨越门槛';
    return { ...rule, raw: metric.raw, status, reason, condition: `${rule.label} ${rule.operator} ${rule.display}` };
  });
  const status = checks.some(check => check.status === 'failed') ? 'failed'
    : checks.some(check => check.status === 'review') ? 'review' : 'passed';
  return { status, passed: status === 'passed', checks,
    reasons: checks.filter(check => check.status !== 'passed').map(check => `${check.condition}：${check.reason}`) };
}

/** @param {object} [config] 完整配置，百分比使用 UI 单位。 @returns {object} 校验后的独立配置。 */
function normalizeKeywordFilter(config) {
  if (config === undefined) return Object.fromEntries(RULES.map(rule => [rule.key,
    { enabled: true, value: Number(rule.display.replace('%', '')) }]));
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || Object.keys(config).length !== RULES.length) throw new TypeError('Invalid keywordFilter config');
  return Object.fromEntries(RULES.map(({ key }) => {
    const item = config[key];
    const max = ['conversionRate', 'tmallClickShare'].includes(key) ? 100 : Number.MAX_SAFE_INTEGER;
    if (!item || typeof item.enabled !== 'boolean' || typeof item.value !== 'number'
      || !Number.isFinite(item.value) || item.value < 0 || item.value > max
      || Object.keys(item).some(name => !['enabled', 'value'].includes(name))) {
      throw new TypeError(`Invalid keywordFilter.${key}`);
    }
    return [key, { enabled: item.enabled, value: item.value }];
  }));
}

/** @param {object} [config] UI 百分比单位的配置。 @returns {object} 平台五项过滤值（百分比仍为 UI 单位）。 */
function keywordFilterConditions(config) {
  const normalized = normalizeKeywordFilter(config);
  return { ...Object.fromEntries(['demandSupplyRatio', 'searchPopularity', 'conversionRate']
    .map(key => [key, normalized[key].enabled ? normalized[key].value : 0])), buyerCount: 0, referencePrice: 0 };
}

/** @param {object[]} rows 已采集行。 @param {object} [config] 当前配置。 @returns {object} 采集限制与重采提示。 */
function keywordFilterCollectionStatus(rows, config) {
  const requested = keywordFilterConditions(config);
  let unknown = rows.length === 0;
  let restrictive = false;
  for (const row of rows) {
    const evidence = row.sycmEvidence;
    const applied = evidence?.filterConditions;
    const knownHot = evidence?.mode === 'hot' && applied && Object.keys(requested).every(key => applied[key] === 0);
    if ((!knownHot && evidence?.filterApplied !== true) || !applied
      || Object.keys(requested).some(key => !Number.isFinite(applied[key]))) {
      unknown = true;
      continue;
    }
    if (Object.keys(requested).some(key => applied[key] > requested[key])) restrictive = true;
  }
  return { requiresRecollection: unknown || restrictive,
    collectionEvidenceUnknown: unknown,
    collectionFilterStatus: restrictive ? 'restrictive' : unknown ? 'unknown' : 'compatible',
    recollectionReason: restrictive ? '当前筛选比采集时宽松，原采集排除的数据需要显式重采。'
      : unknown ? '采集过滤条件未确认（包括旧数据或平台未完整应用条件）；本地重筛无法保证补回被排除的数据。' : null };
}

module.exports = { filterKeywordMetrics, normalizeKeywordFilter, keywordFilterConditions, keywordFilterCollectionStatus };
