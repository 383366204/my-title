const { loadSeeds, normalizeKeyword, recordSeedEvent, saveSeeds } = require('./seed-store');
const { extractShortRoot } = require('./root-keywords');

const METRICS = ['runs', 'candidates', 'verified', 'generationEligible', 'selectedProducts', 'generatedTitles', 'failures'];

function normalizeStats(seed = {}) {
  const current = seed.stats && typeof seed.stats === 'object' ? seed.stats : {};
  return {
    runs: Number(current.runs || seed.queryCount || 0),
    candidates: Number(current.candidates || seed.candidateCount || 0),
    verified: Number(current.verified || seed.successCount || 0),
    generationEligible: Number(current.generationEligible || 0),
    selectedProducts: Number(current.selectedProducts || 0),
    generatedTitles: Number(current.generatedTitles || 0),
    failures: Number(current.failures || seed.failCount || 0)
  };
}

function findSeed(seeds, feedback) {
  const original = normalizeKeyword(feedback.originalKeyword || '');
  const root = normalizeKeyword(feedback.root || feedback.seed || '');
  if (original) {
    const exact = seeds.find(seed => normalizeKeyword(seed.keyword) === original);
    if (exact) return exact;
  }
  if (root) {
    const exactRoot = seeds.find(seed => normalizeKeyword(seed.keyword) === root);
    if (exactRoot) return exactRoot;
    return seeds.find(seed => extractShortRoot(seed)?.root === root) || null;
  }
  return null;
}

function nextLifecycle(seed, stats) {
  const status = String(seed.status || 'active');
  if (['paused', 'disabled'].includes(status)) return status;
  if (stats.runs >= 3 && stats.verified === 0) return 'cooling';
  if (stats.runs >= 2 && stats.generationEligible > 0 && ['observing', 'explore', 'cooling'].includes(status)) return 'active';
  return status;
}

/**
 * Apply mining and downstream outcome counters to stored seeds.
 * @param {Array<object>} feedbackRows Per-root metric increments.
 * @param {object} options Feedback options.
 * @param {string} options.dataDir Keyword-mining data directory.
 * @param {string} [options.eventType=feedback] Audit event type.
 * @returns {{updated:number, skipped:number, seeds:Array<object>}} Update summary.
 */
function applySeedFeedback(feedbackRows = [], { dataDir, eventType = 'feedback' } = {}) {
  if (!dataDir || !Array.isArray(feedbackRows) || feedbackRows.length === 0) {
    return { updated: 0, skipped: 0, seeds: [] };
  }
  const seeds = loadSeeds(dataDir);
  let updated = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (const feedback of feedbackRows) {
    const seed = findSeed(seeds, feedback || {});
    if (!seed) {
      skipped += 1;
      continue;
    }
    const stats = normalizeStats(seed);
    for (const metric of METRICS) {
      stats[metric] += Math.max(0, Number(feedback[metric] || 0));
    }
    seed.stats = stats;
    seed.successCount = stats.verified;
    seed.failCount = stats.failures;
    if (Number(feedback.runs || 0) > 0) {
      const previousUsedAt = seed.lastUsedAt ? new Date(seed.lastUsedAt).getTime() : 0;
      const usedAt = feedback.usedAt || now;
      const currentUsedAt = new Date(usedAt).getTime();
      const gapDays = previousUsedAt && Number.isFinite(currentUsedAt)
        ? Math.max(0, (currentUsedAt - previousUsedAt) / 86400000)
        : Infinity;
      seed.consecutiveRuns = gapDays <= 2 ? Number(seed.consecutiveRuns || 0) + 1 : 1;
      seed.lastUsedAt = usedAt;
    }
    const previousStatus = seed.status || 'active';
    seed.status = nextLifecycle(seed, stats);
    if (seed.status !== previousStatus) {
      seed.statusReason = seed.status === 'cooling'
        ? '连续运行未产生验真通过词，自动进入冷却。'
        : '历史产出达到活跃门槛，自动恢复。';
      seed.statusUpdatedAt = now;
    }
    updated += 1;
    recordSeedEvent({
      type: eventType,
      keyword: seed.keyword,
      root: feedback.root || '',
      increments: Object.fromEntries(METRICS.map(metric => [metric, Math.max(0, Number(feedback[metric] || 0))])),
      status: seed.status,
      source: 'pipeline'
    }, dataDir);
  }

  if (updated > 0) saveSeeds(seeds, dataDir);
  return { updated, skipped, seeds };
}

module.exports = { applySeedFeedback };
