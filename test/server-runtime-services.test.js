const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntimeView } = require('../core/server/runtime-view');
const { createSycmAccessRecovery } = require('../core/server/sycm-access-recovery');
const express = require('express');
const { registerWorkbenchRoutes } = require('../core/server/workbench-routes');
const { registerWorkflowControlRoutes } = require('../core/server/workflow-control-routes');

test('runtime view reads current state and preserves legacy snapshot fallbacks', () => {
  let runtime = null;
  let workflow = null;
  const view = createRuntimeView({
    WORKFLOW_NODE_IDS: { start: 'start', mine: 'mine', end: 'end' },
    readRuntimeState: () => runtime,
    summarizePipelineRun: ({ runId }) => ({ runId, count: 2 }),
    getWorkflowRun: () => workflow
  });
  assert.equal(view.runtimeOnlyWorkflowSnapshot('fixture'), null);
  assert.equal(view.withPipelineRuntimeFields(null), null);
  runtime = { status: 'cancelled', activeStep: 'mine', startedAt: 'fixture-time' };
  const snapshot = view.runtimeOnlyWorkflowSnapshot('fixture');
  assert.equal(snapshot.nodeStates.start.status, 'completed');
  assert.equal(snapshot.nodeStates.mine.status, 'cancelled');
  assert.equal(snapshot.nodeStates.end.status, 'idle');
  runtime = { status: 'paused', activeStep: 'mine', progress: { mine: { status: 'paused', current: 0 }, unknown: { status: 'failed' } } };
  assert.equal(view.runtimeOnlyWorkflowSnapshot('fixture').nodeStates.mine.status, 'paused');
  assert.equal(view.runtimeOnlyWorkflowSnapshot('fixture').nodeStates.unknown, undefined);
  workflow = { runId: 'fixture', status: 'completed', nodeStates: {} };
  const result = view.pipelineRunResponse('fixture', { ok: true });
  assert.equal(result.runtime, runtime);
  assert.equal(result.currentRun.workflow, workflow);
  assert.equal(result.currentRun.count, 2);
  assert.equal(result.ok, true);
});

test('Chrome recovery only clears supported blockers after readiness confirmation', async () => {
  let access = {};
  let ready = false;
  let clears = 0;
  let checkedPort;
  const { recoverSycmAccessAfterChrome } = createSycmAccessRecovery({
    getSycmAccessStatus: () => access,
    getSycmChromeAvailabilityChecker: () => async port => { checkedPort = port; return ready; },
    clearSycmAccessBlocker: () => { clears++; return { cleared: true }; }
  });
  assert.equal((await recoverSycmAccessAfterChrome(9444)).cleared, false);
  access = { breaker: { open: true, reason: 'No Chrome tab found on port 9222' } };
  assert.equal((await recoverSycmAccessAfterChrome(9444)).chromeReady, false);
  assert.equal(checkedPort, 9444);
  assert.equal(clears, 0);
  ready = true;
  assert.equal((await recoverSycmAccessAfterChrome(9444)).cleared, true);
  access = { breaker: { open: true, status: 'rate_limited', reason: 'platform request limit' } };
  assert.equal((await recoverSycmAccessAfterChrome(9444, { assumeReady: true })).cleared, false);
  assert.equal(clears, 1);
  access = { breaker: { open: true, status: 'login_required' } };
  assert.equal((await recoverSycmAccessAfterChrome(9444)).cleared, false);
  assert.equal((await recoverSycmAccessAfterChrome(9444, { assumeReady: true })).cleared, true);
});

test('legacy batch summaries and graph validation retain response contracts', async () => {
  const app = express();
  app.use(express.json());
  let validation;
  let result = { ok: true, errors: [] };
  registerWorkbenchRoutes(app, {
    parsePositiveNumber: (value, fallback) => Number(value) > 0 ? Number(value) : fallback,
    listPipelineRuns: ({ limit }) => ({ limit, runs: [{ runId: 'fixture', counts: { reviewCandidates: 2 }, previews: { distributionReview: 'preview' } }] })
  });
  registerWorkflowControlRoutes(app, {
    validateProductionWorkflow: (workflow, options) => { validation = { workflow, options }; if (result instanceof Error) throw result; return result; }
  });
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const { data } = await (await fetch(`${base}/api/workflow/batches?limit=3`)).json();
    assert.equal(data.limit, 3);
    assert.equal(data.runs[0].requiresReview, true);
    assert.equal(data.runs[0].reviewPreview, 'preview');
    assert.deepEqual(data.latest, data.runs[0]);
    const validate = () => fetch(`${base}/api/workflows/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workflow: { nodes: [] }, template_id: 'fixture-template', mode: 'daily' }) });
    assert.equal((await validate()).status, 200);
    assert.deepEqual(validation, { workflow: { nodes: [] }, options: { templateId: 'fixture-template', mode: 'daily' } });
    result = { ok: false, errors: ['fixture invalid'] };
    assert.equal((await validate()).status, 400);
    result = new Error('fixture failure');
    assert.equal((await validate()).status, 500);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
