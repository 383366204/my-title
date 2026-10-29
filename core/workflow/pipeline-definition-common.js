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

module.exports = { WORKFLOW_NODE_IDS, NODE_ORDER, WORKFLOW_RUN_ID_PATTERN, ARTIFACT_BY_NODE, localIsoDate };
