# Workflow Progress And Cancel Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real per-step workflow progress and safe cancellation for production WorkflowStudio runs.

**Architecture:** Keep `data/pipeline/runs/<runId>/` as the source of truth. Introduce a small runtime layer that writes `runtime` state and `workflow-events.jsonl`, runs existing `flowMine` / `flowVerify` / `flowGenerate` / `flowExport` step-by-step inside the server process, and lets the UI subscribe through the existing SSE endpoint. Cancellation is application-level: requested in a control file, checked between safe step boundaries, and persisted as `cancelled`.

**Tech Stack:** Node.js CommonJS, Express, `node:test`, React + Vite, React Flow, file-backed runtime state.

---

## Scope

Implement now:

- Per-step progress and node state for `mine`, `verify`, `generate`, `export`, and `review`.
- A production workflow runtime that can return a `runId` immediately.
- `POST /api/workflows/runs/:runId/cancel`.
- SSE progress events from `workflow-events.jsonl`.
- Frontend progress display and cancel button.

Do not implement now:

- Full pause/resume checkpoint recovery.
- OS-level process pause.
- Distribution submit.
- Arbitrary graph execution.

## File Structure

- Create `skills/pipeline-flow/runtime/store.js`: file helpers for runtime state, control requests, and event appends.
- Create `skills/pipeline-flow/runtime/runner.js`: step-by-step runtime runner that calls existing pipeline-flow step functions.
- Create `skills/pipeline-flow/test/runtime.test.js`: runtime store and runner unit tests with stub step functions.
- Modify `skills/pipeline-flow/index.js`: export the existing step functions if not already exported, and export runtime runner helpers.
- Modify `core/workflow/pipeline-adapter.js`: include runtime progress/events in workflow run summaries and node states.
- Modify `core/test/workflow-pipeline-adapter.test.js`: progress mapping tests.
- Modify `bin/server.js`: start runtime runner instead of spawning whole-flow CLI for `/api/workflows/run`; implement cancel route and SSE progress event replay.
- Modify `apps/web/src/workflow-ui.js` and `apps/web/src/workflow-ui.test.mjs`: progress display helpers.
- Modify `apps/web/src/WorkflowStudio.jsx` and `apps/web/src/App.css`: progress bars, cancel button, progress log rendering.

---

### Task 1: Runtime Store

**Files:**
- Create: `skills/pipeline-flow/runtime/store.js`
- Create: `skills/pipeline-flow/test/runtime.test.js`

- [ ] **Step 1: Write failing tests for runtime store**

Create `skills/pipeline-flow/test/runtime.test.js`:

```js
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
  readRuntimeEvents
} = require('./runtime/store');

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

    appendRuntimeEvent({ dataDir, runId: 'run_3', event: { event: 'progress', step: 'mine', percent: 10 } });
    appendRuntimeEvent({ dataDir, runId: 'run_3', event: { event: 'progress', step: 'mine', percent: 100 } });

    assert.deepEqual(readRuntimeEvents({ dataDir, runId: 'run_3' }).map(event => event.percent), [10, 100]);
  });

  it('rejects unsafe run ids', () => {
    const dataDir = tempDataDir();
    assert.throws(() => initRuntimeState({ dataDir, runId: '../bad', steps: ['mine'] }), /Invalid runtime run id/);
    assert.throws(() => requestRuntimeCancel({ dataDir, runId: '../bad' }), /Invalid runtime run id/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test skills/pipeline-flow/test/runtime.test.js
```

Expected: fails because `./runtime/store` does not exist.

- [ ] **Step 3: Implement runtime store**

Create `skills/pipeline-flow/runtime/store.js`:

