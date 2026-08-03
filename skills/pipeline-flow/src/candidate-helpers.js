'use strict';

const DEFAULT_FALLBACK_CANDIDATES = [
  { keyword: '玛瑙戒指女', category: 'accessories', coreProduct: '戒指', signature: '戒指|玛瑙|女' },
  { keyword: '宠物磨牙玩具', category: 'pet', coreProduct: '玩具', signature: '宠物|磨牙|玩具' },
  { keyword: '端午五彩手绳', category: 'holiday', coreProduct: '手绳', signature: '端午|五彩|手绳' },
  { keyword: '桌面收纳盒', category: 'home', coreProduct: '收纳盒', signature: '桌面|收纳盒' },
  { keyword: '便携猫包', category: 'pet', coreProduct: '猫包', signature: '便携|猫包' }
];

/**
 * Build concrete fallback candidates that must still pass SYCM verification.
 * @param {number} [limit] Maximum candidate count.
 * @returns {Array<object>} Fallback candidates.
 */
function fallbackCandidates(limit = 10) {
  const date = new Date().toISOString().slice(0, 10);
  return DEFAULT_FALLBACK_CANDIDATES.slice(0, Number(limit || 10)).map(item => ({
    date,
    keyword: item.keyword,
    seed: 'pipeline-fallback',
    category: item.category,
    pattern: 'fallback-concrete',
    localScore: 70,
    tier: 'mid',
    reason: 'fallback concrete product keyword; must pass SYCM before product search',
    nextAction: 'sycm_verify',
    flags: ['fallback_candidate'],
    coreProduct: item.coreProduct,
    signature: item.signature,
    productSignature: item.coreProduct,
    rigid: [],
    optional: [],
    nextCommands: {
      sycm: `node bin/cli.js sycm "${item.keyword}" --mode hot --json`,
      hotCheck: `node bin/cli.js sycm "${item.keyword}" --mode hot --json`,
      blueExplore: `node bin/cli.js sycm "${item.keyword}" --mode blue --json`,
      titleGenerate: `node bin/cli.js "${item.keyword}" --json`
    }
  }));
}

/**
 * Build a candidate that preserves an exact user keyword.
 * @param {string} keyword User keyword.
 * @returns {object} Exact keyword candidate.
 */
function exactKeywordCandidate(keyword) {
  const value = String(keyword || '').trim();
  if (!value) throw new Error('keyword is required');
  return {
    date: new Date().toISOString().slice(0, 10),
    keyword: value,
    seed: 'user-exact-keyword',
    category: '',
    pattern: 'user-exact-keyword',
    localScore: 85,
    tier: 'direct',
    reason: 'user requested exact keyword; do not rewrite before SYCM or product search',
    nextAction: 'sycm_verify',
    flags: ['user_exact_keyword'],
    coreProduct: value,
    signature: value,
    productSignature: value,
    rigid: [value],
    optional: [],
    nextCommands: {
      sycm: `node bin/cli.js sycm "${value}" --mode blue --json`,
      hotCheck: `node bin/cli.js sycm "${value}" --mode hot --json`,
      blueExplore: `node bin/cli.js sycm "${value}" --mode blue --json`,
      titleGenerate: `node bin/cli.js "${value}" --json`
    }
  };
}

/**
 * Normalize a candidate discovered outside the pipeline.
 * @param {object} [candidate] Candidate payload.
 * @returns {object|null} Normalized candidate or null when no keyword exists.
 */
function normalizeExternalCandidate(candidate = {}) {
  const keyword = String(candidate.keyword || candidate.word || '').trim();
  if (!keyword) return null;
  return {
    keyword,
    seed: candidate.seed || candidate.sourceKeyword || 'web-discovery',
    category: candidate.category || '',
    pattern: candidate.pattern || 'web-discovery',
    source: candidate.source || 'web',
    localScore: Number(candidate.localScore || candidate.score || 0),
    tier: candidate.tier || 'mid',
    reason: candidate.reason || candidate.gateReason || 'Web 辅助发现加入当前流程',
    nextAction: candidate.nextAction || 'sycm_verify',
    flags: Array.isArray(candidate.flags) ? candidate.flags : ['web_discovery'],
    coreProduct: candidate.coreProduct || '',
    signature: candidate.signature || keyword,
    productSignature: candidate.productSignature || candidate.coreProduct || '',
    rigid: Array.isArray(candidate.rigid) ? candidate.rigid : [],
    optional: Array.isArray(candidate.optional) ? candidate.optional : [],
    sycmData: candidate.sycmData || null,
    addedAt: new Date().toISOString()
  };
}

module.exports = {
  DEFAULT_FALLBACK_CANDIDATES,
  exactKeywordCandidate,
  fallbackCandidates,
  normalizeExternalCandidate
};
