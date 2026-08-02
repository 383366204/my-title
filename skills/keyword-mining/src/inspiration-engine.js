const { buildHistoryKeys } = require('../../../core/history-record');
const { selectDiverseCandidates, historySignals } = require('./diversity-selector');
const { collectInspirations, seededNumber } = (() => {
  const sources = require('./inspiration-sources');
  return {
    ...sources,
    seededNumber: seed => parseInt(sources.stableHash(seed).slice(0, 12), 16) / 0xffffffffffff
  };
})();
const { assessInspiration, assessRootCandidate } = require('./inspiration-guard');
const { productizeInspirations } = require('./inspiration-productizer');

const DEFAULT_SOURCE_QUOTAS = { news: 3, dictionary: 2, calendar: 1, trend: 1 };

function ageDays(record, now) {
  const timestamp = Date.parse(record?.lastSeenAt || '');
  const current = Date.parse(now || '');
  if (!Number.isFinite(timestamp) || !Number.isFinite(current)) return Infinity;
  return Math.max(0, (current - timestamp) / 86400000);
}

function sourceScore(sourceType) {
  if (sourceType === 'news') return 15;
  if (sourceType === 'trend') return 14;
  if (sourceType === 'calendar') return 12;
  return 9;
}

/**
 * Score a grounded product root before querying SYCM.
 * @param {object} candidate Grounded root candidate.
 * @param {object} history Recent diversity history.
 * @param {object} context Run date and attempt context.
 * @returns {object} Total score and factor breakdown.
 */
function rootPreScore(candidate, history, { date, runAttempt }) {
  const sourceType = candidate.inspiration?.sourceType || 'dictionary';
  const relation = Math.min(20, Math.max(0, Number(candidate.confidence || 60) * 0.2));
  const novelty = historySignals({
    ...candidate,
    keyword: candidate.rootKeyword,
    localScore: 0,
    seed: candidate.inspirationId,
    category: candidate.category || candidate.familyKey
  }, history || {}, { now: `${date}T12:00:00.000Z`, mode: 'explore' });
  const noveltyScore = novelty.noveltyStatus === 'new_family' ? 15 : Math.max(0, 15 - Number(novelty.familyPenalty || 0));
  const categoryCoverage = candidate.category ? 10 : 6;
  const sourceReliability = sourceType === 'news' || sourceType === 'trend' ? 10 : sourceType === 'calendar' ? 8 : 6;
  const explorationJitter = seededNumber(`${date}:${runAttempt}:${candidate.rootKeyword}:${candidate.inspirationId}`) * 4;
  const total = 30 + relation + sourceScore(sourceType) + noveltyScore + categoryCoverage + sourceReliability + explorationJitter;
  return {
    total: Number(Math.min(100, total).toFixed(2)),
    novelty,
    breakdown: {
      concreteness: 30,
      relation: Number(relation.toFixed(2)),
      sourceFreshness: sourceScore(sourceType),
      novelty: Number(noveltyScore.toFixed(2)),
      categoryCoverage,
      sourceReliability,
      explorationJitter: Number(explorationJitter.toFixed(2))
    }
  };
}

/**
 * Check exact-root and product-family cooldowns.
 * @param {object} candidate Grounded root candidate.
 * @param {object} history Recent diversity history.
 * @param {object} options Cooldown options.
 * @returns {object} Cooldown decision and ages.
 */
function applyCooldown(candidate, history, { now, rootCooldownDays, familyCooldownDays }) {
  const keys = buildHistoryKeys({
    keyword: candidate.rootKeyword,
    coreProduct: candidate.coreProduct,
    familyKey: candidate.familyKey
  });
  const keywordRecord = history?.keywords?.[keys.keywordKey];
  const familyRecord = history?.families?.[keys.familyKey] || history?.families?.[keys.coreProductKey];
  const rootAgeDays = ageDays(keywordRecord, now);
  const familyAgeDays = ageDays(familyRecord, now);
  if (rootAgeDays < rootCooldownDays) return { ok: false, reason: 'root_cooldown', rootAgeDays, familyAgeDays };
  if (familyAgeDays < familyCooldownDays) return { ok: false, reason: 'family_cooldown', rootAgeDays, familyAgeDays };
  return { ok: true, reason: '', rootAgeDays, familyAgeDays };
}

/**
 * Fill daily root capacity while preserving source quotas and family diversity.
 * @param {Array<object>} rows Ranked root candidates.
 * @param {object} options Root limit and per-source quotas.
 * @returns {Array<object>} Selected root candidates.
 */
function selectBySourceQuota(rows, { rootLimit, sourceQuotas }) {
  const selected = [];
  const selectedKeys = new Set();
  const take = row => {
    const key = `${row.familyKey}:${row.rootKeyword}`;
    if (selectedKeys.has(key) || selected.some(item => item.familyKey === row.familyKey)) return false;
    selected.push(row);
    selectedKeys.add(key);
    return true;
  };
  for (const [sourceType, quota] of Object.entries(sourceQuotas)) {
    const rowsForSource = rows.filter(row => row.inspiration?.sourceType === sourceType);
    let accepted = 0;
    for (const row of rowsForSource) {
      if (accepted >= quota || selected.length >= rootLimit) break;
      if (take(row)) accepted += 1;
    }
  }
  for (const row of rows) {
    if (selected.length >= rootLimit) break;
    take(row);
  }
  return selected;
}

