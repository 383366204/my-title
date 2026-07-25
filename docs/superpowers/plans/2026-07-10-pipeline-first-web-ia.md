# Pipeline-First Web IA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the web app open directly into one pipeline-centered workspace where workbench, keyword mining, SYCM verification, title generation, and review are operated through workflow nodes instead of separate top-level pages.

**Architecture:** Keep the existing production pipeline backend and `WorkflowStudio` canvas as the source of truth. Convert the old dashboard/mining/title pages into embedded node panels and route all durable actions through the selected pipeline run, while preserving old components until their node-panel replacements are verified.

**Tech Stack:** React, Vite, `@xyflow/react`, lucide-react, Node.js CommonJS backend APIs, `node:test`.

---

## Scope

This plan changes web information architecture only. It does not redesign the backend pipeline algorithm, SYCM scoring, 1688 search, or title-generation logic.

The finished UI should have one primary entry:

```text
选品流水线
```

Old top-level pages become node operation panels:

```text
工作台      -> 流水线概览 / 左侧状态栏 / 复核节点
挖词选品    -> 选词挖掘节点面板
标题生成    -> 标题货源生成节点面板
```

## File Structure

- Modify `apps/web/src/App.jsx`
  - Make `workflow` the default and only primary workspace.
  - Remove top-level navigation for `dashboard`, `mine`, and `title`.
  - Keep old page components exported or locally available for embedded reuse during migration.

- Modify `apps/web/src/WorkflowStudio.jsx`
  - Add a top pipeline status/primary-action strip.
  - Replace navigation redirects with node selection.
  - Mount node-specific operation panels in the right detail panel.

- Modify `apps/web/src/workflow-ui.js`
  - Add pure helpers for pipeline-first navigation, node-to-panel routing, and top-level action labels.

- Modify `apps/web/src/workflow-ui.test.mjs`
  - Cover all new helpers before component changes.

- Modify `apps/web/src/pipeline-action-view.js`
  - Change target tabs from old page ids to workflow node ids.

- Modify `apps/web/src/App.css`
  - Hide or remove old nav styling only after component tests pass.
  - Add styles for the top workflow action strip and embedded node panels.

- Keep backend files unchanged for this phase unless tests expose a missing endpoint.

---

## Target UX

### Main Shell

```text
┌──────────────────────────────────────────────────────────────┐
│  当前流程：每日蓝海选品流水线  状态：生意参谋校验阻塞        │
│  主操作：启动 Chrome 并打开生意参谋  暂停  继续  取消        │
├───────────────┬──────────────────────────┬───────────────────┤
│ 模板 / 历史    │ 可执行流程画布             │ 当前节点操作台      │
│ 平台状态       │                          │ 产物 / 阻塞 / 操作  │
├───────────────┴──────────────────────────┴───────────────────┤
│ 实时日志 / 最近节点输出                                       │
└──────────────────────────────────────────────────────────────┘
```

### Node Panels

```text
开始节点        -> 模板选择、精确关键词、每日参数
选词挖掘节点    -> 种子池、词根发现、候选词、加入当前流程
生意参谋校验节点 -> Chrome 状态、启动 Chrome、重试校验、指标表
标题生成节点    -> 已验真词、生成标题、货源卡片、加入复核
人工复核节点    -> 待确认铺货、风险项、复制标题、打开货源
完成节点        -> 导出文件、批次结果、耗时和通过率
```

---

## Task 1: Add Pipeline-First Routing Helpers

**Files:**
- Modify: `apps/web/src/workflow-ui.js`
- Test: `apps/web/src/workflow-ui.test.mjs`

- [ ] **Step 1: Write failing tests**

Append these imports in `apps/web/src/workflow-ui.test.mjs`:

```js
import {
  getPipelineFirstNavItems,
  getWorkflowNodeIdForLegacyTarget,
  getPipelineFirstActionTarget
} from './workflow-ui.js';
```

Append these tests:

