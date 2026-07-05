# Workflow Operability Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the React workflow canvas and monitor clearly show where the pipeline is, what is happening inside each step, and what the user can safely do next.

**Architecture:** Keep React as the only Web UI. Add small pure UI helpers in `apps/web/src/workflow-ui.js`, then use them from `apps/web/src/WorkflowStudio.jsx` so production pipeline and legacy workflow runs share one state vocabulary. Do not add new backend APIs unless a UI action cannot be expressed with existing `/api/pipeline/*` and `/api/workflows/*` endpoints.

**Tech Stack:** React, Vite, `@xyflow/react`, lucide-react, Node.js `node:test`, Express APIs in `bin/server.js`.

---

## File Structure

- Modify `apps/web/src/workflow-ui.js`: pure status, action, progress, blocker, and detail-panel helpers.
- Modify `apps/web/src/workflow-ui.test.mjs`: unit tests for every new helper and action mapping.
- Modify `apps/web/src/WorkflowStudio.jsx`: replace duplicated node progress fragments, improve node action rendering, and expand selected-node detail panel.
- Modify `apps/web/src/App.css`: styles for compact node progress, action chips, selected node detail rows, and blocker callouts.
- Modify `README.md`: one short note that the React workflow canvas now supports visible progress, pause, resume, retry, and blocker guidance.

No new route should be required. Existing endpoints already cover:

- `POST /api/pipeline/runs/:runId/pause`
- `POST /api/pipeline/runs/:runId/resume`
- `POST /api/pipeline/runs/:runId/:step/retry`
- `POST /api/workflows/runs/:runId/pause`
- `POST /api/workflows/runs/:runId/resume`
- `POST /api/workflows/runs/:runId/retry-node`
- `GET /api/workflows/runs/:runId/artifacts/:nodeId`

---

### Task 1: Unified Workflow UI State Helpers

**Files:**
- Modify: `apps/web/src/workflow-ui.js`
- Test: `apps/web/src/workflow-ui.test.mjs`

- [ ] **Step 1: Add failing tests for unified state helpers**

Append tests to `apps/web/src/workflow-ui.test.mjs`:

```js
test('getWorkflowNodeViewModel returns Chinese status, progress, blocker, and action metadata', () => {
  const view = getWorkflowNodeViewModel('verify', {
    status: 'waiting_manual',
    progress: { current: 2, total: 5, percent: 40, message: '等待生意参谋登录' },
    blocker: 'sycm_login_required',
    actionHint: '请登录生意参谋后继续',
    cooldownRemainingMs: 0
  });

  assert.equal(view.statusLabel, '等待人工处理');
  assert.equal(view.tone, 'warn');
  assert.equal(view.progressLabel, '等待生意参谋登录 · 2/5 · 40%');
  assert.equal(view.primaryAction.action, 'resume');
  assert.equal(view.primaryAction.label, '继续流程');
  assert.equal(view.blockerTitle, '需要人工处理');
  assert.match(view.blockerMessage, /生意参谋/);
});

test('getWorkflowNodeViewModel describes rate cooldown and retryable failures', () => {
  const cooldown = getWorkflowNodeViewModel('mine', {
    status: 'running',
    progress: { percent: 30, message: '1688 请求冷却中' },
    cooldownRemainingMs: 65000
  });
  assert.equal(cooldown.blockerTitle, '请求冷却中');
  assert.match(cooldown.blockerMessage, /65 秒/);

  const retryable = getWorkflowNodeViewModel('generate', {
    status: 'retryable',
    error: 'LLM timeout'
  });
  assert.equal(retryable.primaryAction.action, 'retry-node');
  assert.equal(retryable.blockerTitle, '可以重试');
  assert.match(retryable.blockerMessage, /LLM timeout/);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
```

Expected: FAIL because `getWorkflowNodeViewModel` is not exported.

- [ ] **Step 3: Implement the helper**

In `apps/web/src/workflow-ui.js`, export:

```js
export function labelWorkflowNodeStatus(status) {
  const normalized = String(status || '').toLowerCase();
  const labels = {
    idle: '未开始',
    pending: '等待启动',
    running: '运行中',
    resuming: '继续中',
    retrying: '重试中',
    completed: '已完成',
    paused: '已暂停',
    waiting_manual: '等待人工处理',
    waiting_confirmation: '等待确认',
    needs_review: '等待复核',
    retryable: '待重试',
    blocked: '已阻塞',
    failed: '失败',
    cancelled: '已取消'
  };
  return labels[normalized] || '未知状态';
}

export function getWorkflowBlockerView(state = {}) {
  const status = String(state.status || '').toLowerCase();
  const blocker = String(state.blocker || '').toLowerCase();
  const error = String(state.error || '').trim();
  const actionHint = String(state.actionHint || '').trim();
  const cooldown = Number(state.cooldownRemainingMs || 0);

  if (cooldown > 0) {
    return {
      title: '请求冷却中',
      message: `平台请求频率受限，约 ${Math.ceil(cooldown / 1000)} 秒后可继续。`
    };
  }
  if (status === 'waiting_manual' || /login|slider|captcha|manual|sycm|taobao|1688/.test(blocker)) {
    return {
      title: '需要人工处理',
      message: actionHint || error || '请处理平台登录、滑块或授权后继续流程。'
    };
  }
  if (status === 'retryable') {
    return {
      title: '可以重试',
      message: error || actionHint || '该节点失败但可以从当前节点重试。'
    };
  }
  if (status === 'blocked' || status === 'failed') {
    return {
      title: status === 'failed' ? '执行失败' : '流程阻塞',
      message: error || actionHint || state.blocker || '请查看节点详情后处理。'
    };
  }
  return null;
}

export function getWorkflowNodeViewModel(nodeId, state = {}) {
  const status = state.status || state.state || 'idle';
  const progress = state.progress || null;
  const blocker = getWorkflowBlockerView(state);
  return {
    nodeId,
    status,
    statusLabel: labelWorkflowNodeStatus(status),
    tone: getCanvasNodeTone(status),
    progress,
    progressLabel: formatWorkflowProgressLabel(progress),
    progressPercent: progress && Number.isFinite(Number(progress.percent))
      ? Math.max(0, Math.min(100, Number(progress.percent)))
      : 0,
    primaryAction: getWorkflowNodeAction(nodeId, status),
    blockerTitle: blocker?.title || '',
    blockerMessage: blocker?.message || '',
    hasBlocker: Boolean(blocker),
    durationMs: Number.isFinite(Number(state.durationMs)) ? Number(state.durationMs) : null,
    outputSummary: state.outputSummary || ''
  };
}
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/workflow-ui.js apps/web/src/workflow-ui.test.mjs
git commit -m "feat: unify workflow node ui state"
```

---

### Task 2: Replace Duplicated Node Progress Rendering

**Files:**
- Modify: `apps/web/src/WorkflowStudio.jsx`
- Modify: `apps/web/src/App.css`
- Test: `apps/web/src/workflow-ui.test.mjs`

- [ ] **Step 1: Add helper import**

In `apps/web/src/WorkflowStudio.jsx`, extend the existing import from `./workflow-ui.js`:

```js
  getWorkflowNodeViewModel,
```

- [ ] **Step 2: Add reusable node widgets**

Add these components above `InputNode`:

```jsx
const WorkflowProgressStrip = ({ view }) => {
  if (!view.progress) return null;
  return (
    <div className="workflow-node-progress" aria-label={view.progressLabel || '节点进度'}>
      <div className="workflow-node-progress-bar">
        <span style={{ width: `${view.progressPercent}%` }} />
      </div>
      {view.progressLabel && <div className="workflow-node-progress-label">{view.progressLabel}</div>}
    </div>
  );
};

const WorkflowBlockerCallout = ({ view }) => {
  if (!view.hasBlocker) return null;
  return (
    <div className={`workflow-node-callout workflow-node-callout-${view.tone}`}>
      <strong>{view.blockerTitle}</strong>
      <span>{view.blockerMessage}</span>
    </div>
  );
};

const WorkflowNodeActionChip = ({ view }) => (
  <div className={`production-node-action production-node-action-${view.primaryAction.tone}`}>
    {view.primaryAction.label}
  </div>
);
```

