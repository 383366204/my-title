# Workflow Blocker Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn workflow blocker states into concrete Web actions so a user can understand, fix, retry, and continue a stuck product-selection pipeline without leaving the React UI.

**Architecture:** Keep the durable pipeline runtime and existing `/api/pipeline/*` routes as the source of truth. Add small client API wrappers, pure UI decision helpers, and a focused blocker action panel in `WorkflowStudio.jsx`; the mining page continues to append candidates through the existing candidates API, then the workflow canvas can retry the verify node.

**Tech Stack:** Node.js CommonJS, Express APIs in `bin/server.js`, React/Vite, `@xyflow/react`, `node:test`.

---

## File Structure

- Modify `apps/web/src/pipeline-client.js`: expose pause, resume, retry operations for pipeline runs.
- Modify `apps/web/src/use-pipeline-run.js`: add hook methods `pauseRun`, `resumeRun`, and `retryStep` for non-canvas pages.
- Modify `apps/web/src/workflow-ui.js`: add deterministic blocker remediation actions for `verified_empty`, SYCM manual action, retryable failures, and review states.
- Modify `apps/web/src/workflow-ui.test.mjs`: test blocker action mapping and operation messages.
- Modify `apps/web/src/WorkflowStudio.jsx`: replace generic recovery buttons with a blocker action panel that can route to mining, retry verify, continue after manual action, or open artifacts.
- Modify `apps/web/src/App.jsx`: let the workflow page request navigation to the mining page with the current run context.
- Modify `apps/web/src/App.css`: add compact styles for blocker action cards.
- Modify `core/workflow/pipeline-adapter.js`: add `nextRecommendedAction` to blocked node states when summary status already identifies the cause.
- Modify `core/test/workflow-pipeline-adapter.test.js`: assert blocked nodes expose machine-readable recommended action metadata.

---

### Task 1: Pipeline Operation Client Wrappers

**Files:**
- Modify: `apps/web/src/pipeline-client.js`
- Modify: `apps/web/src/use-pipeline-run.js`

- [ ] **Step 1: Add pipeline operation wrappers**

In `apps/web/src/pipeline-client.js`, append:

```js
export function pausePipelineRun(runId, payload = {}) {
  return fetchPipelineJson(`/api/pipeline/runs/${encodeURIComponent(runId)}/pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
}

