'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const pipeline = require('..');
const {
  buildFlowCommand,
  isGenerationEligibleKeyword,
  resolveOpportunityDir
} = require('../src/flow-context');
const manualFlow = require('../src/manual-flow');
const miningFlow = require('../src/keyword-mining-flow');
const reviewFlow = require('../src/keyword-review-flow');
const verificationFlow = require('../src/keyword-verification-flow');
const orchestrator = require('../src/flow-orchestrator');
const { flowSelectProducts } = require('../src/product-selection-flow');
const { flowGenerate } = require('../src/title-generation-flow');
const { flowExport } = require('../src/export-flow');
const { createWorkflowRunner } = require('../src/workflow-runner');

test('pipeline facade exposes the extracted stage implementations', () => {
  assert.equal(pipeline.flowManualStart, manualFlow.flowManualStart);
  assert.equal(pipeline.flowEnrichManualProducts, manualFlow.flowEnrichManualProducts);
  assert.equal(pipeline.flowReviewProducts, manualFlow.flowReviewProducts);
  assert.equal(pipeline.flowSelectProducts, flowSelectProducts);
  assert.equal(pipeline.flowGenerate, flowGenerate);
  assert.equal(pipeline.flowExport, flowExport);
  assert.equal(pipeline.appendRunCandidates, miningFlow.appendRunCandidates);
  assert.equal(pipeline.flowMine, miningFlow.flowMine);
  assert.equal(pipeline.flowReviewCandidates, reviewFlow.flowReviewCandidates);
  assert.equal(pipeline.flowVerify, verificationFlow.flowVerify);
  assert.equal(pipeline.flowKeywordStart, orchestrator.flowKeywordStart);
  assert.equal(pipeline.flowKeyword, orchestrator.flowKeyword);
  assert.equal(pipeline.flowDaily, orchestrator.flowDaily);
  assert.equal(pipeline.createWorkflowRunner, createWorkflowRunner);
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
