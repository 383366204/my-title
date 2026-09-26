'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { registerSelectionReviewRoutes } = require('../../core/server/selection-review-routes');
const { initRun, getRun, writeRun, appendJsonl, readJsonl } = require('../../skills/pipeline-flow/src/run-store');
const { normalizeKeywordFilter } = require('../../skills/pipeline-flow/src/keyword-metric-filter');
const { reviewRootOpportunities } = require('../../skills/pipeline-flow/src/root-opportunity-review');
const { readWorkflowNodeArtifact } = require('../../core/workflow/pipeline-artifacts');
const { sanitizeWorkflowParams, resolveProductionWorkflowLaunch } = require('../../core/workflow/pipeline-params');
const { flowKeywordStart } = require('../../skills/pipeline-flow/src/flow-orchestrator');
const { outputForNode } = require('../../core/workflow/pipeline-node-output');
const { registerWorkflowControlRoutes } = require('../../core/server/workflow-control-routes');
const { verifyExactSelectionKeywords } = require('../../skills/pipeline-flow/src/exact-keyword-verification');
const { flowExpandRootKeywords } = require('../../skills/pipeline-flow/src/root-keyword-expansion-flow');

test('keyword filter API persists atomically without advancing or erasing decisions', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyword-filter-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const lookup = { dataDir, runId: 'fixture' };
  const { run, runDir } = initRun({ ...lookup, options: { mode: 'keyword', combinedOpportunityReview: true } });
  const metric = { demandSupplyRatio: 2, searchPopularity: 60, conversionRate: '2%', tmallClickShare: '20%' };
  appendJsonl(run.files.candidates, [
    { keyword: 'a', sycmData: metric, reviewDraft: 'rejected' },
    { keyword: 'b', sycmData: metric }, { keyword: 'c' }
  ]);
  appendJsonl(run.files.reviewedCandidates, [
    { keyword: 'a', sycmData: metric, combinedOpportunityReview: true, reviewStatus: 'approved',
      keywordOpportunity: { manualApproval: { approved: true } } },
    { keyword: 'b', sycmData: metric, combinedOpportunityReview: true, reviewStatus: 'rejected' }
  ]);
  run.status = 'awaiting_keyword_review';
  writeRun(runDir, run);
  let runtime = { activeStep: 'keywordReview', status: 'blocked', progress: {} };
  const app = express();
  app.use(express.json());
  registerSelectionReviewRoutes(app, { dataDir, isValidWorkflowRunIdParam: id => /^[a-z]+$/.test(id),
    readRuntimeState: () => runtime, updateRuntimeState: () => assert.fail('must not advance') });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (body, id = 'fixture') => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/workflows/runs/${id}/keyword-filter`,
      body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, ...(await res.json()) };
  };
  const initial = await request();
  assert.equal(initial.data.version, 0);
  assert.equal(initial.data.editable, true);
  assert.equal(initial.data.requiresRecollection, true);
  assert.equal((await request(undefined, 'missing')).status, 404);
  assert.equal((await request(undefined, 'bad-id')).status, 400);
  const config = normalizeKeywordFilter();
  config.searchPopularity.value = 100;
  const updated = await request({ config, version: 0, decisions: { b: 'approved' } });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.version, 1);
  assert.deepEqual(updated.data.counts, { total: 3, passed: 0, failed: 2, review: 1 });
  assert.equal(updated.data.rows[0].reviewStatus, 'approved');
  assert.equal(updated.data.rows[0].reviewDraft, 'rejected');
  assert.equal(updated.data.rows[0].keywordOpportunity.manualApproval.approved, true);
  assert.equal(updated.data.rows[1].reviewStatus, 'rejected');
  assert.equal(updated.data.rows[1].reviewDraft, 'approved');
  assert.equal(getRun(lookup).run.counts.keywordFilterFailed, 2);
  assert.deepEqual(outputForNode('keywordReview', getRun(lookup).run).filterCounts, { passed: 0, failed: 2, review: 1 });
  const confirm = await fetch(`http://127.0.0.1:${server.address().port}/api/workflows/runs/fixture/keyword-review`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keywordFilterVersion: 0 })
  });
  assert.equal(confirm.status, 409);
  const artifact = readWorkflowNodeArtifact({ ...lookup, nodeId: 'keywordReview', limit: 'all' });
  assert.deepEqual(artifact.keywordFilter, config);
  assert.equal(artifact.keywordFilterVersion, 1);
  assert.equal(getRun(lookup).run.status, 'awaiting_keyword_review');
  assert.equal((await request({ config, version: 0 })).status, 409);
  for (const body of [{ config: {}, version: 1 }, { config, version: '1' }, { version: 1 },
    { config, version: 1, decisions: { a: true } }, { config, version: 1, decisions: { unknown: 'approved' } }]) {
    assert.equal((await request(body)).status, 400);
  }
  for (const state of [
    { activeStep: 'keywordReview', status: 'running' },
    { activeStep: 'keywordReview', status: 'completed' },
    { activeStep: 'select', status: 'paused' },
    { activeStep: 'keywordReview', status: 'paused', progress: { keywordReview: { status: 'completed' } } },
    { activeStep: 'keywordReview', status: 'paused', progress: { select: { status: 'completed' } } }
  ]) {
    runtime = state;
    assert.equal((await request({ config, version: 1 })).status, 409);
    assert.equal((await request()).data.editable, false);
  }
  runtime = { activeStep: 'keywordReview', status: 'blocked' };
  const simultaneous = await Promise.all([request({ config, version: 1 }), request({ config, version: 1 })]);
  assert.deepEqual(simultaneous.map(item => item.status).sort(), [200, 409]);
  const reloaded = reviewRootOpportunities(lookup);
  assert.equal(reloaded.reviewed[0].reviewStatus, 'approved');
  assert.equal(reloaded.reviewed[1].reviewDraft, 'approved');
  assert.equal(reloaded.reviewed[1].metricFilter.status, 'failed');
  assert.equal(reloaded.stepIncomplete, true, 'saved approval must not bypass explicit confirmation on resume');
});

