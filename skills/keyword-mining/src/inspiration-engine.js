const { buildHistoryKeys } = require('../../../core/history-record');
const { selectDiverseCandidates, historySignals } = require('./diversity-selector');
const { collectInspirations, stableHash } = require('./inspiration-sources');
const { assessInspiration, assessRootCandidate } = require('./inspiration-guard');
const { productizeInspirations } = require('./inspiration-productizer');
const { rootResearchStatus, normalizeResearchRoot, discoverySnapshot } = require('./root-research-store');
const { collectDimensionInspirations } = require('./dimension-catalog');
const path = require('path');

const DEFAULT_SOURCE_QUOTAS = { user_input: 1, news: 2, knowledge_base: 3, dictionary: 1, calendar: 1, trend: 1 };

function seededNumber(seed) {
  return parseInt(stableHash(seed).slice(0, 12), 16) / 0xffffffffffff;
}

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
  // 使用可核验的字段完整性，不再把模型自报置信度作为评分依据。
  const relation = (candidate.relationReason ? 8 : 0) + (candidate.productForm ? 6 : 0) + (candidate.productUse ? 6 : 0);
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
  rootCooldownDays = 30,
  familyCooldownDays = 0,
  minRootScore = 60,
  sourceQuotas = DEFAULT_SOURCE_QUOTAS,
  history = null,
  llmClient = null,
  useLLM = true,
  newsItems = [],
  newsFeedUrls,
  dictionaryWords,
  trendItems = [],
  fetcher,
  dataDir,
  researchScopeId = 'default',
  enabledDimensions,
  customInputs,
  now = Date.now(), onProgress, shouldStop, batchCacheDir, onPartial,
  materialBudget = Number(process.env.INSPIRATION_MATERIAL_BUDGET || 48)
} = {}) {
  const demands = collectDimensionInspirations({ date, runAttempt, enabledDimensions, customInputs });
  const directed = demands.some(item => item.dimension === 'direction');
  onProgress?.({ current: 0, total: 1, message: directed ? '正在准备自定义选词方向' : '正在收集新闻；字典与日历使用本地素材' });
  const collect = () => directed ? { inspirations: [], errors: [], stats: { news: 0 } } : collectInspirations({
    date,
    runAttempt,
    newsItems,
    newsFeedUrls,
    dictionaryWords,
    trendItems,
    fetcher, cacheDir: dataDir ? path.join(dataDir, 'news-cache') : undefined, onProgress, shouldStop
  });
  const collected = await discoverySnapshot(batchCacheDir ? path.join(batchCacheDir, 'materials.json') : null, async () => {
    const result = await collect();
    if (shouldStop?.()) throw Object.assign(new Error('已停止灵感采集'), { code: 'INSPIRATION_STOPPED' });
    return result;
  });
  const inspirations = [...(directed ? [] : collected.inspirations), ...demands].map(item => {
    const guard = assessInspiration(item);
    return { ...item, ...guard, status: guard.ok ? 'safe' : 'rejected' };
  });
  const seenMaterials = new Set();
  const safeInspirations = inspirations.filter(item => {
    if (!item.ok) return false;
    const key = `${item.sourceType}:${item.dimension || ''}:${item.rawSourceText || item.inspirationWord}`;
    if (seenMaterials.has(key)) return false;
    seenMaterials.add(key);
    return true;
  });
  // 每轮交错来源，避免字典排在前面时耗尽预算或挤掉时事、人群素材。
  const groups = new Map();
  for (const item of safeInspirations) {
    const key = item.dimension || item.sourceType;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const ordered = [];
  while ([...groups.values()].some(rows => rows.length)) {
    for (const rows of groups.values()) if (rows.length) ordered.push(rows.shift());
  }
  const evaluate = productized => {
    const merged = new Map();
    for (const row of productized.roots) {
      const key = normalizeResearchRoot(row.rootKeyword);
      const previous = merged.get(key);
      const provenance = { inspirationId: row.inspirationId, inspiration: row.inspiration, relationReason: row.relationReason };
      if (previous) previous.provenance.push(provenance);
      else merged.set(key, { ...row, provenance: [provenance] });
    }
    const grounded = [...merged.values()].map(row => assessRootCandidate(row, { maxSeeds: 0 }));
    const cooled = grounded.map(candidate => {
      if (candidate.rejectReason) return candidate;
      const research = dataDir ? rootResearchStatus(candidate.rootKeyword, { dataDir, researchScopeId, now }) : null;
      const cooldown = research
        ? { ok: research.state !== 'cooling', reason: research.state === 'cooling' ? 'root_cooldown' : '' }
        : applyCooldown(candidate, history || {}, { now: `${date}T12:00:00.000Z`, rootCooldownDays, familyCooldownDays });
      candidate = { ...candidate, research: research && { state: research.state, lastCompletedAt: research.lastCompletedAt, nextEligibleAt: research.nextEligibleAt } };
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
      maxPerSeed: directed ? Number(rootLimit || 8) : 1,
      maxPerCategory: Math.max(1, Math.ceil(Number(rootLimit || 8) * 0.25)),
      maxPerPattern: eligible.length,
      maxPerProductCore: 1,
      history,
      mode: 'explore'
    }).selected;
    const selectedRoots = selectBySourceQuota(diversified, {
      rootLimit: Number(rootLimit || 8),
      sourceQuotas: directed ? { user_input: Number(rootLimit || 8) } : sourceQuotas
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
    return { roots, selectedRoots, grounded, rejectionCounts };
  };
  const productized = { roots: [], meta: { generated: 0, fallbackGenerated: 0, cacheHits: 0, errors: [], requests: [] } };
  let decisions = evaluate(productized);
  let analyzed = 0;
  let rounds = 0;
  const budget = Math.min(ordered.length, Math.max(1, Math.floor(materialBudget) || 48));
  while (analyzed < budget && decisions.selectedRoots.length < rootLimit) {
    if (shouldStop?.()) throw Object.assign(new Error('已暂停灵感分析'), { code: 'INSPIRATION_STOPPED' });
    const round = ordered.slice(analyzed, Math.min(budget, analyzed + (directed ? 1 : 4)));
    const report = event => onProgress?.({ current: analyzed, total: budget,
      message: `已分析 ${analyzed}/${budget} 条素材，已选 ${decisions.selectedRoots.length}/${rootLimit} 个词根；${event.message}` });
    const next = await productizeInspirations(round, { llmClient, useLLM, onProgress: report, shouldStop, batchCacheDir,
      ...(productized.meta.rateLimited ? { concurrency: 1 } : {}),
      ...(directed ? { maxRootsPerInspiration: Math.max(3, Number(rootLimit || 8)) } : {}) });
    productized.roots.push(...next.roots);
    for (const key of ['generated', 'fallbackGenerated', 'cacheHits']) productized.meta[key] += next.meta[key] || 0;
    for (const key of ['errors', 'requests']) productized.meta[key].push(...(next.meta[key] || []));
    productized.meta.provider = next.meta.provider;
    productized.meta.model = next.meta.model;
    productized.meta.rateLimited ||= next.meta.rateLimited;
    analyzed += round.length;
    rounds += 1;
    decisions = evaluate(productized);
    onPartial?.({ inspirations, roots: decisions.roots, selectedRoots: decisions.selectedRoots, analyzed, target: rootLimit });
    report({ message: `已复用 ${productized.meta.cacheHits} 批，失败 ${productized.meta.errors.length} 批` });
  }
  const { roots, selectedRoots, grounded, rejectionCounts } = decisions;
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
      analyzedInspirationCount: analyzed,
      rounds,
      targetRootCount: rootLimit,
      targetReached: selectedRoots.length >= rootLimit,
      stopReason: selectedRoots.length >= rootLimit ? 'target_reached' : analyzed >= ordered.length ? 'materials_exhausted' : 'material_budget_reached',
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
      newsStatus: collected.stats.news > 0 ? 'available' : collected.errors.length > 0 ? 'unavailable' : 'empty_or_unconfigured',
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
