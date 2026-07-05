# Pipeline Runtime Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real pause, resume, and step retry support to the production pipeline runtime used by the Web workflow canvas.

**Architecture:** Keep the current file-backed runtime under `data/pipeline/runs/<runId>/`. Extend `runtime-control.json` from cancel-only control into pause/resume/retry-step commands, teach `runPipelineRuntime()` to resume from a stored `activeStep`, and expose production pipeline APIs that the Web canvas can call directly. Pausing remains safe-boundary based: the current platform request is allowed to finish, then the runtime stops before the next step.

**Tech Stack:** Node.js CommonJS, `node:test`, Express routes in `bin/server.js`, React/Vite Web UI, existing pipeline runtime files in `skills/pipeline-flow/runtime/`.

---

## File Structure

- Modify `skills/pipeline-flow/runtime/store.js`
  - Add control writers for pause, resume, and retry-step.
  - Add `clearRuntimeControl()` so resumed runs do not re-read stale pause/cancel requests.
  - Keep `requestRuntimeCancel()` backward compatible.
- Modify `skills/pipeline-flow/runtime/runner.js`
  - Add resume options: `resumeFromStep`, `retryStep`, and `preserveRuntime`.
  - Initialize runtime only for fresh runs; resume runs reuse `runtime.json`.
  - Check runtime control after each safe step boundary.
  - When pausing, mark runtime `paused` and set `activeStep` to the next pending step.
  - When retrying, reset the target and downstream progress to `idle` and start from the target.
- Modify `bin/server.js`
  - Add pipeline production APIs: pause, resume, and retry-step.
  - Keep old workflow recovery APIs unchanged for legacy `run_...` workflow runs.
  - Prevent duplicate active production runtime per run.
- Modify `core/workflow/pipeline-adapter.js`
  - Map production runtime `paused`, `resuming`, and `retrying` states into canvas node states.
  - Preserve runtime-level `manualAction`, `platform`, and `platformStatus` on the active node.
- Modify `apps/web/src/WorkflowStudio.jsx`
  - Route production pause/resume/retry buttons to `/api/pipeline/...` endpoints.
  - Only use `/api/workflows/...` endpoints for legacy workflow runs.
- Modify `apps/web/src/workflow-ui.js`
  - Keep deterministic action metadata for `resume` and `retry-node`.
  - Add status/action tests for paused production nodes.
- Test `skills/pipeline-flow/test/runtime.test.js`
  - Store control writers.
  - Pause at safe boundary.
  - Resume from active step.
  - Retry resets target and downstream steps.
  - Cancel wins over pause/resume.
- Test `test/workflow-api-recovery.test.js`
  - Production pipeline pause/resume/retry endpoints.
- Test `core/test/workflow-pipeline-adapter.test.js`
  - Runtime paused and retrying states map to canvas correctly.
- Test `apps/web/src/workflow-ui.test.mjs`
  - Button action metadata remains stable.

---

### Task 1: Runtime Store Control Helpers

**Files:**
- Modify: `skills/pipeline-flow/runtime/store.js`
- Test: `skills/pipeline-flow/test/runtime.test.js`

- [ ] **Step 1: Write failing store tests**

Add these imports at the top of `skills/pipeline-flow/test/runtime.test.js`:

```js
const {
  initRuntimeState,
  readRuntimeState,
  updateRuntimeState,
  requestRuntimeCancel,
  requestRuntimePause,
  requestRuntimeResume,
  requestRuntimeRetryStep,
  clearRuntimeControl,
  readRuntimeControl,
  appendRuntimeEvent,
  readRuntimeEvents,
  assertRuntimeRunId
} = require('../runtime/store');
```

Append this test inside `describe('pipeline runtime store', () => { ... })`:

```js
it('persists pause resume and retry-step control requests', () => {
  const dataDir = tempDataDir();
  initRuntimeState({ dataDir, runId: 'run_control', steps: ['mine', 'verify', 'generate'] });

  const pause = requestRuntimePause({ dataDir, runId: 'run_control', reason: 'user_pause' });
  assert.equal(pause.requestedAction, 'pause');
  assert.equal(pause.reason, 'user_pause');
  assert.ok(pause.updatedAt);

  const resume = requestRuntimeResume({ dataDir, runId: 'run_control' });
  assert.equal(resume.requestedAction, 'resume');

  const retry = requestRuntimeRetryStep({ dataDir, runId: 'run_control', step: 'verify', reason: 'manual_retry' });
  assert.equal(retry.requestedAction, 'retry-step');
  assert.equal(retry.step, 'verify');
  assert.equal(retry.reason, 'manual_retry');

  const cleared = clearRuntimeControl({ dataDir, runId: 'run_control' });
  assert.equal(cleared.requestedAction, null);
  assert.equal(readRuntimeControl({ dataDir, runId: 'run_control' }).requestedAction, null);
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test skills/pipeline-flow/test/runtime.test.js
```

