'use strict';

const { categoryAssessment, validateGeneratedRow } = require('./src/export-validator');
const { flowExport } = require('./src/export-flow');
const { flowDaily, flowKeyword, flowKeywordStart } = require('./src/flow-orchestrator');
const { appendRunCandidates, flowMine } = require('./src/keyword-mining-flow');
const { flowReviewCandidates } = require('./src/keyword-review-flow');
const { flowVerify } = require('./src/keyword-verification-flow');
const {
  flowEnrichManualProducts,
  flowManualStart,
  flowReviewProducts
} = require('./src/manual-flow');
const { scoreKeywordOpportunity, scoreProductOpportunity } = require('./src/opportunity-scoring');
const { summarizeOpportunities } = require('./src/opportunity-store');
const { flowSelectProducts } = require('./src/product-selection-flow');
const {
  DEFAULT_FLOW_DIR,
  createRunId,
  getRun,
  markRunDistributionComplete,
  readJsonl
} = require('./src/run-store');
const {
  fetchSycmWithFallback,
  scoreSycmRows,
  shouldFallbackToNextTier
} = require('./src/sycm-verifier');
const { flowGenerate } = require('./src/title-generation-flow');
const { createWorkflowRunner } = require('./src/workflow-runner');

module.exports = {
  DEFAULT_FLOW_DIR,
  createRunId,
  readJsonl,
  getRun,
  markRunDistributionComplete,
  scoreSycmRows,
  shouldFallbackToNextTier,
  fetchSycmWithFallback,
  appendRunCandidates,
  flowManualStart,
  flowEnrichManualProducts,
  flowReviewProducts,
  flowMine,
  flowReviewCandidates,
  flowVerify,
  flowSelectProducts,
  flowGenerate,
  flowExport,
  flowKeywordStart,
  flowKeyword,
  flowDaily,
  createWorkflowRunner,
  validateGeneratedRow,
  categoryAssessment,
  scoreKeywordOpportunity,
  scoreProductOpportunity,
  summarizeOpportunities
};