- [ ] **Step 3: Replace progress fragments in `ProductionNode`**

Inside `ProductionNode`, replace local `tone`, `action`, `progress`, `progressLabel`, and `progressPercent` calculations with:

```js
const view = getWorkflowNodeViewModel(id, data);
const tone = view.tone;
```

Replace the progress, blocker, and action JSX with:

```jsx
<WorkflowProgressStrip view={view} />
<WorkflowBlockerCallout view={view} />
<WorkflowNodeActionChip view={view} />
```

- [ ] **Step 4: Replace progress fragments in `InputNode`, `MiningNode`, and `TitleGeneratorNode`**

At the top of each node component, create:

```js
const view = getWorkflowNodeViewModel(data.id || data.label, data);
```

Keep the existing business-specific content, but replace repeated progress and blocker JSX with:

```jsx
<WorkflowProgressStrip view={view} />
<WorkflowBlockerCallout view={view} />
```

For blocked, waiting, and retryable states, replace the inline action pill with:

```jsx
{['blocked', 'waiting_manual', 'retryable', 'paused', 'failed'].includes(String(data.status || '').toLowerCase()) && (
  <WorkflowNodeActionChip view={view} />
)}
```

- [ ] **Step 5: Add CSS for compact callouts**

Add to `apps/web/src/App.css` near existing workflow node styles:

```css
.workflow-node-callout {
  margin-top: 8px;
  display: grid;
  gap: 3px;
  padding: 7px 8px;
  border: 1px solid var(--card-border);
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.72);
  color: var(--text-secondary);
  font-size: 10px;
  line-height: 1.35;
  text-align: left;
}

.workflow-node-callout strong {
  color: var(--text-primary);
  font-size: 10px;
}

.workflow-node-callout-warn {
  border-color: rgba(245, 158, 11, 0.42);
  background: rgba(120, 53, 15, 0.18);
}

.workflow-node-callout-danger {
  border-color: rgba(248, 113, 113, 0.4);
  background: rgba(127, 29, 29, 0.18);
}
```

- [ ] **Step 6: Run build**

Run:

```bash
npm run web:build
```

