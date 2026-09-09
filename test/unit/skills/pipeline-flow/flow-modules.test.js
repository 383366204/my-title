'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { buildFlowCommand, isGenerationEligibleKeyword, resolveOpportunityDir } = require('../../../../skills/pipeline-flow/src/flow-context');
const manualFlow = require('../../../../skills/pipeline-flow/src/manual-flow');
const miningFlow = require('../../../../skills/pipeline-flow/src/keyword-mining-flow');
const reviewFlow = require('../../../../skills/pipeline-flow/src/keyword-review-flow');
const verificationFlow = require('../../../../skills/pipeline-flow/src/keyword-verification-flow');
const orchestrator = require('../../../../skills/pipeline-flow/src/flow-orchestrator');
const { flowSelectProducts } = require('../../../../skills/pipeline-flow/src/product-selection-flow');
const { flowGenerate } = require('../../../../skills/pipeline-flow/src/title-generation-flow');
const { flowExport } = require('../../../../skills/pipeline-flow/src/export-flow');
const { createWorkflowRunner } = require('../../../../skills/pipeline-flow/src/workflow-runner');

test('stage implementations are available through their owning modules', () => {
  const stages = [
    manualFlow.flowManualStart, manualFlow.flowEnrichManualProducts, manualFlow.flowReviewProducts,
    flowSelectProducts, flowGenerate, flowExport, miningFlow.appendRunCandidates, miningFlow.flowMine,
    reviewFlow.flowReviewCandidates, verificationFlow.flowVerify,
    orchestrator.flowKeywordStart, orchestrator.flowKeyword, orchestrator.flowDaily, createWorkflowRunner
  ];
  for (const stage of stages) assert.equal(typeof stage, 'function');
});

test('flow context keeps stage commands and opportunity paths stable', () => {
  assert.equal(
    buildFlowCommand('verify', 'run-123', { limit: 8 }),
    'node bin/cli.js flow verify --run run-123 --limit 8'
  );
  assert.equal(
    buildFlowCommand('review', 'run-123', { approveAll: true }),
    'node bin/cli.js flow review --run run-123 --approve-all'
  );
  assert.equal(
    resolveOpportunityDir({ dataDir: '/tmp/pipeline-test' }),
    path.join('/tmp/pipeline-test', 'opportunities')
  );
});

test('generation eligibility preserves verified fallback behavior', () => {
  assert.equal(isGenerationEligibleKeyword({}), true);
  assert.equal(isGenerationEligibleKeyword({ keywordOpportunity: { decision: 'continue' } }), true);
  assert.equal(isGenerationEligibleKeyword({
    keywordOpportunity: { decision: 'reject' },
    autoFallbackEligible: true
  }), true);
  assert.equal(isGenerationEligibleKeyword({ keywordOpportunity: { decision: 'reject' } }), false);
});