test('explicit recollection creates an isolated cache-bypassed run, rejects stale and unsupported requests', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filter-recollect-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const { run, runDir } = initRun({ dataDir, runId: 'source', options: { mode: 'keyword' } });
  run.status = 'awaiting_keyword_review';
  run.options.keywordFilter.searchPopularity.value = 80;
  appendJsonl(run.files.candidates, { keyword: 'a', reviewDraft: 'rejected' });
  writeRun(runDir, run);
  const before = fs.readFileSync(path.join(runDir, 'run.json'), 'utf8');
  let runtime = { activeStep: 'keywordReview', status: 'blocked', mode: 'keyword', params: { keyword: 'a' } };
  let launched;
  let busy = false;
  const handlers = new Map();
  registerWorkflowControlRoutes({ post: (url, handler) => handlers.set(url, handler) }, {
    dataDir, isValidWorkflowRunIdParam: () => true, readRuntimeState: () => runtime,
    workbench: { tryAcquire: () => busy ? null : {}, release: () => {},
      runReserved: (reservation, fn) => { reservation.promise = Promise.resolve(fn()); return reservation.promise; } },
    createRunId: () => 'fresh', sanitizeWorkflowParams,
    resolveProductionWorkflowDefinition: () => ({}), writeWorkflowDefinition: () => {},
    getPipelineRuntimeRunner: () => options => { launched = options; return {}; }, originalError: () => {}
  });
  const call = (version, decisions) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    handlers.get('/api/workflows/runs/:runId/keyword-filter/recollect')({ params: { runId: 'source' }, body: { version, decisions } }, res);
    return res;
  };
  assert.equal(call(1).statusCode, 409);
  assert.equal(launched, undefined);
  assert.equal(call(0, { unknown: 'approved' }).statusCode, 400);
  assert.equal(call(0, { a: true }).statusCode, 400);
  assert.equal(call(0, null).statusCode, 400);
  const response = call(0, { a: 'approved' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.recollectionMode, 'new_run');
  assert.notEqual(launched.runId, 'source');
  assert.equal(launched.params.guardCache, false);
  assert.equal(launched.params.keywordFilter.searchPopularity.value, 80);
  assert.deepEqual(launched.params.keywordFilterDecisions, { a: 'approved' });
  assert.equal(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'), before);
  const firstRunId = launched.runId;
  launched = null;
  const repeated = call(0);
  assert.equal(repeated.body.data.runId, firstRunId);
  assert.equal(repeated.body.data.reused, true);
  assert.equal(launched, null);
  busy = true;
  assert.equal(call(0).statusCode, 409);
  busy = false;
  runtime = { ...runtime, mode: 'daily' };
  run.options.keywordFilterVersion = 1;
  writeRun(runDir, run);
  assert.equal(call(1).body.code, 'RECOLLECTION_UNSUPPORTED');
  appendJsonl(run.files.rootCandidates, [
    { rootKeyword: 'unused-ai-root' },
    { rootKeyword: 'source-root', queryTasks: [{ keyword: 'actual-query', mode: 'hot', status: 'success' }] }
  ]);
  appendJsonl(run.files.candidates, { keyword: 'b', root: 'other-query', sourceRoots: ['actual-query'] });
  assert.equal(call(1).statusCode, 200);
  assert.equal(launched.mode, 'root-keyword');
  assert.deepEqual(launched.params.roots, ['actual-query', 'other-query']);
  assert.equal(launched.params.guardCache, false);
});