Expected: FAIL because `requestRuntimePause`, `requestRuntimeResume`, `requestRuntimeRetryStep`, and `clearRuntimeControl` are not exported.

- [ ] **Step 3: Implement control helpers**

In `skills/pipeline-flow/runtime/store.js`, add this helper after `requestRuntimeCancel()`:

```js
function writeRuntimeControl({ dataDir, runId, control = {} }) {
  const next = {
    requestedAction: control.requestedAction || null,
    updatedAt: new Date().toISOString()
  };
  if (control.reason) next.reason = control.reason;
  if (control.step) next.step = control.step;
  writeJson(controlFile(dataDir, runId), next);
  return next;
}
```

Replace the body of `requestRuntimeCancel()` with:

```js
function requestRuntimeCancel({ dataDir, runId, reason = 'user_cancelled' }) {
  return writeRuntimeControl({
    dataDir,
    runId,
    control: { requestedAction: 'cancel', reason }
  });
}
```

Add these functions after `requestRuntimeCancel()`:

```js
function requestRuntimePause({ dataDir, runId, reason = 'user_paused' }) {
  return writeRuntimeControl({
    dataDir,
    runId,
    control: { requestedAction: 'pause', reason }
  });
}

function requestRuntimeResume({ dataDir, runId, reason = 'user_resumed' }) {
  return writeRuntimeControl({
    dataDir,
    runId,
    control: { requestedAction: 'resume', reason }
  });
}

function requestRuntimeRetryStep({ dataDir, runId, step, reason = 'user_retry_step' }) {
  if (!step) throw new Error('retry step is required');
  return writeRuntimeControl({
    dataDir,
    runId,
    control: { requestedAction: 'retry-step', step, reason }
  });
}

function clearRuntimeControl({ dataDir, runId }) {
  return writeRuntimeControl({
    dataDir,
    runId,
    control: { requestedAction: null }
  });
}
```

Update `module.exports`:

```js
module.exports = {
  initRuntimeState,
  readRuntimeState,
  updateRuntimeState,
  requestRuntimeCancel,
  requestRuntimePause,
  requestRuntimeResume,
  requestRuntimeRetryStep,
  clearRuntimeControl,
  readRuntimeControl,
  appendRuntimeEvent,
  readRuntimeEvents,
  assertRuntimeRunId
};
```

- [ ] **Step 4: Run store tests**

Run:

```bash
node --test skills/pipeline-flow/test/runtime.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/pipeline-flow/runtime/store.js skills/pipeline-flow/test/runtime.test.js
git commit -m "feat: add pipeline runtime control helpers"
```

---

### Task 2: Runner Pause at Safe Boundaries

**Files:**
- Modify: `skills/pipeline-flow/runtime/runner.js`
- Test: `skills/pipeline-flow/test/runtime.test.js`

- [ ] **Step 1: Write failing pause tests**

Append this test inside `describe('pipeline runtime runner', () => { ... })`:

```js
it('pauses between safe step boundaries and records the next active step', async () => {
  const dataDir = tempDataDir();
  const calls = [];
  const result = await runPipelineRuntime({
    dataDir,
    runId: 'pause_boundary_run',
    mode: 'daily',
    params: {},
    steps: ['mine', 'verify', 'generate'],
    stepFns: {
      mine: async ({ reportProgress, runId }) => {
        calls.push('mine');
        reportProgress({ current: 1, total: 1, message: 'mine done' });
        requestRuntimePause({ dataDir, runId, reason: 'user_pause' });
        return { runId, runDir: path.join(dataDir, 'runs', runId), status: 'mined' };
      },
      verify: async () => {
        calls.push('verify');
        throw new Error('verify should not run after pause');
      },
      generate: async () => {
        calls.push('generate');
        throw new Error('generate should not run after pause');
      }
    }
  });

  assert.deepEqual(calls, ['mine']);
  assert.equal(result.status, 'paused');
  assert.equal(result.runtimeStatus, 'paused');
  const runtime = readRuntimeState({ dataDir, runId: 'pause_boundary_run' });
  assert.equal(runtime.status, 'paused');
  assert.equal(runtime.activeStep, 'verify');
  assert.equal(runtime.progress.mine.status, 'completed');
  assert.equal(runtime.progress.verify.status, 'idle');
  assert.ok(readRuntimeEvents({ dataDir, runId: 'pause_boundary_run' }).some(event => {
    return event.event === 'status' && event.status === 'paused';
  }));
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test skills/pipeline-flow/test/runtime.test.js
```

