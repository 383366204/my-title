'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listProductionWorkflowTemplates, listProductionWorkflowVariants } = require('../../../core/workflow/pipeline-templates');
const { validateProductionWorkflow, resolveProductionWorkflowLaunch, resolveProductionWorkflowDefinition, sanitizeWorkflowParams } = require('../../../core/workflow/pipeline-params');
const { runPipelineRuntime } = require('../../../skills/pipeline-flow/runtime/runner');
const { verifyExactSelectionKeywords } = require('../../../skills/pipeline-flow/src/exact-keyword-verification');
const { flowKeywordStart } = require('../../../skills/pipeline-flow/src/flow-orchestrator');
const { flowReviewCandidates } = require('../../../skills/pipeline-flow/src/keyword-review-flow');
const { getRun, readJsonl } = require('../../../skills/pipeline-flow/src/run-store');
const { flowExpandRootKeywords } = require('../../../skills/pipeline-flow/src/root-keyword-expansion-flow');
const { prepareKeywordSupplement } = require('../../../skills/pipeline-flow/src/keyword-supplement');

function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-selection-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return { dataDir, runId: 'selection-test' };
}

test('one selection entry validates and snapshots each concrete mode', () => {
  const entry = listProductionWorkflowTemplates().filter(item => item.id === 'selection-v1');
  assert.equal(entry.length, 1);
  assert.equal(entry[0].selectionModes.length, 3);
  for (const item of listProductionWorkflowVariants().filter(item => item.id === 'selection-v1')) {
    const request = { templateId: item.id, mode: item.mode, workflow: item.workflow, params: { keyword: '杯垫', roots: ['杯垫'] } };
    assert.equal(validateProductionWorkflow(item.workflow, request).ok, true);
    const launch = resolveProductionWorkflowLaunch(request);
    assert.equal(launch.mode, item.mode);
    const snapshot = resolveProductionWorkflowDefinition(request, launch);
    assert.equal(snapshot.id, 'selection-v1');
    assert.equal(snapshot.mode, item.mode);
    assert.equal(snapshot.nodes.filter(node => node.id === 'keywordReview').length, 1);
    assert.equal(snapshot.nodes.some(node => node.id === 'verify'), item.mode === 'keyword');
  }
  const graph = entry[0].workflow;
  assert.equal(validateProductionWorkflow(graph, { templateId: 'selection-v1', mode: 'keyword' }).ok, false);
  assert.equal(validateProductionWorkflow(graph, { templateId: 'daily-selection-v1' }).ok, false);
  assert.throws(() => resolveProductionWorkflowLaunch({ templateId: 'selection-v1', mode: 'manual' }), /未知/);
});

test('sanitization preserves large inputs and enforces manual confirmation', () => {
  assert.equal(sanitizeWorkflowParams('keyword', { keywords: Array.from({ length: 120 }, (_, i) => `词${i}`) }).keywords.length, 120);
  assert.equal(sanitizeWorkflowParams('daily', { autoApproveKeywords: true }).autoApproveKeywords, false);
  const root = sanitizeWorkflowParams('root-keyword', { roots: ['男装'] });
  assert.equal(root.sycmMode, 'both');
  assert.equal(root.pages, 3);
  assert.equal(root.sycmMaxPages, 3);
});

test('exact runtime waits for review even if automatic approval was requested', async t => {
  const options = fixture(t);
  let calls = 0;
  const result = await runPipelineRuntime({ ...options, mode: 'keyword', params: {
    keyword: '杯垫', autoApproveKeywords: true, approveAll: true,
    sycmExtractor: async () => { calls++; return { data: [{ keyword: '杯垫', searchPopularity: 0 }] }; }
  } });
  assert.equal(calls, 1);
  assert.equal(result.status, 'awaiting_keyword_review');
  assert.equal(result.approved.length, 0);
  const approved = flowReviewCandidates({ ...options, approvedKeywords: ['杯垫'], rejectedKeywords: [] });
  assert.equal(approved.approved.length, 1);
  assert.equal(approved.approved[0].sycmScore.passed, false);
  assert.equal(approved.approved[0].keywordOpportunity.manualApproval.approved, true);
});

test('exact verification does not use related terms and resumes unfinished items only', async t => {
  const options = fixture(t);
  await flowKeywordStart({ ...options, keywords: ['杯垫', '茶杯'] });
  let calls = 0;
  const sycmExtractor = async word => { calls++; return { data: [{ keyword: `${word}关联词`, searchPopularity: 900 }] }; };
  const paused = await verifyExactSelectionKeywords({ ...options, sycmExtractor, shouldStop: () => calls ? 'pause' : null });
  assert.equal(paused.status, 'paused');
  await verifyExactSelectionKeywords({ ...options, sycmExtractor });
  assert.equal(calls, 2);
  const rows = readJsonl(getRun(options).run.files.candidates);
  assert.ok(rows.every(row => row.sycmData === null && row.sycmEvidence.exactChecked));
});

test('platform failure stays at verification instead of silently reaching review', async t => {
  const options = fixture(t);
  const result = await runPipelineRuntime({ ...options, mode: 'keyword', params: {
    keyword: '杯垫', sycmExtractor: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:9222'); }
  } });
  assert.equal(result.status, 'manual_action_required');
  assert.match(result.manualAction.userMessage, /9222/);
});

test('root expansion queries hot and blue pages with correct provenance', async t => {
  const options = fixture(t);
  const requests = [];
  const result = await flowExpandRootKeywords({ ...options, roots: ['杯垫'], sycmMode: 'both', pages: 3,
    sycmExtractor: async (word, config) => {
      requests.push(config);
      return { data: [{ keyword: `${word}${config.mode}`, searchPopularity: 30 }] };
    }
  });
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(requests.map(item => item.mode), ['hot', 'blue']);
  assert.ok(requests.every(item => item.maxPages === 3 && item.guardMinCooldownMs >= 45000));
  assert.deepEqual(result.candidates.map(row => row.sycmEvidence.mode).sort(), ['blue', 'hot']);
});

test('supplement queries only new words, keeps draft decisions and never approves automatically', async t => {
  const options = fixture(t);
  await runPipelineRuntime({ ...options, mode: 'keyword', params: { keyword: '杯垫', sycmExtractor: async () => ({ data: [] }) } });
  const keywords = prepareKeywordSupplement({ ...options, keywords: ['茶杯', '茶杯'], decisions: { 杯垫: 'approved' } });
  assert.deepEqual(keywords, ['茶杯']);
  const queried = [];
  const result = await runPipelineRuntime({ ...options, mode: 'keyword', preserveRuntime: true, resumeFromStep: 'keywordReview',
    params: { reviewQueryKeywords: keywords, sycmExtractor: async word => { queried.push(word); return { data: [] }; } } });
  assert.deepEqual(queried, ['茶杯']);
  assert.equal(result.status, 'awaiting_keyword_review');
  assert.equal(result.reviewed.find(row => row.keyword === '杯垫').reviewDraft, 'approved');
  assert.equal(result.approved.length, 0);
  assert.deepEqual(readJsonl(getRun(options).run.files.verifiedKeywords), []);
  assert.throws(() => prepareKeywordSupplement({ ...options, keywords: ['茶杯'] }), /已有查询结果/);
});
