# Daily Workflow Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Web UI into a clear daily operation workbench for keyword mining, verification, title/product generation, human review, and distribution batch export, while using the React Flow canvas as a read-only monitor instead of the main operating surface.

**Architecture:** Reuse the existing deterministic pipeline in `skills/pipeline-flow` and its files under `data/pipeline/runs/*` as the source of truth. Add a small Web API adapter that reads pipeline run files, exposes normalized workflow state, and can start the existing CLI flow in a controlled way. Keep the classic `web/` dashboard as the primary place for actions; make `apps/web` consume the same run summary for visual monitoring and logs.

**Tech Stack:** Node.js CommonJS, Express in `bin/server.js`, existing `skills/pipeline-flow`, existing `core/agent-response.js`, browser JavaScript in `web/`, React Flow app under `apps/web`, `node:test`, Vite build.

---

## Collaboration Notes

Antigravity agreed with the direction of using the old dashboard as the main action surface and the React Flow app as a monitor. Its useful recommendations included:

- Reuse `skills/pipeline-flow` and `core/agent-response.js`; do not create a second business workflow.
- Read `nextActionCode`, `requiresUserAction`, `blockers`, `userMessage`, `allowedCommands`, and `nextCommand` directly in Web UI.
- Keep the first React Flow version read-only for daily workflow monitoring.
- Avoid database migration, multi-user permissions, and dynamic flow editing for this pass.

One Antigravity suggestion referenced `core/workflow-runtime.js`, but that file does not exist in this repository. This plan does not depend on it.

---

## Current Context

- `web/` is the current usable dashboard. It already has tabs for dashboard, mining, title generation, IndexedDB history storage, and a read-only `/api/workflow/batches` card.
- `apps/web/` is a React Flow canvas. It has node status, history, SSE logs, run/cancel controls, and product-card detail work planned separately in `docs/superpowers/plans/2026-06-29-workflow-product-card-detail.md`.
- `core/workflow/*` is a demo-style node runtime used by the React Flow canvas.
- `skills/pipeline-flow/index.js` is the real daily pipeline. It creates `data/pipeline/runs/<runId>/run.json`, `candidates.jsonl`, `sycm-results.jsonl`, `verified-keywords.jsonl`, `generated-products.jsonl`, `distribution-review.md`, and `distribution-batch.txt`.
- `core/agent-response.js` standardizes user-action states such as `manual_action_required`, `review_required`, and `confirm_before_submit`.
- `bin/cli.js` already exposes:
  - `flow daily`
  - `flow mine`
  - `flow verify`
  - `flow generate`
  - `flow export`
  - `flow keyword`
  - `workflow run`
  - `workflow resume --confirm-submit`

---

## Out Of Scope

- Do not make React Flow a dynamic workflow editor in this pass. No drag-to-design daily automations, no arbitrary node deletion, no custom user-defined graphs.
- Do not add PostgreSQL, MongoDB, or another persistent database. Continue to use `data/pipeline/runs/*` as the shared source of truth.
- Do not add auto-submit. Daily automation may generate a batch, but actual submit still requires explicit human confirmation.
- Do not add multi-user auth, RBAC, or deployment permissions. The product remains a single-user local tool.
- Do not replace the browser IndexedDB history store. Use it only as local UI history; backend pipeline files remain canonical.

---

## File Map

- Create: `core/pipeline-run-summary.js`
  - Read and normalize `data/pipeline/runs/*` into a UI-friendly shape.
  - Map pipeline statuses to workbench stages.
  - Read previews from JSONL/report files without loading huge files into memory.
- Create: `core/test/pipeline-run-summary.test.js`
  - Unit tests for run summary, stage mapping, file preview, and user-action mapping.
- Modify: `bin/server.js`
  - Replace ad hoc `/api/workflow/batches` parsing with `core/pipeline-run-summary.js`.
  - Add daily workbench endpoints:
    - `GET /api/workbench/runs`
    - `GET /api/workbench/runs/:runId`
    - `POST /api/workbench/run`
  - Keep existing `/api/workflows/*` canvas endpoints working.
- Modify: `web/index.html`
  - Add a "今日工作台" section inside the dashboard card area.
  - Add controls for start mode, counts, and manual-action status.
  - Replace the separate-tab workflow canvas link with an in-product monitor entry.
- Modify: `web/js/app.js`
  - Load workbench run summaries.
  - Render run stage, blockers, next action, counts, and review queues.
  - Start a daily or exact-keyword run through the new API.
  - Route users between dashboard operation and workflow monitor without making the canvas feel like a separate product.
