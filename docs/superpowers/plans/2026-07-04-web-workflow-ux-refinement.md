# Web Workflow UX Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the unified React web workflow easier to understand and operate by turning the current pipeline state into clear next-step guidance, separating durable pipeline actions from temporary exploration, and making the canvas feel like part of the same product.

**Architecture:** Keep the existing unified `/api/pipeline/*` backend as the source of truth. Add small frontend helpers for pipeline action copy and CTA decisions, then reuse those helpers in Dashboard, Mining, Title, and WorkflowStudio. Avoid changing keyword scoring, SYCM thresholds, runtime internals, or distribution submission behavior in this pass.

**Tech Stack:** React/Vite frontend in `apps/web/src`, existing CommonJS Node backend only for route compatibility checks, `node:test`, browser smoke via local `node bin/server.js`.

---

## Current Problem

The previous pass unified the web app around one durable pipeline run, but the interaction still has rough edges:

- Dashboard, Mining, Title, and WorkflowStudio now share pipeline data, but each page phrases the flow differently.
- Mining page has both durable pipeline actions and temporary SSE mining, yet they are visually close enough to feel like competing primary actions.
- Title page lists verified pipeline keywords, but clicking one only changes the keyword input. It does not carry a verified safety context, so the user can still feel unsure whether the word is safe for review.
- Workflow canvas is reachable through "开发调试", which makes the production workflow feel experimental even after being unified.
- Some canvas labels still expose raw status/stage strings such as `ready_to_distribute`, `verified`, or English template labels.

The refinement target is:

```text
One current run -> one obvious next step -> page-specific tools that either advance the run or clearly stay temporary
```

## File Structure

### Frontend Helpers

- Create `apps/web/src/pipeline-action-view.js`
  - Owns user-facing next-step labels, page targets, CTA tone, and compact run summary copy.
  - Keeps App and WorkflowStudio from duplicating status interpretation.

- Modify `apps/web/src/workflow-ui.test.mjs`
  - Add unit tests for the new helper.
  - Keep existing workflow-ui tests unchanged.

### Main React App

- Modify `apps/web/src/App.jsx`
  - Add a first-class nav item for "流程画布".
  - Replace "开发调试" labels with production wording.
  - Rework Dashboard CTA row to show a single primary next-step action.
  - Split Mining page actions into durable pipeline operation and temporary exploration.
  - Let Title page import verified pipeline keywords as verified source candidates.

- Modify `apps/web/src/App.css`
  - Add focused styles for the action rail, durable/temporary mining sections, verified keyword rows, and responsive wrapping.
  - Reuse existing dark operational styling, 8px radius, restrained colors.

### Workflow Canvas

- Modify `apps/web/src/WorkflowStudio.jsx`
  - Rename visible headings from "开发调试"/mixed production text to "流程画布" and "流程编排".
  - Show current selected run and next-step copy using `getPipelineActionView`.
  - Localize raw status/stage labels where visible.

---

## Task 1: Add Shared Pipeline Action View Helper

**Files:**
- Create: `apps/web/src/pipeline-action-view.js`
- Modify: `apps/web/src/workflow-ui.test.mjs`

- [ ] **Step 1: Write failing tests**

Add this import near the top of `apps/web/src/workflow-ui.test.mjs`:

```js
import {
  getPipelineActionView,
  getPipelineSummaryText,
  normalizeVerifiedKeywordForTitle
} from './pipeline-action-view.js';
```

Append these tests:

```js
test('getPipelineActionView returns one primary CTA per pipeline stage', () => {
  assert.deepEqual(getPipelineActionView({ status: 'mined', stage: 'mined' }), {
    label: '执行大盘验真',
    targetTab: 'mine',
    step: 'verify',
    tone: 'default',
    description: '候选词已经准备好，下一步需要用生意参谋等指标验真。'
  });

  assert.deepEqual(getPipelineActionView({ status: 'verified', stage: 'verified' }), {
    label: '生成标题货源',
    targetTab: 'title',
    step: 'generate',
    tone: 'default',
    description: '已有通过验真的关键词，可以进入标题和货源生成。'
  });

  assert.equal(getPipelineActionView({ status: 'needs_review', stage: 'review' }).tone, 'warn');
  assert.equal(getPipelineActionView({ status: 'ready_to_distribute', stage: 'ready' }).label, '确认铺货清单');
});

test('getPipelineSummaryText summarizes empty and active runs', () => {
  assert.equal(getPipelineSummaryText(null), '暂无当前流程');
  assert.equal(getPipelineSummaryText({
    runId: '2026-07-04-120000',
    status: 'mined',
    counts: { candidates: 12, sycmVerified: 0, generatedProducts: 0 }
  }), '候选词 12 个 · 验真通过 0 个 · 标题货源 0 个');
});

test('normalizeVerifiedKeywordForTitle preserves verified safety context', () => {
  const candidate = normalizeVerifiedKeywordForTitle({
    keyword: '纯银项链女',
    sycmScore: { score: 86, reason: '搜索人气和供需通过' },
    sycmData: { searchPopularity: 2300, demandSupplyRatio: 1.8 }
  });

  assert.equal(candidate.keyword, '纯银项链女');
  assert.equal(candidate.canDistribute, true);
  assert.equal(candidate.gateStatus, 'verified');
  assert.equal(candidate.localScore, 86);
  assert.equal(candidate.sycmData.searchPopularity, 2300);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
```

Expected: FAIL with `Cannot find module './pipeline-action-view.js'`.

- [ ] **Step 3: Create `apps/web/src/pipeline-action-view.js`**

Create the file with:

```js
import { labelPipelineStatus } from './pipeline-labels.js';

const DEFAULT_ACTION = {
  label: '查看当前流程',
  targetTab: 'dashboard',
  step: '',
  tone: 'default',
  description: '流程记录已更新，可以从工作台查看当前状态。'
};

export function getPipelineActionView(run = {}) {
  const status = String(run.status || '').toLowerCase();
  const stage = String(run.stage || '').toLowerCase();
  if (!run || !run.runId) {
    return {
      label: '启动每日流程',
      targetTab: 'dashboard',
      step: 'start',
      tone: 'default',
      description: '还没有当前流程，先从工作台启动每日选品。'
    };
  }
  if (status === 'created' || stage === 'seed') {
    return {
      label: '开始挖词',
      targetTab: 'mine',
      step: 'mine',
      tone: 'default',
      description: '流程已创建，下一步是生成候选关键词。'
    };
  }
  if (status === 'mined' || stage === 'mined' || stage === 'candidate') {
    return {
      label: '执行大盘验真',
      targetTab: 'mine',
      step: 'verify',
      tone: 'default',
      description: '候选词已经准备好，下一步需要用生意参谋等指标验真。'
    };
  }
  if (status === 'verified' || stage === 'verified') {
    return {
      label: '生成标题货源',
      targetTab: 'title',
      step: 'generate',
      tone: 'default',
      description: '已有通过验真的关键词，可以进入标题和货源生成。'
    };
  }
  if (status === 'generated' || stage === 'generated') {
    return {
      label: '查看标题货源',
      targetTab: 'title',
      step: 'export',
      tone: 'default',
      description: '标题和货源已生成，可以检查商品并加入复核。'
    };
  }
  if (status === 'needs_review' || stage === 'review') {
    return {
      label: '处理人工复核',
      targetTab: 'dashboard',
      step: 'review',
      tone: 'warn',
      description: '存在需要人工确认的标题、货源或风险项。'
    };
  }
  if (status === 'ready_to_distribute' || status === 'awaiting_user_confirmation' || stage === 'ready') {
    return {
      label: '确认铺货清单',
      targetTab: 'dashboard',
      step: 'submit',
      tone: 'warn',
      description: '铺货清单已准备好，提交前需要人工确认。'
    };
  }
  if (status === 'workflow_complete' || status === 'submitted' || stage === 'submitted') {
    return {
      label: '查看已提交结果',
      targetTab: 'dashboard',
      step: '',
      tone: 'success',
      description: '当前流程已经提交完成，可以查看批次记录。'
    };
  }
  if (status === 'manual_action_required' || status === 'verified_partial_manual_required' || status === 'verified_empty') {
    return {
      label: '处理验真阻塞',
      targetTab: 'mine',
      step: 'verify',
      tone: 'warn',
      description: '验真阶段需要人工处理或更换候选词。'
    };
  }
  return {
    ...DEFAULT_ACTION,
    description: `${labelPipelineStatus(status)}，可以从工作台查看当前状态。`
  };
}

export function getPipelineSummaryText(run = null) {
  if (!run || !run.runId) return '暂无当前流程';
  const counts = run.counts || {};
  return [
    `候选词 ${counts.candidates || 0} 个`,
    `验真通过 ${counts.sycmVerified || 0} 个`,
    `标题货源 ${counts.generatedProducts || 0} 个`
  ].join(' · ');
}

export function normalizeVerifiedKeywordForTitle(row = {}) {
  const score = Number(row.sycmScore?.score ?? row.localScore ?? row.score ?? 0);
  return {
    ...row,
    keyword: String(row.keyword || row.word || '').trim(),
    localScore: Number.isFinite(score) && score > 0 ? score : 80,
    source: row.source || 'pipeline_verified',
    gateStatus: 'verified',
    gateReason: row.sycmScore?.reason || row.reason || '当前流程已验真',
    canDistribute: true,
    sycmData: row.sycmData || row.market || {}
  };
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pipeline-action-view.js apps/web/src/workflow-ui.test.mjs
git commit -m "feat: add pipeline action view helpers"
```

