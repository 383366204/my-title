'use strict';

const { extractSycmData, DEFAULT_FILTER_CONDITIONS } = require('../../sycm-research/src/sycm-cdp-extractor');
const { keywordFilterConditions } = require('./keyword-metric-filter');
const { normalizeSycmMetrics, compareMetricThreshold } = require('../../sycm-research/src/metric-parser');

const DEFAULT_RELAXED_FILTER_CONDITIONS = {
  demandSupplyRatio: 0.5,
  searchPopularity: 0,
  conversionRate: 0,
  buyerCount: 0,
  referencePrice: 0
};
const DEFAULT_HOT_FILTER_CONDITIONS = {
  demandSupplyRatio: 0,
  searchPopularity: 0,
  conversionRate: 0,
  buyerCount: 0,
  referencePrice: 0
};

/**
 * Score rows returned by SYCM for the selected verification tier.
 * @param {object[]} rows SYCM result rows.
 * @param {object} [options] Scoring options.
 * @param {string} [options.mode] blue, blue_relaxed, or hot.
 * @returns {object} Verification score and usage metadata.
 */
function scoreSycmRows(rows, { mode = 'blue' } = {}) {
  const usableRows = Array.isArray(rows) ? rows.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
  if (usableRows.length === 0) {
    return { passed: false, score: 0, reason: '生意参谋无数据' };
  }

  const best = usableRows.reduce((max, row) => {
    const normalized = normalizeSycmMetrics(row);
    const demandSupplyRatio = normalized.demandSupplyRatio ?? 0;
    const searchPopularity = normalized.searchPopularity ?? 0;
    const clickRate = (normalized.clickRate ?? 0) * 100;
    const conversionRate = (normalized.conversionRate ?? 0) * 100;
    const score = Math.max(0, Math.round(
      Math.min(40, demandSupplyRatio * 8) +
      Math.min(25, searchPopularity / 20) +
      Math.min(20, clickRate / 4) +
      Math.min(15, conversionRate * 3)
    ));
    return !max.row || score > max.score ? { row, normalized, score, demandSupplyRatio, searchPopularity, clickRate, conversionRate } : max;
  }, { row: null, score: 0, demandSupplyRatio: 0, searchPopularity: 0, clickRate: 0, conversionRate: 0 });

  const hasHeat = best.searchPopularity > 0 || best.clickRate > 0 || best.conversionRate > 0;
  const popularityState = compareMetricThreshold(best.normalized.metrics.searchPopularity, Number.MIN_VALUE);
  const demandState = compareMetricThreshold(best.normalized.metrics.demandSupplyRatio, mode === 'blue_relaxed' ? 0.5 : 1);
  const needsReview = popularityState === 'review' || (mode !== 'hot' && demandState === 'review');
  const passed = !needsReview && popularityState === 'passed' && hasHeat && (mode === 'hot' || demandState === 'passed');
  const confidence = mode === 'hot' ? 'trend' : mode === 'blue_relaxed' ? 'medium' : 'high';
  const usage = mode === 'hot' ? 'trend_reference' : mode === 'blue_relaxed' ? 'title_optional' : 'title_core';
  return {
    passed,
    needsReview,
    metrics: best.normalized.metrics,
    metricParserVersion: best.normalized.metricParserVersion,
    score: best.score,
    bestKeyword: best.row && best.row.keyword,
    mode,
    confidence,
    usage,
    reason: passed
      ? (mode === 'hot'
        ? `热搜降级通过，搜索人气${best.searchPopularity}，点击率${best.clickRate}`
        : mode === 'blue_relaxed'
          ? `放宽蓝海通过，供需比${best.demandSupplyRatio}，搜索人气${best.searchPopularity}，点击率${best.clickRate}`
          : `供需比${best.demandSupplyRatio}，搜索人气${best.searchPopularity}，点击率${best.clickRate}`)
      : needsReview ? '关键指标缺失、解析不明确或区间跨越门槛，需人工复核' : '指标不足，暂不进入标题生成'
  };
}

/**
 * Decide whether verification should continue to a broader tier.
 * @param {object} [options] Tier result.
 * @param {object[]} [options.data] SYCM rows.
 * @param {object} [options.sycmScore] Score returned by scoreSycmRows.
 * @param {number} [options.minBlueRows] Minimum acceptable row count.
 * @returns {boolean} Whether the next tier is required.
 */
function shouldFallbackToNextTier({ data, sycmScore, minBlueRows = 1 } = {}) {
  const count = Array.isArray(data) ? data.length : 0;
  if (count < minBlueRows) return true;
  return !(sycmScore && sycmScore.passed);
}