Expected: Vite build completes.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/WorkflowStudio.jsx apps/web/src/App.css
git commit -m "refactor: reuse workflow node progress views"
```

---

### Task 3: Upgrade Selected Node Detail Panel

**Files:**
- Modify: `apps/web/src/WorkflowStudio.jsx`
- Modify: `apps/web/src/App.css`
- Test: `apps/web/src/workflow-ui.test.mjs`

- [ ] **Step 1: Add tests for detail rows**

Append to `apps/web/src/workflow-ui.test.mjs`:

```js
test('getWorkflowNodeDetailRows summarizes inputs, progress, output, and error', () => {
  const rows = getWorkflowNodeDetailRows({
    id: 'generate',
    data: {
      keyword: '纯银项链',
      status: 'failed',
      progress: { current: 1, total: 3, percent: 33, message: '生成标题失败' },
      error: 'LLM timeout',
      outputSummary: '生成 2 个标题'
    }
  });

  assert.deepEqual(rows.map((row) => row.label), ['状态', '进度', '关键词', '输出摘要', '错误']);
  assert.equal(rows.find((row) => row.label === '状态').value, '失败');
  assert.match(rows.find((row) => row.label === '进度').value, /生成标题失败/);
});
```

- [ ] **Step 2: Implement detail helper**

Export this from `apps/web/src/workflow-ui.js`:

```js
export function getWorkflowNodeDetailRows(node = {}) {
  const data = node.data || {};
  const view = getWorkflowNodeViewModel(node.id, data);
  const rows = [
    { label: '状态', value: view.statusLabel }
  ];
  if (view.progressLabel) rows.push({ label: '进度', value: view.progressLabel });
  if (data.keyword) rows.push({ label: '关键词', value: data.keyword });
  if (data.count) rows.push({ label: '数量', value: `${data.count}` });
  if (data.maxLength) rows.push({ label: '标题长度', value: `${data.maxLength}` });
  if (view.outputSummary) rows.push({ label: '输出摘要', value: view.outputSummary });
  if (data.error) rows.push({ label: '错误', value: data.error });
  if (view.blockerMessage) rows.push({ label: view.blockerTitle || '提示', value: view.blockerMessage });
  return rows.filter((row) => row.value !== null && row.value !== undefined && String(row.value).trim() !== '');
}
```

- [ ] **Step 3: Use detail rows in the right panel**

In `apps/web/src/WorkflowStudio.jsx`, import `getWorkflowNodeDetailRows`.

Find the selected-node panel and replace ad hoc status/error/progress text with:

```jsx
{selectedNode && (
  <div className="workflow-detail-card">
    <div className="workflow-detail-card-head">
      <span>{selectedNode.data?.label || selectedNode.id}</span>
      <b>{getWorkflowNodeViewModel(selectedNode.id, selectedNode.data).statusLabel}</b>
    </div>
    <div className="workflow-detail-rows">
      {getWorkflowNodeDetailRows(selectedNode).map((row) => (
        <div className="workflow-detail-row" key={row.label}>
          <span>{row.label}</span>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 4: Add right-panel CSS**

Add:

```css
.workflow-detail-card {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--card-border);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.62);
}

.workflow-detail-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.workflow-detail-card-head span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-weight: 700;
}

.workflow-detail-card-head b {
  color: var(--text-secondary);
  font-size: 11px;
}

.workflow-detail-rows {
  display: grid;
  gap: 7px;
}

.workflow-detail-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  font-size: 12px;
}

.workflow-detail-row span {
  color: var(--text-muted);
}

.workflow-detail-row strong {
  min-width: 0;
  color: var(--text-secondary);
  font-weight: 500;
  overflow-wrap: anywhere;
}
```

- [ ] **Step 5: Run tests and build**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
npm run web:build
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/workflow-ui.js apps/web/src/workflow-ui.test.mjs apps/web/src/WorkflowStudio.jsx apps/web/src/App.css
git commit -m "feat: clarify workflow node details"
```

---

### Task 4: Improve Pause, Resume, and Retry Feedback

**Files:**
- Modify: `apps/web/src/WorkflowStudio.jsx`
- Test: `apps/web/src/workflow-ui.test.mjs`

- [ ] **Step 1: Add operation message helper tests**

Append to `apps/web/src/workflow-ui.test.mjs`:

```js
test('getWorkflowOperationMessage returns clear Chinese feedback', () => {
  assert.equal(getWorkflowOperationMessage('pause', 'success'), '已请求暂停，当前步骤会在安全边界停止。');
  assert.equal(getWorkflowOperationMessage('resume', 'success'), '已请求继续，流程会从当前节点恢复。');
  assert.equal(getWorkflowOperationMessage('retry-node', 'success'), '已请求重试，当前节点及下游步骤会重新执行。');
  assert.match(getWorkflowOperationMessage('retry-node', 'error', 'network'), /network/);
});
```

- [ ] **Step 2: Implement helper**

Export from `apps/web/src/workflow-ui.js`:

```js
export function getWorkflowOperationMessage(action, result, error = '') {
  if (result === 'error') {
    const prefix = action === 'pause'
      ? '暂停请求失败'
      : action === 'resume'
        ? '继续请求失败'
        : action === 'retry-node'
          ? '重试请求失败'
          : '操作失败';
    return `${prefix}: ${error || '未知错误'}`;
  }
  if (action === 'pause') return '已请求暂停，当前步骤会在安全边界停止。';
  if (action === 'resume') return '已请求继续，流程会从当前节点恢复。';
  if (action === 'retry-node') return '已请求重试，当前节点及下游步骤会重新执行。';
  return '操作已提交。';
}
```

- [ ] **Step 3: Use helper in operation handlers**

In `WorkflowStudio.jsx`, import `getWorkflowOperationMessage`.

In `handleCancelWorkflow`, keep cancel wording as-is. In `runWorkflowOperation`, after successful response and before `loadHistoryRun`, add:

```js
setLogs((prev) => [...prev, {
  timestamp: new Date().toISOString(),
  level: 'info',
  message: getWorkflowOperationMessage(action, 'success')
}]);
```

In the catch branch, replace `alert`-only feedback with:

```js
const message = getWorkflowOperationMessage(action, 'error', err.message);
setLogs((prev) => [...prev, {
  timestamp: new Date().toISOString(),
  level: 'error',
  message
}]);
alert(message);
```

- [ ] **Step 4: Run targeted tests**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs test/workflow-api-recovery.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/workflow-ui.js apps/web/src/workflow-ui.test.mjs apps/web/src/WorkflowStudio.jsx
git commit -m "feat: clarify workflow recovery feedback"
```

---

### Task 5: Monitor View Consistency and Final Verification

**Files:**
- Modify: `apps/web/src/WorkflowStudio.jsx`
- Modify: `apps/web/src/App.css`
- Modify: `README.md`

- [ ] **Step 1: Make monitor stage labels use the same status vocabulary**

In `MonitorStageNode`, replace the local `statusLabel` map with:

```js
const view = getWorkflowNodeViewModel(data.id, data);
const statusLabel = view.statusLabel;
```

Keep `monitor-node-${data.status || 'idle'}` classes unchanged to avoid a broad styling rewrite.

- [ ] **Step 2: Add selected monitor summary card**

In the monitor right-side panel, add a compact summary using existing `activeMonitorSummary`:

```jsx
{activeMonitorSummary && (
  <div className="workflow-detail-card">
    <div className="workflow-detail-card-head">
      <span>{activeMonitorSummary.runId}</span>
      <b>{labelPipelineStatus(activeMonitorSummary.status)}</b>
    </div>
    <div className="workflow-detail-rows">
      <div className="workflow-detail-row"><span>阶段</span><strong>{labelPipelineStage(activeMonitorSummary.stage)}</strong></div>
      <div className="workflow-detail-row"><span>更新时间</span><strong>{formatDateTime(activeMonitorSummary.updatedAt || activeMonitorSummary.startedAt)}</strong></div>
      {activeMonitorSummary.nextAction?.label && (
        <div className="workflow-detail-row"><span>下一步</span><strong>{activeMonitorSummary.nextAction.label}</strong></div>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 3: Update README**

In `README.md`, update the Workflow UI section with one sentence:

```md
流程画布会直接展示节点进度、阻塞原因、暂停/继续/重试入口和节点产物摘要，避免再跳转到独立监控页。
```

- [ ] **Step 4: Run complete verification**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs test/workflow-api-recovery.test.js core/test/workflow-pipeline-adapter.test.js
npm run web:build
npm test
git diff --check
```

Expected:

- All tests pass.
- Vite build completes.
- `git diff --check` prints no output.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/WorkflowStudio.jsx apps/web/src/App.css README.md
git commit -m "feat: polish workflow monitor usability"
```

---

## Self-Review

- Spec coverage: The plan covers unified state labels, per-node progress, pause/resume/retry actions, blocker explanations, selected-node details, and monitor consistency.
- Placeholder scan: No unfinished markers or unspecified edge-case steps remain.
- Type consistency: Helper names are consistent across tasks: `getWorkflowNodeViewModel`, `getWorkflowBlockerView`, `getWorkflowNodeDetailRows`, and `getWorkflowOperationMessage`.
- Scope check: This remains a frontend operability polish pass. It intentionally avoids backend workflow semantics, platform rate-limit policy changes, and new APIs.