---

## Task 2: Make Dashboard Next-Step Guidance Explicit

**Files:**
- Modify: `apps/web/src/App.jsx`
- Modify: `apps/web/src/App.css`
- Test: `apps/web/src/workflow-ui.test.mjs`

- [ ] **Step 1: Import the new helpers in `App.jsx`**

Add this import next to the existing local imports:

```js
import {
  getPipelineActionView,
  getPipelineSummaryText,
  normalizeVerifiedKeywordForTitle
} from './pipeline-action-view.js';
```

- [ ] **Step 2: Replace `FlowStatusPanel` action derivation**

Inside `FlowStatusPanel`, replace:

```js
const action = getWorkflowAction(run);
const statusText = run.status || 'unknown';
const nextActionText = labelNextAction(run);
```

with:

```js
const action = getPipelineActionView(run);
const statusText = run.status || 'unknown';
const nextActionText = labelNextAction(run);
const summaryText = getPipelineSummaryText(run);
```

- [ ] **Step 3: Add summary copy under the run id**

After:

```jsx
<strong>{run.runId}</strong>
```

add:

```jsx
<p>{summaryText}</p>
```

- [ ] **Step 4: Replace the next-action copy**

Inside `.next-action-card`, replace:

```jsx
<p>{nextActionText}</p>
```

with:

```jsx
<p>{action.description}</p>
<small>{nextActionText}</small>
```

- [ ] **Step 5: Make the primary action visually distinct**

In the `.flow-action-row`, replace the first button class:

```jsx
className="secondary-button"
```

with:

```jsx
className={`secondary-button flow-primary-action ${action.tone === 'warn' ? 'flow-primary-warn' : ''}`}
```

- [ ] **Step 6: Add CSS for the dashboard action hierarchy**

Append near `.flow-action-row` in `apps/web/src/App.css`:

```css
.next-action-card small {
  display: block;
  margin-top: 5px;
  color: var(--text-muted);
  font-size: 11px;
}

.flow-primary-action {
  border-color: rgba(20, 184, 166, 0.55);
  background: rgba(20, 184, 166, 0.12);
  color: #99f6e4;
  font-weight: 800;
}

.flow-primary-warn {
  border-color: rgba(245, 158, 11, 0.5);
  background: rgba(120, 53, 15, 0.18);
  color: #fde68a;
}
```

- [ ] **Step 7: Build**

Run:

```bash
npm run web:build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/App.jsx apps/web/src/App.css
git commit -m "fix: clarify dashboard next action"
```

---

## Task 3: Split Mining Into Pipeline Mode and Temporary Exploration

**Files:**
- Modify: `apps/web/src/App.jsx`
- Modify: `apps/web/src/App.css`

- [ ] **Step 1: Rename the Mining page subtitle**

In `MiningView`, replace the `PageHeader` subtitle:

```jsx
subtitle="种子池、词根挖掘、SSE 挖词结果在同一页完成，结果可直接送入标题生成。"
```

with:

```jsx
subtitle="优先推进当前流程；临时挖词和词根发现只用于探索，确认后再加入流程。"
```

- [ ] **Step 2: Add current next-step copy in the pipeline band**

At the start of `MiningView`, after `eventSourceRef`, add:

```js
const pipelineAction = getPipelineActionView(pipeline.currentRun);
const pipelineSummary = getPipelineSummaryText(pipeline.currentRun);
```

In `.pipeline-context-band`, replace the `<p>` content with:

```jsx
{pipeline.currentRun ? pipelineSummary : pipelineAction.description}
```

Under that `<p>`, add:

```jsx
<small>{pipelineAction.description}</small>
```

- [ ] **Step 3: Add verify step action**

After `runPipelineMine`, add:

```js
const runPipelineVerify = async () => {
  setPipelineBusy('verify');
  setPipelineMessage('');
  try {
    const result = await pipeline.runStep('verify', { limit: config.count });
    setPipelineMessage(`大盘验真完成，通过 ${result.currentRun?.counts?.sycmVerified ?? 0} 个。`);
  } catch (err) {
    setPipelineMessage(err.message);
  } finally {
    setPipelineBusy('');
  }
};
```

- [ ] **Step 4: Add a verify button beside mine**

Inside `.context-actions`, after the mine button, add:

```jsx
<button className="secondary-button" type="button" onClick={runPipelineVerify} disabled={!pipeline.currentRun || Boolean(pipelineBusy)}>
  {pipelineBusy === 'verify' ? <RefreshCw size={15} className="spin" /> : <CheckCircle2 size={15} />}
  执行大盘验真
</button>
```

- [ ] **Step 5: Wrap temporary mining area in a dedicated class**

Change:

```jsx
<section className="table-panel">
```

for the "自动挖词流" section only to:

```jsx
<section className="table-panel temporary-mining-panel">
```

Change its title row from:

```jsx
<h3>自动挖词流</h3>
<span className="tiny-muted">候选词会做去重、验真和质量分层</span>
```

to:

```jsx
<h3>临时探索挖词</h3>
<span className="tiny-muted">不自动推进当前流程</span>
```

- [ ] **Step 6: Add CSS for the split**

Append near `.pipeline-context-band`:

```css
.pipeline-context-band small {
  display: block;
  margin-top: 5px;
  color: var(--text-muted);
  font-size: 11px;
}

.temporary-mining-panel {
  border-style: dashed;
  background: rgba(255, 255, 255, 0.026);
}

.temporary-mining-panel .primary-button {
  border-color: #334155;
  background: #1f2937;
  color: #cbd5e1;
}
```

- [ ] **Step 7: Build**

Run:

```bash
npm run web:build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/App.jsx apps/web/src/App.css
git commit -m "fix: separate pipeline mining from exploration"
```

---

## Task 4: Make Verified Pipeline Keywords Carry Safety Into Title Generation

**Files:**
- Modify: `apps/web/src/App.jsx`
- Test: `apps/web/src/workflow-ui.test.mjs`

- [ ] **Step 1: Add a title import callback**

In `TitleView`, add this prop:

```js
function TitleView({ sourceCandidate, onAddReviewProduct, historyService, pipeline, onUseVerifiedKeyword }) {
```

- [ ] **Step 2: Replace verified keyword chip click behavior**

Inside verified keyword mapping, replace:

```jsx
onClick={() => setForm((current) => ({ ...current, keyword: item.keyword }))}
```

with:

```jsx
onClick={() => onUseVerifiedKeyword(item)}
```

- [ ] **Step 3: Add App-level callback**

In `App`, before the return, add:

```js
const useVerifiedKeywordForTitle = (row) => {
  const candidate = normalizeCandidateForTitle(normalizeVerifiedKeywordForTitle(row));
  setSourceCandidate(candidate);
  setActiveTab('title');
};
```

- [ ] **Step 4: Pass callback into `TitleView`**

Add the prop:

```jsx
onUseVerifiedKeyword={useVerifiedKeywordForTitle}
```

- [ ] **Step 5: Make empty verified keyword copy actionable**