Expected: FAIL because pause requests are ignored.

- [ ] **Step 3: Import new store helpers**

In `skills/pipeline-flow/runtime/runner.js`, change the runtime store import to include `clearRuntimeControl`:

```js
const {
  assertRuntimeRunId,
  initRuntimeState,
  updateRuntimeState,
  readRuntimeState,
  readRuntimeControl,
  clearRuntimeControl,
  appendRuntimeEvent
} = require('./store');
```

- [ ] **Step 4: Add progress reset helpers**

Add these helpers above `runPipelineRuntime()`:

```js
function idleProgress() {
  return { status: 'idle', current: 0, total: 0, percent: 0, message: '' };
}

function completedProgress(message = '完成') {
  return { status: 'completed', current: 1, total: 1, percent: 100, message };
}

function resetProgressFromStep(progress, steps, startStep) {
  const startIndex = steps.indexOf(startStep);
  if (startIndex < 0) return progress || {};
  return steps.reduce((memo, step, index) => {
    memo[step] = index >= startIndex ? idleProgress() : (progress?.[step] || completedProgress());
    return memo;
  }, {});
}
```

- [ ] **Step 5: Handle pause control after each completed step**

Inside `runPipelineRuntime()`, replace the existing `const control = readRuntimeControl({ dataDir, runId }); if (control.requestedAction === 'cancel') { ... }` block with:

```js
const control = readRuntimeControl({ dataDir, runId });
const nextStep = nextStepAfter(steps, step);
if (control.requestedAction === 'cancel') {
  updateRuntimeState({
    dataDir,
    runId,
    patch: {
      status: 'cancelled',
      requestedAction: 'cancel',
      activeStep: nextStep
    }
  });
  appendRuntimeEvent({
    dataDir,
    runId,
    event: { event: 'status', status: 'cancelled', reason: control.reason || '' }
  });
  return { runId, runDir, status: 'cancelled', runtimeStatus: 'cancelled' };
}

if (control.requestedAction === 'pause') {
  clearRuntimeControl({ dataDir, runId });
  updateRuntimeState({
    dataDir,
    runId,
    patch: {
      status: 'paused',
      requestedAction: 'pause',
      activeStep: nextStep
    }
  });
  appendRuntimeEvent({
    dataDir,
    runId,
    event: { event: 'status', status: 'paused', reason: control.reason || '' }
  });
  return { runId, runDir, status: 'paused', runtimeStatus: 'paused' };
}
```

- [ ] **Step 6: Ensure paused status is terminal**

Update `runtimeStatusForPipelineStatus()`:

```js
function runtimeStatusForPipelineStatus(pipelineStatus) {
  if (pipelineStatus === 'cancelled') return 'cancelled';
  if (pipelineStatus === 'paused') return 'paused';
  if (FAILED_PIPELINE_STATUSES.has(pipelineStatus)) return 'failed';
  if (BLOCKED_PIPELINE_STATUSES.has(pipelineStatus)) return 'blocked';
  if (REVIEW_PIPELINE_STATUSES.has(pipelineStatus)) return 'needs_review';
  return 'completed';
}
```

- [ ] **Step 7: Run runtime tests**

Run:

```bash
node --test skills/pipeline-flow/test/runtime.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add skills/pipeline-flow/runtime/runner.js skills/pipeline-flow/test/runtime.test.js
git commit -m "feat: pause pipeline runtime at step boundaries"
```

---

### Task 3: Runner Resume and Retry-Step

**Files:**
- Modify: `skills/pipeline-flow/runtime/runner.js`
- Test: `skills/pipeline-flow/test/runtime.test.js`