```js
test('getPipelineFirstNavItems exposes only the pipeline workspace by default', () => {
  assert.deepEqual(getPipelineFirstNavItems(), [
    { id: 'workflow', label: '选品流水线' }
  ]);
});

test('getWorkflowNodeIdForLegacyTarget maps old pages to pipeline nodes', () => {
  assert.equal(getWorkflowNodeIdForLegacyTarget('dashboard'), 'review');
  assert.equal(getWorkflowNodeIdForLegacyTarget('mine'), 'mine');
  assert.equal(getWorkflowNodeIdForLegacyTarget('title'), 'generate');
  assert.equal(getWorkflowNodeIdForLegacyTarget('workflow'), '');
  assert.equal(getWorkflowNodeIdForLegacyTarget('unknown'), '');
});

test('getPipelineFirstActionTarget converts old next actions to node selection intents', () => {
  assert.deepEqual(getPipelineFirstActionTarget({ targetTab: 'mine', step: 'verify' }), {
    type: 'select-node',
    nodeId: 'verify'
  });
  assert.deepEqual(getPipelineFirstActionTarget({ targetTab: 'title', step: 'generate' }), {
    type: 'select-node',
    nodeId: 'generate'
  });
  assert.deepEqual(getPipelineFirstActionTarget({ targetTab: 'dashboard', step: 'review' }), {
    type: 'select-node',
    nodeId: 'review'
  });
  assert.deepEqual(getPipelineFirstActionTarget({ targetTab: 'workflow' }), {
    type: 'workspace',
    nodeId: ''
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
```

Expected: FAIL because the helpers are not exported.

- [ ] **Step 3: Implement helper functions**

Add to `apps/web/src/workflow-ui.js`:

```js
const PIPELINE_FIRST_NAV_ITEMS = [
  { id: 'workflow', label: '选品流水线' }
];

const LEGACY_TARGET_NODE = {
  dashboard: 'review',
  mine: 'mine',
  title: 'generate'
};

const STEP_NODE = {
  start: 'start',
  mine: 'mine',
  verify: 'verify',
  generate: 'generate',
  export: 'export',
  review: 'review',
  submit: 'review'
};

export function getPipelineFirstNavItems() {
  return PIPELINE_FIRST_NAV_ITEMS.map((item) => ({ ...item }));
}

export function getWorkflowNodeIdForLegacyTarget(targetTab) {
  return LEGACY_TARGET_NODE[String(targetTab || '')] || '';
}

export function getPipelineFirstActionTarget(action = {}) {
  const stepNode = STEP_NODE[String(action.step || '')] || '';
  const legacyNode = getWorkflowNodeIdForLegacyTarget(action.targetTab);
  const nodeId = stepNode || legacyNode;
  if (nodeId) return { type: 'select-node', nodeId };
  return { type: 'workspace', nodeId: '' };
}
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
```

Expected: PASS.

---

## Task 2: Make Workflow the Default Single Workspace

**Files:**
- Modify: `apps/web/src/App.jsx`
- Test: `apps/web/src/workflow-ui.test.mjs`

- [ ] **Step 1: Write failing test for nav helper usage**

In `apps/web/src/workflow-ui.test.mjs`, extend the `getPipelineFirstNavItems` test:

```js
const navItems = getPipelineFirstNavItems();
assert.equal(navItems.some((item) => item.id === 'dashboard'), false);
assert.equal(navItems.some((item) => item.id === 'mine'), false);
assert.equal(navItems.some((item) => item.id === 'title'), false);
```

- [ ] **Step 2: Run test**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
```

Expected: PASS after Task 1. This protects the intended IA while changing `App.jsx`.

- [ ] **Step 3: Update imports in `App.jsx`**

Add imports:

```js
import {
  getPipelineFirstNavItems,
  getPipelineFirstActionTarget
} from './workflow-ui.js';
```

Change `NAV_ITEMS` to:

```js
const NAV_ITEMS = getPipelineFirstNavItems().map((item) => ({
  ...item,
  icon: FlaskConical
}));
```

- [ ] **Step 4: Default to workflow**

Change:

```js
const [activeTab, setActiveTab] = useState('dashboard');
```

to:

```js
const [activeTab, setActiveTab] = useState('workflow');
```

- [ ] **Step 5: Remove workflow special-case rendering**

Replace:

```jsx
if (activeTab === 'workflow') {
  return (
    <AppShell activeTab={activeTab} setActiveTab={setActiveTab}>
      <div className="studio-host">
        <WorkflowStudio key={activeTab} initialMode="monitor" onNavigate={setActiveTab} />
      </div>
    </AppShell>
  );
}
```

with no special branch. Keep one final return that renders `WorkflowStudio` when `activeTab === 'workflow'`.

- [ ] **Step 6: Render only workflow for normal use**

In the final return, keep:

```jsx
{activeTab === 'workflow' && (
  <div className="studio-host">
    <WorkflowStudio
      key={activeTab}
      initialMode="monitor"
      onNavigate={(target) => {
        const intent = getPipelineFirstActionTarget({ targetTab: target });
        if (intent.type === 'select-node') {
          window.dispatchEvent(new CustomEvent('workflow:select-node', { detail: { nodeId: intent.nodeId } }));
        }
        setActiveTab('workflow');
      }}
    />
  </div>
)}
```

Keep the old `DashboardView`, `MiningView`, and `TitleView` definitions in the file for Task 4 extraction, but do not render them as top-level tabs.

- [ ] **Step 7: Run build**

Run:

```bash
cd apps/web && npm run build
```

Expected: Vite build succeeds.

---

## Task 3: Replace Cross-Page Navigation with Node Selection

**Files:**
- Modify: `apps/web/src/WorkflowStudio.jsx`
- Modify: `apps/web/src/workflow-ui.js`
- Test: `apps/web/src/workflow-ui.test.mjs`

- [ ] **Step 1: Add failing tests for blocker actions**

Append:

```js
test('getPipelineFirstActionTarget selects mine node for mine-more recovery', () => {
  assert.deepEqual(getPipelineFirstActionTarget({ targetTab: 'mine', step: 'mine' }), {
    type: 'select-node',
    nodeId: 'mine'
  });
});
```

- [ ] **Step 2: Run tests**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
```

