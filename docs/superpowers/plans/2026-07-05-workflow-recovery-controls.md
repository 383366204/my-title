# Workflow Recovery Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make workflow runs recoverable from `waiting_manual`, `retryable`, `blocked`, and `paused` states through backend APIs and real Web controls.

**Architecture:** Keep the existing file-backed workflow runtime, but add a small recovery layer around `core/workflow/scheduler.js`. Recovery should reuse completed node outputs, reset only the selected failed/blocked node and its downstream dependents, and expose safe API operations for pause, resume, and retry.

**Tech Stack:** Node.js CommonJS, `node:test`, Express-style routes in `bin/server.js`, React/Vite, React Flow.

---

## File Structure

- Modify `core/workflow/run-store.js`
  - Add atomic-ish run mutation helpers around existing JSON store: `mutateRun`, `resetRunNodeForRetry`, and `markRunPaused`.
  - Keep file storage format backward compatible.
- Modify `core/workflow/scheduler.js`
  - Add `resumeWorkflow(runId, options)` and `retryWorkflowNode(runId, nodeId)`.
  - Make graph execution start from the first runnable non-completed node instead of always starting from roots.
  - Use `activeRuns` to prevent duplicate resume/retry.
- Modify `core/workflow/index.js`
  - Export the new recovery helpers.
- Modify `bin/server.js`
  - Replace placeholder `/api/workflows/runs/:runId/retry-node` and `/api/workflows/runs/:runId/resume`.
  - Add `/api/workflows/runs/:runId/pause`.
- Modify `apps/web/src/WorkflowStudio.jsx`
  - Convert node action hints into real buttons for pause/resume/retry.
  - Refresh run state after operations and keep SSE behavior.
- Modify `apps/web/src/workflow-ui.js`
  - Add deterministic action metadata for `resume`, `retry`, `pause`, and disabled states.
- Modify `apps/web/src/workflow-ui.test.mjs`
  - Cover action selection logic.
- Modify `test/workflow.test.js`
  - Cover resume from paused run and retry from failed/blocked node.
- Modify `test/workflow-observability.test.js`
  - Extend platform-blocked recovery coverage.

---

### Task 1: Store-Level Recovery Helpers

**Files:**
- Modify: `core/workflow/run-store.js`
- Test: `test/workflow.test.js`

- [ ] **Step 1: Write failing tests for pause and node reset**

Append this test to `test/workflow.test.js`:

```js
test('Workflow Run Store - can pause and reset a failed node for retry', () => {
  const workflow = {
    nodes: [
      { id: 'start', type: 'keyword-input', data: { keyword: '银耳环' } },
      { id: 'mine', type: 'keyword-mining', data: { count: 2 } }
    ],
    edges: [{ id: 'e1', source: 'start', target: 'mine' }]
  };

  const run = createRun(workflow);
  updateRun(run.runId, {
    status: 'failed',
    nodeStates: {
      ...run.nodeStates,
      start: {
        ...run.nodeStates.start,
        status: 'completed',
        output: { keyword: '银耳环' }
      },
      mine: {
        ...run.nodeStates.mine,
        status: 'retryable',
        error: 'temporary network error',
        blocker: 'network_transient_failure',
        actionHint: '可以重试',
        progress: { status: 'retryable', current: 0, total: 0, percent: 100, message: '等待重试' }
      }
    }
  });

  const { markRunPaused, resetRunNodeForRetry } = require('../core/workflow');
  const paused = markRunPaused(run.runId);
  assert.strictEqual(paused.status, 'paused');

  const reset = resetRunNodeForRetry(run.runId, 'mine');
  assert.strictEqual(reset.status, 'pending');
  assert.strictEqual(reset.nodeStates.start.status, 'completed');
  assert.strictEqual(reset.nodeStates.mine.status, 'idle');
  assert.strictEqual(reset.nodeStates.mine.error, null);
  assert.strictEqual(reset.nodeStates.mine.blocker, null);
  assert.deepStrictEqual(reset.nodeStates.mine.progress, {
    status: 'idle',
    current: 0,
    total: 0,
    percent: 0,
    message: ''
  });

  const runFile = path.join(workflowDataDir, `${run.runId}.json`);
  const logFile = path.join(workflowDataDir, `${run.runId}.log`);
  if (fs.existsSync(runFile)) fs.unlinkSync(runFile);
  if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test test/workflow.test.js
```

