const { buildHistoryKeys, historyRecencyWeight } = require('../../../core/history-record');
const { productFamily } = require('./product-words');

function daysBetween(leftIso, rightIso) {
  const left = new Date(leftIso).getTime();
  const right = new Date(rightIso).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Infinity;
  return Math.abs(right - left) / 86400000;
}

function belowLimit(map, key, limit) {
  if (!limit || limit <= 0) return true;
  return (map.get(key) || 0) < limit;
}

function inc(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function modeFactor(mode) {
  if (mode === 'strict' || mode === 'stable') return 0.65;
  if (mode === 'explore') return 1.3;
  return 1;
}

/**
 * Resolve the canonical product family for a candidate.
 * @param {object} item Candidate row.
 * @returns {string} Product family key.
 */
function rawFamily(item = {}) {
  return String(item.familyKey || productFamily(item.coreProduct || item.productSignature || '') || item.coreProduct || '').replace(/^family:/, '');
}

/**
 * Calculate cross-run novelty and repetition penalties.
 * @param {object} item Candidate row.
 * @param {object} history Recent keyword history.
 * @param {object} options Evaluation context.
 * @returns {object} History and novelty signals.
 */
function historySignals(item, history = {}, { now, mode, selectedFamilyCount = 0 } = {}) {
  const family = rawFamily(item);
  const keys = buildHistoryKeys({ ...item, familyKey: family });
  const keywordRecord = history.keywords?.[keys.keywordKey] || null;
  const signatureRecord = history.signatures?.[keys.signatureKey] || null;
  const familyRecord = history.families?.[keys.familyKey] || history.families?.[keys.coreProductKey] || null;
  const exactWeight = historyRecencyWeight(keywordRecord, { now, cooldownDays: 30 });
  const signatureWeight = historyRecencyWeight(signatureRecord, { now, cooldownDays: 7 });
  const familyWeight = historyRecencyWeight(familyRecord, { now, cooldownDays: 7 });
  const familyAgeDays = familyRecord ? daysBetween(familyRecord.lastSeenAt, now) : Infinity;
  const factor = modeFactor(mode);
  const signaturePenalty = signatureWeight * 10 * factor;
  const familyPenalty = familyWeight * (familyAgeDays < 3 ? 18 : 8) * factor;
  const frequencyPenalty = familyRecord
    ? Math.min(8, Math.log2(Number(familyRecord.runCount || 0) + 1) * 2) * factor
    : 0;
  const withinRunPenalty = selectedFamilyCount * 10 * factor;
  const newFamilyBonus = family && !familyRecord ? (mode === 'explore' ? 7 : mode === 'strict' || mode === 'stable' ? 2 : 4) : 0;
  const penalty = signaturePenalty + familyPenalty + frequencyPenalty + withinRunPenalty;
  const noveltyStatus = !family
    ? 'unknown_family'
    : !familyRecord
      ? 'new_family'
      : familyAgeDays < 3
        ? 'recent_family'
        : familyAgeDays < 7
          ? 'cooling_family'
          : 'returning_family';
  return {
    family,
    keys,
    exactWeight,
    hardExactDuplicate: exactWeight > 0,
    signaturePenalty,
    familyPenalty,
    frequencyPenalty,
    withinRunPenalty,
    newFamilyBonus,
    penalty,
    noveltyStatus,
    familyAgeDays: Number.isFinite(familyAgeDays) ? Number(familyAgeDays.toFixed(2)) : null,
    familyRunCount: Number(familyRecord?.runCount || 0),
    signatureRunCount: Number(signatureRecord?.runCount || 0)
  };
}

function eligibleByCaps(item, counts, options) {
  const seed = item.seed || '';
  const category = item.category || '';
  const pattern = item.pattern || '';
  const signature = item.signature || item.keyword || '';
  const family = rawFamily(item);
  return belowLimit(counts.seed, seed, options.maxPerSeed)
    && belowLimit(counts.category, category, options.maxPerCategory)
    && belowLimit(counts.pattern, pattern, options.maxPerPattern)
    && belowLimit(counts.signature, signature, options.maxPerSignature)
    && (!family || belowLimit(counts.family, family, options.maxPerProductCore));
}

function addCounts(item, counts) {
  inc(counts.seed, item.seed || '');
  inc(counts.category, item.category || '');
  inc(counts.pattern, item.pattern || '');
  inc(counts.signature, item.signature || item.keyword || '');
  const family = rawFamily(item);
  if (family) inc(counts.family, family);
}

/**
 * Greedily select a quality-constrained portfolio with cross-run novelty signals.
 * @param {Array<object>} items Ranked candidate rows.
 * @param {object} options Diversity options.
 * @returns {{selected:Array<object>,stats:object}}
 */
function selectDiverseCandidates(items = [], {
  count = 50,
  maxPerSeed = 5,
  maxPerCategory = 20,
  maxPerPattern = 20,
  maxPerSignature = 1,
  maxPerProductCore = 3,
  history = null,
  mode = 'balanced',
  now = new Date().toISOString(),
  excludeExactHistory = false,
  allowHistoryFallback = false
} = {}) {
  const options = { maxPerSeed, maxPerCategory, maxPerPattern, maxPerSignature, maxPerProductCore };
  const counts = {
    seed: new Map(),
    category: new Map(),
    pattern: new Map(),
    signature: new Map(),
    family: new Map()
  };
  const remaining = items.map((item, index) => ({ item, index }));
  const selected = [];
  const exactHistoryFilteredKeys = new Set();
  let historyFallbackCount = 0;

  while (selected.length < Number(count || 50) && remaining.length > 0) {
    let bestIndex = -1;
    let best = null;
    for (let index = 0; index < remaining.length; index++) {
      const entry = remaining[index];
      if (!eligibleByCaps(entry.item, counts, options)) continue;
      const family = rawFamily(entry.item);
      const signals = historySignals(entry.item, history || {}, {
        now,
        mode,
        selectedFamilyCount: counts.family.get(family) || 0
      });
      if (excludeExactHistory && signals.hardExactDuplicate && !allowHistoryFallback) {
        exactHistoryFilteredKeys.add(signals.keys.keywordKey || entry.item.keyword);
        continue;
      }
      const fallbackPenalty = excludeExactHistory && signals.hardExactDuplicate ? 40 : 0;
      const diversityScore = Number((Number(entry.item.localScore || 0) + signals.newFamilyBonus - signals.penalty - fallbackPenalty).toFixed(2));
      const candidate = { entry, signals, diversityScore, historyFallback: fallbackPenalty > 0 };
      if (!best
        || candidate.diversityScore > best.diversityScore
        || (candidate.diversityScore === best.diversityScore && Number(entry.item.localScore || 0) > Number(best.entry.item.localScore || 0))
        || (candidate.diversityScore === best.diversityScore && entry.index < best.entry.index)) {
        best = candidate;
        bestIndex = index;
      }
    }
    if (!best) break;
    const [{ item }] = remaining.splice(bestIndex, 1);
    addCounts(item, counts);
    if (best.historyFallback) historyFallbackCount += 1;
    selected.push({
      ...item,
      familyKey: best.signals.family || item.familyKey || '',
      diversity: {
        mode,
        score: best.diversityScore,
        noveltyStatus: best.historyFallback ? 'history_fallback' : best.signals.noveltyStatus,
        familyAgeDays: best.signals.familyAgeDays,
        familyRunCount: best.signals.familyRunCount,
        signatureRunCount: best.signals.signatureRunCount,
        historyPenalty: Number(best.signals.penalty.toFixed(2)),
        newFamilyBonus: best.signals.newFamilyBonus,
        historyFallback: best.historyFallback
      }
    });
  }

  selected.sort((a, b) => Number(b.localScore || 0) - Number(a.localScore || 0)
    || Number(b.diversity?.score || 0) - Number(a.diversity?.score || 0)
    || String(a.keyword).localeCompare(String(b.keyword), 'zh-CN'));
  const familyCounts = [...counts.family.values()];
  const newFamilies = new Set(selected
    .filter(item => item.diversity?.noveltyStatus === 'new_family')
    .map(item => item.familyKey)
    .filter(Boolean));
  return {
    selected,
    stats: {
      mode,
      input: items.length,
      selected: selected.length,
      familyCount: counts.family.size,
      newFamilyCount: newFamilies.size,
      exactHistoryFiltered: exactHistoryFilteredKeys.size,
      historyFallbackCount,
      historyPenalized: selected.filter(item => Number(item.diversity?.historyPenalty || 0) > 0).length,
      maxFamilyShare: selected.length > 0 && familyCounts.length > 0
        ? Number((Math.max(...familyCounts) / selected.length).toFixed(4))
        : 0,
      requested: Number(count || 50),
      shortfall: Math.max(0, Number(count || 50) - selected.length)
    }
  };
}

module.exports = { selectDiverseCandidates, historySignals, rawFamily };