Expected: PASS after Task 1 because `step: mine` is already mapped.

- [ ] **Step 3: Add external node selection listener**

In `WorkflowStudio.jsx`, add this effect near other effects:

```jsx
useEffect(() => {
  const handleSelectNode = (event) => {
    const nodeId = event.detail?.nodeId;
    if (!nodeId) return;
    setSelectedNodeId(nodeId);
    setTimeout(() => {
      loadNodeArtifact(nodeId).catch(() => {});
    }, 0);
  };
  window.addEventListener('workflow:select-node', handleSelectNode);
  return () => window.removeEventListener('workflow:select-node', handleSelectNode);
}, [loadNodeArtifact]);
```

- [ ] **Step 4: Change `mine-more` recovery**

Replace:

```js
if (action === 'mine-more') {
  onNavigate?.('mine');
  const message = '已切到挖词选品页。补充候选词后回到选品流水线重跑验真。';
  setLogs((prev) => [...prev, {
    timestamp: new Date().toISOString(),
    level: 'info',
    message
  }]);
  return;
}
```

with:

```js
if (action === 'mine-more') {
  setSelectedNodeId('mine');
  await loadNodeArtifact('mine').catch(() => {});
  setLogs((prev) => [...prev, {
    timestamp: new Date().toISOString(),
    level: 'info',
    message: '已选中选词挖掘节点。请在右侧补充候选词后重跑生意参谋校验。'
  }]);
  return;
}
```

- [ ] **Step 5: Run build**

Run:

```bash
cd apps/web && npm run build
```

Expected: PASS.

---

## Task 4: Add Embedded Node Panel Shells

**Files:**
- Modify: `apps/web/src/WorkflowStudio.jsx`
- Modify: `apps/web/src/App.css`
- Test: `apps/web/src/workflow-ui.test.mjs`

- [ ] **Step 1: Add node panel kind helper tests**

Import and test:

```js
import { getWorkflowNodePanelKind } from './workflow-ui.js';

test('getWorkflowNodePanelKind maps production nodes to embedded panels', () => {
  assert.equal(getWorkflowNodePanelKind('start'), 'start-config');
  assert.equal(getWorkflowNodePanelKind('mine'), 'keyword-mining');
  assert.equal(getWorkflowNodePanelKind('verify'), 'sycm-verify');
  assert.equal(getWorkflowNodePanelKind('generate'), 'title-generate');
  assert.equal(getWorkflowNodePanelKind('review'), 'review');
  assert.equal(getWorkflowNodePanelKind('end'), 'completion');
  assert.equal(getWorkflowNodePanelKind('other'), 'artifact');
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
```

Expected: FAIL because `getWorkflowNodePanelKind` is not exported.

- [ ] **Step 3: Implement helper**

Add to `workflow-ui.js`:

```js
export function getWorkflowNodePanelKind(nodeId) {
  const normalized = String(nodeId || '');
  if (normalized === 'start') return 'start-config';
  if (normalized === 'mine') return 'keyword-mining';
  if (normalized === 'verify') return 'sycm-verify';
  if (normalized === 'generate') return 'title-generate';
  if (normalized === 'review') return 'review';
  if (normalized === 'end') return 'completion';
  return 'artifact';
}
```

- [ ] **Step 4: Add panel shell component**

In `WorkflowStudio.jsx`, add:

