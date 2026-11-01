'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkbenchCoordinator } = require('../../../core/server/workbench-coordinator');
const {
  createWorkflowControlService,
  isWorkflowRetryNodeAllowed
} = require('../../../core/workflow/control-service');

test('isWorkflowRetryNodeAllowed validates mode-specific and standard retryable steps', () => {
  assert.equal(isWorkflowRetryNodeAllowed({ mode: 'daily', steps: ['mine', 'verify'] }, 'verify'), true);
  assert.equal(isWorkflowRetryNodeAllowed({ mode: 'daily', steps: ['mine', 'verify'] }, 'review'), false);
  assert.equal(
    isWorkflowRetryNodeAllowed(
      { mode: 'peer-discovery', steps: ['extractSources', 'findSimilarProducts'] },
      'findSimilarProducts'
    ),
    true
  );
  assert.equal(
    isWorkflowRetryNodeAllowed(
      { mode: 'peer-discovery', steps: ['extractSources', 'findSimilarProducts'] },
      'collectPeerProducts'
    ),
    false
  );
  assert.equal(
    isWorkflowRetryNodeAllowed(
      { mode: 'competitor-analysis', steps: ['findCompetitorSources'] },
      'findCompetitorSources'
    ),
    true
  );
});

test('createWorkflowControlService unifies start, pause, resume, retry and cancel across workflow and pipeline sources', async () => {
  const workbench = createWorkbenchCoordinator();
  const runtimeStore = new Map();
  const legacyStore = new Map([['legacy-1', { runId: 'legacy-1', status: 'paused' }]]);
  const runnerCalls = [];
  let seq = 0;
  let chromeReady = true;

  const service = createWorkflowControlService({
    workbench,
    createRunId: () => `run_${++seq}`,
    resolveProductionWorkflowLaunch: (body) => {
      if (body.badMode) throw new Error('未知 workflow mode');
      return { mode: body.mode || 'daily', params: body.params || { keyword: '耳环' } };
    },
    resolveManualShareParams: async (_mode, params) => params,
    sanitizeWorkflowParams: (_mode, params) => params,
    resolveProductionWorkflowDefinition: () => ({ id: 'tpl-daily' }),
    writeWorkflowDefinition: () => {},
    getPipelineRuntimeRunner: () => async (input) => {
      runnerCalls.push(input);
      runtimeStore.set(input.runId, {
        runId: input.runId,
        mode: input.mode,
        status: 'paused',
        activeStep: input.retryStep || input.resumeFromStep || 'verify',
        steps: ['mine', 'verify', 'generate'],
        params: input.params
      });
      return { runId: input.runId, status: 'paused' };
    },
    readRuntimeState: ({ runId }) => runtimeStore.get(runId) || null,
    summarizePipelineRun: ({ runId }) => runtimeStore.has(runId) ? { runId } : null,
    withPipelineRuntimeFields: (val) => val,
    pipelineRunResponse: (runId, extra = {}) => ({ runId, ...extra }),
    requestRuntimePause: ({ runId, reason }) => ({ requestedAction: 'pause', runId, reason }),
    requestRuntimeResume: ({ runId }) => ({ requestedAction: 'resume', runId }),
    requestRuntimeRetryStep: ({ runId, step }) => ({ requestedAction: 'retry-step', runId, step }),
    requestRuntimeCancel: ({ runId, reason }) => ({ requestedAction: 'cancel', runId, reason }),
    getSycmChromeAvailabilityChecker: () => async () => chromeReady,
    recoverSycmAccessAfterChrome: async () => ({ chromeReady }),
    markRunPaused: (runId) => legacyStore.get(runId) || null,
    getRun: (runId) => legacyStore.get(runId) || null,
    resumeWorkflow: async (runId) => {
      legacyStore.set(runId, { runId, status: 'completed' });
    },
    retryWorkflowNode: async (runId, nodeId) => {
      legacyStore.set(runId, { runId, status: 'completed', retried: nodeId });
    }
  });

  // 1. Validation error returns 400 and releases workbench lock
  const invalidStart = await service.startRun({ badMode: true }, { source: 'workflow' });
  assert.equal(invalidStart.httpStatus, 400);
  assert.equal(workbench.current, null);

  // 2. Workflow start & Pipeline start return their respective response shapes
  const wfStart = await service.startRun({ mode: 'daily' }, { source: 'workflow' });
  assert.equal(wfStart.httpStatus, 200);
  assert.equal(wfStart.body.data.monitor, 'workflow');
  const runId = wfStart.body.data.runId;
  await new Promise((resolve) => setImmediate(resolve));

  const pipeStart = await service.startRun({ mode: 'keyword' }, { source: 'pipeline' });
  assert.equal(pipeStart.httpStatus, 200);
  assert.equal(pipeStart.body.data.status, 'started');
  await new Promise((resolve) => setImmediate(resolve));

  // 3. Pause runtime & legacy fallback
  const pausedRuntime = service.pauseRun({ runId, reason: 'check' });
  assert.equal(pausedRuntime.httpStatus, 200);
  assert.equal(pausedRuntime.body.data.control.requestedAction, 'pause');

  const missingPipelinePause = service.pauseRun({
    runId: 'legacy-1',
    validateRunId: true,
    allowLegacyFallback: false
  });
  assert.equal(missingPipelinePause.httpStatus, 404);

  const legacyPause = service.pauseRun({
    runId: 'legacy-1',
    allowLegacyFallback: true
  });
  assert.equal(legacyPause.httpStatus, 200);
  assert.equal(legacyPause.body.run.runId, 'legacy-1');

  // 4. Retry step checks Chrome preflight for verify
  chromeReady = false;
  const blockedRetry = await service.retryStep({
    runId,
    stepId: 'verify',
    source: 'workflow',
    allowLegacyFallback: true
  });
  assert.equal(blockedRetry.httpStatus, 409);
  assert.equal(blockedRetry.body.code, 'SYCM_CHROME_REQUIRED');

  chromeReady = true;
  const okRetry = await service.retryStep({
    runId,
    stepId: 'verify',
    source: 'workflow',
    allowLegacyFallback: true
  });
  assert.equal(okRetry.httpStatus, 200);
  assert.equal(okRetry.body.data.control.step, 'verify');
  await new Promise((resolve) => setImmediate(resolve));

  // 5. Resume runtime & legacy fallback
  const resumed = await service.resumeRun({
    runId,
    source: 'pipeline',
    validateRunId: true
  });
  assert.equal(resumed.httpStatus, 200);
  assert.equal(resumed.body.data.control.requestedAction, 'resume');
  await new Promise((resolve) => setImmediate(resolve));

  const legacyResumed = await service.resumeRun({
    runId: 'legacy-1',
    source: 'workflow',
    allowLegacyFallback: true
  });
  assert.equal(legacyResumed.httpStatus, 200);
  assert.equal(legacyResumed.body.run.status, 'completed');

  // 6. Cancel validation & execution
  assert.equal(service.cancelRun({ runId: 'bad id!' }).httpStatus, 400);
  const cancelled = service.cancelRun({ runId });
  assert.equal(cancelled.httpStatus, 200);
  assert.equal(cancelled.body.data.status, 'cancel_requested');
});