- [ ] **Step 1: Write failing resume test**

Append this test inside `describe('pipeline runtime runner', () => { ... })`:

```js
it('resumes a paused run from the stored active step without rerunning completed steps', async () => {
  const dataDir = tempDataDir();
  const firstCalls = [];
  await runPipelineRuntime({
    dataDir,
    runId: 'resume_run',
    mode: 'daily',
    params: {},
    steps: ['mine', 'verify', 'generate'],
    stepFns: {
      mine: async ({ reportProgress, runId }) => {
        firstCalls.push('mine');
        reportProgress({ current: 1, total: 1, message: 'mine done' });
        requestRuntimePause({ dataDir, runId, reason: 'pause_before_verify' });
        return { runId, runDir: path.join(dataDir, 'runs', runId), status: 'mined' };
      },
      verify: async () => {
        firstCalls.push('verify');
        throw new Error('verify should not run before resume');
      },
      generate: async () => {
        firstCalls.push('generate');
        throw new Error('generate should not run before resume');
      }
    }
  });

  const secondCalls = [];
  const result = await runPipelineRuntime({
    dataDir,
    runId: 'resume_run',
    mode: 'daily',
    params: {},
    preserveRuntime: true,
    resumeFromStep: 'verify',
    steps: ['mine', 'verify', 'generate'],
    stepFns: {
      mine: async () => {
        secondCalls.push('mine');
        throw new Error('mine should not rerun on resume');
      },
      verify: async ({ reportProgress }) => {
        secondCalls.push('verify');
        reportProgress({ current: 1, total: 1, message: 'verify done' });
        return { status: 'verified' };
      },
      generate: async ({ reportProgress }) => {
        secondCalls.push('generate');
        reportProgress({ current: 1, total: 1, message: 'generate done' });
        return { status: 'generated' };
      }
    }
  });

  assert.deepEqual(firstCalls, ['mine']);
  assert.deepEqual(secondCalls, ['verify', 'generate']);
  assert.equal(result.runtimeStatus, 'completed');
  const runtime = readRuntimeState({ dataDir, runId: 'resume_run' });
  assert.equal(runtime.status, 'completed');
  assert.equal(runtime.progress.mine.status, 'completed');
  assert.equal(runtime.progress.verify.status, 'completed');
  assert.equal(runtime.progress.generate.status, 'completed');
});
```

- [ ] **Step 2: Write failing retry-step test**

Append this test inside `describe('pipeline runtime runner', () => { ... })`:

```js
it('retries a selected step and resets downstream progress', async () => {
  const dataDir = tempDataDir();
  await runPipelineRuntime({
    dataDir,
    runId: 'retry_step_run',
    mode: 'daily',
    params: {},
    steps: ['mine', 'verify', 'generate'],
    stepFns: {
      mine: async () => ({ status: 'mined' }),
      verify: async () => ({ status: 'verified' }),
      generate: async () => ({ status: 'generated' })
    }
  });

  const calls = [];
  const result = await runPipelineRuntime({
    dataDir,
    runId: 'retry_step_run',
    mode: 'daily',
    params: {},
    preserveRuntime: true,
    retryStep: 'verify',
    steps: ['mine', 'verify', 'generate'],
    stepFns: {
      mine: async () => {
        calls.push('mine');
        throw new Error('mine should not rerun when retrying verify');
      },
      verify: async ({ reportProgress }) => {
        calls.push('verify');
        reportProgress({ current: 1, total: 1, message: 'verify retried' });
        return { status: 'verified' };
      },
      generate: async ({ reportProgress }) => {
        calls.push('generate');
        reportProgress({ current: 1, total: 1, message: 'generate rerun' });
        return { status: 'generated' };
      }
    }
  });

  assert.deepEqual(calls, ['verify', 'generate']);
  assert.equal(result.runtimeStatus, 'completed');
  const runtime = readRuntimeState({ dataDir, runId: 'retry_step_run' });
  assert.equal(runtime.status, 'completed');
  assert.equal(runtime.progress.mine.status, 'completed');
  assert.equal(runtime.progress.verify.status, 'completed');
  assert.equal(runtime.progress.generate.status, 'completed');
});
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
node --test skills/pipeline-flow/test/runtime.test.js
```

Expected: FAIL because resume and retry options are ignored and runtime is reinitialized.

- [ ] **Step 4: Determine start step from runtime/options**