/**
 * Discover safe, diverse short product roots without reading the seed pool.
 * @param {object} [options] Discovery options.
 * @returns {Promise<object>} Inspirations, root decisions, selected roots, and stats.
 */
async function discoverInspirationRoots({
  date = new Date().toISOString().slice(0, 10),
  runAttempt = 0,
  rootLimit = 8,
  rootCooldownDays = 14,
  familyCooldownDays = 7,
  minRootScore = 60,
  sourceQuotas = DEFAULT_SOURCE_QUOTAS,
  history = null,
  llmClient = null,
  useLLM = true,
  newsItems = [],
  newsFeedUrls,
  dictionaryWords,
  trendItems = [],
  fetcher
} = {}) {
  const collected = await collectInspirations({
    date,
    runAttempt,
    newsItems,
    newsFeedUrls,
    dictionaryWords,
    trendItems,
    fetcher
  });
  const inspirations = collected.inspirations.map(item => {
    const guard = assessInspiration(item);
    return { ...item, ...guard, status: guard.ok ? 'safe' : 'rejected' };
  });
  const safeInspirations = inspirations.filter(item => item.ok);
  const productized = await productizeInspirations(safeInspirations, { llmClient, useLLM });
  const grounded = productized.roots.map(row => assessRootCandidate(row, { maxSeeds: 0 }));
  const now = `${date}T12:00:00.000Z`;
  const cooled = grounded.map(candidate => {
    if (candidate.rejectReason) return candidate;
    const cooldown = applyCooldown(candidate, history || {}, { now, rootCooldownDays, familyCooldownDays });
    if (!cooldown.ok) return { ...candidate, status: 'rejected', rejectReason: cooldown.reason, cooldown };
    const score = rootPreScore(candidate, history, { date, runAttempt });
    return {
      ...candidate,
      seed: candidate.inspirationId,
      pattern: `inspiration-${candidate.inspiration?.sourceType || 'unknown'}`,
      source: 'inspiration',
      category: candidate.category || candidate.familyKey,
      localScore: score.total,
      rootScore: score,
      status: score.total >= minRootScore ? 'eligible' : 'rejected',
      rejectReason: score.total >= minRootScore ? '' : 'root_score_below_threshold'
    };
  });
  const eligible = cooled.filter(item => item.status === 'eligible');
  const diversified = selectDiverseCandidates(eligible, {
    count: eligible.length,
    maxPerSeed: 1,
    maxPerCategory: Math.max(1, Math.ceil(Number(rootLimit || 8) * 0.25)),
    maxPerPattern: eligible.length,
    maxPerProductCore: 1,
    history,
    mode: 'explore'
  }).selected;
  const selectedRoots = selectBySourceQuota(diversified, {
    rootLimit: Number(rootLimit || 8),
    sourceQuotas
  }).map((row, index) => ({ ...row, status: 'selected', selectedRank: index + 1 }));
  const selectedIds = new Set(selectedRoots.map(item => `${item.inspirationId}:${item.rootKeyword}`));
  const roots = cooled.map(item => selectedIds.has(`${item.inspirationId}:${item.rootKeyword}`)
    ? selectedRoots.find(row => row.inspirationId === item.inspirationId && row.rootKeyword === item.rootKeyword)
    : item.status === 'eligible'
      ? { ...item, status: 'not_selected', rejectReason: 'daily_quota_or_diversity' }
      : item);
  const rejectionCounts = roots.filter(item => item.status === 'rejected' || item.status === 'not_selected')
    .reduce((counts, item) => {
      counts[item.rejectReason || 'unknown'] = (counts[item.rejectReason || 'unknown'] || 0) + 1;
      return counts;
    }, {});
  return {
    ok: true,
    date,
    inspirations,
    roots,
    selectedRoots,
    stats: {
      inspirationCount: inspirations.length,
      safeInspirationCount: safeInspirations.length,
      inspirationRejected: inspirations.length - safeInspirations.length,
      productizedCount: productized.roots.length,
      groundedCount: grounded.filter(item => !item.rejectReason).length,
      selectedRootCount: selectedRoots.length,
      sourceCounts: selectedRoots.reduce((counts, row) => {
        const source = row.inspiration?.sourceType || 'unknown';
        counts[source] = (counts[source] || 0) + 1;
        return counts;
      }, {}),
      rejectionCounts,
      feedErrors: collected.errors,
      productizer: productized.meta
    }
  };
}

module.exports = {
  DEFAULT_SOURCE_QUOTAS,
  applyCooldown,
  discoverInspirationRoots,
  rootPreScore,
  selectBySourceQuota
};