```jsx
const NodeOperationPanel = ({ selectedNode, artifactState }) => {
  const kind = getWorkflowNodePanelKind(selectedNode?.id);
  if (kind === 'keyword-mining') {
    return (
      <div className="node-operation-panel">
        <h3>选词挖掘操作台</h3>
        <p>候选词、种子池和词根发现将在这里操作；当前先显示节点产物。</p>
        <ArtifactPanel state={artifactState} />
      </div>
    );
  }
  if (kind === 'sycm-verify') {
    return (
      <div className="node-operation-panel">
        <h3>生意参谋校验操作台</h3>
        <p>Chrome 状态、阻塞原因、重试校验和指标表将在这里操作。</p>
        <ArtifactPanel state={artifactState} />
      </div>
    );
  }
  if (kind === 'title-generate') {
    return (
      <div className="node-operation-panel">
        <h3>标题货源生成操作台</h3>
        <p>已验真词、标题生成和货源卡片将在这里操作。</p>
        <ArtifactPanel state={artifactState} />
      </div>
    );
  }
  if (kind === 'review') {
    return (
      <div className="node-operation-panel">
        <h3>人工复核操作台</h3>
        <p>待确认铺货、风险项和复核动作将在这里操作。</p>
        <ArtifactPanel state={artifactState} />
      </div>
    );
  }
  return <ArtifactPanel state={artifactState} />;
};
```

- [ ] **Step 5: Replace direct artifact panel**

Replace:

```jsx
<ArtifactPanel state={artifactState} />
```

with:

```jsx
<NodeOperationPanel selectedNode={selectedNode} artifactState={artifactState} />
```

- [ ] **Step 6: Add minimal styles**

Add to `App.css`:

```css
.node-operation-panel {
  display: grid;
  gap: 12px;
}

.node-operation-panel h3 {
  margin: 0;
  font-size: 13px;
  color: #e2e8f0;
}

.node-operation-panel p {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: #94a3b8;
}
```

- [ ] **Step 7: Run tests and build**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
cd apps/web && npm run build
```

Expected: both PASS.

---

## Task 5: Move Pipeline Overview Into WorkflowStudio

**Files:**
- Modify: `apps/web/src/WorkflowStudio.jsx`
- Modify: `apps/web/src/App.css`

- [ ] **Step 1: Add top action strip component**

In `WorkflowStudio.jsx`, add:

```jsx
const WorkflowTopActionStrip = ({ runStatus, currentRunId, activeNodeId, onRun, onPause, onCancel, canCancelRun, running }) => (
  <div className="workflow-top-action-strip">
    <div>
      <span>当前流程</span>
      <strong>{currentRunId || '未开始'}</strong>
      <small>当前节点：{activeNodeId || '开始'}</small>
    </div>
    <div className="workflow-top-status">
      <b>{runStatus || 'idle'}</b>
      {running ? (
        <>
          <button type="button" className="secondary-button" onClick={onPause}>暂停</button>
          <button type="button" className="secondary-button danger" onClick={onCancel} disabled={!canCancelRun}>取消</button>
        </>
      ) : (
        <button type="button" className="primary-button" onClick={onRun}>运行工作流</button>
      )}
    </div>
  </div>
);
```

- [ ] **Step 2: Mount it above the canvas**

Place it in the main middle column above the existing toolbar:

```jsx
<WorkflowTopActionStrip
  runStatus={runStatus}
  currentRunId={currentRunId}
  activeNodeId={selectedNodeId}
  running={running}
  onRun={handleRunWorkflow}
  onPause={() => runWorkflowOperation('pause')}
  onCancel={handleCancelWorkflow}
  canCancelRun={canCancelRun}
/>
```

- [ ] **Step 3: Keep old toolbar buttons during this phase**

Do not remove existing run/pause/cancel buttons yet. The first pass should duplicate controls briefly so behavior can be compared.

- [ ] **Step 4: Add styles**

Add:

```css
.workflow-top-action-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid #1e293b;
  background: #0f172a;
}

.workflow-top-action-strip span,
.workflow-top-action-strip small {
  display: block;
  font-size: 11px;
  color: #94a3b8;
}

.workflow-top-action-strip strong {
  display: block;
  margin-top: 2px;
  font-size: 13px;
  color: #e2e8f0;
}