Expected: fail because `markRunPaused` and `resetRunNodeForRetry` are not exported.

- [ ] **Step 3: Implement store helpers**

Add these functions to `core/workflow/run-store.js` after `updateRun`:

```js
function idleProgress() {
  return { status: 'idle', current: 0, total: 0, percent: 0, message: '' };
}

function resetNodeStateForRetry(state) {
  return {
    ...state,
    status: 'idle',
    error: null,
    startedAt: null,
    completedAt: null,
    progress: idleProgress(),
    blocker: null,
    actionHint: null,
    platformStatus: null,
    durationMs: null,
    outputSummary: null,
    cooldownRemainingMs: 0
  };
}

function downstreamNodeIds(workflow, nodeId) {
  const edges = Array.isArray(workflow?.edges) ? workflow.edges : [];
  const queue = [nodeId];
  const seen = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    for (const edge of edges) {
      if (edge.source !== current || seen.has(edge.target)) continue;
      seen.add(edge.target);
      queue.push(edge.target);
    }
  }

  return [...seen];
}

function mutateRun(runId, mutator) {
  const runObj = getRun(runId);
  if (!runObj) return null;
  const next = mutator(runObj) || runObj;
  next.updatedAt = new Date().toISOString();
  saveRun(next);
  return next;
}

function markRunPaused(runId) {
  return mutateRun(runId, (runObj) => ({
    ...runObj,
    status: 'paused',
    error: null
  }));
}

function resetRunNodeForRetry(runId, nodeId) {
  return mutateRun(runId, (runObj) => {
    if (!runObj.nodeStates || !runObj.nodeStates[nodeId]) {
      throw new Error(`找不到可重试节点: ${nodeId}`);
    }

    const resetIds = new Set([nodeId, ...downstreamNodeIds(runObj.workflow, nodeId)]);
    const nextNodeStates = { ...runObj.nodeStates };
    for (const id of resetIds) {
      if (!nextNodeStates[id]) continue;
      nextNodeStates[id] = resetNodeStateForRetry(nextNodeStates[id]);
    }

    return {
      ...runObj,
      status: 'pending',
      error: null,
      nodeStates: nextNodeStates
    };
  });
}
```

Update `module.exports`:

```js
module.exports = {
  createRun,
  getRun,
  updateRun,
  mutateRun,
  markRunPaused,
  resetRunNodeForRetry,
  addRunLog,
  listRuns
};
```

- [ ] **Step 4: Export helpers from workflow index**

`core/workflow/index.js` already spreads `runStore`; no additional code is needed after Step 3 if exports are correct.

- [ ] **Step 5: Run tests**

Run:

```bash
node --test test/workflow.test.js
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add core/workflow/run-store.js test/workflow.test.js
git commit -m "feat: add workflow recovery store helpers"
```

---

### Task 2: Scheduler Resume and Retry

**Files:**
- Modify: `core/workflow/scheduler.js`
- Test: `test/workflow.test.js`

- [ ] **Step 1: Write failing scheduler recovery tests**

Append this test to `test/workflow.test.js`:

```js
test('Workflow Scheduler - resumes from first non-completed node after retry reset', async () => {
  let failingCalls = 0;
  registerNode('test-flaky-recovery-node', {
    execute: async () => {
      failingCalls += 1;
      if (failingCalls === 1) {
        const err = new Error('temporary timeout');
        err.status = 'transient_failure';
        err.retryable = true;
        throw err;
      }
      return { recovered: true };
    }
  });

  const workflow = {
    nodes: [
      { id: 'start', type: 'keyword-input', data: { keyword: '珍珠耳环' } },
      { id: 'flaky', type: 'test-flaky-recovery-node', data: { label: '临时失败节点' } },
      { id: 'title', type: 'title-generator', data: { label: '标题节点' } }
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'flaky' },
      { id: 'e2', source: 'flaky', target: 'title' }
    ]
  };

  const run = createRun(workflow);
  await startWorkflow(run.runId);

  let failed = getRun(run.runId);
  assert.strictEqual(failed.status, 'retryable');
  assert.strictEqual(failed.nodeStates.start.status, 'completed');
  assert.strictEqual(failed.nodeStates.flaky.status, 'retryable');

  const { retryWorkflowNode } = require('../core/workflow');
  await retryWorkflowNode(run.runId, 'flaky');

  const finalRun = getRun(run.runId);
  assert.strictEqual(finalRun.status, 'completed');
  assert.strictEqual(finalRun.nodeStates.start.status, 'completed');
  assert.strictEqual(finalRun.nodeStates.flaky.status, 'completed');
  assert.strictEqual(finalRun.nodeStates.title.status, 'completed');
  assert.strictEqual(failingCalls, 2);

  const runFile = path.join(workflowDataDir, `${run.runId}.json`);
  const logFile = path.join(workflowDataDir, `${run.runId}.log`);
  if (fs.existsSync(runFile)) fs.unlinkSync(runFile);
  if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test test/workflow.test.js
```

Expected: fail because `retryWorkflowNode` does not exist.

- [ ] **Step 3: Add runnable queue builder**

In `core/workflow/scheduler.js`, replace the current initial queue:

```js
const queue = nodes.filter(n => inEdges[n.id].length === 0).map(n => n.id);
```

with:

```js
const runnableStatuses = new Set(['idle', 'retryable', 'waiting_manual', 'blocked', 'failed']);
const queue = nodes
  .filter((node) => runnableStatuses.has(nodeStates[node.id]?.status || 'idle'))
  .filter((node) => {
    const parents = inEdges[node.id] || [];
    return parents.every((parentId) => nodeStates[parentId]?.status === 'completed');
  })
  .map((node) => node.id);
```

- [ ] **Step 4: Add resumable start function**

Add this function above `startWorkflow` in `core/workflow/scheduler.js`:

```js
function createLogger(runId) {
  return {
    info: (msg) => {
      addRunLog(runId, 'info', msg);
      emitRunEvent(runId, 'log', { level: 'info', message: msg });
    },
    warn: (msg) => {
      addRunLog(runId, 'warn', msg);
      emitRunEvent(runId, 'log', { level: 'warn', message: msg });
    },
    error: (msg) => {
      addRunLog(runId, 'error', msg);
      emitRunEvent(runId, 'log', { level: 'error', message: msg });
    }
  };
}

async function runWorkflowExecution(runId, startMessage) {
  if (activeRuns.has(runId)) {
    throw new Error(`工作流正在运行: ${runId}`);
  }

  updateRun(runId, { status: 'running', startedAt: new Date().toISOString(), error: null });
  emitRunEvent(runId, 'status_change', { status: 'running' });

  const logger = createLogger(runId);
  logger.info(startMessage);

  const executionPromise = (async () => {
    try {
      await executeWorkflowGraph(runId, logger);
    } catch (err) {
      logger.error(`工作流运行异常终止: ${err.message}`);
      const isPlatformError = err.name === 'PlatformAccessError' ||
        err.status !== undefined ||
        err.cooldownRemainingMs !== undefined ||
        err.platform !== undefined;
      const runStatus = isPlatformError ? normalizePlatformError(err).status : 'failed';
      updateRun(runId, { status: runStatus, error: err.message });
      emitRunEvent(runId, 'status_change', { status: runStatus, error: err.message });
    } finally {
      activeRuns.delete(runId);
    }
  })();

  activeRuns.set(runId, executionPromise);
  return executionPromise;
}
```

Then simplify `startWorkflow(runId)` to:

```js
async function startWorkflow(runId) {
  const runObj = getRun(runId);
  if (!runObj) {
    throw new Error(`找不到工作流运行记录: ${runId}`);
  }
  if (runObj.status !== 'pending') {
    throw new Error(`工作流当前状态不能启动: ${runObj.status}`);
  }
  return runWorkflowExecution(runId, `工作流启动成功 [RunId: ${runId}]`);
}
```

- [ ] **Step 5: Add resume and retry APIs in scheduler**

Add after `cancelWorkflow`:

```js
async function resumeWorkflow(runId) {
  const runObj = getRun(runId);
  if (!runObj) {
    throw new Error(`找不到工作流运行记录: ${runId}`);
  }
  if (!['paused', 'blocked', 'waiting_manual', 'retryable', 'failed', 'pending'].includes(runObj.status)) {
    throw new Error(`工作流当前状态不能继续: ${runObj.status}`);
  }
  return runWorkflowExecution(runId, `工作流继续执行 [RunId: ${runId}]`);
}

async function retryWorkflowNode(runId, nodeId) {
  const { resetRunNodeForRetry } = require('./run-store');
  const reset = resetRunNodeForRetry(runId, nodeId);
  if (!reset) {
    throw new Error(`找不到工作流运行记录: ${runId}`);
  }
  emitRunEvent(runId, 'node_change', { nodeId, state: reset.nodeStates[nodeId] });
  return runWorkflowExecution(runId, `重试节点 ${nodeId} [RunId: ${runId}]`);
}
```

Update module exports:

```js
module.exports = {
  startWorkflow,
  resumeWorkflow,
  retryWorkflowNode,
  cancelWorkflow
};
```

- [ ] **Step 6: Run tests**

Run:

```bash
node --test test/workflow.test.js test/workflow-observability.test.js
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add core/workflow/scheduler.js test/workflow.test.js
git commit -m "feat: resume and retry workflow nodes"
```

---

### Task 3: HTTP APIs for Pause, Resume, Retry

**Files:**
- Modify: `bin/server.js`
- Test: `test/workflow-api-recovery.test.js`

- [ ] **Step 1: Write failing API tests**

Create `test/workflow-api-recovery.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const workflowDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-api-recovery-test-'));
process.env.ECOM_WORKFLOW_DATA_DIR = workflowDataDir;

const {
  createRun,
  getRun,
  registerNode
} = require('../core/workflow');

test('workflow recovery APIs expose pause, resume, and retry handlers through exported app', async () => {
  registerNode('test-api-flaky-node', {
    execute: async () => ({ ok: true })
  });

  const workflow = {
    nodes: [{ id: 'api_node', type: 'test-api-flaky-node', data: {} }],
    edges: []
  };
  const run = createRun(workflow);

  const serverModule = require('../bin/server');
  assert.ok(serverModule.app || serverModule.createApp, 'server should export app or createApp for route testing');

  const runFile = path.join(workflowDataDir, `${run.runId}.json`);
  const logFile = path.join(workflowDataDir, `${run.runId}.log`);
  if (fs.existsSync(runFile)) fs.unlinkSync(runFile);
  if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
});
```

- [ ] **Step 2: Run test to verify current route testability**

Run:

```bash
node --test test/workflow-api-recovery.test.js
```

Expected: fail if `bin/server.js` does not export `app` or `createApp`. If it already exports one, continue to Step 3 and replace the smoke assertion with route-level requests.

- [ ] **Step 3: Import recovery functions**

In `bin/server.js`, extend the workflow import to include:

```js
resumeWorkflow,
retryWorkflowNode,
markRunPaused
```

- [ ] **Step 4: Replace placeholder routes**

Replace the current placeholder routes:

```js
app.post('/api/workflows/runs/:runId/retry-node', sendWorkflowNotImplemented('retry-node'));
app.post('/api/workflows/runs/:runId/resume', sendWorkflowNotImplemented('resume'));
```

with:

```js
app.post('/api/workflows/runs/:runId/pause', (req, res) => {
  try {
    const run = markRunPaused(req.params.runId);
    if (!run) return res.status(404).json({ ok: false, error: '工作流运行不存在' });
    return res.json({ ok: true, run });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/workflows/runs/:runId/resume', async (req, res) => {
  try {
    await resumeWorkflow(req.params.runId);
    return res.json({ ok: true, run: getRun(req.params.runId) });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/workflows/runs/:runId/retry-node', async (req, res) => {
  try {
    const nodeId = String(req.body?.nodeId || '').trim();
    if (!nodeId) {
      return res.status(400).json({ ok: false, error: 'nodeId is required' });
    }
    await retryWorkflowNode(req.params.runId, nodeId);
    return res.json({ ok: true, run: getRun(req.params.runId) });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});
```

