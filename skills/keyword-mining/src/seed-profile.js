const { classifySeed } = require('./seed-classifier');
const { keywordSignature } = require('./keyword-signature');
const { normalizeKeyword } = require('./seed-store');
const { productFamily } = require('./product-words');

const ACTIVE_ROLES = new Set(['discovery_root', 'direct_candidate']);
const EVIDENCE_SOURCES = new Set(['sycm_related', 'sycm_hot', 'sycm_blue', 'reverse_mine', '1688_opportunity', '1688_trend']);

/**
 * Normalize legacy and current outcome counters.
 * @param {object} seed Stored seed.
 * @returns {object} Stable outcome counters.
 */
function normalizedStats(seed = {}) {
  const stats = seed.stats && typeof seed.stats === 'object' ? seed.stats : {};
  return {
    runs: Number(stats.runs || seed.queryCount || 0),
    candidates: Number(stats.candidates || seed.candidateCount || 0),
    verified: Number(stats.verified || seed.successCount || 0),
    generationEligible: Number(stats.generationEligible || 0),
    selectedProducts: Number(stats.selectedProducts || 0),
    generatedTitles: Number(stats.generatedTitles || 0),
    failures: Number(stats.failures || seed.failCount || 0)
  };
}

function profileRole(seed, classification) {
  const explicit = String(seed.role || '').trim();
  if (explicit) return explicit;
  if (seed.type === 'direct') return classification.coreProduct ? 'direct_candidate' : 'context_only';
  if (classification.role === 'product' || classification.role === 'qualified_product') return 'discovery_root';
  if (classification.role === 'abstract' || classification.role === 'event') return 'context_only';
  return 'unrecognized';
}

function sourceEvidence(seed) {
  const source = String(seed.source || 'manual').toLowerCase();
  const evidence = seed.evidence && typeof seed.evidence === 'object' ? seed.evidence : {};
  let score = EVIDENCE_SOURCES.has(source) ? 15 : source === 'manual' ? 8 : 5;
  if (Number(evidence.searchPopularity || 0) > 0) score += 3;
  if (Number(evidence.demandSupplyRatio || 0) > 0) score += 2;
  return Math.min(20, score);
}

/**
 * Score a seed from product concreteness, evidence, outcomes, and novelty.
 * @param {object} profile Enriched seed profile.
 * @param {object} [context] Scoring context.
 * @returns {{total:number,breakdown:object}} Quality score and factors.
 */
function scoreSeedQuality(profile, { familySize = 1 } = {}) {
  const stats = profile.stats;
  const concrete = profile.role === 'discovery_root'
    ? 25
    : profile.role === 'direct_candidate'
      ? 22
      : profile.role === 'unrecognized'
        ? 5
        : 0;
  const evidence = sourceEvidence(profile);
  const verifiedRate = (stats.verified + 1) / (Math.max(stats.candidates, stats.verified) + 4);
  const eligibleRate = (stats.generationEligible + 1) / (Math.max(stats.verified, stats.generationEligible) + 3);
  const verifiedScore = Math.min(20, Math.round(verifiedRate * 20));
  const downstreamScore = Math.min(15, Math.round(eligibleRate * 10 + Math.min(5, stats.selectedProducts)));
  const novelty = Math.max(0, 10 - Math.max(0, Number(familySize || 1) - 1) * 3);
  const categoryCoverage = profile.category ? 5 : 2;
  const timely = /中秋|端午|七夕|开学|夏季|春节|圣诞/.test(`${profile.category}${profile.keyword}`) ? 5 : 3;
  const failurePenalty = Math.min(20, stats.failures * 4);
  const total = Math.max(0, Math.min(100, concrete + evidence + verifiedScore + downstreamScore + novelty + categoryCoverage + timely - failurePenalty));
  return {
    total,
    breakdown: { concrete, evidence, verified: verifiedScore, downstream: downstreamScore, novelty, categoryCoverage, timely, failurePenalty }
  };
}

/**
 * Recommend lifecycle movement without mutating the stored seed.
 * @param {object} profile Enriched seed profile.
 * @returns {string} Recommended lifecycle status.
 */
function recommendedStatus(profile) {
  const current = String(profile.status || 'active');
  if (!ACTIVE_ROLES.has(profile.role)) return current === 'active' ? 'observing' : current;
  if (profile.stats.runs >= 3 && profile.stats.verified === 0) return 'cooling';
  if (profile.stats.runs >= 2 && profile.stats.generationEligible > 0) return 'active';
  return current;
}

function daysSince(value, now = new Date()) {
  if (!value) return Infinity;
  const timestamp = new Date(value).getTime();
  const nowTimestamp = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(timestamp) || !Number.isFinite(nowTimestamp)) return Infinity;
  return Math.max(0, (nowTimestamp - timestamp) / 86400000);
}

/**
 * Score a seed for this run without replacing its long-term quality score.
 * @param {object} profile Enriched seed profile.
 * @param {object} [options] Rotation options.
 * @returns {number} Run-specific scheduling score.
 */
function scoreSeedRotation(profile, { now = new Date() } = {}) {
  const ageDays = daysSince(profile.lastUsedAt, now);
  const recencyBonus = Number.isFinite(ageDays) ? Math.min(14, ageDays * 2) : 14;
  const consecutivePenalty = Math.max(0, Number(profile.consecutiveRuns || 0) - 1) * 6;
  const observingBonus = ['observing', 'explore'].includes(profile.status) ? 6 : profile.status === 'cooling' ? 2 : 0;
  const priorityTieBreaker = Math.min(5, Number(profile.priorityScore || profile.priority || 0) * 0.25);
  return Number((profile.qualityScore + recencyBonus + observingBonus + priorityTieBreaker - consecutivePenalty).toFixed(2));
}

