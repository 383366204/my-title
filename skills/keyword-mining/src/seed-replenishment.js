const { prepareSeedSuggestions } = require('./seed-suggestions');

const DEFAULT_SOURCE_QUOTAS = {
  sycm: 3,
  verified: 2,
  alibaba1688: 2,
  seasonal: 1,
  manual: 1
};

/**
 * Build a balanced, read-only seed replenishment plan from multiple discovery sources.
 * @param {object} sources Candidate arrays keyed by source channel.
 * @param {object} [options] Planning options.
 * @param {Array<object>} [options.existingSeeds] Current seed pool.
 * @param {object} [options.sourceQuotas] Per-source accepted limits.
 * @param {number} [options.maxSuggestions=8] Overall accepted limit.
 * @param {number} [options.minQualityScore=45] Minimum seed quality.
 * @returns {{accepted:Array<object>,rejected:Array<object>,bySource:object,summary:object}} Replenishment plan.
 */
function buildSeedReplenishmentPlan(sources = {}, {
  existingSeeds = [],
  sourceQuotas = DEFAULT_SOURCE_QUOTAS,
  maxSuggestions = 8,
  minQualityScore = 45
} = {}) {
  const accepted = [];
  const rejected = [];
  const bySource = {};
  const sourceEntries = Object.entries(sources || {}).filter(([, rows]) => Array.isArray(rows));

  for (const [source, rows] of sourceEntries) {
    const remaining = Math.max(0, Number(maxSuggestions || 8) - accepted.length);
    const quota = Math.min(remaining, Math.max(0, Number(sourceQuotas[source] ?? 1)));
    if (quota === 0) {
      bySource[source] = { input: rows.length, accepted: 0, rejected: rows.length, quota };
      rejected.push(...rows.map(row => ({ sourceKeyword: row.keyword || row.word || '', reason: 'source_quota_exhausted', source })));
      continue;
    }
    const result = prepareSeedSuggestions(rows.map(row => ({ ...row, source: row.source || source })), {
      existingSeeds: [...existingSeeds, ...accepted],
      maxSuggestions: quota,
      minQualityScore
    });
    accepted.push(...result.accepted.map(item => ({ ...item, discoverySource: source })));
    rejected.push(...result.rejected.map(item => ({ ...item, discoverySource: source })));
    bySource[source] = { ...result.summary, quota };
    if (accepted.length >= Number(maxSuggestions || 8)) break;
  }

  return {
    accepted,
    rejected,
    bySource,
    summary: {
      input: sourceEntries.reduce((total, [, rows]) => total + rows.length, 0),
      accepted: accepted.length,
      rejected: rejected.length,
      sourcesUsed: Object.values(bySource).filter(item => item.accepted > 0).length
    }
  };
}

module.exports = { DEFAULT_SOURCE_QUOTAS, buildSeedReplenishmentPlan };
