const { auditSeedPool, buildSeedProfile } = require('./seed-profile');

/**
 * Turn external discovery rows into deduped observing-pool suggestions.
 * @param {Array<object>} candidates Discovery candidates from SYCM, 1688, AI, or manual sources.
 * @param {object} options Suggestion options.
 * @param {Array<object>} [options.existingSeeds] Current stored seeds.
 * @param {number} [options.maxSuggestions=5] Maximum accepted suggestions.
 * @param {number} [options.minQualityScore=45] Minimum read-only seed quality.
 * @returns {{accepted:Array<object>,rejected:Array<object>,summary:object}} Suggestion result.
 */
function prepareSeedSuggestions(candidates = [], { existingSeeds = [], maxSuggestions = 5, minQualityScore = 45 } = {}) {
  const rows = Array.isArray(candidates) ? candidates : [];
  const existingFamilies = new Set(auditSeedPool(existingSeeds).profiles.map(seed => seed.familyKey).filter(Boolean));
  const acceptedFamilies = new Set();
  const accepted = [];
  const rejected = [];

  for (const raw of rows) {
    const sourceKeyword = String(raw.keyword || raw.word || '').trim();
    if (accepted.length >= Number(maxSuggestions || 5)) {
      rejected.push({ sourceKeyword, reason: 'suggestion_limit_reached' });
      continue;
    }
    const profile = buildSeedProfile({
      keyword: sourceKeyword,
      category: raw.category || '',
      source: raw.source || 'discovery',
      priority: Number(raw.priority || 6),
      evidence: raw.evidence || {
        searchPopularity: raw.searchPopularity || 0,
        demandSupplyRatio: raw.demandSupplyRatio || 0,
        conversionRate: raw.conversionRate || 0
      },
      type: raw.type || 'expand',
      status: 'observing'
    });
    if (!profile.coreProduct || !['discovery_root', 'direct_candidate'].includes(profile.role)) {
      rejected.push({ sourceKeyword, reason: 'not_concrete_product', profile });
      continue;
    }
    if (existingFamilies.has(profile.familyKey) || acceptedFamilies.has(profile.familyKey)) {
      rejected.push({ sourceKeyword, reason: 'duplicate_family', profile });
      continue;
    }
    if (profile.qualityScore < Number(minQualityScore || 45)) {
      rejected.push({ sourceKeyword, reason: 'quality_below_threshold', profile });
      continue;
    }
    const keyword = raw.type === 'direct' ? profile.keyword : profile.coreProduct;
    accepted.push({
      keyword,
      sourceKeyword,
      category: profile.category || '',
      coreProduct: profile.coreProduct,
      familyKey: profile.familyKey,
      role: raw.type === 'direct' ? 'direct_candidate' : 'discovery_root',
      type: raw.type || 'expand',
      source: profile.source,
      status: 'observing',
      priority: Number(raw.priority || 6),
      qualityScore: profile.qualityScore,
      evidence: profile.evidence || {},
      reason: raw.reason || `从「${sourceKeyword}」提取具体商品词根`
    });
    acceptedFamilies.add(profile.familyKey);
  }

  return {
    accepted,
    rejected,
    summary: {
      input: rows.length,
      accepted: accepted.length,
      rejected: rejected.length,
      duplicateFamilies: rejected.filter(item => item.reason === 'duplicate_family').length,
      nonProduct: rejected.filter(item => item.reason === 'not_concrete_product').length
    }
  };
}

module.exports = { prepareSeedSuggestions };