- Modify: `web/css/style.css`
  - Add compact workbench layout, stage badges, action cards, review rows, and warning styles.
- Modify: `apps/web/src/App.jsx`
  - Add a read-only daily workflow monitor template.
  - Load run summaries from `/api/workbench/runs/:runId`.
  - Map `data/pipeline` stages to node states.
- Modify: `apps/web/src/App.css`
  - Add monitor-specific node status styles if current utility classes are insufficient.
- Modify: `README.md`
  - Document the real daily workflow, the workbench, and the read-only canvas role.

---

## Shared Status Contract

Use this normalized stage vocabulary in both Web UIs:

```js
const WORKBENCH_STAGE_ORDER = [
  'seed',
  'mined',
  'verified',
  'generated',
  'review',
  'ready',
  'submitted'
];
```

Pipeline status mapping:

```js
const PIPELINE_STATUS_TO_STAGE = {
  created: 'seed',
  mined: 'mined',
  manual_action_required: 'verified',
  verified_partial_manual_required: 'verified',
  verified: 'verified',
  verified_empty: 'verified',
  generated: 'generated',
  generate_failed: 'generated',
  needs_review: 'review',
  ready_to_distribute: 'ready',
  export_empty: 'review',
  awaiting_user_confirmation: 'ready',
  workflow_complete: 'submitted'
};
```

Normalized run summary shape:

```js
{
  ok: true,
  runId: '2026-06-29-120000',
  status: 'needs_review',
  stage: 'review',
  stageIndex: 4,
  startedAt: '2026-06-29T04:00:00.000Z',
  updatedAt: '2026-06-29T04:10:00.000Z',
  counts: {
    candidates: 0,
    sycmVerified: 0,
    sycmRejected: 0,
    generatedProducts: 0,
    readyToDistribute: 0,
    reviewCandidates: 0,
    rejectedBeforeDistribution: 0
  },
  files: {
    candidates: '...',
    sycmResults: '...',
    verifiedKeywords: '...',
    generatedProducts: '...',
    distributionBatch: '...',
    distributionReview: '...'
  },
  nextActionCode: 'review_required',
  requiresUserAction: true,
  blockers: ['review_rejected_rows'],
  userMessage: 'Review is required before continuing.',
  nextCommand: '...',
  previews: {
    candidates: [],
    verifiedKeywords: [],
    generatedProducts: [],
    distributionReview: ''
  }
}
```

---

## Task 1: Pipeline Run Summary Adapter

**Files:**
- Create: `core/pipeline-run-summary.js`
- Create: `core/test/pipeline-run-summary.test.js`

- [ ] **Step 1: Write failing tests**

Create `core/test/pipeline-run-summary.test.js` with tests that create a temp `data/pipeline/runs/<runId>` directory and assert status mapping, counts, previews, and user-action fields.