```js
'use strict';

const fs = require('fs');
const path = require('path');
const { DEFAULT_FLOW_DIR } = require('../index');

const RUN_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function assertRuntimeRunId(runId) {
  if (!RUN_ID_PATTERN.test(String(runId || ''))) throw new Error('Invalid runtime run id');
}

function runDir(dataDir, runId) {
  assertRuntimeRunId(runId);
  return path.join(dataDir || DEFAULT_FLOW_DIR, 'runs', runId);
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

function runtimeFile(dataDir, runId) {
  return path.join(runDir(dataDir, runId), 'runtime.json');
}

function controlFile(dataDir, runId) {
  return path.join(runDir(dataDir, runId), 'runtime-control.json');
}

function eventsFile(dataDir, runId) {
  return path.join(runDir(dataDir, runId), 'workflow-events.jsonl');
}

function createProgress(steps) {
  return Object.fromEntries(steps.map(step => [
    step,
    { status: 'idle', current: 0, total: 0, percent: 0, message: '' }
  ]));
}

function initRuntimeState({ dataDir, runId, steps }) {
  const now = new Date().toISOString();
  const runtime = {
    status: 'running',
    activeStep: steps[0] || '',
    requestedAction: null,
    steps,
    progress: createProgress(steps),
    startedAt: now,
    updatedAt: now
  };
  writeJson(runtimeFile(dataDir, runId), runtime);
  writeJson(controlFile(dataDir, runId), { requestedAction: null, updatedAt: now });
  return runtime;
}

function readRuntimeState({ dataDir, runId }) {
  return readJson(runtimeFile(dataDir, runId), null);
}

function updateRuntimeState({ dataDir, runId, patch }) {
  const current = readRuntimeState({ dataDir, runId }) || {};
  const next = {
    ...current,
    ...patch,
    progress: {
      ...(current.progress || {}),
      ...(patch.progress || {})
    },
    updatedAt: new Date().toISOString()
  };
  writeJson(runtimeFile(dataDir, runId), next);
  return next;
}

function requestRuntimeCancel({ dataDir, runId, reason = 'user_cancelled' }) {
  const control = {
    requestedAction: 'cancel',
    reason,
    updatedAt: new Date().toISOString()
  };
  writeJson(controlFile(dataDir, runId), control);
  return control;
}

function readRuntimeControl({ dataDir, runId }) {
  return readJson(controlFile(dataDir, runId), { requestedAction: null });
}

function appendRuntimeEvent({ dataDir, runId, event }) {
  const file = eventsFile(dataDir, runId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = { ...event, timestamp: event.timestamp || new Date().toISOString(), runId };
  fs.appendFileSync(file, JSON.stringify(payload) + '\n', 'utf8');
  return payload;
}

function readRuntimeEvents({ dataDir, runId }) {
  const file = eventsFile(dataDir, runId);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

module.exports = {
  assertRuntimeRunId,
  initRuntimeState,
  readRuntimeState,
  updateRuntimeState,
  requestRuntimeCancel,
  readRuntimeControl,
  appendRuntimeEvent,
  readRuntimeEvents
};
```

- [ ] **Step 4: Run runtime store test**

Run:

```bash
node --test skills/pipeline-flow/test/runtime.test.js
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add skills/pipeline-flow/runtime/store.js skills/pipeline-flow/test/runtime.test.js
git commit -m "feat: add pipeline runtime store"
```

---

### Task 2: Step Runtime Runner

**Files:**
- Create: `skills/pipeline-flow/runtime/runner.js`
- Modify: `skills/pipeline-flow/test/runtime.test.js`
- Modify: `skills/pipeline-flow/index.js`

- [ ] **Step 1: Add failing runner tests**

Append to `skills/pipeline-flow/test/runtime.test.js`:

```js
const { runPipelineRuntime } = require('./runtime/runner');

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
        return { runId: 'runtime_run', runDir: path.join(dataDir, 'runs', 'runtime_run'), candidates: [{ keyword: 'a' }, { keyword: 'b' }] };
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test skills/pipeline-flow/test/runtime.test.js
```

Expected: fails because `./runtime/runner` does not exist.

- [ ] **Step 3: Implement runner**

Create `skills/pipeline-flow/runtime/runner.js`:

