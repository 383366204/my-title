'use strict';

const WORKFLOW_NODE_IDS = {
  start: 'start',
  inspire: 'inspire',
  mine: 'mine',
  keywordReview: 'keywordReview',
  verify: 'verify',
  select: 'select',
  generate: 'generate',
  export: 'export',
  review: 'review',
  collectRank: 'collectRank',
  confirmProducts: 'confirmProducts',
  importSheet: 'importSheet',
  generateReviews: 'generateReviews',
  generateSheet: 'generateSheet',
  removeWatermark: 'removeWatermark',
  resolveShops: 'resolveShops',
  collectCompetitors: 'collectCompetitors',
  findCompetitorSources: 'findCompetitorSources',
  enrichCompetitors: 'enrichCompetitors',
  analyzeCompetitors: 'analyzeCompetitors',
  competitorReport: 'competitorReport',
  extractSources: 'extractSources',
  findSimilarProducts: 'findSimilarProducts',
  evaluateShops: 'evaluateShops',
  peerReport: 'peerReport',
  collectPeerProducts: 'collectPeerProducts',
  verifyImageSources: 'verifyImageSources',
  prepareListingDrafts: 'prepareListingDrafts',
  reviewPeerListings: 'reviewPeerListings',
  peerProductReport: 'peerProductReport',
  end: 'end'
};

const NODE_ORDER = Object.values(WORKFLOW_NODE_IDS);
const WORKFLOW_RUN_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

const ARTIFACT_BY_NODE = {
  [WORKFLOW_NODE_IDS.inspire]: { fileKey: 'inspirationRoots', type: 'jsonl' },
  [WORKFLOW_NODE_IDS.mine]: { fileKey: 'candidates', type: 'jsonl' },
  [WORKFLOW_NODE_IDS.keywordReview]: { fileKey: 'reviewedCandidates', type: 'jsonl' },
  [WORKFLOW_NODE_IDS.verify]: { fileKey: 'verifiedKeywords', type: 'jsonl' },
  [WORKFLOW_NODE_IDS.select]: { fileKey: 'selectedProducts', type: 'jsonl' },
  [WORKFLOW_NODE_IDS.generate]: { fileKey: 'generatedProducts', type: 'jsonl' },
  [WORKFLOW_NODE_IDS.export]: { fileKey: 'distributionBatch', type: 'text' },
  [WORKFLOW_NODE_IDS.review]: { fileKey: 'distributionReview', type: 'text' },
  [WORKFLOW_NODE_IDS.collectRank]: { fileKey: 'productRank', type: 'jsonl' },
  [WORKFLOW_NODE_IDS.confirmProducts]: { fileKey: 'productGroups', type: 'json' },
  [WORKFLOW_NODE_IDS.importSheet]: { fileKey: 'reviewGroups', type: 'json' },
  [WORKFLOW_NODE_IDS.generateReviews]: { fileKey: 'reviewDrafts', type: 'jsonl' },
  [WORKFLOW_NODE_IDS.generateSheet]: { fileKey: 'orderSheet', type: 'xlsx' },
  [WORKFLOW_NODE_IDS.resolveShops]: { fileKey: 'competitorShops', type: 'jsonl' },
  [WORKFLOW_NODE_IDS.collectCompetitors]: { fileKey: 'competitorHotProducts', type: 'competitor-products' },
  [WORKFLOW_NODE_IDS.enrichCompetitors]: { fileKey: 'competitorProductDetails', type: 'jsonl' },
  [WORKFLOW_NODE_IDS.analyzeCompetitors]: { fileKey: 'competitorAnalysis', type: 'json' },
  [WORKFLOW_NODE_IDS.competitorReport]: { fileKey: 'competitorReport', type: 'xlsx' },
  [WORKFLOW_NODE_IDS.extractSources]: { fileKey: 'sourceProducts', type: 'jsonl' },
  [WORKFLOW_NODE_IDS.findSimilarProducts]: { fileKey: 'candidateShops', type: 'jsonl' },
  [WORKFLOW_NODE_IDS.evaluateShops]: { fileKey: 'shopEvaluations', type: 'jsonl' },
  [WORKFLOW_NODE_IDS.peerReport]: { fileKey: 'peerReport', type: 'xlsx' },
  [WORKFLOW_NODE_IDS.collectPeerProducts]: { fileKey: 'peerProducts', type: 'jsonl' },
  [WORKFLOW_NODE_IDS.verifyImageSources]: { fileKey: 'imageSourcingResults', type: 'jsonl' },
  [WORKFLOW_NODE_IDS.prepareListingDrafts]: { fileKey: 'peerListingDrafts', type: 'jsonl' },
  [WORKFLOW_NODE_IDS.reviewPeerListings]: { fileKey: 'peerSubmissionLedger', type: 'jsonl' },
  [WORKFLOW_NODE_IDS.peerProductReport]: { fileKey: 'peerProductReport', type: 'xlsx' }
};