```js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  summarizePipelineRun,
  listPipelineRuns,
  pipelineStatusToStage
} = require('../pipeline-run-summary');

function tempPipelineDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-summary-'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

describe('pipeline-run-summary', () => {
  test('maps pipeline status to workbench stages', () => {
    assert.equal(pipelineStatusToStage('mined'), 'mined');
    assert.equal(pipelineStatusToStage('verified_partial_manual_required'), 'verified');
    assert.equal(pipelineStatusToStage('generated'), 'generated');
    assert.equal(pipelineStatusToStage('needs_review'), 'review');
    assert.equal(pipelineStatusToStage('ready_to_distribute'), 'ready');
    assert.equal(pipelineStatusToStage('workflow_complete'), 'submitted');
    assert.equal(pipelineStatusToStage('unknown_status'), 'seed');
  });

  test('summarizes one run with review-required response fields', () => {
    const dataDir = tempPipelineDir();
    const runId = '2026-06-29-120000';
    const runDir = path.join(dataDir, 'runs', runId);
    const reviewFile = path.join(runDir, 'distribution-review.md');
    const batchFile = path.join(runDir, 'distribution-batch.txt');
    writeJson(path.join(runDir, 'run.json'), {
      runId,
      status: 'needs_review',
      startedAt: '2026-06-29T04:00:00.000Z',
      updatedAt: '2026-06-29T04:10:00.000Z',
      counts: {
        candidates: 12,
        sycmVerified: 3,
        sycmRejected: 2,
        generatedProducts: 8,
        readyToDistribute: 4,
        reviewCandidates: 2,
        rejectedBeforeDistribution: 1
      },
      files: {
        distributionReview: reviewFile,
        distributionBatch: batchFile
      }
    });
    fs.writeFileSync(reviewFile, '# Review\nneeds manual check\n', 'utf8');
    fs.writeFileSync(batchFile, 'https://detail.1688.com/offer/1.html\\tTitle\\n', 'utf8');

    const summary = summarizePipelineRun({ dataDir, runId });
    assert.equal(summary.ok, true);
    assert.equal(summary.runId, runId);
    assert.equal(summary.stage, 'review');
    assert.equal(summary.nextActionCode, 'review_required');
    assert.equal(summary.requiresUserAction, true);
    assert.deepEqual(summary.blockers, ['review_rejected_rows']);
    assert.equal(summary.batchCount, 1);
    assert.match(summary.previews.distributionReview, /needs manual check/);
  });

  test('lists latest runs first', () => {
    const dataDir = tempPipelineDir();
    writeJson(path.join(dataDir, 'runs', 'old', 'run.json'), {
      runId: 'old',
      status: 'mined',
      updatedAt: '2026-06-28T00:00:00.000Z'
    });
    writeJson(path.join(dataDir, 'runs', 'new', 'run.json'), {
      runId: 'new',
      status: 'generated',
      updatedAt: '2026-06-29T00:00:00.000Z'
    });

    const result = listPipelineRuns({ dataDir });
    assert.equal(result.runs[0].runId, 'new');
    assert.equal(result.latest.runId, 'new');
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
node --test core/test/pipeline-run-summary.test.js
```

Expected: fail with `Cannot find module '../pipeline-run-summary'`.

- [ ] **Step 3: Implement the adapter**

Create `core/pipeline-run-summary.js` with these exported functions:

```js
'use strict';

const fs = require('fs');
const path = require('path');
const { withAgentResponseFields } = require('./agent-response');

const DEFAULT_PIPELINE_DIR = path.join(process.cwd(), 'data', 'pipeline');
const STAGE_ORDER = ['seed', 'mined', 'verified', 'generated', 'review', 'ready', 'submitted'];

function pipelineStatusToStage(status) {
  const map = {
    created: 'seed',
    mined: 'mined',
    manual_action_required: 'verified',
    verified_partial_manual_required: 'verified',
    verified: 'verified',
    verified_empty: 'verified',
    generated: 'generated',
    generate_failed: 'generated',
    needs_review: 'review',
    ready_to_distribute: 'ready',
    export_empty: 'review',
    awaiting_user_confirmation: 'ready',
    workflow_complete: 'submitted'
  };
  return map[status] || 'seed';
}
```

Also implement:

```js
function summarizePipelineRun({ dataDir = DEFAULT_PIPELINE_DIR, runId, previewLimit = 20, reviewChars = 5000 } = {}) {}
function listPipelineRuns({ dataDir = DEFAULT_PIPELINE_DIR, limit = 20 } = {}) {}
function readJsonlPreview(file, limit) {}
function readTextPreview(file, maxChars) {}
function countNonEmptyLines(file) {}
```