```js
'use strict';

const path = require('path');
const { createRunId, DEFAULT_FLOW_DIR, flowMine, flowVerify, flowGenerate, flowExport, flowKeyword } = require('../index');
const {
  initRuntimeState,
  updateRuntimeState,
  readRuntimeControl,
  appendRuntimeEvent
} = require('./store');

const DEFAULT_STEPS = ['mine', 'verify', 'generate', 'export', 'review'];

function percent(current, total) {
  if (!total) return current > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}

function createReporter({ dataDir, runId, step }) {
  return ({ current = 0, total = 0, message = '' }) => {
    const payload = {
      status: 'running',
      current,
      total,
      percent: percent(current, total),
      message
    };
    updateRuntimeState({ dataDir, runId, patch: { activeStep: step, progress: { [step]: payload } } });
    appendRuntimeEvent({ dataDir, runId, event: { event: 'progress', step, ...payload } });
  };
}

async function runPipelineRuntime(options = {}) {
  const dataDir = options.dataDir || DEFAULT_FLOW_DIR;
  const steps = options.steps || DEFAULT_STEPS;
  const params = options.params || {};
  const mode = options.mode || 'daily';
  const runId = options.runId || createRunId();
  const runDir = path.join(dataDir, 'runs', runId);
  const stepFns = options.stepFns || {
    mine: async ({ reportProgress }) => {
      reportProgress({ current: 0, total: params.mine || params.limit || 50, message: '开始挖词' });
      return flowMine({ ...params, dataDir, runId, limit: params.mine || params.limit || 50 });
    },
    verify: async ({ reportProgress }) => {
      reportProgress({ current: 0, total: params.verify || 20, message: '开始验真' });
      return flowVerify({ ...params, dataDir, runId, limit: params.verify || 20 });
    },
    generate: async ({ reportProgress }) => {
      reportProgress({ current: 0, total: params.generate || 10, message: '开始生成标题货源' });
      return flowGenerate({ ...params, dataDir, runId, limit: params.generate || 10 });
    },
    export: async ({ reportProgress }) => {
      reportProgress({ current: 0, total: params.export || 20, message: '开始导出清单' });
      return flowExport({ ...params, dataDir, runId, limit: params.export || 20 });
    },
    review: async ({ reportProgress }) => {
      reportProgress({ current: 1, total: 1, message: '等待人工复核' });
      return { status: 'needs_review' };
    },
    keyword: async ({ reportProgress }) => {
      reportProgress({ current: 0, total: 1, message: '开始精确关键词流程' });
      return flowKeyword({ ...params, dataDir, runId, keyword: params.keyword });
    }
  };

  initRuntimeState({ dataDir, runId, steps });
  appendRuntimeEvent({ dataDir, runId, event: { event: 'status', status: 'running', step: steps[0] || '' } });

  let lastResult = { runId, runDir, status: 'running' };
  try {
    const runnableSteps = mode === 'keyword' && !options.stepFns ? ['keyword'] : steps;
    for (const step of runnableSteps) {
      updateRuntimeState({
        dataDir,
        runId,
        patch: {
          status: 'running',
          activeStep: step,
          progress: { [step]: { status: 'running', current: 0, total: 0, percent: 0, message: '' } }
        }
      });
      appendRuntimeEvent({ dataDir, runId, event: { event: 'step_started', step, status: 'running' } });

      const fn = stepFns[step];
      if (!fn) throw new Error(`Unknown runtime step: ${step}`);
      lastResult = await fn({
        dataDir,
        runId,
        runDir,
        params,
        reportProgress: createReporter({ dataDir, runId, step })
      });

      updateRuntimeState({
        dataDir,
        runId,
        patch: {
          progress: { [step]: { status: 'completed', current: 1, total: 1, percent: 100, message: '完成' } }
        }
      });
      appendRuntimeEvent({ dataDir, runId, event: { event: 'step_completed', step, status: 'completed' } });

      const control = readRuntimeControl({ dataDir, runId });
      if (control.requestedAction === 'cancel') {
        updateRuntimeState({ dataDir, runId, patch: { status: 'cancelled', activeStep: steps[steps.indexOf(step) + 1] || step } });
        appendRuntimeEvent({ dataDir, runId, event: { event: 'status', status: 'cancelled', reason: control.reason || '' } });
        return { runId, runDir, status: 'cancelled' };
      }

      if (lastResult && ['verified_empty', 'manual_action_required', 'verified_partial_manual_required', 'generate_failed', 'needs_review', 'ready_to_distribute'].includes(lastResult.status)) {
        break;
      }
    }
    updateRuntimeState({ dataDir, runId, patch: { status: lastResult.status === 'cancelled' ? 'cancelled' : 'completed' } });
    appendRuntimeEvent({ dataDir, runId, event: { event: 'status', status: 'completed' } });
    return { ...lastResult, runId, runDir };
  } catch (error) {
    updateRuntimeState({ dataDir, runId, patch: { status: 'failed', error: error.message } });
    appendRuntimeEvent({ dataDir, runId, event: { event: 'status', status: 'failed', error: error.message } });
    throw error;
  }
}

module.exports = {
  runPipelineRuntime
};
```