- [ ] **Step 5: Run API smoke and workflow tests**

Run:

```bash
node --test test/workflow-api-recovery.test.js test/workflow.test.js
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add bin/server.js test/workflow-api-recovery.test.js
git commit -m "feat: expose workflow recovery APIs"
```

---

### Task 4: Web Controls for Pause, Resume, Retry

**Files:**
- Modify: `apps/web/src/workflow-ui.js`
- Modify: `apps/web/src/WorkflowStudio.jsx`
- Test: `apps/web/src/workflow-ui.test.mjs`

- [ ] **Step 1: Write failing front-end action tests**

Add to `apps/web/src/workflow-ui.test.mjs`:

```js
test('getWorkflowNodeAction returns executable recovery actions', () => {
  assert.deepEqual(getWorkflowNodeAction('verify', 'waiting_manual'), {
    label: '继续流程',
    action: 'resume',
    tone: 'warn'
  });
  assert.deepEqual(getWorkflowNodeAction('generate', 'retryable'), {
    label: '重试节点',
    action: 'retry-node',
    tone: 'warn'
  });
  assert.deepEqual(getWorkflowNodeAction('verify', 'blocked'), {
    label: '查看阻塞',
    action: 'blocked',
    tone: 'danger'
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
```

Expected: fail because labels/actions still return hint-only values.

- [ ] **Step 3: Update action mapping**

In `apps/web/src/workflow-ui.js`, update the waiting/manual and retryable branches:

```js
if (normalizedState === 'waiting_manual') {
  return { label: '继续流程', action: 'resume', tone: 'warn' };
}
if (normalizedState === 'retryable') {
  return { label: '重试节点', action: 'retry-node', tone: 'warn' };
}
```

- [ ] **Step 4: Add operation helper in WorkflowStudio**

In `apps/web/src/WorkflowStudio.jsx`, add this helper inside the component near `handleCancelWorkflow`:

```jsx
const runWorkflowOperation = async (action, nodeId = null) => {
  if (!currentRunId) return;
  const endpoint = action === 'retry-node'
    ? `/api/workflows/runs/${currentRunId}/retry-node`
    : `/api/workflows/runs/${currentRunId}/${action}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: action === 'retry-node' ? JSON.stringify({ nodeId }) : '{}'
  });
  const payload = await res.json();
  if (payload.ok === false) {
    throw new Error(payload.error || '工作流操作失败');
  }
  await loadHistoryRun(currentRunId);
};
```

- [ ] **Step 5: Render real buttons in selected-node side panel**

Below the `actionHint` block in the selected-node panel, add:

```jsx
{selectedNode.data?.status && ['waiting_manual', 'retryable', 'paused', 'blocked'].includes(selectedNode.data.status) && currentRunId && (
  <div className="flex gap-2 pt-1">
    {selectedNode.data.status === 'retryable' && (
      <button
        type="button"
        className="secondary-button"
        onClick={() => runWorkflowOperation('retry-node', selectedNode.id)}
      >
        重试节点
      </button>
    )}
    {(selectedNode.data.status === 'waiting_manual' || selectedNode.data.status === 'paused' || selectedNode.data.status === 'blocked') && (
      <button
        type="button"
        className="secondary-button"
        onClick={() => runWorkflowOperation('resume')}
      >
        继续流程
      </button>
    )}
  </div>
)}
```

- [ ] **Step 6: Add pause button near run controls**

Near the existing cancel button in `WorkflowStudio.jsx`, add:

```jsx
{currentRunId && runStatus === 'running' && (
  <button
    type="button"
    className="secondary-button"
    onClick={() => runWorkflowOperation('pause')}
  >
    暂停
  </button>
)}
```

- [ ] **Step 7: Run front-end tests and build**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
npm run web:build
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/workflow-ui.js apps/web/src/workflow-ui.test.mjs apps/web/src/WorkflowStudio.jsx
git commit -m "feat: add workflow recovery controls"
```

---

### Task 5: Platform Readiness Guard Before Resume

**Files:**
- Modify: `core/workflow/scheduler.js`
- Modify: `core/workflow/state-helper.js`
- Test: `test/workflow-observability.test.js`

