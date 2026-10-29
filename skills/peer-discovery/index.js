'use strict';

const {
  runPeerExtractStep,
  runPeerSimilarStep,
  runPeerCollectionStep,
  runPeerVerifyImageSourcesStep,
  runPeerPrepareListingDraftsStep,
  runPeerReviewListingsStep,
  runPeerProductReportStep,
  runPeerEvaluateShopsStep,
  runPeerReportStep
} = require('./src/collection-runtime-step');

const { normalizePeerDiscoveryParams } = require('./src/params');
const { extractSourceProducts } = require('./src/source-extractor');
const { findSimilarProducts } = require('./src/similar-finder');
const { collectPeerProducts } = require('./src/collect-peer-products');
const { verifyImageSources, judgeImageCandidate } = require('./src/image-sourcing-matcher');
const { prepareListingDraft, prepareListingDrafts } = require('./src/listing-draft-preparer');
const {
  savePeerDraftEdits,
  createPeerAllocationPlan,
  submitPeerAllocationPlan,
  reconcilePeerSubmissions
} = require('./src/peer-listing-adapter');
const { createAllocationPlan, splitAllocationBatches } = require('./src/allocation-plan');
const { writePeerProductReport } = require('./src/peer-product-report-writer');
const { evaluateShop, evaluateAllShops, applyShopVerdict } = require('./src/shop-evaluator');
const { matchSourcing, titleSimilarity, checkSpecConsistency } = require('./src/sourcing-matcher');
const { writePeerReport } = require('./src/peer-report-writer');
const { runPipelineRuntime, getPeerSteps, PEER_DISCOVERY_STEPS, PEER_IMAGE_SELECTION_STEPS } = require('../pipeline-flow/runtime/runner');

/**
 * Convenient programmatic entry point to run peer discovery pipeline.
 * @param {object} options
 * @returns {Promise<object>}
 */
async function runPeerDiscovery(options = {}) {
  const params = normalizePeerDiscoveryParams(options.params || options);
  return await runPipelineRuntime({
    ...options,
    mode: 'peer-discovery',
    params
  });
}

module.exports = {
  // Constants & Steps
  PEER_DISCOVERY_STEPS,
  PEER_IMAGE_SELECTION_STEPS,
  getPeerSteps,

  // Programmatic runner
  runPeerDiscovery,
  normalizePeerDiscoveryParams,

  // Runtime Step Adapters
  runPeerExtractStep,
  runPeerSimilarStep,
  runPeerCollectionStep,
  runPeerVerifyImageSourcesStep,
  runPeerPrepareListingDraftsStep,
  runPeerReviewListingsStep,
  runPeerProductReportStep,
  runPeerEvaluateShopsStep,
  runPeerReportStep,

  // Core functions
  extractSourceProducts,
  findSimilarProducts,
  collectPeerProducts,
  verifyImageSources,
  judgeImageCandidate,
  prepareListingDraft,
  prepareListingDrafts,
  savePeerDraftEdits,
  createPeerAllocationPlan,
  submitPeerAllocationPlan,
  reconcilePeerSubmissions,
  createAllocationPlan,
  splitAllocationBatches,
  writePeerProductReport,
  evaluateShop,
  evaluateAllShops,
  applyShopVerdict,
  matchSourcing,
  titleSimilarity,
  checkSpecConsistency,
  writePeerReport
};