export function resumePipelineRun(runId, payload = {}) {
  return fetchPipelineJson(`/api/pipeline/runs/${encodeURIComponent(runId)}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
}

export function retryPipelineStep(runId, step, payload = {}) {
  return fetchPipelineJson(`/api/pipeline/runs/${encodeURIComponent(runId)}/${encodeURIComponent(step)}/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
}
```

- [ ] **Step 2: Wire wrappers into the shared hook**

In `apps/web/src/use-pipeline-run.js`, extend the import:

```js
  pausePipelineRun,
  resumePipelineRun,
  retryPipelineStep,
```

Add these callbacks before `useEffect`:

```js
  const pauseRun = useCallback(async (payload = {}) => {
    const runId = payload.runId || (currentRun && currentRun.runId);
    if (!runId) throw new Error('请先创建或选择一个当前流程。');
    setError('');
    const result = await pausePipelineRun(runId, payload);
    applyPipelinePayload(result);
    await refreshRun().catch(() => {});
    return result;
  }, [applyPipelinePayload, currentRun, refreshRun]);

  const resumeRun = useCallback(async (payload = {}) => {
    const runId = payload.runId || (currentRun && currentRun.runId);
    if (!runId) throw new Error('请先创建或选择一个当前流程。');
    setError('');
    const result = await resumePipelineRun(runId, payload);
    applyPipelinePayload(result);
    await refreshRun().catch(() => {});
    return result;
  }, [applyPipelinePayload, currentRun, refreshRun]);

  const retryStep = useCallback(async (step, payload = {}) => {
    const runId = payload.runId || (currentRun && currentRun.runId);
    if (!runId) throw new Error('请先创建或选择一个当前流程。');
    if (!step) throw new Error('请选择要重试的流程节点。');
    setError('');
    const result = await retryPipelineStep(runId, step, payload);
    applyPipelinePayload(result);
    await refreshRun().catch(() => {});
    return result;
  }, [applyPipelinePayload, currentRun, refreshRun]);
```

Return them:

```js
    pauseRun,
    resumeRun,
    retryStep,
```

- [ ] **Step 3: Smoke check import syntax**

Run:

```bash
npm run web:build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pipeline-client.js apps/web/src/use-pipeline-run.js
git commit -m "feat: expose pipeline recovery client actions"
```

---

### Task 2: Machine-Readable Blocker Actions

**Files:**
- Modify: `core/workflow/pipeline-adapter.js`
- Modify: `core/test/workflow-pipeline-adapter.test.js`
- Modify: `apps/web/src/workflow-ui.js`
- Modify: `apps/web/src/workflow-ui.test.mjs`

- [ ] **Step 1: Add failing adapter assertions**

In `core/test/workflow-pipeline-adapter.test.js`, inside `surfaces summary blocker guidance when runtime only reports a blocked step`, add:

```js
    assert.deepEqual(run.nodeStates.verify.nextRecommendedAction, {
      action: 'mine-more',
      label: '补充候选词',
      description: '当前没有通过生意参谋验真的词，先补充候选词再重跑验真。'
    });
```

- [ ] **Step 2: Run adapter test to verify failure**

Run:

```bash
node --test core/test/workflow-pipeline-adapter.test.js
```

Expected: FAIL because `nextRecommendedAction` is not present.

- [ ] **Step 3: Add action metadata to adapter**

In `core/workflow/pipeline-adapter.js`, extend `summaryInterventionForNode()` return objects:

```js
        nextRecommendedAction: {
          action: 'mine-more',
          label: '补充候选词',
          description: '当前没有通过生意参谋验真的词，先补充候选词再重跑验真。'
        }
```

For `manual_action_required`:

```js
        nextRecommendedAction: {
          action: 'resume-after-manual',
          label: '我已处理，继续流程',
          description: '处理登录、滑块、权限或功能入口后，从当前节点继续。'
        }
```

For `verified_partial_manual_required`:

```js
        nextRecommendedAction: {
          action: 'continue-or-fix-sycm',
          label: '继续使用已通过词',
          description: '已有部分关键词通过，可继续生成；也可以先处理生意参谋后重试验真。'
        }
```

When creating `initialState`, preserve the metadata:

```js
      nextRecommendedAction: intervention?.nextRecommendedAction || initialState.nextRecommendedAction || null
```

- [ ] **Step 4: Add pure UI helper tests**

In `apps/web/src/workflow-ui.test.mjs`, import `getWorkflowBlockerActions` and append:

```js
test('getWorkflowBlockerActions maps verified-empty blockers to useful next actions', () => {
  const actions = getWorkflowBlockerActions('verify', {
    status: 'blocked',
    blocker: 'verified_empty',
    nextRecommendedAction: {
      action: 'mine-more',
      label: '补充候选词',
      description: '当前没有通过生意参谋验真的词，先补充候选词再重跑验真。'
    }
  });

  assert.deepEqual(actions.map(action => action.action), ['mine-more', 'retry-node']);
  assert.equal(actions[0].label, '补充候选词');
  assert.equal(actions[1].label, '重跑验真');
});
```

- [ ] **Step 5: Implement `getWorkflowBlockerActions`**

In `apps/web/src/workflow-ui.js`, export:

```js
export function getWorkflowBlockerActions(nodeId, state = {}) {
  const status = String(state.status || '').toLowerCase();
  const blocker = String(state.blocker || '').toLowerCase();
  const recommended = state.nextRecommendedAction || null;
  const actions = [];

  if (recommended && recommended.action) {
    actions.push({
      action: recommended.action,
      label: recommended.label || '处理阻塞',
      description: recommended.description || ''
    });
  }

  if (nodeId === 'verify' && blocker === 'verified_empty') {
    actions.push({
      action: 'retry-node',
      label: '重跑验真',
      description: '补充候选词或调整参数后，从生意参谋校验节点重新执行。'
    });
  } else if (['waiting_manual', 'paused', 'blocked'].includes(status)) {
    actions.push({
      action: 'resume',
      label: '继续流程',
      description: '确认阻塞已处理后，从当前节点继续执行。'
    });
  }

  if (['retryable', 'failed'].includes(status)) {
    actions.push({
      action: 'retry-node',
      label: '重试节点',
      description: '当前节点及下游步骤会重新执行。'
    });
  }

  return actions.filter((action, index, list) => (
    list.findIndex(item => item.action === action.action && item.label === action.label) === index
  ));
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
node --test core/test/workflow-pipeline-adapter.test.js apps/web/src/workflow-ui.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add core/workflow/pipeline-adapter.js core/test/workflow-pipeline-adapter.test.js apps/web/src/workflow-ui.js apps/web/src/workflow-ui.test.mjs
git commit -m "feat: add workflow blocker remediation actions"
```

---

### Task 3: Blocker Action Panel in Workflow Canvas

**Files:**
- Modify: `apps/web/src/WorkflowStudio.jsx`
- Modify: `apps/web/src/App.jsx`
- Modify: `apps/web/src/App.css`

- [ ] **Step 1: Allow WorkflowStudio to request app navigation**

Change the component signature in `apps/web/src/WorkflowStudio.jsx`:

```jsx
export default function WorkflowStudio({ initialMode = MODE_MONITOR, onNavigate }) {
```

In `apps/web/src/App.jsx`, change the workflow render:

```jsx
          <WorkflowStudio key={activeTab} initialMode="monitor" onNavigate={setActiveTab} />
```

- [ ] **Step 2: Import blocker actions**

In `apps/web/src/WorkflowStudio.jsx`, add to the `./workflow-ui.js` import:

```js
  getWorkflowBlockerActions,
```

- [ ] **Step 3: Add action executor**

Inside `WorkflowStudio`, near `runWorkflowOperation`, add:

```js
  const runBlockerAction = async (action, nodeId) => {
    if (action === 'mine-more') {
      onNavigate?.('mine');
      setOperationMessage('已切到挖词选品页。补充候选词后回到流程画布重跑验真。');
      return;
    }
    if (action === 'retry-node') {
      await runWorkflowOperation('retry-node', nodeId);
      return;
    }
    if (action === 'resume' || action === 'resume-after-manual' || action === 'continue-or-fix-sycm') {
      await runWorkflowOperation('resume', nodeId);
    }
  };
```

- [ ] **Step 4: Replace generic recovery buttons with action panel**

Replace the current selected-node recovery button block with:

```jsx
            {selectedNode.data?.status && selectedNodeCanRecover && (
              <div className="workflow-blocker-actions">
                {getWorkflowBlockerActions(selectedNode.id, selectedNode.data).map((action) => (
                  <button
                    type="button"
                    className="workflow-blocker-action"
                    key={`${action.action}-${action.label}`}
                    onClick={() => runBlockerAction(action.action, selectedNode.id)}
                  >
                    <span>{action.label}</span>
                    {action.description && <small>{action.description}</small>}
                  </button>
                ))}
              </div>
            )}
```

- [ ] **Step 5: Add compact styles**

In `apps/web/src/App.css`, add:

```css
.workflow-blocker-actions {
  display: grid;
  gap: 8px;
}

.workflow-blocker-action {
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(15, 23, 42, 0.72);
  color: #e2e8f0;
  border-radius: 8px;
  padding: 10px 12px;
  text-align: left;
}

.workflow-blocker-action span {
  display: block;
  font-size: 13px;
  font-weight: 700;
}

.workflow-blocker-action small {
  display: block;
  margin-top: 4px;
  color: #94a3b8;
  font-size: 11px;
  line-height: 1.45;
}
```

- [ ] **Step 6: Build and browser-check**

Run:

```bash
npm run web:build
npm run ui
```

Open `http://127.0.0.1:3001/`, select run `2026-07-06-005614`, click `生意参谋校验`.

Expected:
- The detail panel shows a primary action card `补充候选词`.
- It also shows `重跑验真`.
- Clicking `补充候选词` navigates to `挖词选品`.
- No raw `IDLE` or `VERIFIED_EMPTY` text is visible.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/WorkflowStudio.jsx apps/web/src/App.jsx apps/web/src/App.css
git commit -m "feat: guide workflow blocker recovery in ui"
```

---

### Task 4: Close the Mining-to-Retry Loop

**Files:**
- Modify: `apps/web/src/App.jsx`
- Modify: `apps/web/src/workflow-ui.js`
- Modify: `apps/web/src/workflow-ui.test.mjs`

- [ ] **Step 1: Add current-run action text helper test**

In `apps/web/src/workflow-ui.test.mjs`, append:

```js
test('getMiningRecoveryHint explains how to recover a verified-empty run', () => {
  assert.equal(getMiningRecoveryHint({
    status: 'verified_empty',
    counts: { candidates: 1, sycmVerified: 0, sycmRejected: 1 }
  }), '当前流程验真无结果。补充候选词后，回到流程画布重跑“生意参谋校验”。');
});
```

- [ ] **Step 2: Implement helper**

In `apps/web/src/workflow-ui.js`, export:

```js
export function getMiningRecoveryHint(run = null) {
  if (!run) return '';
  if (run.status === 'verified_empty') {
    return '当前流程验真无结果。补充候选词后，回到流程画布重跑“生意参谋校验”。';
  }
  if (run.status === 'manual_action_required' || run.status === 'verified_partial_manual_required') {
    return '当前流程需要处理生意参谋状态。处理完成后，回到流程画布继续或重跑验真。';
  }
  return '';
}
```

- [ ] **Step 3: Show the hint in MiningView**

In `apps/web/src/App.jsx`, import `getMiningRecoveryHint` from `./workflow-ui.js`.

Inside `MiningView`, after `const pipelineSummary = getPipelineSummaryText(pipeline.currentRun);`, add:

```js
  const miningRecoveryHint = getMiningRecoveryHint(pipeline.currentRun);
```

In the `.pipeline-context-band`, below the existing `<small>`, render:

```jsx
          {miningRecoveryHint && <small className="pipeline-recovery-hint">{miningRecoveryHint}</small>}
```

- [ ] **Step 4: Test and build**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
npm run web:build
```

Expected: PASS.

- [ ] **Step 5: Manual browser check**

Run:

```bash
npm run ui
```

Open `http://127.0.0.1:3001/`, go to `挖词选品` while the latest run is `verified_empty`.

Expected:
- Context band shows the recovery hint.
- Existing buttons `加入当前流程` and `运行当前流程挖词阶段` remain enabled when a current run exists.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/App.jsx apps/web/src/workflow-ui.js apps/web/src/workflow-ui.test.mjs
git commit -m "feat: connect mining recovery hints to workflow"
```

---

### Task 5: Verification and Push

**Files:**
- No new files.

- [ ] **Step 1: Run focused tests**

```bash
node --test core/test/workflow-pipeline-adapter.test.js apps/web/src/workflow-ui.test.mjs
```

Expected: all tests pass.

- [ ] **Step 2: Run production build**

```bash
npm run web:build
```

Expected: Vite build succeeds.

- [ ] **Step 3: Run browser smoke test**

```bash
npm run ui
```

Browser checks:
- `流程画布 -> 流程编排 -> 2026-07-06-005614 -> 生意参谋校验` shows actionable cards.
- `补充候选词` navigates to `挖词选品`.
- `挖词选品` explains how to recover the verified-empty run.
- No raw `IDLE`, `VERIFIED_EMPTY`, or generic-only blocker message appears.

- [ ] **Step 4: Final status check**

```bash
git status --short
```

Expected: only intentionally untracked local runtime cache such as `data/platform-access/`, or a clean tree.

- [ ] **Step 5: Push**

```bash
git push
```

Expected: branch `codex/executable-workflow-canvas` updates on GitHub.

---

## Self-Review

- Spec coverage: The plan covers the next high-impact workflow gap: blocked runs become actionable, mining can feed recovery, and retry/resume operations use existing durable APIs.
- Placeholder scan: No task uses TBD or vague follow-up wording; every code change has concrete snippets and commands.
- Type consistency: `nextRecommendedAction`, `getWorkflowBlockerActions`, `pauseRun`, `resumeRun`, and `retryStep` names are consistent across adapter, UI helpers, hook, and components.