- [ ] **Step 1: Write failing readiness test**

Append to `test/workflow-observability.test.js`:

```js
test('Workflow Recovery - resume keeps manual node blocked when platform status is unavailable', async () => {
  registerNode('test-manual-platform-node', {
    execute: async () => {
      throw new PlatformAccessError('Need login again', {
        status: 'login_required',
        platform: 'taobao'
      });
    }
  });

  const run = createRun({
    nodes: [{ id: 'manual', type: 'test-manual-platform-node', data: {} }],
    edges: []
  });

  await startWorkflow(run.runId);
  const blocked = getRun(run.runId);
  assert.strictEqual(blocked.status, 'waiting_manual');
  assert.strictEqual(blocked.nodeStates.manual.platformStatus, 'login_required');
});
```

- [ ] **Step 2: Run test**

Run:

```bash
node --test test/workflow-observability.test.js
```

Expected: pass with current behavior. This locks the platform status shape before adding readiness checks.

- [ ] **Step 3: Add readiness check helper**

In `core/workflow/scheduler.js`, import:

```js
const { getPlatformAccessStatus } = require('../platform-access-guard');
```

Add:

```js
function platformReadyForNode(state) {
  const platform = state?.platformStatus && state?.platformStatus !== 'error'
    ? state.platformStatus
    : state?.platform;
  if (!platform) return { ready: true };
  const status = getPlatformAccessStatus(platform);
  return {
    ready: status.available,
    status
  };
}
```

- [ ] **Step 4: Use readiness check before running a waiting_manual node**

Inside `executeWorkflowGraph`, before setting a node to `running`, add:

```js
const currentState = nodeStates[nodeId];
if (currentState.status === 'waiting_manual') {
  const readiness = platformReadyForNode(currentState);
  if (!readiness.ready) {
    currentState.blocker = readiness.status.status;
    currentState.actionHint = readiness.status.manualAction?.userMessage || '平台仍需人工处理，完成后再继续。';
    currentState.cooldownRemainingMs = readiness.status.cooldownRemainingMs || 0;
    updateRun(runId, { nodeStates });
    emitRunEvent(runId, 'node_change', { nodeId, state: currentState });
    throw new Error(currentState.actionHint);
  }
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
node --test test/workflow-observability.test.js test/workflow.test.js
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add core/workflow/scheduler.js test/workflow-observability.test.js
git commit -m "feat: guard workflow resume with platform status"
```

---

### Task 6: Final Verification and Cleanup

**Files:**
- No code files unless a verification failure requires a fix.

- [ ] **Step 1: Run focused workflow tests**

Run:

```bash
node --test test/workflow.test.js test/workflow-observability.test.js test/workflow-api-recovery.test.js
```

Expected: all pass.

- [ ] **Step 2: Run front-end tests**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
```

Expected: all pass.

- [ ] **Step 3: Run project regression**

Run:

```bash
npm run test:core-skills
npm run web:build
git diff --check
```

Expected:
- `npm run test:core-skills`: pass with 0 failures.
- `npm run web:build`: Vite build succeeds.
- `git diff --check`: no output.

- [ ] **Step 4: Manual browser check**

Run:

```bash
npm run dev --prefix apps/web -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173/`, then:

- Go to `流程画布`.
- Go to `流程编排`.
- Click a node.
- Confirm the right panel shows `运行状态与指标`.
- Start a workflow with a mocked or safe local node.
- Confirm `暂停`, `继续流程`, and `重试节点` buttons appear only in matching states.

- [ ] **Step 5: Commit final fixes if needed**

If Step 4 required UI or test fixes:

```bash
git add <changed-files>
git commit -m "fix: polish workflow recovery controls"
```

---

## Self-Review

**Spec coverage:** The plan covers pause, resume, retry, platform-aware continuation, backend APIs, Web controls, and verification.

**Placeholder scan:** No `TBD`, `TODO`, or unspecified “add tests” steps remain. Each task includes concrete files, code snippets, commands, and expected results.

**Type consistency:** The plan consistently uses `progress.status/current/total/percent/message`, node statuses from `core/workflow/state-helper.js`, and API actions `pause`, `resume`, and `retry-node`.