/**
 * Allocate active and observing seeds by quality-aware rotation.
 * @param {Array<object>} profiles Audited seed profiles.
 * @param {object} [options] Scheduling options.
 * @returns {Array<object>} Scheduled profiles with rotation metadata.
 */
function scheduleSeedProfiles(profiles = [], {
  maxSeeds = 20,
  maxObservingSeeds = 3,
  coolingRetryDays = 3,
  now = new Date()
} = {}) {
  const enrich = profile => ({
    ...profile,
    rotationScore: scoreSeedRotation(profile, { now }),
    daysSinceLastUse: daysSince(profile.lastUsedAt, now)
  });
  const sort = rows => rows.map(enrich).sort((a, b) =>
    b.rotationScore - a.rotationScore
    || b.qualityScore - a.qualityScore
    || String(a.keyword).localeCompare(String(b.keyword), 'zh-CN'));
  const active = sort(profiles.filter(profile => profile.status === 'active'));
  const observing = sort(profiles.filter(profile => (
    ['observing', 'explore'].includes(profile.status)
    || (profile.status === 'cooling' && daysSince(profile.lastUsedAt, now) >= Number(coolingRetryDays || 3))
  )));
  const observingSlots = Math.min(Number(maxObservingSeeds || 0), observing.length, Number(maxSeeds || 0));
  const activeSlots = Math.max(0, Number(maxSeeds || 0) - observingSlots);
  return [...active.slice(0, activeSlots), ...observing.slice(0, observingSlots)]
    .sort((a, b) => b.rotationScore - a.rotationScore || b.qualityScore - a.qualityScore);
}

/**
 * Build a read-only, backward-compatible seed profile.
 * @param {object} seed Stored seed row.
 * @param {object} [context] Scoring context.
 * @returns {object} Enriched seed profile.
 */
function buildSeedProfile(seed = {}, context = {}) {
  const keyword = normalizeKeyword(seed.keyword);
  const classification = classifySeed({ ...seed, keyword });
  const signature = keywordSignature(keyword);
  const role = profileRole(seed, classification);
  const coreProduct = seed.coreProduct || classification.coreProduct || signature.coreProduct || '';
  const familyKey = seed.familyKey || productFamily(coreProduct) || signature.productSignature || keyword;
  const stats = normalizedStats(seed);
  const base = {
    ...seed,
    keyword,
    normalizedKeyword: keyword,
    coreProduct,
    familyKey,
    directionSignature: signature.signature || keyword,
    role,
    classificationReason: classification.reason,
    stats
  };
  const quality = scoreSeedQuality(base, context);
  const profile = { ...base, qualityScore: quality.total, qualityBreakdown: quality.breakdown };
  return { ...profile, recommendedStatus: recommendedStatus(profile) };
}

/**
 * Audit exact duplicates, semantic families, and migration changes without writing files.
 * @param {Array<object>} seeds Stored seed rows.
 * @returns {object} Audit report with enriched profiles.
 */
function auditSeedPool(seeds = []) {
  const firstPass = seeds.map(seed => buildSeedProfile(seed));
  const familyCounts = firstPass.reduce((counts, seed) => {
    counts.set(seed.familyKey, (counts.get(seed.familyKey) || 0) + 1);
    return counts;
  }, new Map());
  const profiles = firstPass.map(seed => {
    const quality = scoreSeedQuality(seed, { familySize: familyCounts.get(seed.familyKey) || 1 });
    const profile = { ...seed, qualityScore: quality.total, qualityBreakdown: quality.breakdown };
    return { ...profile, recommendedStatus: recommendedStatus(profile) };
  });
  const exactGroups = new Map();
  const familyGroups = new Map();
  for (const profile of profiles) {
    if (!exactGroups.has(profile.normalizedKeyword)) exactGroups.set(profile.normalizedKeyword, []);
    exactGroups.get(profile.normalizedKeyword).push(profile.keyword);
    if (!familyGroups.has(profile.familyKey)) familyGroups.set(profile.familyKey, []);
    familyGroups.get(profile.familyKey).push(profile.keyword);
  }
  const migration = profiles.map(profile => ({
    keyword: profile.keyword,
    coreProduct: profile.coreProduct,
    familyKey: profile.familyKey,
    role: profile.role,
    qualityScore: profile.qualityScore,
    currentStatus: profile.status || 'active',
    recommendedStatus: profile.recommendedStatus,
    needsChange: !profile.coreProduct || profile.recommendedStatus !== (profile.status || 'active') || !profile.familyKey
  }));
  return {
    summary: {
      total: profiles.length,
      active: profiles.filter(seed => (seed.status || 'active') === 'active').length,
      actionable: profiles.filter(seed => ACTIVE_ROLES.has(seed.role)).length,
      contextOnly: profiles.filter(seed => seed.role === 'context_only').length,
      unrecognized: profiles.filter(seed => seed.role === 'unrecognized').length,
      exactDuplicateGroups: [...exactGroups.values()].filter(group => group.length > 1).length,
      repeatedFamilyGroups: [...familyGroups.values()].filter(group => group.length > 1).length,
      migrationChanges: migration.filter(item => item.needsChange).length
    },
    exactDuplicates: [...exactGroups.entries()].filter(([, group]) => group.length > 1).map(([key, keywords]) => ({ key, keywords })),
    repeatedFamilies: [...familyGroups.entries()].filter(([, group]) => group.length > 1).map(([familyKey, keywords]) => ({ familyKey, keywords })),
    migration,
    profiles
  };
}

module.exports = {
  buildSeedProfile,
  auditSeedPool,
  scoreSeedQuality,
  scoreSeedRotation,
  scheduleSeedProfiles,
  normalizedStats,
  recommendedStatus
};
