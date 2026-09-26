'use strict';

const PARSER_VERSION = 'sycm-metrics-v1';
const NUMBER = '[+-]?\\d+(?:\\.\\d+)?(?:千|万|亿)?%?';
const EXACT = new RegExp(`^(${NUMBER})$`);
const RANGE = new RegExp(`^(${NUMBER})\\s*(?:~|～|至|—|–)\\s*(${NUMBER})$`);

function endpoint(text, unit, numericPercent) {
  const match = String(text).match(/^([+-]?\d+(?:\.\d+)?)(千|万|亿)?(%)?$/);
  if (!match || (unit !== 'ratio' && match[3])) return null;
  const multiplier = { 千: 1000, 万: 10000, 亿: 100000000 }[match[2]] || 1;
  return Number(match[1]) * multiplier / (match[3] || (unit === 'ratio' && numericPercent) ? 100 : 1);
}

/**
 * 解析生意参谋指标；区间使用下界，不把趋势当成指标或把缺失当零。
 * @param {unknown} raw 原始单元格内容。
 * @param {object} [options] unit 为 count/ratio/number；无百分号的比率默认按百分点解释。
 * @returns {object} 带原始证据、区间和解析状态的指标。
 */
function parseSycmMetric(raw, { unit = 'number', numericPercent = true } = {}) {
  const result = { raw: raw ?? null, value: null, lower: null, upper: null, unit,
    status: 'missing', trendRaw: null, trend: null, parserVersion: PARSER_VERSION };
  if (raw == null || (typeof raw === 'string' && /^(?:\s*|--?|暂无|无数据|N\/A)$/i.test(raw.trim()))) return result;
  if (!['string', 'number'].includes(typeof raw) || (typeof raw === 'number' && !Number.isFinite(raw))) {
    return { ...result, status: 'ambiguous' };
  }
  let text = String(raw).normalize('NFKC').replace(/[,，]/g, '').trim();
  // 只有明确分隔的趋势或带符号的粘连趋势才可拆分；10 ~ 500% 不可猜测。
  const trend = text.match(/^(.*?)\s+([+-]?\d+(?:\.\d+)?%)$/)
    || text.match(/^(.*?\d%?)([+-]\d+(?:\.\d+)?%)$/);
  if (trend && (EXACT.test(trend[1].trim()) || RANGE.test(trend[1].trim()))) {
    text = trend[1].trim();
    result.trendRaw = trend[2];
    result.trend = Number(trend[2].slice(0, -1)) / 100;
  }
  const range = text.match(RANGE);
  const exact = text.match(EXACT);
  if (!range && !exact) return { ...result, status: 'ambiguous' };
  // 端点百分号不一致无法区分区间单位和拼接的涨跌幅。
  if (range && range[1].endsWith('%') !== range[2].endsWith('%')) return { ...result, status: 'ambiguous' };
  const lower = endpoint((range || exact)[1], unit, numericPercent);
  const upper = range ? endpoint(range[2], unit, numericPercent) : lower;
  if (lower == null || upper == null || !Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper) {
    return { ...result, status: 'ambiguous' };
  }
  return { ...result, value: lower, lower, upper, status: range ? 'range' : 'exact' };
}

const FIELDS = {
  searchPopularity: ['count', 'searchPopularity'],
  clickPopularity: ['count', 'clickPopularity'],
  demandSupplyRatio: ['number', 'demandSupplyRatio'],
  clickRate: ['ratio', 'clickRate', 'clickRatio'],
  conversionRate: ['ratio', 'conversionRate', 'payConversionRate', 'payConversion'],
  tmallClickShare: ['ratio', 'tmallClickShare', 'tmallShare', 'tmallClickRatio'],
  buyerCount: ['count', 'buyerCount', 'payBuyerCount', 'payBuyers'],
  onlineProductCount: ['count', 'onlineProductCount', 'productCount', 'competitionCount', '商品数'],
  trend: ['ratio', 'trend', 'trendRate', 'searchTrend', 'growthRate']
};

/**
 * 统一别名和指标单位，合法零优先于备用字段；原始行应优先于旧归一化数据。
 * @param {object} [row] 平台原始行，或本模块已归一化的行。
 * @returns {object} 数值兼容字段和可追溯 metrics。
 */
function normalizeSycmMetrics(row = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) row = {};
  const metrics = {};
  const result = { metricParserVersion: PARSER_VERSION, metrics };
  for (const [field, [unit, ...aliases]] of Object.entries(FIELDS)) {
    const rawKey = aliases.find(key => row[key] != null && row[key] !== '');
    const existing = row.metricParserVersion === PARSER_VERSION && row.metrics?.[field];
    metrics[field] = existing || parseSycmMetric(rawKey ? row[rawKey] : null, { unit });
    result[field] = metrics[field].value;
  }
  result.payConversionRate = result.conversionRate;
  return result;
}

/**
 * 阈值判断区分明确通过、明确不足与待复核。
 * @param {object} metric 结构化指标。
 * @param {number} threshold 下限。
 * @returns {string} passed/weak/review。
 */
function compareMetricThreshold(metric, threshold) {
  if (!metric || !['exact', 'range'].includes(metric.status)) return 'review';
  if (metric.lower >= threshold) return 'passed';
  return metric.upper < threshold ? 'weak' : 'review';
}

module.exports = { parseSycmMetric, normalizeSycmMetrics, compareMetricThreshold };