.workflow-top-status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.workflow-top-status b {
  font-size: 12px;
  color: #bfdbfe;
}
```

- [ ] **Step 5: Build**

Run:

```bash
cd apps/web && npm run build
```

Expected: PASS.

---

## Task 6: Migrate Old Page Copy and Actions to Pipeline-First Language

**Files:**
- Modify: `apps/web/src/pipeline-action-view.js`
- Modify: `apps/web/src/workflow-ui.js`
- Test: `apps/web/src/workflow-ui.test.mjs`

- [ ] **Step 1: Update `pipeline-action-view.js` target semantics**

Change return values so the labels remain user-facing but targets no longer imply old pages:

```js
if (!run || !run.runId) {
  return {
    label: '启动每日流程',
    targetTab: 'workflow',
    step: 'start',
    tone: 'default',
    description: '还没有当前流程，先在流水线开始节点启动每日选品。'
  };
}
```

For mined/verified/generated cases, keep `targetTab: 'workflow'` and set `step`:

```js
step: 'mine'
step: 'verify'
step: 'generate'
step: 'review'
```

- [ ] **Step 2: Add regression tests**

Append:

```js
test('pipeline action targets remain inside workflow workspace', () => {
  assert.deepEqual(getPipelineFirstActionTarget({ targetTab: 'workflow', step: 'verify' }), {
    type: 'select-node',
    nodeId: 'verify'
  });
  assert.deepEqual(getPipelineFirstActionTarget({ targetTab: 'workflow', step: 'review' }), {
    type: 'select-node',
    nodeId: 'review'
  });
});
```

- [ ] **Step 3: Run tests**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
```

Expected: PASS.

---

## Task 7: Manual Browser Verification

**Files:**
- No code changes.

- [ ] **Step 1: Start services**

Run:

```bash
node bin/server.js
cd apps/web && npm run dev -- --host 127.0.0.1
```

Expected:

```text
Local Web UI 服务已启动
Vite dev server listening on 127.0.0.1
```

- [ ] **Step 2: Open app**

Open:

```text
http://127.0.0.1:5173/
```

Expected:

```text
The first screen is 选品流水线, not 工作台.
```

- [ ] **Step 3: Verify old nav is gone**

Confirm sidebar does not show:

```text
工作台
挖词选品
标题生成
```

Confirm it shows:

```text
选品流水线
```

- [ ] **Step 4: Verify node selection replaces page jumps**

Click a run blocker action that previously navigated to mining.

Expected:

```text
The selected node becomes 选词挖掘.
The URL and primary workspace remain on 选品流水线.
The right panel changes instead of changing pages.
```

- [ ] **Step 5: Verify SYCM action**

Select `生意参谋校验` and click `启动 Chrome`.

Expected:

```text
Chrome opens or reuses port 9222.
The page opens https://sycm.taobao.com/mc/free/search_analysis or the SYCM login redirect.
The workflow remains selected.
```

---

## Task 8: Final Verification

**Files:**
- No code changes unless verification fails.

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
node --test core/test/workflow-pipeline-adapter.test.js
node --test test/workflow-api-recovery.test.js
```

Expected:

```text
pass 0 fail
```

- [ ] **Step 2: Run production build**

Run:

```bash
cd apps/web && npm run build
```

Expected:

```text
✓ built
```

- [ ] **Step 3: Check whitespace**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Review changed files**

Run:

```bash
git diff --stat
```

Expected changed files include only:

```text
apps/web/src/App.jsx
apps/web/src/WorkflowStudio.jsx
apps/web/src/workflow-ui.js
apps/web/src/workflow-ui.test.mjs
apps/web/src/pipeline-action-view.js
apps/web/src/App.css
```

If unrelated backend files appear, inspect and separate them before committing.

---

## Self-Review

Spec coverage:
- Single primary pipeline entry is covered by Tasks 1 and 2.
- Old page jumps are replaced by node selection in Tasks 3 and 6.
- Embedded node panel migration starts safely in Task 4.
- Pipeline overview moves into the workflow page in Task 5.
- Browser-level UX verification is covered by Task 7.

Placeholder scan:
- This plan contains no placeholder markers or open-ended implementation steps.
- Every code-changing step includes concrete code or exact replacement guidance.

Type consistency:
- Helper names are consistent across test and implementation steps:
  - `getPipelineFirstNavItems`
  - `getWorkflowNodeIdForLegacyTarget`
  - `getPipelineFirstActionTarget`
  - `getWorkflowNodePanelKind`

Risk controls:
- Old page components are not deleted in this phase.
- Backend APIs remain unchanged.
- The first implementation hides old top-level pages and introduces embedded panels, then later phases can move full component internals node by node.