/**
 * Verify a keyword using strict blue, relaxed blue, then hot tiers.
 * @param {string} keyword Keyword to verify.
 * @param {object} [options] SYCM and fallback options.
 * @returns {Promise<object>} Selected tier, rows, score, and attempt trace.
 */
async function fetchSycmWithFallback(keyword, options = {}) {
  const configured = options.keywordFilter ? keywordFilterConditions(options.keywordFilter) : null;
  const sycmExtractor = options.sycmExtractor || extractSycmData;
  const baseOptions = {
    ...(configured ? { guardCache: false } : {}),
    port: Number(options.port || process.env.SYCM_DEBUG_PORT || 9222),
    maxPages: Number(options.pages || process.env.SYCM_MAX_PAGES || 1),
    loginMode: options.loginMode || process.env.SYCM_LOGIN_MODE || 'manual',
    pageFilters: { compareType: options.compare || 'cycle', timePeriod: options.period || '7d' }
  };
  const primaryMode = options.verificationMode || options.mode || 'blue';
  const primary = await sycmExtractor(keyword, {
    ...baseOptions,
    mode: primaryMode === 'blue_relaxed' ? 'blue' : primaryMode,
    filterConditions: configured || (primaryMode === 'blue' ? DEFAULT_FILTER_CONDITIONS : primaryMode === 'blue_relaxed' ? DEFAULT_RELAXED_FILTER_CONDITIONS : null)
  });
  const primaryData = primary && Array.isArray(primary.data) ? primary.data : [];
  const primaryScore = scoreSycmRows(primaryData, { mode: primaryMode });
  const fallbackEnabled = options.fallbackHot !== false && ['blue', 'blue_relaxed'].includes(primaryMode);
  const minBlueRows = Number(options.minBlueRows || 1);

  if (!fallbackEnabled || !shouldFallbackToNextTier({ data: primaryData, sycmScore: primaryScore, minBlueRows })) {
    return {
      result: primary,
      data: primaryData,
      sycmScore: primaryScore,
      verifyMode: primaryMode,
      fallbackUsed: false,
      attempts: [{ mode: primaryMode, totalCount: primaryData.length, passed: primaryScore.passed }]
    };
  }

  // 自定义门槛下不再放宽平台条件，复用同次查询，避免重复请求。
  const relaxed = primaryMode === 'blue_relaxed' || configured ? primary : await sycmExtractor(keyword, {
    ...baseOptions,
    mode: 'blue',
    filterConditions: configured || options.relaxedFilterConditions || DEFAULT_RELAXED_FILTER_CONDITIONS
  });
  const relaxedData = relaxed && Array.isArray(relaxed.data) ? relaxed.data : [];
  const relaxedScore = scoreSycmRows(relaxedData, { mode: 'blue_relaxed' });
  const primaryFallbackReason = primaryData.length < minBlueRows ? 'blue_rows_insufficient' : 'blue_score_not_passed';

  if (!shouldFallbackToNextTier({ data: relaxedData, sycmScore: relaxedScore, minBlueRows })) {
    return {
      result: relaxed,
      data: relaxedData,
      sycmScore: relaxedScore,
      verifyMode: 'blue_relaxed',
      fallbackUsed: true,
      fallbackReason: primaryFallbackReason,
      primary: { data: primaryData, sycmScore: primaryScore },
      attempts: [
        { mode: primaryMode, totalCount: primaryData.length, passed: primaryScore.passed },
        { mode: 'blue_relaxed', totalCount: relaxedData.length, passed: relaxedScore.passed }
      ]
    };
  }

  const fallback = await sycmExtractor(keyword, {
    ...baseOptions,
    mode: 'hot',
    filterConditions: configured || options.hotFilterConditions || DEFAULT_HOT_FILTER_CONDITIONS
  });
  const fallbackData = fallback && Array.isArray(fallback.data) ? fallback.data : [];
  const fallbackScore = scoreSycmRows(fallbackData, { mode: 'hot' });
  return {
    result: fallback,
    data: fallbackData,
    sycmScore: fallbackScore,
    verifyMode: 'hot',
    fallbackUsed: true,
    fallbackReason: relaxedData.length < minBlueRows ? 'blue_relaxed_rows_insufficient' : 'blue_relaxed_score_not_passed',
    primary: { data: primaryData, sycmScore: primaryScore },
    attempts: [
      { mode: primaryMode, totalCount: primaryData.length, passed: primaryScore.passed },
      { mode: 'blue_relaxed', totalCount: relaxedData.length, passed: relaxedScore.passed },
      { mode: 'hot', totalCount: fallbackData.length, passed: fallbackScore.passed }
    ]
  };
}

module.exports = {
  fetchSycmWithFallback,
  scoreSycmRows,
  shouldFallbackToNextTier
};
