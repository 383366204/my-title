'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initRun, appendJsonl, readJsonl } = require('../../../../skills/pipeline-flow/src/run-store');
const { flowReviewCandidates } = require('../../../../skills/pipeline-flow/src/keyword-review-flow');
const { isGenerationEligibleKeyword } = require('../../../../skills/pipeline-flow/src/flow-context');
const { scoreRootReviewCandidate } = require('../../../../skills/pipeline-flow/src/root-opportunity-review');
const { listProductionWorkflowTemplates } = require('../../../../core/workflow/pipeline-templates');
const { validateGeneratedRow } = require('../../../../skills/pipeline-flow/src/export-validator');
const { initRuntimeState, updateRuntimeState, readRuntimeState } = require('../../../../skills/pipeline-flow/runtime/store');
const { runPipelineRuntime } = require('../../../../skills/pipeline-flow/runtime/runner');
const { registerSelectionReviewRoutes } = require('../../../../core/server/selection-review-routes');

test('root review merges scoring and human override without changing failed scores', t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'root-review-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const { run } = initRun({ dataDir, runId: 'review', options: { mode: 'root-keyword' } });
  appendJsonl(run.files.candidates, [{ keyword: '木质摆件', sycmEvidence: { mode: 'hot' }, sycmData: { searchPopularity: 0, demandSupplyRatio: 0.01 } }, { keyword: '树脂摆件' }]);
  const options = { dataDir, runId: 'review' };
  const pending = flowReviewCandidates(options);
  assert.equal(pending.status, 'awaiting_keyword_review');
  assert.equal(pending.stepIncomplete, true);
  assert.equal(pending.reviewed[0].sycmScore.mode, 'hot');
  assert.equal(pending.reviewed[0].sycmScore.passed, false);
  assert.equal(readJsonl(run.files.verifiedKeywords).length, 0);
  const confirmed = flowReviewCandidates({ ...options, approvedKeywords: ['木质摆件'], rejectedKeywords: ['树脂摆件'] });
  assert.equal(confirmed.status, 'keywords_reviewed');
  const rows = readJsonl(run.files.verifiedKeywords);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sycmScore.passed, false);
  assert.ok(rows[0].keywordOpportunity.manualApproval.reviewedAt);
  assert.equal(isGenerationEligibleKeyword(rows[0]), true);
  assert.equal(isGenerationEligibleKeyword(pending.reviewed[0]), false);
  const empty = flowReviewCandidates({ ...options, approvedKeywords: [], rejectedKeywords: ['木质摆件', '树脂摆件'] });
  assert.equal(empty.status, 'keyword_review_empty');
  assert.deepEqual(readJsonl(run.files.verifiedKeywords), []);
});

test('root template has a single opportunity review node and valid downstream edges', () => {
  const template = listProductionWorkflowTemplates().find(row => row.mode === 'root-keyword');
  assert.equal(template.workflow.nodes.some(node => node.id === 'verify'), false);
  assert.ok(template.workflow.edges.some(edge => edge.source === 'keywordReview' && edge.target === 'select'));
  assert.equal(scoreRootReviewCandidate({ keyword: '手动词' }).reviewRecommended, false);
});

test('human keyword approval does not bypass missing title, URL and category checks', () => {
  const result = validateGeneratedRow({ keywordOpportunity: { decision: 'reject', manualApproval: { approved: true } } });
  assert.ok(!result.reasons.some(reason => reason.startsWith('legacy_keyword_opportunity')));
  assert.ok(result.reasons.includes('missing_url'));
  assert.ok(result.reasons.includes('missing_title'));
  assert.ok(result.reasons.includes('missing_category'));
});

test('legacy verify resumes in combined review instead of querying or mining again', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'root-review-resume-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const runId = 'legacy';
  initRuntimeState({ dataDir, runId, mode: 'root-keyword', steps: ['mine', 'keywordReview', 'verify', 'select', 'generate', 'export'] });
  updateRuntimeState({ dataDir, runId, patch: { activeStep: 'verify', status: 'blocked' } });
  let called = 0;
  await runPipelineRuntime({ dataDir, runId, preserveRuntime: true, stepFns: { keywordReview: async () => {
    called++;
    return { status: 'awaiting_keyword_review', stepIncomplete: true };
  } } });
  assert.equal(called, 1);
  assert.equal(readRuntimeState({ dataDir, runId }).activeStep, 'keywordReview');
  assert.ok(!readRuntimeState({ dataDir, runId }).steps.includes('verify'));
});

test('HTTP confirmation of root review advances to selection even for old runtime steps', () => {
  let handler, patch;
  const runtime = { mode: 'root-keyword', activeStep: 'verify', status: 'blocked', steps: ['mine', 'keywordReview', 'verify', 'select'] };
  registerSelectionReviewRoutes({ post: (url, fn) => { if (url.endsWith('/keyword-review')) handler = fn; } }, {
    isValidWorkflowRunIdParam: () => true,
    flowReviewCandidates: () => ({ status: 'keywords_reviewed', approved: [{}], rejected: [] }),
    readRuntimeState: () => runtime,
    updateRuntimeState: value => { patch = value.patch; },
    summarizePipelineRun: () => ({}), withPipelineRuntimeFields: value => value
  });
  handler({ params: { runId: 'legacy' }, body: { approvedKeywords: ['木质摆件'] } }, { json: () => {} });
  assert.equal(patch.activeStep, 'select');
  assert.equal(patch.status, 'paused');
  assert.equal(patch.progress.verify, undefined);
});