Replace:

```jsx
当前流程还没有已验真关键词，可以先去挖词页运行验真。
```

with:

```jsx
当前流程还没有已验真关键词。请先在挖词页执行“大盘验真”。
```

- [ ] **Step 6: Run tests and build**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
npm run web:build
```

Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/App.jsx apps/web/src/workflow-ui.test.mjs
git commit -m "fix: preserve verified keyword context"
```

---

## Task 5: Make Workflow Canvas a First-Class Same-Page Tool

**Files:**
- Modify: `apps/web/src/App.jsx`
- Modify: `apps/web/src/WorkflowStudio.jsx`
- Modify: `apps/web/src/App.css`

- [ ] **Step 1: Add canvas to top-level navigation**

In `NAV_ITEMS`, add:

```js
{ id: 'workflow', label: '流程画布', icon: FlaskConical }
```

Use the existing `FlaskConical` import.

- [ ] **Step 2: Remove the hidden debug-only wording**

In `FlowStatusPanel`, replace:

```jsx
<button className="secondary-button muted" type="button" onClick={() => onNavigate('experiment')}>
  <FlaskConical size={15} /> 开发调试
</button>
```

with:

```jsx
<button className="secondary-button muted" type="button" onClick={() => onNavigate('workflow')}>
  <FlaskConical size={15} /> 流程画布
</button>
```

- [ ] **Step 3: Update App route**

Replace:

```js
if (activeTab === 'experiment') {
```

with:

```js
if (activeTab === 'workflow') {
```

Replace:

```jsx
<WorkflowStudio key={activeTab} initialMode="experiment" />
```

with:

```jsx
<WorkflowStudio key={activeTab} initialMode="monitor" />
```

- [ ] **Step 4: Rename WorkflowStudio heading**

In `WorkflowStudio.jsx`, replace:

```jsx
流程监控/可执行流程编排
```

with:

```jsx
流程画布
```

Replace:

```jsx
<h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase">节点库 (点击添加)</h2>
```

with:

```jsx
<h2 className="text-xs font-bold tracking-wider text-slate-400">节点库</h2>
```

Replace:

```jsx
<h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase mb-2">Production 模板</h2>
```

with:

```jsx
<h2 className="text-xs font-bold tracking-wider text-slate-400 mb-2">流程模板</h2>
```

- [ ] **Step 5: Build**

Run:

```bash
npm run web:build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/App.jsx apps/web/src/WorkflowStudio.jsx
git commit -m "fix: make workflow canvas first class"
```

---

## Task 6: Localize Canvas Status and Detail Labels

**Files:**
- Modify: `apps/web/src/WorkflowStudio.jsx`
- Modify: `apps/web/src/workflow-ui.test.mjs`
- Reuse: `apps/web/src/pipeline-labels.js`
- Reuse: `apps/web/src/pipeline-action-view.js`

- [ ] **Step 1: Import label helpers**

In `WorkflowStudio.jsx`, add:

```js
import {
  labelPipelineStatus,
  labelPipelineStage
} from './pipeline-labels.js';
import {
  getPipelineActionView
} from './pipeline-action-view.js';
```

- [ ] **Step 2: Derive the selected run next action**

After:

```js
const activeMonitorSummary = selectedMonitorRun || monitorLatestRun;
```

add:

```js
const activeMonitorAction = getPipelineActionView(activeMonitorSummary);
```

- [ ] **Step 3: Localize production node status**

Inside `ProductionNode`, replace:

```jsx
<b>{status}</b>
```

with:

```jsx
<b>{labelPipelineStatus(status)}</b>
```

- [ ] **Step 4: Localize monitor run cards**

In monitor run card, replace:

```jsx
{run.status || 'unknown'}
```

with:

```jsx
{labelPipelineStatus(run.status)}
```

Replace:

```jsx
{run.stage || 'unknown'} · 第 {(resolveSummaryStageIndex(run) + 1) || 0} 阶段
```

with:

```jsx
{labelPipelineStage(run.stage)} · 第 {(resolveSummaryStageIndex(run) + 1) || 0} 阶段
```

- [ ] **Step 5: Localize right detail panel**

In monitor detail, replace:

```jsx
{activeMonitorSummary.status}
```