In `runPipelineRuntime()`, after `const stepFns = ...`, add:

```js
const existingRuntime = options.preserveRuntime
  ? readRuntimeState({ dataDir, runId })
  : null;
const startStep = options.retryStep || options.resumeFromStep || existingRuntime?.activeStep || steps[0];
const startIndex = Math.max(0, steps.indexOf(startStep));
const stepsToRun = steps.slice(startIndex);
```

- [ ] **Step 5: Initialize or reuse runtime state**

Replace:

```js
initRuntimeState({ dataDir, runId, steps });
appendRuntimeEvent({
  dataDir,
  runId,
  event: { event: 'status', status: 'running', step: steps[0] || '' }
});
```

with:

```js
if (existingRuntime) {
  clearRuntimeControl({ dataDir, runId });
  const progress = options.retryStep
    ? resetProgressFromStep(existingRuntime.progress || {}, steps, options.retryStep)
    : (existingRuntime.progress || {});
  updateRuntimeState({
    dataDir,
    runId,
    patch: {
      status: options.retryStep ? 'retrying' : 'resuming',
      activeStep: startStep,
      requestedAction: null,
      progress
    }
  });
} else {
  initRuntimeState({ dataDir, runId, steps });
}
appendRuntimeEvent({
  dataDir,
  runId,
  event: { event: 'status', status: existingRuntime ? (options.retryStep ? 'retrying' : 'resuming') : 'running', step: startStep || '' }
});
```

- [ ] **Step 6: Iterate over stepsToRun**

Change:

```js
for (const step of steps) {
```

to:

```js
for (const step of stepsToRun) {
```

- [ ] **Step 7: Mark completed steps with helper**

Replace the progress patch after a successful step:

```js
progress: {
  [step]: { status: 'completed', current: 1, total: 1, percent: 100, message: '完成' }
}
```

with:

```js
progress: {
  [step]: completedProgress()
}
```

- [ ] **Step 8: Run runtime tests**

Run:

```bash
node --test skills/pipeline-flow/test/runtime.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add skills/pipeline-flow/runtime/runner.js skills/pipeline-flow/test/runtime.test.js
git commit -m "feat: resume and retry pipeline runtime steps"
```

---

### Task 4: Production Pipeline Recovery APIs

**Files:**
- Modify: `bin/server.js`
- Test: `test/workflow-api-recovery.test.js`

- [ ] **Step 1: Add failing API tests**

In `test/workflow-api-recovery.test.js`, add a new test block that starts the existing server app and calls production endpoints with a uniquely named pipeline run. Use the same server bootstrap pattern already in this file.

Append this test inside the existing API suite:

```js
await t.test('production pipeline pause resume and retry endpoints', async () => {
  const runId = 'api_pipeline_recovery_run';
  const baseUrl = `http://127.0.0.1:${port}`;
  const {
    initRuntimeState,
    readRuntimeState,
    updateRuntimeState
  } = require('../skills/pipeline-flow/runtime/store');
  const pipelineDataDir = path.join(process.cwd(), 'data', 'pipeline');
  const runDir = path.join(pipelineDataDir, 'runs', runId);
  fs.rmSync(runDir, { recursive: true, force: true });
  initRuntimeState({
    dataDir: pipelineDataDir,
    runId,
    steps: ['mine', 'verify', 'generate', 'export', 'review']
  });
  const originalRunner = app.locals.pipelineRuntimeRunner;
  const runnerCalls = [];
  app.locals.pipelineRuntimeRunner = async (options) => {
    runnerCalls.push(options);
    updateRuntimeState({
      dataDir: pipelineDataDir,
      runId: options.runId,
      patch: {
        status: 'completed',
        activeStep: options.retryStep || options.resumeFromStep || 'mine'
      }
    });
    return { runId: options.runId, status: 'completed', runtimeStatus: 'completed' };
  };

  try {
    const pauseRes = await fetch(`${baseUrl}/api/pipeline/runs/${runId}/pause`, { method: 'POST' });
    const pausePayload = await pauseRes.json();
    assert.equal(pausePayload.ok, true);
    assert.equal(pausePayload.data.control.requestedAction, 'pause');

    const retryRes = await fetch(`${baseUrl}/api/pipeline/runs/${runId}/verify/retry`, { method: 'POST' });
    const retryPayload = await retryRes.json();
    assert.equal(retryPayload.ok, true);
    assert.equal(retryPayload.data.control.requestedAction, 'retry-step');
    assert.equal(retryPayload.data.control.step, 'verify');

    const resumeRes = await fetch(`${baseUrl}/api/pipeline/runs/${runId}/resume`, { method: 'POST' });
    const resumePayload = await resumeRes.json();
    assert.equal(resumePayload.ok, true);
    assert.equal(resumePayload.data.control.requestedAction, 'resume');

    const runtime = readRuntimeState({ dataDir: pipelineDataDir, runId });
    assert.ok(runtime);
    assert.equal(runnerCalls.length, 2);
    assert.equal(runnerCalls[0].retryStep, 'verify');
    assert.equal(runnerCalls[1].resumeFromStep, 'verify');
  } finally {
    app.locals.pipelineRuntimeRunner = originalRunner;
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run failing API test**

Run:

```bash
node --test test/workflow-api-recovery.test.js
```

Expected: FAIL because production pause/resume/retry endpoints do not exist.

- [ ] **Step 3: Import runtime controls**

In `bin/server.js`, extend the runtime store import:

```js
const {
  readRuntimeState,
  requestRuntimeCancel,
  requestRuntimePause,
  requestRuntimeResume,
  requestRuntimeRetryStep
} = require('../skills/pipeline-flow/runtime/store');
```

- [ ] **Step 4: Add endpoint helper**

Add these helpers near `withPipelineRuntimeFields()`:

```js
function getPipelineRuntimeRunner() {
  return app.locals.pipelineRuntimeRunner || runPipelineRuntime;
}

function pipelineRunResponse(runId, extra = {}) {
  return {
    ...extra,
    runId,
    runtime: readRuntimeState({ runId }),
    currentRun: withPipelineRuntimeFields(summarizePipelineRun({ runId }))
  };
}
```

- [ ] **Step 5: Add production control endpoints**

Add these routes before the existing generic `/api/pipeline/runs/:runId/:step` route. This order matters because Express would otherwise treat `pause` or `resume` as `:step`.

```js
app.post('/api/pipeline/runs/:runId/pause', (req, res) => {
  const runId = req.params.runId;
  if (!isValidWorkflowRunIdParam(runId)) {
    return res.status(400).json({ ok: false, error: '无效的运行 ID。' });
  }
  try {
    const control = requestRuntimePause({
      runId,
      reason: req.body?.reason || 'user_paused'
    });
    res.json({ ok: true, data: pipelineRunResponse(runId, { control }) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/pipeline/runs/:runId/resume', async (req, res) => {
  const runId = req.params.runId;
  if (!isValidWorkflowRunIdParam(runId)) {
    return res.status(400).json({ ok: false, error: '无效的运行 ID。' });
  }
  if (activeWorkbenchProcess) {
    return res.status(409).json({ ok: false, error: '已有工作流正在运行，请等待完成后再继续。' });
  }
  try {
    const runtime = readRuntimeState({ runId });
    if (!runtime) return res.status(404).json({ ok: false, error: '未找到该流程运行记录' });
    const control = requestRuntimeResume({ runId });
    const promise = getPipelineRuntimeRunner()({
      runId,
      mode: runtime.steps?.includes('keyword') ? 'keyword' : 'daily',
      preserveRuntime: true,
      resumeFromStep: runtime.activeStep,
      steps: runtime.steps
    });
    const runState = { runId, mode: 'resume', promise };
    activeWorkbenchProcess = runState;
    promise.finally(() => {
      if (activeWorkbenchProcess === runState) activeWorkbenchProcess = null;
    });
    res.json({ ok: true, data: pipelineRunResponse(runId, { control }) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/pipeline/runs/:runId/:step/retry', async (req, res) => {
  const runId = req.params.runId;
  const step = String(req.params.step || '');
  if (!isValidWorkflowRunIdParam(runId)) {
    return res.status(400).json({ ok: false, error: '无效的运行 ID。' });
  }
  if (!['mine', 'verify', 'generate', 'export'].includes(step)) {
    return res.status(400).json({ ok: false, error: '不支持的流程步骤。' });
  }
  if (activeWorkbenchProcess) {
    return res.status(409).json({ ok: false, error: '已有工作流正在运行，请等待完成后再重试。' });
  }
  try {
    const runtime = readRuntimeState({ runId });
    if (!runtime) return res.status(404).json({ ok: false, error: '未找到该流程运行记录' });
    const control = requestRuntimeRetryStep({ runId, step });
    const promise = getPipelineRuntimeRunner()({
      runId,
      mode: runtime.steps?.includes('keyword') ? 'keyword' : 'daily',
      preserveRuntime: true,
      retryStep: step,
      steps: runtime.steps
    });
    const runState = { runId, mode: 'retry-step', promise };
    activeWorkbenchProcess = runState;
    promise.finally(() => {
      if (activeWorkbenchProcess === runState) activeWorkbenchProcess = null;
    });
    res.json({ ok: true, data: pipelineRunResponse(runId, { control }) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

- [ ] **Step 6: Keep legacy workflow endpoints unchanged**

Do not remove these existing routes:

```js
POST /api/workflows/runs/:runId/pause
POST /api/workflows/runs/:runId/resume
POST /api/workflows/runs/:runId/retry-node
```

They are still needed for legacy file-backed workflow runs whose ids start with `run_`.

- [ ] **Step 7: Run API tests**

Run:

```bash
node --test test/workflow-api-recovery.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add bin/server.js test/workflow-api-recovery.test.js
git commit -m "feat: expose pipeline runtime recovery APIs"
```

---

### Task 5: Canvas State Mapping and Web Controls

**Files:**
- Modify: `core/workflow/pipeline-adapter.js`
- Modify: `apps/web/src/WorkflowStudio.jsx`
- Modify: `apps/web/src/workflow-ui.js`
- Test: `core/test/workflow-pipeline-adapter.test.js`
- Test: `apps/web/src/workflow-ui.test.mjs`

- [ ] **Step 1: Write failing adapter tests**

In `core/test/workflow-pipeline-adapter.test.js`, add a case near the runtime progress tests:

```js
it('maps paused runtime state to the active pipeline node', () => {
  const dataDir = tempPipelineDir();
  const runId = 'paused_runtime_run';
  const runDir = path.join(dataDir, 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  writeJson(path.join(runDir, 'run.json'), {
    runId,
    status: 'mined',
    options: {}
  });
  writeJson(path.join(runDir, 'runtime.json'), {
    status: 'paused',
    activeStep: WORKFLOW_NODE_IDS.verify,
    steps: ['mine', 'verify', 'generate', 'export', 'review'],
    progress: {
      mine: { status: 'completed', current: 1, total: 1, percent: 100, message: '完成' },
      verify: { status: 'paused', current: 0, total: 0, percent: 0, message: '已暂停' }
    }
  });

  const run = getWorkflowRun({ dataDir, runId });

  assert.equal(run.nodeStates.verify.status, 'paused');
  assert.equal(run.nodeStates.verify.progress.status, 'paused');
  assert.equal(run.status, 'paused');
});
```

- [ ] **Step 2: Run failing adapter test**

Run:

```bash
node --test core/test/workflow-pipeline-adapter.test.js
```

Expected: FAIL if top-level status or active node mapping does not reflect runtime paused state.

- [ ] **Step 3: Map runtime status in adapter**

In `core/workflow/pipeline-adapter.js`, update `nodeStatusFromRuntimeProgress()` to keep `resuming` and `retrying` visible as running:

```js
if (status === 'resuming' || status === 'retrying') return 'running';
```

In `buildNodeStates(summary)`, after reading `runtime`, add:

```js
if (runtime && runtime.status === 'paused' && runtime.activeStep && states[runtime.activeStep]) {
  states[runtime.activeStep] = {
    ...states[runtime.activeStep],
    status: 'paused',
    progress: normalizeNodeProgress({
      ...(states[runtime.activeStep].progress || {}),
      status: 'paused',
      message: states[runtime.activeStep].progress?.message || '已暂停'
    })
  };
}
```

In the function that builds the returned workflow run object, set top-level `status` to `runtime.status` when `runtime.status` is one of `paused`, `resuming`, `retrying`, or `cancelled`.

- [ ] **Step 4: Update Web API routing**

In `apps/web/src/WorkflowStudio.jsx`, update `runWorkflowOperation()` endpoint selection:

```js
const shouldUsePipelineStep = (action === 'retry-node' || action === 'resume')
  && isPipelineRecoverableNode(targetNodeId)
  && !isLegacyWorkflowRun(currentRunId);
const endpoint = action === 'pause' && !isLegacyWorkflowRun(currentRunId)
  ? `/api/pipeline/runs/${currentRunId}/pause`
  : action === 'resume' && !isLegacyWorkflowRun(currentRunId)
    ? `/api/pipeline/runs/${currentRunId}/resume`
    : shouldUsePipelineStep && action === 'retry-node'
      ? `/api/pipeline/runs/${currentRunId}/${targetNodeId}/retry`
      : shouldUsePipelineStep
        ? `/api/pipeline/runs/${currentRunId}/resume`
        : (action === 'retry-node'
            ? `/api/workflows/runs/${currentRunId}/retry-node`
            : `/api/workflows/runs/${currentRunId}/${action}`);
```

Update the body:

```js
body: action === 'retry-node' && !shouldUsePipelineStep
  ? JSON.stringify({ nodeId: targetNodeId })
  : '{}'
```

Change pause button visibility from legacy-only to all active production/legacy runs:

```js
const canPauseRun = Boolean(currentRunId) && runStatus === 'running';
```

- [ ] **Step 5: Add Web action tests**

In `apps/web/src/workflow-ui.test.mjs`, extend the existing action test:

```js
assert.deepEqual(getWorkflowNodeAction('verify', 'paused'), {
  label: '继续流程',
  action: 'resume',
  tone: 'warn'
});
```

If `getWorkflowNodeAction()` currently returns the default for `paused`, add this branch in `apps/web/src/workflow-ui.js`:

```js
if (normalizedState === 'paused') {
  return { label: '继续流程', action: 'resume', tone: 'warn' };
}
```

- [ ] **Step 6: Run adapter and UI tests**

Run:

```bash
node --test core/test/workflow-pipeline-adapter.test.js apps/web/src/workflow-ui.test.mjs
npm run web:build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add core/workflow/pipeline-adapter.js apps/web/src/WorkflowStudio.jsx apps/web/src/workflow-ui.js apps/web/src/workflow-ui.test.mjs core/test/workflow-pipeline-adapter.test.js
git commit -m "feat: connect pipeline recovery controls to canvas"
```

---

### Task 6: Production Recovery Verification

**Files:**
- No source files unless a verification failure requires a fix.

- [ ] **Step 1: Run focused runtime and API tests**

Run:

```bash
node --test skills/pipeline-flow/test/runtime.test.js test/workflow-api-recovery.test.js core/test/workflow-pipeline-adapter.test.js apps/web/src/workflow-ui.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 2: Run Web build**

Run:

```bash
npm run web:build
```

Expected: Vite build completes successfully.

- [ ] **Step 3: Run core skills regression**

Run:

```bash
npm run test:core-skills
```

Expected: all tests PASS.

- [ ] **Step 4: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 5: Manual Web smoke test**

Start the app using the repo's normal Web command. If a dev server is already running, reuse it.

Open Workflow Studio and verify:

1. Start a production pipeline run.
2. Click `暂停`.
3. Confirm the current step finishes and the next node becomes `已暂停`.
4. Click the paused node and press `继续流程`.
5. Confirm the run continues from the paused node.
6. Force or load a failed/blocked run for `verify`, `generate`, or `export`.
7. Click `重试节点`.
8. Confirm the selected step and downstream steps rerun, while upstream completed steps remain completed.

- [ ] **Step 6: Commit verification-only fixes if needed**

If any command fails and a fix is required:

```bash
git add <changed-files>
git commit -m "fix: stabilize pipeline runtime recovery"
```

If no code changes are needed, do not create a commit.

---

## Self-Review

**Spec coverage:** This plan covers store controls, runner pause/resume/retry, production APIs, canvas state mapping, Web controls, and verification.

**Placeholder scan:** No placeholder tasks remain. Every task names concrete files, code, tests, commands, and expected results.

**Type consistency:** Control action names are consistent: `pause`, `resume`, `retry-step`, and `cancel`. Web action names remain `pause`, `resume`, and `retry-node`, with production retry routed to `/api/pipeline/runs/:runId/:step/retry`.

**Risk notes for implementers:**
- Do not reinitialize `runtime.json` on resume or retry.
- Cancel must stay higher priority than pause.
- Pause must stop only at safe step boundaries.
- Retry must reset the target step and all downstream steps, not upstream completed steps.
- Legacy workflow APIs must remain available because the project now has both legacy workflow runs and production pipeline runs.