- [ ] **Step 4: Export runtime helpers from `skills/pipeline-flow/index.js`**

At the bottom of `skills/pipeline-flow/index.js`, add exports without removing existing exports:

```js
  runPipelineRuntime: require('./runtime/runner').runPipelineRuntime
```

If adding this inline creates circular import issues, do not export runner from `index.js`; server can require `skills/pipeline-flow/runtime/runner` directly. Keep existing step function exports available.

- [ ] **Step 5: Run runtime tests**

Run:

```bash
node --test skills/pipeline-flow/test/runtime.test.js
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add skills/pipeline-flow/runtime/runner.js skills/pipeline-flow/test/runtime.test.js skills/pipeline-flow/index.js
git commit -m "feat: add step-based pipeline runtime"
```

---

### Task 3: Workflow Runtime API

**Files:**
- Modify: `bin/server.js`
- Modify: `core/workflow/pipeline-adapter.js`
- Modify: `core/test/workflow-pipeline-adapter.test.js`

- [ ] **Step 1: Add adapter progress mapping tests**

Append to `core/test/workflow-pipeline-adapter.test.js`:

```js
it('maps runtime progress onto workflow node states', () => {
  const run = pipelineSummaryToWorkflowRun({
    runId: 'runtime_progress',
    status: 'mined',
    stage: 'mined',
    runtime: {
      status: 'running',
      activeStep: 'verify',
      progress: {
        verify: { status: 'running', current: 3, total: 10, percent: 30, message: '验真 3/10' }
      }
    }
  });

  assert.equal(run.runtime.status, 'running');
  assert.equal(run.nodeStates.verify.status, 'running');
  assert.equal(run.nodeStates.verify.progress.percent, 30);
  assert.equal(run.nodeStates.verify.progress.message, '验真 3/10');
});
```

- [ ] **Step 2: Update adapter to include runtime**

In `core/workflow/pipeline-adapter.js`, read `runtime.json` from the run dir inside `getWorkflowRun` and `pipelineSummaryToWorkflowRun`:

```js
function readWorkflowRuntime({ dataDir = DEFAULT_PIPELINE_DIR, runId } = {}) {
  const file = path.join(workflowRunDir(dataDir, runId), 'runtime.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
```

Then attach:

```js
const runtime = summary.runtime || null;
...
runtime,
```

And when building each node state:

```js
const progress = runtime?.progress?.[node.id] || runtime?.progress?.[node.data?.stage] || null;
if (progress) {
  nodeStates[node.id].status = progress.status || nodeStates[node.id].status;
  nodeStates[node.id].progress = progress;
}
```

- [ ] **Step 3: Modify `/api/workflows/run` to use runtime runner**

In `bin/server.js`, import:

```js
const { runPipelineRuntime } = require('../skills/pipeline-flow/runtime/runner');
const { requestRuntimeCancel, readRuntimeEvents } = require('../skills/pipeline-flow/runtime/store');
```

Replace the spawn block in `/api/workflows/run` with:

```js
const runId = createRunId();
const runState = { pid: null, mode: launch.mode, runId, promise: null };
activeWorkbenchProcess = runState;

runState.promise = runPipelineRuntime({
  runId,
  mode: launch.mode,
  params,
  steps: ['mine', 'verify', 'generate', 'export', 'review']
}).catch(err => {
  originalError(`[Workflow Runtime] ${launch.mode} failed, runId=${runId}:`, err.message);
}).finally(() => {
  if (activeWorkbenchProcess === runState) activeWorkbenchProcess = null;
});

res.json({
  ok: true,
  data: {
    status: 'started',
    runId,
    pid: null,
    mode: launch.mode,
    monitor: 'workflow',
    message: 'Workflow runtime 已启动，可在画布中查看步骤进度。'
  }
});
```

Also import `createRunId` from `skills/pipeline-flow`.

- [ ] **Step 4: Implement cancel route**

Replace cancel 501 handler:

```js
app.post('/api/workflows/runs/:runId/cancel', (req, res) => {
  try {
    const control = requestRuntimeCancel({
      runId: req.params.runId,
      reason: req.body?.reason || 'user_cancelled'
    });
    res.json({ ok: true, data: control });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});
```

Keep retry-node and resume as 501.

- [ ] **Step 5: Include runtime events in SSE**

In `/api/workflows/runs/:runId/events`, after init, replay recent `readRuntimeEvents({ runId })` events:

```js
readRuntimeEvents({ runId }).slice(-100).forEach(event => {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
});
```

In the polling loop, track event count and emit new events:

```js
let lastEventCount = readRuntimeEvents({ runId }).length;
...
const events = readRuntimeEvents({ runId });
events.slice(lastEventCount).forEach(event => res.write(`data: ${JSON.stringify(event)}\n\n`));
lastEventCount = events.length;
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --test skills/pipeline-flow/test/runtime.test.js core/test/workflow-pipeline-adapter.test.js test/workflow.test.js
node --check bin/server.js
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add bin/server.js core/workflow/pipeline-adapter.js core/test/workflow-pipeline-adapter.test.js
git commit -m "feat: run workflows with progress runtime"
```

---

### Task 4: Frontend Progress And Cancel Controls

**Files:**
- Modify: `apps/web/src/workflow-ui.js`
- Modify: `apps/web/src/workflow-ui.test.mjs`
- Modify: `apps/web/src/WorkflowStudio.jsx`
- Modify: `apps/web/src/App.css`

- [ ] **Step 1: Add UI helper tests**

Append to `apps/web/src/workflow-ui.test.mjs`:

```js
import { formatWorkflowProgressLabel } from './workflow-ui.js';

test('formatWorkflowProgressLabel describes progress safely', () => {
  assert.equal(formatWorkflowProgressLabel({ current: 3, total: 10, percent: 30 }), '3/10 · 30%');
  assert.equal(formatWorkflowProgressLabel({ percent: 0 }), '0%');
  assert.equal(formatWorkflowProgressLabel(null), '0%');
});
```

- [ ] **Step 2: Implement helper**

Add to `apps/web/src/workflow-ui.js`:

```js
export function formatWorkflowProgressLabel(progress = {}) {
  const current = Number(progress?.current || 0);
  const total = Number(progress?.total || 0);
  const percent = Number(progress?.percent || 0);
  if (total > 0) return `${current}/${total} · ${percent}%`;
  return `${percent}%`;
}
```

- [ ] **Step 3: Render node progress in `WorkflowStudio.jsx`**

In the production node renderer, add:

```jsx
{data.progress && (
  <div className="workflow-node-progress">
    <div className="workflow-node-progress-bar" style={{ width: `${Math.max(0, Math.min(100, data.progress.percent || 0))}%` }} />
  </div>
)}
{data.progress?.message && <div className="workflow-node-progress-label">{data.progress.message}</div>}
```

When syncing node states from SSE `init`, include `progress`:

```js
progress: state.progress || null
```

- [ ] **Step 4: Add cancel button**

Near the run button in `WorkflowStudio.jsx`, add:

```jsx
<button
  onClick={handleCancelWorkflow}
  disabled={!currentRunId || !['running', 'pending'].includes(runStatus)}
  className="px-4 py-2 rounded bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-sm font-bold flex items-center gap-2"
>
  <Square size={16} /> 取消
</button>
```