with:

```jsx
{labelPipelineStatus(activeMonitorSummary.status)}
```

Replace:

```jsx
{activeMonitorSummary.stage}
```

with:

```jsx
{labelPipelineStage(activeMonitorSummary.stage)}
```

- [ ] **Step 6: Show the same next-step guidance in the detail panel**

After the `.monitor-detail-grid` block in the monitor detail panel, add:

```jsx
<div className={`monitor-alert ${activeMonitorAction.tone === 'warn' ? 'monitor-alert-warning' : ''}`}>
  <div className="font-bold mb-1">{activeMonitorAction.label}</div>
  <div>{activeMonitorAction.description}</div>
</div>
```

- [ ] **Step 7: Build**

Run:

```bash
npm run web:build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/WorkflowStudio.jsx
git commit -m "fix: localize workflow canvas status"
```

---

## Task 7: Browser Smoke and Responsive QA

**Files:**
- No code changes unless smoke reveals defects.

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run build**

Run:

```bash
npm run web:build
```

Expected: PASS.

- [ ] **Step 3: Start local server**

Run:

```bash
UI_PORT=3099 node bin/server.js
```

Expected: server prints `http://127.0.0.1:3099`.

- [ ] **Step 4: Browser smoke on desktop**

Open `http://127.0.0.1:3099` and verify:

1. Top navigation includes `工作台`, `挖词选品`, `标题生成`, `流程画布`.
2. Dashboard current flow shows one primary next-step action and a compact count summary.
3. Mining page shows a durable current-flow band first.
4. Mining page temporary exploration section is visually secondary and says `临时探索挖词`.
5. Title page verified pipeline keywords can be clicked and become the source candidate.
6. Workflow canvas opens in monitor mode and shows Chinese status labels.

- [ ] **Step 5: Browser smoke on mobile width**

Set viewport to `390x844` and verify:

1. Navigation labels do not overlap.
2. Current-flow band wraps without horizontal overflow.
3. Mining action buttons wrap into multiple lines.
4. Title verified keyword chips remain inside the panel.

- [ ] **Step 6: Commit smoke fixes if needed**

If smoke reveals style fixes, commit them:

```bash
git add apps/web/src/App.jsx apps/web/src/App.css apps/web/src/WorkflowStudio.jsx
git commit -m "fix: polish workflow ux responsive states"
```

---

## Task 8: Full Verification and Push

**Files:**
- No code changes unless verification reveals defects.

- [ ] **Step 1: Run focused pipeline/web tests**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs skills/pipeline-flow/test/runtime.test.js skills/pipeline-flow/test/pipeline-flow.test.js core/test/workflow-pipeline-adapter.test.js
```

Expected: all pass.

- [ ] **Step 2: Run project test suites**

Run:

```bash
npm test
npm run test:core-skills
npm run web:build
```

Expected:

- `npm test`: all pass
- `npm run test:core-skills`: all pass
- `npm run web:build`: Vite build succeeds

- [ ] **Step 3: Check git status**

Run:

```bash
git status --short
```

Expected: clean working tree after all commits.

- [ ] **Step 4: Push**

Run:

```bash
git push origin codex/executable-workflow-canvas
```

Expected: push succeeds.

---

## Rollout Notes

- Keep all existing `/api/pipeline/*`, `/api/mine/run`, and `/api/title/generate` behavior unchanged.
- This plan only changes user guidance and page wiring. It does not change scoring, SYCM thresholds, duplicate detection, or distribution submission.
- The title page should still allow manual keyword generation, but verified pipeline keywords must carry a safer source context.
- The canvas becomes a normal same-page tool named `流程画布`, not a separate debug area.

## Self-Review

- Spec coverage: The plan covers the requested UX continuation: next-step guidance, mining workflow clarity, title-page verified keyword context, canvas unification, localization, responsive smoke, and full verification.
- Placeholder scan: No placeholder markers remain. Every task includes concrete files, snippets, commands, and expected results.
- Type consistency: `getPipelineActionView`, `getPipelineSummaryText`, `normalizeVerifiedKeywordForTitle`, `pipeline.currentRun`, and `onUseVerifiedKeyword` names are consistent across tasks.
