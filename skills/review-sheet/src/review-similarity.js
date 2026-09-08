'use strict';

const crypto = require('crypto');

const BLOCKED_THRESHOLD = 0.78;
const WARNING_THRESHOLD = 0.58;
const MIN_FUZZY_LENGTH = 15;

/**
 * 统一评价文本，供完全重复和近似重复检测使用。
 * @param {unknown} value 原始文本。
 * @returns {string} 去除空白、标点和大小写差异后的文本。
 */
function normalizeReviewText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

/**
 * 为评价生成稳定指纹。
 * @param {unknown} value 评价文本。
 * @returns {string} SHA-256 指纹，空文本返回空串。
 */
function reviewFingerprint(value) {
  const normalized = normalizeReviewText(value);
  return normalized ? crypto.createHash('sha256').update(normalized).digest('hex') : '';
}

function ngramSet(text, size = 2) {
  const normalized = normalizeReviewText(text);
  const result = new Set();
  if (normalized.length < size) {
    if (normalized) result.add(normalized);
    return result;
  }
  for (let index = 0; index <= normalized.length - size; index += 1) {
    result.add(normalized.slice(index, index + size));
  }
  return result;
}

/**
 * 计算两条中文评价的近似度。短文本仅识别完全重复，降低误报。
 * @param {unknown} left 第一条评价。
 * @param {unknown} right 第二条评价。
 * @returns {number} 0 到 1 的相似度。
 */
function scoreReviewSimilarity(left, right) {
  const a = normalizeReviewText(left);
  const b = normalizeReviewText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (Math.min(a.length, b.length) < MIN_FUZZY_LENGTH) return 0;

  const leftSet = ngramSet(a);
  const rightSet = ngramSet(b);
  let intersection = 0;
  for (const token of leftSet) if (rightSet.has(token)) intersection += 1;
  const union = leftSet.size + rightSet.size - intersection;
  const jaccard = union > 0 ? intersection / union : 0;
  const containment = Math.min(leftSet.size, rightSet.size) > 0
    ? intersection / Math.min(leftSet.size, rightSet.size)
    : 0;
  const lengthRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  // 一小段文字被长评价包含时仅提醒；长度接近才按高度相似处理。
  const containmentWeight = lengthRatio >= 0.6 ? 0.9 : 0.6;
  return Math.round(Math.max(jaccard, containment * containmentWeight) * 1000) / 1000;
}

function emptyQuality() {
  return {
    level: 'none',
    score: 0,
    scope: '',
    reason: '',
    matchedDraftId: '',
    matchedRunId: ''
  };
}

function strongerQuality(current, candidate) {
  const rank = { none: 0, warning: 1, blocked: 2 };
  if ((rank[candidate.level] || 0) > (rank[current.level] || 0)) return candidate;
  if (candidate.level === current.level && Number(candidate.score) > Number(current.score)) return candidate;
  return current;
}

function matchQuality(row, target, { scope, rowNumber } = {}) {
  const score = scoreReviewSimilarity(row.reviewContent, target.reviewContent);
  if (score < WARNING_THRESHOLD) return null;
  const batch = scope === 'batch';
  const level = batch && score >= BLOCKED_THRESHOLD ? 'blocked' : 'warning';
  const label = batch
    ? `与本表第 ${rowNumber} 条${score === 1 ? '完全重复' : '高度相似'}`
    : '与历史评价相似';
  return {
    level,
    score,
    scope,
    reason: label,
    matchedDraftId: String(target.id || target.draftId || ''),
    matchedRunId: String(target.runId || '')
  };
}

/**
 * 对整批评价执行批内与历史查重，并返回可持久化质量字段。
 * @param {Array<object>} rows 当前评价草稿。
 * @param {object} [options] 检测选项。
 * @param {Array<object>} [options.history] 已确认的历史评价。
 * @param {string} [options.runId] 当前运行 ID，用于排除本次历史。
 * @returns {{rows:Array<object>,summary:object,qualityById:object}} 检测结果。
 */
function assessReviewQuality(rows = [], options = {}) {
  const history = Array.isArray(options.history) ? options.history : [];
  const assessed = [];

  for (const [index, source] of (Array.isArray(rows) ? rows : []).entries()) {
    const row = { ...source };
    const text = String(row.reviewContent || '').trim();
    let quality = emptyQuality();
    if (!text) {
      quality = { ...quality, level: 'blocked', scope: 'content', reason: '评价内容为空' };
    } else {
      for (let previousIndex = 0; previousIndex < assessed.length; previousIndex += 1) {
        const candidate = matchQuality(row, assessed[previousIndex], { scope: 'batch', rowNumber: previousIndex + 1 });
        if (candidate) quality = strongerQuality(quality, candidate);
      }
      for (const historical of history) {
        if (String(historical.runId || '') && String(historical.runId) === String(options.runId || '')) continue;
        const candidate = matchQuality(row, historical, { scope: 'history' });
        if (candidate) quality = strongerQuality(quality, candidate);
      }
    }
    assessed.push({ ...row, fingerprint: reviewFingerprint(text), quality });
  }

  const summary = assessed.reduce((memo, row) => {
    memo.total += 1;
    const level = row.quality?.level || 'none';
    if (level === 'blocked') memo.blocked += 1;
    else if (level === 'warning') memo.warning += 1;
    else memo.passed += 1;
    if (!String(row.reviewContent || '').trim()) memo.missing += 1;
    if (row.quality?.scope === 'batch' && row.quality?.score === 1) memo.exactDuplicates += 1;
    if (row.quality?.scope === 'batch' && row.quality?.score >= WARNING_THRESHOLD && row.quality?.score < 1) memo.nearDuplicates += 1;
    if (row.quality?.scope === 'history') memo.historyWarnings += 1;
    return memo;
  }, {
    total: 0,
    passed: 0,
    warning: 0,
    blocked: 0,
    missing: 0,
    exactDuplicates: 0,
    nearDuplicates: 0,
    historyWarnings: 0
  });
  const qualityById = Object.fromEntries(assessed.map(row => [String(row.id || ''), row.quality]));
  return { rows: assessed, summary, qualityById };
}

module.exports = {
  BLOCKED_THRESHOLD,
  MIN_FUZZY_LENGTH,
  WARNING_THRESHOLD,
  assessReviewQuality,
  normalizeReviewText,
  reviewFingerprint,
  scoreReviewSimilarity
};
