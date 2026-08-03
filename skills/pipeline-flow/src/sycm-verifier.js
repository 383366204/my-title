'use strict';

const { extractSycmData, DEFAULT_FILTER_CONDITIONS } = require('../../sycm-research');

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

function parseMetricNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const matches = String(value || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/g);
  if (!matches) return 0;
  const nums = matches.map(Number).filter(Number.isFinite);
  return nums.length ? Math.max(...nums) : 0;
}

/**
 * Score rows returned by SYCM for the selected verification tier.
 * @param {object[]} rows SYCM result rows.
 * @param {object} [options] Scoring options.
 * @param {string} [options.mode] blue, blue_relaxed, or hot.
 * @returns {object} Verification score and usage metadata.
 */
function scoreSycmRows(rows, { mode = 'blue' } = {}) {
  const usableRows = Array.isArray(rows) ? rows : [];
  if (usableRows.length === 0) {
    return { passed: false, score: 0, reason: '生意参谋无数据' };
  }

  const best = usableRows.reduce((max, row) => {
    const demandSupplyRatio = parseMetricNumber(row.demandSupplyRatio);
    const searchPopularity = parseMetricNumber(row.searchPopularity);
    const clickRate = parseMetricNumber(row.clickRate);
    const conversionRate = parseMetricNumber(row.conversionRate);
    const score = Math.round(
      Math.min(40, demandSupplyRatio * 8) +
      Math.min(25, searchPopularity / 20) +
      Math.min(20, clickRate / 4) +
      Math.min(15, conversionRate * 3)
    );
    return score > max.score ? { row, score, demandSupplyRatio, searchPopularity, clickRate, conversionRate } : max;
  }, { row: null, score: 0, demandSupplyRatio: 0, searchPopularity: 0, clickRate: 0, conversionRate: 0 });

  const hasHeat = best.searchPopularity > 0 || best.clickRate > 0 || best.conversionRate > 0;
  const passed = mode === 'hot'
    ? hasHeat
    : mode === 'blue_relaxed'
      ? best.demandSupplyRatio >= 0.5 && hasHeat
      : best.demandSupplyRatio >= 1 && hasHeat;
  const confidence = mode === 'hot' ? 'trend' : mode === 'blue_relaxed' ? 'medium' : 'high';
  const usage = mode === 'hot' ? 'trend_reference' : mode === 'blue_relaxed' ? 'title_optional' : 'title_core';
  return {
    passed,
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
      : '指标不足，暂不进入标题生成'
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
  const sycmExtractor = options.sycmExtractor || extractSycmData;
  const baseOptions = {
    port: Number(options.port || process.env.SYCM_DEBUG_PORT || 9222),
    maxPages: Number(options.pages || process.env.SYCM_MAX_PAGES || 1),
    loginMode: options.loginMode || process.env.SYCM_LOGIN_MODE || 'manual',
    pageFilters: { compareType: options.compare || 'cycle', timePeriod: options.period || '7d' }
  };
  const primaryMode = options.mode || 'blue';
  const primary = await sycmExtractor(keyword, {
    ...baseOptions,
    mode: primaryMode,
    filterConditions: primaryMode === 'blue' ? DEFAULT_FILTER_CONDITIONS : null
  });
  const primaryData = primary && Array.isArray(primary.data) ? primary.data : [];
  const primaryScore = scoreSycmRows(primaryData, { mode: primaryMode });
  const fallbackEnabled = options.fallbackHot !== false && primaryMode === 'blue';
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

  const relaxed = await sycmExtractor(keyword, {
    ...baseOptions,
    mode: 'blue',
    filterConditions: options.relaxedFilterConditions || DEFAULT_RELAXED_FILTER_CONDITIONS
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
    filterConditions: options.hotFilterConditions || DEFAULT_HOT_FILTER_CONDITIONS
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