const CANONICAL_WORKFLOW_STEPS = Object.freeze({
  daily: Object.freeze([
    WORKFLOW_NODE_IDS.inspire,
    WORKFLOW_NODE_IDS.mine,
    WORKFLOW_NODE_IDS.keywordReview,
    WORKFLOW_NODE_IDS.select,
    WORKFLOW_NODE_IDS.generate,
    WORKFLOW_NODE_IDS.export
  ]),
  'root-keyword': Object.freeze([
    WORKFLOW_NODE_IDS.mine,
    WORKFLOW_NODE_IDS.keywordReview,
    WORKFLOW_NODE_IDS.select,
    WORKFLOW_NODE_IDS.generate,
    WORKFLOW_NODE_IDS.export
  ]),
  keyword: Object.freeze([
    WORKFLOW_NODE_IDS.start,
    WORKFLOW_NODE_IDS.select,
    WORKFLOW_NODE_IDS.generate,
    WORKFLOW_NODE_IDS.export
  ]),
  manual: Object.freeze([
    WORKFLOW_NODE_IDS.start,
    WORKFLOW_NODE_IDS.select,
    WORKFLOW_NODE_IDS.verify,
    WORKFLOW_NODE_IDS.generate,
    WORKFLOW_NODE_IDS.export
  ]),
  'order-sheet': Object.freeze([
    WORKFLOW_NODE_IDS.collectRank,
    WORKFLOW_NODE_IDS.confirmProducts,
    WORKFLOW_NODE_IDS.generateSheet
  ]),
  'review-sheet': Object.freeze([
    WORKFLOW_NODE_IDS.importSheet,
    WORKFLOW_NODE_IDS.generateReviews,
    WORKFLOW_NODE_IDS.generateSheet
  ]),
  'competitor-analysis': Object.freeze([
    WORKFLOW_NODE_IDS.resolveShops,
    WORKFLOW_NODE_IDS.collectCompetitors,
    WORKFLOW_NODE_IDS.findCompetitorSources
  ]),
  'peer-discovery:peer-analysis': Object.freeze([
    WORKFLOW_NODE_IDS.extractSources,
    WORKFLOW_NODE_IDS.findSimilarProducts,
    WORKFLOW_NODE_IDS.evaluateShops,
    WORKFLOW_NODE_IDS.peerReport
  ]),
  'peer-discovery:image-selection': Object.freeze([
    WORKFLOW_NODE_IDS.extractSources,
    WORKFLOW_NODE_IDS.findSimilarProducts,
    WORKFLOW_NODE_IDS.collectPeerProducts,
    WORKFLOW_NODE_IDS.verifyImageSources,
    WORKFLOW_NODE_IDS.prepareListingDrafts,
    WORKFLOW_NODE_IDS.reviewPeerListings,
    WORKFLOW_NODE_IDS.peerProductReport
  ]),
  'watermark-removal': Object.freeze([
    WORKFLOW_NODE_IDS.removeWatermark
  ])
});

/**
 * 获取指定工作流模式的标准步骤列表。
 * @param {string} [mode='daily'] 工作流模式。
 * @param {object} [options] 选项。
 * @param {string} [options.discoveryBranch] peer-discovery 分支。
 * @param {boolean} [options.excludeStart=false] 是否排除 start 步骤。
 * @param {boolean} [options.includeStart=false] 是否包含 start 步骤。
 * @returns {string[]} 步骤名称列表。
 */
function getCanonicalSteps(mode = 'daily', options = {}) {
  const branch = options.discoveryBranch || options.branch || 'peer-analysis';
  let steps;
  if (mode === 'peer-discovery') {
    const key = `peer-discovery:${branch === 'image-selection' ? 'image-selection' : 'peer-analysis'}`;
    steps = CANONICAL_WORKFLOW_STEPS[key] || CANONICAL_WORKFLOW_STEPS['peer-discovery:peer-analysis'];
  } else {
    steps = CANONICAL_WORKFLOW_STEPS[mode] || CANONICAL_WORKFLOW_STEPS.daily;
  }
  const result = [...steps];
  if (options.excludeStart) {
    return result.filter(step => step !== WORKFLOW_NODE_IDS.start);
  }
  if (options.includeStart && !result.includes(WORKFLOW_NODE_IDS.start)) {
    return [WORKFLOW_NODE_IDS.start, ...result];
  }
  return result;
}

/**
 * 校验某步骤是否为目标模式的合法步骤。
 * @param {string} mode 工作流模式。
 * @param {string} step 步骤名。
 * @param {object} [options] 选项。
 * @returns {boolean} 是否合法。
 */
function isValidStepForMode(mode, step, options = {}) {
  if (!step) return false;
  const steps = getCanonicalSteps(mode, { ...options, includeStart: true });
  return steps.includes(step) || step === WORKFLOW_NODE_IDS.end;
}

/**
 * @param {Date} [date] 本地日期。
 * @returns {string} YYYY-MM-DD 格式的本地日期。
 */
function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

module.exports = {
  WORKFLOW_NODE_IDS,
  NODE_ORDER,
  WORKFLOW_RUN_ID_PATTERN,
  ARTIFACT_BY_NODE,
  CANONICAL_WORKFLOW_STEPS,
  getCanonicalSteps,
  isValidStepForMode,
  localIsoDate
};