`summarizePipelineRun` must call `withAgentResponseFields` so Web consumers get the same `nextActionCode` and `requiresUserAction` semantics as CLI.

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test core/test/pipeline-run-summary.test.js
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add core/pipeline-run-summary.js core/test/pipeline-run-summary.test.js
git commit -m "feat: add pipeline run summary adapter"
```

---

## Task 2: Workbench API Wrapper

**Files:**
- Modify: `bin/server.js`
- Test: `test/workbench-api.test.js` if the existing server can be imported safely; otherwise use `node --check` plus manual API checks.

- [ ] **Step 1: Add summary imports**

Add near the other `require` calls:

```js
const { spawn } = require('child_process');
const {
  listPipelineRuns,
  summarizePipelineRun
} = require('../core/pipeline-run-summary');
```

- [ ] **Step 2: Replace `/api/workflow/batches` internals**

Keep the route path for backward compatibility, but make it return summaries from `listPipelineRuns`.

Expected response:

```js
{
  ok: true,
  data: {
    runs: [],
    latest: null
  }
}
```

- [ ] **Step 3: Add `GET /api/workbench/runs`**

Return the latest normalized pipeline summaries:

```js
app.get('/api/workbench/runs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    res.json({ ok: true, data: listPipelineRuns({ limit }) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

- [ ] **Step 4: Add `GET /api/workbench/runs/:runId`**

Return one normalized run:

```js
app.get('/api/workbench/runs/:runId', (req, res) => {
  try {
    const summary = summarizePipelineRun({ runId: req.params.runId });
    if (!summary) return res.status(404).json({ ok: false, error: '未找到该运行记录' });
    res.json({ ok: true, data: summary });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

- [ ] **Step 5: Add guarded `POST /api/workbench/run`**

Start the existing CLI flow with `spawn`, not a new in-process workflow engine. Accept:

```js
{
  "mode": "daily",
  "keyword": "本命年红绳手链女",
  "mine": 50,
  "verify": 20,
  "generate": 10,
  "export": 20
}
```

Build command:

```js
const args = mode === 'keyword'
  ? ['bin/cli.js', 'flow', 'keyword', keyword, '--json']
  : ['bin/cli.js', 'flow', 'daily', '--json'];
```

For this pass, reject a second run while one child process is active:

```js
if (activeWorkbenchProcess) {
  return res.status(409).json({
    ok: false,
    status: 'workflow_busy',
    error: '已有工作流正在运行，请等待完成后再启动。'
  });
}
```

- [ ] **Step 6: Run syntax checks**

Run:

```bash
node --check bin/server.js
```

Expected: exit `0`.

- [ ] **Step 7: Commit**

Run:

```bash
git add bin/server.js
git commit -m "feat: expose daily workbench workflow API"
```

---

## Task 3: Dashboard Daily Workbench

**Files:**
- Modify: `web/index.html`
- Modify: `web/js/app.js`
- Modify: `web/css/style.css`

- [ ] **Step 1: Add the workbench shell**

In `web/index.html`, inside `#sec-dashboard`, add a card with:

- Start controls:
  - mode segmented control: `每日挖掘` / `指定关键词`
  - keyword input shown only for exact keyword mode
  - numeric inputs for mine, verify, generate, export
  - start button
- Latest run summary:
  - run id
  - status
  - stage
  - counts
  - user message
- Review queue:
  - ready count
  - review count
  - hard rejected count
  - links/paths for report and batch file

- [ ] **Step 2: Keep the workflow monitor inside the product navigation**

In `web/index.html`, change the current separate-tab canvas link:

```html
<a href="/workflow/" class="nav-item" id="nav-workflow" target="_blank">
```

to an in-product navigation entry:

```html
<a href="/workflow/" class="nav-item" id="nav-workflow">
```

Also add a dashboard CTA inside the workbench card:

```html
<a href="/workflow/" class="btn btn-secondary btn-sm" id="btn-open-workflow-monitor">查看流程监控</a>
```

Expected UX: opening the workflow monitor replaces the current page in the same tab. Users can return through the existing "返回原生选品页" button in `apps/web/src/App.jsx`, so the dashboard and monitor behave like two views of one product instead of two disconnected tools.

- [ ] **Step 3: Add `loadWorkbenchRuns` in `web/js/app.js`**

Fetch:

```js
const res = await fetch('/api/workbench/runs?limit=10');
```

Render the latest summary. Preserve the existing `loadWorkflowBatches()` as a compatibility wrapper that calls the new function.

- [ ] **Step 4: Add stage rendering**

Use the normalized stages from Task 1. If `summary.requiresUserAction` is true, render a warning banner with:

```text
summary.nextActionCode
summary.userMessage
summary.blockers.join(', ')
summary.nextCommand
```

- [ ] **Step 5: Add start action**

Submit to:

```js
await fetch('/api/workbench/run', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});
```

Disable the button while starting. On `409 workflow_busy`, show a non-modal warning instead of alert-only UX.

- [ ] **Step 6: Add CSS**

Add styles for:

- `.daily-workbench-card`
- `.workbench-controls`
- `.workbench-stage-strip`
- `.workbench-action-warning`
- `.workbench-review-grid`
- `.workbench-run-list`

Keep the layout dense and operational; no landing-page hero treatment.

- [ ] **Step 7: Run browser JS checks**

Run:

```bash
node --check web/js/app.js
```

Expected: exit `0`.

- [ ] **Step 8: Commit**

Run:

```bash
git add web/index.html web/js/app.js web/css/style.css
git commit -m "feat: add daily workflow workbench"
```

---

## Task 4: Read-Only React Flow Monitor

**Files:**
- Modify: `apps/web/src/App.jsx`
- Modify: `apps/web/src/App.css`

- [ ] **Step 1: Add monitor template**

Use fixed nodes:

```js
[
  { id: 'seed', label: '种子/启动', stage: 'seed' },
  { id: 'mined', label: '挖词', stage: 'mined' },
  { id: 'verified', label: '多指标验真', stage: 'verified' },
  { id: 'generated', label: '标题货源', stage: 'generated' },
  { id: 'review', label: '人工复核', stage: 'review' },
  { id: 'ready', label: '待铺货批次', stage: 'ready' },
  { id: 'submitted', label: '已提交', stage: 'submitted' }
]
```

- [ ] **Step 2: Load workbench summaries**

Fetch `/api/workbench/runs` for history and `/api/workbench/runs/:runId` for detail. Do not start the demo `core/workflow` runtime from the monitor mode.

- [ ] **Step 3: Map stage to node status**

For each node:

```js
if (node.stageIndex < summary.stageIndex) status = 'completed';
if (node.stageIndex === summary.stageIndex) status = summary.requiresUserAction ? 'paused' : 'running';
if (node.stageIndex > summary.stageIndex) status = 'idle';
```

Use `failed` when `summary.ok === false` or `summary.status` contains `failed`.

- [ ] **Step 4: Preserve existing canvas demo behind a secondary mode**

Keep `/api/workflows/*` and the existing demo canvas available, but make the default `/workflow/` first screen show the read-only daily monitor. The dynamic demo can live behind a small "节点实验" toggle.

- [ ] **Step 5: Run build**

Run:

```bash
npm run web:build
```

Expected: Vite build exits `0`.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/web/src/App.jsx apps/web/src/App.css
git commit -m "feat: show pipeline runs in workflow monitor"
```

---

## Task 5: Documentation And Verification

**Files:**
- Modify: `README.md`
- Optional Modify: `docs/operations/platform-smoke-checks.md`

- [ ] **Step 1: Document the real workflow**

Add this operating model:

```text
Dashboard = daily actions and review queue
React Flow = read-only monitor and logs
pipeline-flow = source of truth
data/pipeline/runs = durable run files
IndexedDB = local browser history only
```

- [ ] **Step 2: Document manual-action behavior**

Mention that `manual_action_required` means the user must finish login, slider, authorization, or SYCM access in the local browser before continuing.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm run test:all
```

Expected: all Node tests pass and `apps/web` builds.

- [ ] **Step 4: Manual smoke test**

Run:

```bash
npm run ui
```

Open:

```text
http://127.0.0.1:3000/
http://127.0.0.1:3000/workflow/
```

Verify:

- Dashboard shows latest pipeline run.
- Dashboard starts one daily run or exact-keyword run.
- A second start attempt while running returns `workflow_busy`.
- Manual-action states are visible and do not look like success.
- React Flow monitor displays the same latest run and marks the active stage.
- Existing `web/#mine` and `web/#title` still load.

- [ ] **Step 5: Commit**

Run:

```bash
git add README.md docs/operations/platform-smoke-checks.md
git commit -m "docs: document daily workflow workbench"
```

---

## Execution Order

Recommended order:

1. Task 1, because it creates the shared contract and testable data adapter.
2. Task 2, because dashboard and monitor should consume APIs rather than parsing files directly.
3. Task 3, because it solves the user's main UX pain first.
4. Task 4, because the canvas becomes useful after the source-of-truth API exists.
5. Task 5, because workflow behavior must be easy to operate and verify.

The existing `docs/superpowers/plans/2026-06-29-workflow-product-card-detail.md` can run independently after or alongside Task 4. It improves one canvas detail interaction but is not required for the daily workbench MVP.

---

## Self-Review

- Spec coverage: The plan covers dashboard operation, workbench API, React Flow monitoring, human review, manual-action states, and safe non-auto-submit behavior.
- Antigravity coverage: Valid recommendations around `pipeline-flow`, `agent-response`, read-only monitor, and scope limits are included. The nonexistent `core/workflow-runtime.js` dependency is explicitly excluded.
- Placeholder scan: No `TBD`, `TODO`, or open-ended "add tests" placeholder remains. Tasks include file paths and verification commands.
- Type consistency: The shared fields are consistently named `stage`, `stageIndex`, `nextActionCode`, `requiresUserAction`, `blockers`, `userMessage`, `nextCommand`, and `counts`.
- Scope check: This is one coherent implementation slice. It does not include database migration, auto-submit, permissions, or dynamic workflow editing.
