'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  initRuntimeState,
  readRuntimeState,
  updateRuntimeState,
  requestRuntimeCancel,
  readRuntimeControl,
  appendRuntimeEvent,
  readRuntimeEvents,
  assertRuntimeRunId
} = require('../runtime/store');
const { runPipelineRuntime } = require('../runtime/runner');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-runtime-'));
}

describe('pipeline runtime store', () => {
  it('initializes and updates runtime state under the run directory', () => {
    const dataDir = tempDataDir();
    const runtime = initRuntimeState({
      dataDir,
      runId: 'run_1',
      steps: ['mine', 'verify']
    });

    assert.equal(runtime.status, 'running');
    assert.equal(runtime.activeStep, 'mine');
    assert.equal(runtime.progress.mine.status, 'idle');

    updateRuntimeState({
      dataDir,
      runId: 'run_1',
      patch: {
        activeStep: 'verify',
        progress: {
          verify: { status: 'running', current: 1, total: 3, percent: 33, message: '验真 1/3' }
        }
      }
    });

    const updated = readRuntimeState({ dataDir, runId: 'run_1' });
    assert.equal(updated.activeStep, 'verify');
    assert.equal(updated.progress.verify.percent, 33);
    assert.equal(updated.progress.mine.status, 'idle');
  });

  it('persists cancel requests separately from runtime state', () => {
    const dataDir = tempDataDir();
    initRuntimeState({ dataDir, runId: 'run_2', steps: ['mine'] });

    requestRuntimeCancel({ dataDir, runId: 'run_2', reason: 'user_cancelled' });

    const control = readRuntimeControl({ dataDir, runId: 'run_2' });
    assert.equal(control.requestedAction, 'cancel');
    assert.equal(control.reason, 'user_cancelled');
  });

  it('appends and reads ordered runtime events', () => {
    const dataDir = tempDataDir();
    initRuntimeState({ dataDir, runId: 'run_3', steps: ['mine'] });

    const first = appendRuntimeEvent({
      dataDir,
      runId: 'run_3',
      event: { event: 'progress', step: 'mine', percent: 10 }
    });
    const second = appendRuntimeEvent({
      dataDir,
      runId: 'run_3',
      event: { event: 'progress', step: 'mine', percent: 100 }
    });

    assert.equal(first.runId, 'run_3');
    assert.equal(second.runId, 'run_3');
    assert.ok(first.timestamp);
    assert.ok(second.timestamp);
    assert.deepEqual(readRuntimeEvents({ dataDir, runId: 'run_3' }).map(event => event.percent), [10, 100]);
  });

  it('skips malformed runtime event lines', () => {
    const dataDir = tempDataDir();
    initRuntimeState({ dataDir, runId: 'run_4', steps: ['mine'] });
    fs.appendFileSync(
      path.join(dataDir, 'runs', 'run_4', 'workflow-events.jsonl'),
      '{bad json}\n{"event":"progress","step":"mine","percent":50}\n',
      'utf8'
    );

    const events = readRuntimeEvents({ dataDir, runId: 'run_4' });

    assert.deepEqual(events, [{ event: 'progress', step: 'mine', percent: 50 }]);
  });

  it('rejects unsafe run ids', () => {
    const dataDir = tempDataDir();
    assert.throws(() => assertRuntimeRunId('../bad'), /Invalid runtime run id/);
    assert.throws(() => initRuntimeState({ dataDir, runId: '../bad', steps: ['mine'] }), /Invalid runtime run id/);
    assert.throws(() => requestRuntimeCancel({ dataDir, runId: '../bad' }), /Invalid runtime run id/);
  });
});

describe('pipeline runtime runner', () => {
  it('runs steps in order and writes progress events', async () => {
    const dataDir = tempDataDir();
    const calls = [];
    const result = await runPipelineRuntime({
      dataDir,
      mode: 'daily',
      params: { mine: 2, verify: 1, generate: 1, export: 1 },
      steps: ['mine', 'verify'],
      stepFns: {
        mine: async ({ reportProgress }) => {
          calls.push('mine');
          reportProgress({ current: 1, total: 2, message: '挖词 1/2' });
          return {
            runId: 'runtime_run',
            runDir: path.join(dataDir, 'runs', 'runtime_run'),
            candidates: [{ keyword: 'a' }, { keyword: 'b' }]
          };
        },
        verify: async ({ runId, reportProgress }) => {
          calls.push(`verify:${runId}`);
          reportProgress({ current: 1, total: 1, message: '验真完成' });
          return { status: 'verified', verified: [{ keyword: 'a' }], rejected: [] };
        }
      }
    });

    assert.deepEqual(calls, ['mine', 'verify:runtime_run']);
    assert.equal(result.runId, 'runtime_run');
    const runtime = readRuntimeState({ dataDir, runId: 'runtime_run' });
    assert.equal(runtime.status, 'completed');
    assert.equal(runtime.progress.verify.percent, 100);
    assert.ok(readRuntimeEvents({ dataDir, runId: 'runtime_run' }).some(event => event.event === 'progress'));
  });

  it('keeps progress percent safe for unusual totals', async () => {
    const dataDir = tempDataDir();
    const result = await runPipelineRuntime({
      dataDir,
      mode: 'daily',
      params: {},
      steps: ['mine'],
      stepFns: {
        mine: async ({ reportProgress }) => {
          reportProgress({ current: 5, total: 0, message: 'unknown total' });
          reportProgress({ current: -1, total: 3, message: 'negative current' });
          reportProgress({ current: 10, total: 3, message: 'over total' });
          return { status: 'mined' };
        }
      }
    });

    const events = readRuntimeEvents({ dataDir, runId: result.runId })
      .filter(event => event.event === 'progress')
      .map(event => event.percent);

    assert.deepEqual(events, [100, 0, 100]);
  });

  it('cancels between safe step boundaries', async () => {
    const dataDir = tempDataDir();
    const result = await runPipelineRuntime({
      dataDir,
      mode: 'daily',
      params: {},
      steps: ['mine', 'verify'],
      stepFns: {
        mine: async ({ reportProgress, runId }) => {
          reportProgress({ current: 1, total: 1, message: 'mine done' });
          requestRuntimeCancel({ dataDir, runId, reason: 'test_cancel' });
          return { runId, runDir: path.join(dataDir, 'runs', runId), candidates: [] };
        },
        verify: async () => {
          throw new Error('verify should not run after cancel');
        }
      }
    });

    assert.equal(result.status, 'cancelled');
    const runtime = readRuntimeState({ dataDir, runId: result.runId });
    assert.equal(runtime.status, 'cancelled');
    assert.equal(runtime.activeStep, 'verify');
  });
});