test('launch parameters and runtime initialization preserve run-scoped config', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filter-launch-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const config = normalizeKeywordFilter();
  config.tmallClickShare.enabled = false;
  for (const mode of ['daily', 'keyword', 'root-keyword']) {
    const raw = { keyword: 'a', roots: ['a'], keywordFilter: config };
    assert.deepEqual(sanitizeWorkflowParams(mode, raw).keywordFilter, config);
    assert.deepEqual(resolveProductionWorkflowLaunch({ mode, ...raw }).params.keywordFilter, config);
  }
  await flowKeywordStart({ dataDir, runId: 'launch', keyword: 'a', keywordFilter: config });
  assert.deepEqual(getRun({ dataDir, runId: 'launch' }).run.options.keywordFilter, config);
  initRun({ dataDir, runId: 'launch', keywordFilter: normalizeKeywordFilter() });
  assert.deepEqual(getRun({ dataDir, runId: 'launch' }).run.options.keywordFilter, config);
});

test('collectors use persisted config ahead of stale runtime params and preserve actual filter evidence', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filter-collect-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const config = normalizeKeywordFilter();
  config.searchPopularity = { enabled: false, value: 100 };
  config.conversionRate.value = 3;
  const lookup = { dataDir, runId: 'exact' };
  await flowKeywordStart({ ...lookup, keyword: 'a', keywordFilter: config });
  const hotActual = { demandSupplyRatio: 0, searchPopularity: 0, conversionRate: 0, buyerCount: 0, referencePrice: 0 };
  let requested;
  await verifyExactSelectionKeywords({ ...lookup, keywordFilter: normalizeKeywordFilter(), sycmExtractor: async (word, options) => {
    requested = options;
    return { data: [{ keyword: word }], filterConditions: hotActual, filterApplied: false };
  } });
  assert.equal(requested.filterConditions.searchPopularity, 0);
  assert.equal(requested.filterConditions.conversionRate, 3);
  assert.equal(requested.guardCache, false);
  const exact = readJsonl(getRun(lookup).run.files.candidates)[0];
  assert.deepEqual(exact.sycmEvidence.filterConditions, hotActual);
  assert.equal(exact.sycmEvidence.filterApplied, false);
  assert.equal(exact.sycmEvidence.requestedFilterConditions.conversionRate, 3);
  const rootLookup = { dataDir, runId: 'root' };
  initRun({ ...rootLookup, keywordFilter: config, options: { mode: 'root-keyword' } });
  const roots = await flowExpandRootKeywords({ ...rootLookup, roots: ['a'], sycmMode: 'blue', keywordFilter: normalizeKeywordFilter(),
    sycmExtractor: async (word, options) => {
      requested = options;
      return { data: [{ keyword: word }], filterConditions: options.filterConditions, filterApplied: true };
    } });
  assert.equal(requested.filterConditions.searchPopularity, 0);
  assert.equal(requested.guardCache, false);
  assert.deepEqual(roots.candidates[0].sycmEvidence.filterConditions, requested.filterConditions);
  assert.equal(roots.candidates[0].sycmEvidence.filterApplied, true);
});