Update `handleCancelWorkflow`:

```js
const handleCancelWorkflow = async () => {
  if (!currentRunId) return;
  try {
    const res = await fetch(`/api/workflows/runs/${currentRunId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'user_cancelled' })
    });
    const payload = await res.json();
    if (payload.ok === false) throw new Error(payload.error || '取消失败');
    setLogs(prev => prev.concat({
      timestamp: new Date().toISOString(),
      level: 'warn',
      message: '已请求取消，当前步骤会在安全边界停止。'
    }));
  } catch (err) {
    setLogs(prev => prev.concat({
      timestamp: new Date().toISOString(),
      level: 'error',
      message: `取消失败: ${err.message}`
    }));
  }
};
```

- [ ] **Step 5: Handle SSE progress events**

In `listenToRunEvents`, add:

```js
} else if (data.event === 'progress') {
  const step = data.step;
  setNodes((nds) => nds.map((node) => {
    if (node.id !== step) return node;
    return {
      ...node,
      data: {
        ...node.data,
        status: data.status || 'running',
        progress: {
          current: data.current || 0,
          total: data.total || 0,
          percent: data.percent || 0,
          message: data.message || ''
        }
      }
    };
  }));
  setLogs((prev) => prev.concat({
    timestamp: data.timestamp || new Date().toISOString(),
    level: 'info',
    message: data.message || `${step} ${data.percent || 0}%`
  }));
```

- [ ] **Step 6: Add CSS**

Add to `apps/web/src/App.css`:

```css
.workflow-node-progress {
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.18);
  margin-top: 8px;
}

.workflow-node-progress-bar {
  height: 100%;
  border-radius: inherit;
  background: #38bdf8;
  transition: width 180ms ease;
}

.workflow-node-progress-label {
  margin-top: 5px;
  overflow: hidden;
  color: #93c5fd;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 7: Run frontend checks**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
npm run web:build
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/workflow-ui.js apps/web/src/workflow-ui.test.mjs apps/web/src/WorkflowStudio.jsx apps/web/src/App.css
git commit -m "feat: show workflow progress and cancel control"
```

---

### Task 5: Verification And Browser Smoke

**Files:**
- No planned source edits unless verification finds a bug.

- [ ] **Step 1: Run full focused tests**

Run:

```bash
node --test skills/pipeline-flow/test/runtime.test.js core/test/workflow-pipeline-adapter.test.js apps/web/src/workflow-ui.test.mjs test/workflow.test.js
npm run web:build
```

Expected: pass.

- [ ] **Step 2: Run project tests**

Run:

```bash
npm test
npm run test:core-skills
```

Expected: pass. If external API/browser credentials fail, record exact failure.

- [ ] **Step 3: Browser smoke**

Start:

```bash
node bin/server.js
```

Open local URL and verify:

- WorkflowStudio loads production templates.
- Running exact keyword with empty keyword is blocked before request.
- Running daily workflow returns a real `runId`.
- Nodes show progress bars after runtime events arrive.
- Cancel button sends request and produces a visible cancellation log.
- Right panel remains inside viewport.

- [ ] **Step 4: Commit verification fixes if needed**

If smoke reveals a fix:

```bash
git add <changed-files>
git commit -m "fix: polish workflow progress runtime"
```

- [ ] **Step 5: Push branch**

```bash
git push origin codex/executable-workflow-canvas
```

---

## Self-Review

Spec coverage:

- Per-step progress: Tasks 1, 2, 3, 4.
- Cancel: Tasks 1, 2, 3, 4.
- Continue/resume: intentionally deferred; this plan creates runtime state and control files but does not claim checkpoint resume.
- Existing flow integration: Task 2 calls `flowMine`, `flowVerify`, `flowGenerate`, and `flowExport`.
- UI interaction: Task 4.
- Verification: Task 5.

Intentional limitations:

- Cancellation is checked between steps in this first implementation. Fine-grained cancellation inside a single SYCM or GLM request needs a separate step-loop refactor after this runtime is stable.
- Pause/resume is not exposed until checkpoints are proven for `verify` and `generate`.
