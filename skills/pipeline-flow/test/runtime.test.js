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
