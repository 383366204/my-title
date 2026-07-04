# Web Pipeline Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the React web app and the existing pipeline-flow skills operate on the same pipeline run, so workbench, mining, title generation, and workflow canvas are different views of one executable process.

**Architecture:** Add a small pipeline API facade over `skills/pipeline-flow` and `skills/pipeline-flow/runtime`, then make React pages read/write the same run summary and artifacts. Keep auxiliary keyword discovery as a helper, but every durable candidate/result must be attached to a pipeline run.

**Tech Stack:** Node.js CommonJS backend in `bin/server.js`, existing `skills/pipeline-flow` CommonJS modules, React/Vite frontend in `apps/web/src`, node:test.

---

## Current Problem

The web app currently has three partially separate flows:

- Workbench starts full CLI workflows through `/api/workbench/run`.
- Mining page runs `/api/mine/run`, which calls `mineKeywords()` directly and returns temporary candidates.
- Workflow canvas uses `/api/workflows/run` and runtime state around production templates.

The shared skill pipeline is already defined in `skills/pipeline-flow/index.js`:

```text
flowMine -> flowVerify -> flowGenerate -> flowExport -> review/submit
```

The unification target is:

```text
One current runId -> one run summary -> one set of candidates/verified/products -> multiple web views
```

---

## File Structure

### Backend

- Modify `bin/server.js`
  - Add unified `/api/pipeline/*` endpoints.
  - Keep old endpoints temporarily as compatibility wrappers.
  - Reuse `flowMine`, `flowVerify`, `flowGenerate`, `flowExport`, `flowDaily`, `flowKeyword`, `listPipelineRuns`, `summarizePipelineRun`.

- Modify `skills/pipeline-flow/index.js`
  - Add a focused helper for appending externally discovered candidates into an existing run.
  - Export the helper.

- Modify `core/test/web-pipeline-api.test.js`
  - Add API-level tests for the new facade using injectable functions or direct helper tests if Express app export is not available.

### Frontend

- Create `apps/web/src/pipeline-client.js`
  - Central fetch wrapper for the unified pipeline API.

- Create `apps/web/src/pipeline-labels.js`
  - Move current status/stage/count/action label maps out of `App.jsx`.

- Create `apps/web/src/use-pipeline-run.js`
  - React hook for `currentRun`, `refreshRun`, `startRun`, `runStep`, and `appendCandidates`.

- Modify `apps/web/src/App.jsx`
  - Workbench reads `usePipelineRun`.
  - Mining page becomes current-run-aware.
  - Title page can consume verified keywords from current run.

- Modify `apps/web/src/WorkflowStudio.jsx`
  - Keep canvas as advanced view, but make launch/refresh paths consume the unified run state where possible.

- Modify `apps/web/src/workflow-ui.test.mjs`
  - Add tests for labels and next action formatting after moving label helpers.

---

## Task 1: Extract Pipeline Labels From App.jsx

**Files:**
- Create: `apps/web/src/pipeline-labels.js`
- Modify: `apps/web/src/App.jsx`
- Test: `apps/web/src/workflow-ui.test.mjs`

- [ ] **Step 1: Write failing label tests**

Append these imports and tests to `apps/web/src/workflow-ui.test.mjs`:

```js
import {
  labelPipelineStatus,
  labelPipelineStage,
  labelPipelineCount,
  labelNextAction
} from './pipeline-labels.js';

test('pipeline labels localize status, stage, counts, and next commands', () => {
  assert.equal(labelPipelineStatus('verified_empty'), '验真无结果');
  assert.equal(labelPipelineStatus('ready_to_distribute'), '待确认铺货');
  assert.equal(labelPipelineStage('verified'), '大盘验真');
  assert.equal(labelPipelineCount('sycmVerified'), '验真通过');
  assert.equal(labelPipelineCount('generatedProducts'), '标题货源');
  assert.equal(labelNextAction({
    nextCommand: 'node bin/cli.js flow generate --run 2026-07-01-212255 --json'
  }), '生成标题货源');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
```

Expected: FAIL with module not found for `pipeline-labels.js`.

- [ ] **Step 3: Create `apps/web/src/pipeline-labels.js`**

Create the file with:

```js
export const PIPELINE_STATUS_LABEL = {
  created: '已创建',
  mined: '已挖词',
  verified: '已验真',
  verified_empty: '验真无结果',
  verified_partial_manual_required: '部分需人工处理',
  generated: '已生成标题',
  generate_failed: '生成失败',
  export_empty: '导出为空',
  needs_review: '待人工复核',
  ready_to_distribute: '待确认铺货',
  awaiting_user_confirmation: '等待确认',
  submitted: '已提交',
  workflow_complete: '流程完成',
  manual_action_required: '需要人工处理',
  failed: '失败',
  cancelled: '已取消',
  running: '运行中',
  blocked: '已阻塞',
  unknown: '未知'
};

export const PIPELINE_STAGE_LABEL = {
  seed: '种子准备',
  candidate: '候选词',
  mined: '已挖词',
  verified: '大盘验真',
  generated: '标题货源',
  review: '人工复核',
  ready: '待铺货',
  pending_review: '待确认铺货',
  submitted: '已提交',
  unknown: '未知阶段'
};

export const PIPELINE_COUNT_LABEL = {
  candidates: '候选词',
  sycmVerified: '验真通过',
  sycmRejected: '验真拒绝',
  generatedProducts: '标题货源',
  readyToDistribute: '待铺货'
};

export const NEXT_ACTION_LABEL = {
  ready_to_distribute: '确认铺货清单',
  review_required: '处理人工复核',
  manual_action_required: '完成人工处理',
  fix_blockers: '处理阻塞项',
  confirm_before_submit: '确认后提交',
  submit_ready: '准备提交铺货',
  sycm_query_complete: '继续选品或生成标题'
};

export function labelPipelineStatus(status) {
  return PIPELINE_STATUS_LABEL[String(status || 'unknown')] || String(status || '未知');
}

export function labelPipelineStage(stage) {
  return PIPELINE_STAGE_LABEL[String(stage || 'unknown')] || String(stage || '未知阶段');
}

export function labelPipelineCount(key) {
  return PIPELINE_COUNT_LABEL[key] || key;
}

export function labelNextAction(run = {}) {
  const code = String(run.nextActionCode || '');
  if (NEXT_ACTION_LABEL[code]) return NEXT_ACTION_LABEL[code];
  const command = String(run.nextCommand || run.userMessage || '');
  if (/flow mine\b/.test(command)) return '开始挖词';
  if (/flow verify\b/.test(command)) return '执行大盘验真';
  if (/flow generate\b/.test(command)) return '生成标题货源';
  if (/flow export\b/.test(command)) return '导出铺货清单';
  if (/distribute\b/.test(command)) return '确认铺货清单';
  if (/workflow resume\b/.test(command)) return '确认后继续提交';
  if (/^Review\b/.test(command)) return '查看复核报告';
  if (run.userMessage && !/[A-Za-z]{3,}/.test(run.userMessage)) return run.userMessage;
  return '流程记录已更新，可继续从工作台处理。';
}
```

- [ ] **Step 4: Modify `apps/web/src/App.jsx` to import labels**

Remove the local `PIPELINE_STATUS_LABEL`, `PIPELINE_STAGE_LABEL`, `PIPELINE_COUNT_LABEL`, `NEXT_ACTION_LABEL`, `labelPipelineStatus`, `labelPipelineStage`, `labelPipelineCount`, and `labelNextAction` definitions from `App.jsx`.

Add this import near the other local imports:

```js
import {
  labelPipelineStatus,
  labelPipelineStage,
  labelPipelineCount,
  labelNextAction
} from './pipeline-labels.js';
```

- [ ] **Step 5: Run test and build**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
npm run web:build
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pipeline-labels.js apps/web/src/App.jsx apps/web/src/workflow-ui.test.mjs
git commit -m "refactor: extract pipeline labels"
```

---

## Task 2: Add Pipeline Candidate Append Helper

**Files:**
- Modify: `skills/pipeline-flow/index.js`
- Test: `skills/pipeline-flow/test/pipeline-flow.test.js`

- [ ] **Step 1: Write failing helper test**

Append to `skills/pipeline-flow/test/pipeline-flow.test.js`:

```js
test('appendRunCandidates writes discovered candidates into an existing run', async () => {
  const dataDir = tempDataDir();
  const mined = await flowMine({
    dataDir,
    limit: 1,
    fallbackCandidates: true
  });

  const result = await appendRunCandidates({
    dataDir,
    runId: mined.runId,
    candidates: [
      { keyword: '纯银项链女', localScore: 82, source: 'peer', nextAction: 'sycm_verify' },
      { keyword: '纯银项链女', localScore: 82, source: 'peer', nextAction: 'sycm_verify' }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.added, 1);
  const { run } = getRun({ dataDir, runId: mined.runId });
  const rows = readJsonl(run.files.candidates);
  assert.ok(rows.some(row => row.keyword === '纯银项链女'));
  assert.equal(run.counts.candidates, rows.length);
});
```

`flowMine()` currently calls the real keyword miner and does not accept a `mineKeywords` injection parameter, so keep this test focused on append behavior after a real/minimal mine step. If `tempDataDir`, `readJsonl`, or imports are not currently exported in the test file, add local helpers matching existing helpers in the same file:

```js
function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}
```

Update import from `skills/pipeline-flow/index.js` to include:

```js
appendRunCandidates,
getRun
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test skills/pipeline-flow/test/pipeline-flow.test.js
```

Expected: FAIL with `appendRunCandidates is not a function`.

- [ ] **Step 3: Implement `appendRunCandidates`**

In `skills/pipeline-flow/index.js`, add this helper near `flowMine`:

```js
function normalizeExternalCandidate(candidate = {}) {
  const keyword = String(candidate.keyword || candidate.word || '').trim();
  if (!keyword) return null;
  return {
    keyword,
    seed: candidate.seed || candidate.sourceKeyword || 'web-discovery',
    category: candidate.category || '',
    pattern: candidate.pattern || 'web-discovery',
    source: candidate.source || 'web',
    localScore: Number(candidate.localScore || candidate.score || 0),
    tier: candidate.tier || 'mid',
    reason: candidate.reason || candidate.gateReason || 'Web 辅助发现加入当前流程',
    nextAction: candidate.nextAction || 'sycm_verify',
    flags: Array.isArray(candidate.flags) ? candidate.flags : ['web_discovery'],
    coreProduct: candidate.coreProduct || '',
    signature: candidate.signature || keyword,
    productSignature: candidate.productSignature || candidate.coreProduct || '',
    sycmData: candidate.sycmData || null,
    addedAt: new Date().toISOString()
  };
}

async function appendRunCandidates(options = {}) {
  const { runDir, run } = getRun(options);
  const incoming = Array.isArray(options.candidates) ? options.candidates : [];
  const existing = readJsonl(run.files.candidates);
  const seen = new Set(existing.map(row => row.signature || row.keyword));
  const added = [];

  for (const raw of incoming) {
    const candidate = normalizeExternalCandidate(raw);
    if (!candidate) continue;
    const key = candidate.signature || candidate.keyword;
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(candidate);
  }

  if (added.length > 0) {
    appendJsonl(run.files.candidates, added);
    run.status = run.status === 'created' ? 'mined' : run.status;
    run.counts.candidates = existing.length + added.length;
    writeRun(runDir, run);
  }

  return flowResponse({
    ok: true,
    runId: run.runId,
    status: run.status,
    added: added.length,
    candidates: added,
    counts: run.counts,
    files: run.files,
    nextCommand: buildFlowCommand('verify', run.runId, { limit: options.verify || 20 }),
    allowedCommands: [buildFlowCommand('verify', run.runId, { limit: options.verify || 20 })]
  });
}
```

Export it at the bottom:

```js
appendRunCandidates,
```

- [ ] **Step 4: Run tests**

Run:

```bash
node --test skills/pipeline-flow/test/pipeline-flow.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/pipeline-flow/index.js skills/pipeline-flow/test/pipeline-flow.test.js
git commit -m "feat: append web candidates to pipeline runs"
```

---

## Task 3: Add Unified Pipeline API Facade

**Files:**
- Modify: `bin/server.js`
- Test: `core/test/workflow-pipeline-adapter.test.js` or create `test/web-pipeline-api.test.js`

- [ ] **Step 1: Add endpoint contract tests**

If server integration tests already use `fetch` against a started server, create `test/web-pipeline-api.test.js`. Otherwise add focused tests for exported helpers. The expected API behavior is:

```js
test('pipeline API response shape exposes current run summary fields', () => {
  const run = normalizePipelineApiRun({
    runId: '2026-07-01-212255',
    status: 'verified_empty',
    stage: 'verified',
    counts: { candidates: 5, sycmVerified: 0, sycmRejected: 5 },
    nextCommand: 'node bin/cli.js flow generate --run 2026-07-01-212255 --json'
  });

  assert.equal(run.runId, '2026-07-01-212255');
  assert.equal(run.status, 'verified_empty');
  assert.equal(run.stage, 'verified');
  assert.equal(run.counts.candidates, 5);
  assert.equal(run.nextCommand.includes('flow generate'), true);
});
```

Add `normalizePipelineApiRun` to `bin/server.js` only if direct server tests are awkward. If created, export it under `module.exports` only when `NODE_ENV === 'test'`.

- [ ] **Step 2: Add backend imports**

In `bin/server.js`, extend the pipeline-flow import to include:

```js
flowMine,
flowVerify,
flowGenerate,
flowExport,
flowDaily,
flowKeyword,
appendRunCandidates
```

Keep existing imports for `listPipelineRuns` and summaries.

- [ ] **Step 3: Add `GET /api/pipeline/current`**

Add:

```js
app.get('/api/pipeline/current', (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 12;
    const result = listPipelineRuns({ dataDir: DEFAULT_PIPELINE_DIR, limit });
    res.json({ ok: true, data: { current: result.latest || null, runs: result.runs || [] } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

- [ ] **Step 4: Add `POST /api/pipeline/start`**

Add:

```js
app.post('/api/pipeline/start', async (req, res) => {
  try {
    const body = req.body || {};
    const mode = body.mode === 'keyword' ? 'keyword' : 'daily';
    const params = { ...body, dataDir: DEFAULT_PIPELINE_DIR };
    const result = mode === 'keyword'
      ? await flowKeyword(params)
      : await flowDaily(params);
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

This first version is synchronous to keep the integration small. If real runs are too slow for production use, add a follow-up runtime hardening task that delegates these step endpoints to the existing progress runtime and returns a run status immediately.

- [ ] **Step 5: Add step endpoints**

Add:

```js
app.post('/api/pipeline/:runId/mine', async (req, res) => {
  try {
    const result = await flowMine({ ...(req.body || {}), dataDir: DEFAULT_PIPELINE_DIR, runId: req.params.runId });
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/pipeline/:runId/verify', async (req, res) => {
  try {
    const result = await flowVerify({ ...(req.body || {}), dataDir: DEFAULT_PIPELINE_DIR, runId: req.params.runId });
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/pipeline/:runId/generate', async (req, res) => {
  try {
    const result = await flowGenerate({ ...(req.body || {}), dataDir: DEFAULT_PIPELINE_DIR, runId: req.params.runId });
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/pipeline/:runId/export', async (req, res) => {
  try {
    const result = await flowExport({ ...(req.body || {}), dataDir: DEFAULT_PIPELINE_DIR, runId: req.params.runId });
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

- [ ] **Step 6: Add candidate append endpoint**

Add:

```js
app.post('/api/pipeline/:runId/candidates', async (req, res) => {
  try {
    const result = await appendRunCandidates({
      dataDir: DEFAULT_PIPELINE_DIR,
      runId: req.params.runId,
      candidates: Array.isArray(req.body?.candidates) ? req.body.candidates : []
    });
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

- [ ] **Step 7: Run tests**

Run:

```bash
node --test test/*.test.js core/test/*.js
npm run web:build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add bin/server.js test/web-pipeline-api.test.js core/test/workflow-pipeline-adapter.test.js
git commit -m "feat: add unified pipeline web api"
```

---

## Task 4: Add Frontend Pipeline Client and Hook

**Files:**
- Create: `apps/web/src/pipeline-client.js`
- Create: `apps/web/src/use-pipeline-run.js`
- Modify: `apps/web/src/App.jsx`

- [ ] **Step 1: Create `apps/web/src/pipeline-client.js`**

```js
async function fetchPipelineJson(url, options) {
  const res = await fetch(url, options);
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.ok === false) {
    throw new Error(payload.error || `请求失败: ${res.status}`);
  }
  return payload.data ?? payload;
}

export function getCurrentPipeline() {
  return fetchPipelineJson('/api/pipeline/current');
}

export function startPipeline(params) {
  return fetchPipelineJson('/api/pipeline/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
}

export function runPipelineStep(runId, step, params = {}) {
  return fetchPipelineJson(`/api/pipeline/${encodeURIComponent(runId)}/${step}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
}

export function appendPipelineCandidates(runId, candidates) {
  return fetchPipelineJson(`/api/pipeline/${encodeURIComponent(runId)}/candidates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidates })
  });
}
```

- [ ] **Step 2: Create `apps/web/src/use-pipeline-run.js`**

```js
import { useCallback, useEffect, useState } from 'react';
import {
  getCurrentPipeline,
  startPipeline,
  runPipelineStep,
  appendPipelineCandidates
} from './pipeline-client.js';

export function usePipelineRun() {
  const [currentRun, setCurrentRun] = useState(null);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refreshRun = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getCurrentPipeline();
      setCurrentRun(data.current || null);
      setRuns(data.runs || []);
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const startRun = useCallback(async (params) => {
    const result = await startPipeline(params);
    await refreshRun();
    return result;
  }, [refreshRun]);

  const runStep = useCallback(async (step, params = {}) => {
    if (!currentRun?.runId) throw new Error('当前没有可继续的流程');
    const result = await runPipelineStep(currentRun.runId, step, params);
    await refreshRun();
    return result;
  }, [currentRun, refreshRun]);

  const appendCandidates = useCallback(async (candidates) => {
    if (!currentRun?.runId) throw new Error('当前没有可加入候选词的流程');
    const result = await appendPipelineCandidates(currentRun.runId, candidates);
    await refreshRun();
    return result;
  }, [currentRun, refreshRun]);

  useEffect(() => {
    refreshRun().catch(() => {});
  }, [refreshRun]);

  return {
    currentRun,
    runs,
    loading,
    error,
    refreshRun,
    startRun,
    runStep,
    appendCandidates
  };
}
```

- [ ] **Step 3: Wire App root to hook**

In `App.jsx`, import:

```js
import { usePipelineRun } from './use-pipeline-run.js';
```

Inside `App()`:

```js
const pipeline = usePipelineRun();
```

Pass `pipeline` to `DashboardView`, `MiningView`, and `TitleView`:

```jsx
<DashboardView
  ...
  pipeline={pipeline}
/>
<MiningView
  ...
  pipeline={pipeline}
/>
<TitleView
  ...
  pipeline={pipeline}
/>
```

- [ ] **Step 4: Keep existing behavior while introducing hook**

For this task, do not remove `refreshOverview()` yet. `DashboardView` can still use `runs` from old `/api/workbench/runs`; the new hook is available but not yet driving UI. This keeps the change low risk.

- [ ] **Step 5: Run build**

Run:

```bash
npm run web:build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pipeline-client.js apps/web/src/use-pipeline-run.js apps/web/src/App.jsx
git commit -m "feat: add web pipeline run hook"
```

---

## Task 5: Make Mining Page Current-Run Aware

**Files:**
- Modify: `apps/web/src/App.jsx`
- Modify: `apps/web/src/App.css`

- [ ] **Step 1: Add current run banner in `MiningView`**

Change function signature:

```js
function MiningView({ onSendToTitle, historyService, pipeline }) {
```

Add near the top of the return, after `RecoveryHint`:

```jsx
<section className="table-panel pipeline-context-panel">
  <div>
    <span className="tiny-muted">当前流程</span>
    <strong>{pipeline?.currentRun?.runId || '尚未启动流程'}</strong>
  </div>
  <div>
    <span className="tiny-muted">阶段</span>
    <strong>{pipeline?.currentRun ? labelPipelineStage(pipeline.currentRun.stage) : '未开始'}</strong>
  </div>
  <button
    className="secondary-button"
    type="button"
    onClick={() => pipeline?.refreshRun?.()}
  >
    <RefreshCw size={15} /> 刷新流程
  </button>
</section>
```

- [ ] **Step 2: Add CSS**

Add to `apps/web/src/App.css`:

```css
.pipeline-context-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.pipeline-context-panel span,
.pipeline-context-panel strong {
  display: block;
}

.pipeline-context-panel strong {
  margin-top: 4px;
  color: var(--text-primary);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 3: Add "run mining stage" button**

In the “自动挖词流” section, add a second button next to the existing local mining button:

```jsx
<button
  className="secondary-button"
  type="button"
  disabled={!pipeline?.currentRun?.runId || pipeline.loading}
  onClick={() => pipeline.runStep('mine', {
    mine: config.count,
    source: config.source,
    minSearchPopularity: config.minSearchPopularity,
    sycmPrecheck: config.sycmPrecheck
  }).catch((err) => setRecoveryMessage(err.message))}
>
  <Play size={16} />
  运行当前流程挖词阶段
</button>
```

Keep the old button but rename its label to:

```jsx
{running ? '停止' : '临时挖词'}
```

- [ ] **Step 4: Add "append to current run" for temporary candidates**

Near `CandidateTable`, pass an optional handler:

```jsx
<CandidateTable
  candidates={candidates}
  onSendToTitle={onSendToTitle}
  onAddToRun={pipeline?.currentRun?.runId ? async (item) => {
    await pipeline.appendCandidates([item]);
  } : null}
/>
```

Update `CandidateTable` signature:

```js
function CandidateTable({ candidates, onSendToTitle, onAddToRun }) {
```

Add button in the row action cell before "生成":

```jsx
{onAddToRun && (
  <button className="secondary-button" type="button" onClick={() => onAddToRun(item)}>
    <Plus size={15} /> 加入流程
  </button>
)}
```

- [ ] **Step 5: Run build**

Run:

```bash
npm run web:build
```

Expected: PASS.

- [ ] **Step 6: Browser smoke**

Run local server:

```bash
node bin/server.js
```

Open `http://127.0.0.1:3000` or printed port. Verify:

- Mining page shows current run banner.
- If no run exists, "运行当前流程挖词阶段" is disabled.
- Temporary candidates still render.
- Candidate rows show "加入流程" when a run exists.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/App.jsx apps/web/src/App.css
git commit -m "feat: connect mining page to pipeline run"
```

---

## Task 6: Let Discovery Tools Add Candidates to Current Run

**Files:**
- Modify: `apps/web/src/App.jsx`

- [ ] **Step 1: Normalize miner discovery rows**

Add helper in `App.jsx`:

```js
function discoveryToCandidate(item = {}, source = 'web-discovery') {
  const keyword = String(item.keyword || item.word || '').trim();
  return {
    keyword,
    source,
    pattern: source,
    localScore: Number(item.localScore || item.score || 65),
    tier: item.tier || 'mid',
    reason: item.reason || '辅助发现加入当前流程',
    nextAction: 'sycm_verify',
    sycmData: item.searchPopularity ? {
      searchPopularity: item.searchPopularity,
      demandSupplyRatio: item.demandSupplyRatio || 0,
      clickRate: item.clickRate || 0,
      conversionRate: item.conversionRate || 0,
      buyerCount: item.buyerCount || 0
    } : null
  };
}
```

- [ ] **Step 2: Add add-to-run button in miner result chips**

Change miner result render:

```jsx
{minerResults.map((item) => {
  const keyword = item.word || item.keyword || '';
  return (
    <div className="keyword-chip keyword-chip-row" key={`${keyword}-${item.searchPopularity || item.count || ''}`}>
      <button className="keyword-chip-main" type="button" onClick={() => addSeed(keyword)}>
        <span>{keyword}</span>
        <small>{item.searchPopularity ? `人气 ${item.searchPopularity}` : `词频 ${item.count || 1}`}</small>
        <Plus size={13} />
      </button>
      {pipeline?.currentRun?.runId && (
        <button
          className="icon-button"
          type="button"
          title="加入当前流程"
          onClick={() => pipeline.appendCandidates([discoveryToCandidate(item, minerTab)]).catch((err) => setRecoveryMessage(err.message))}
        >
          <Send size={13} />
        </button>
      )}
    </div>
  );
})}
```

- [ ] **Step 3: Add CSS for split chip**

Add:

```css
.keyword-chip-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px;
  align-items: center;
  padding: 0;
}

.keyword-chip-main {
  min-width: 0;
  border: 0;
  background: transparent;
  color: inherit;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
}
```

- [ ] **Step 4: Run build**

```bash
npm run web:build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.jsx apps/web/src/App.css
git commit -m "feat: add discovered keywords to pipeline"
```

---

## Task 7: Connect Title Page to Verified Run Keywords

**Files:**
- Modify: `bin/server.js`
- Modify: `apps/web/src/pipeline-client.js`
- Modify: `apps/web/src/App.jsx`

- [ ] **Step 1: Add artifact endpoint for verified keywords**

In `bin/server.js`, add:

```js
app.get('/api/pipeline/:runId/verified-keywords', (req, res) => {
  try {
    const summary = summarizePipelineRun({ dataDir: DEFAULT_PIPELINE_DIR, runId: req.params.runId, previewLimit: 100 });
    res.json({ ok: true, data: summary?.previews?.verifiedKeywords || [] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

- [ ] **Step 2: Add client function**

In `apps/web/src/pipeline-client.js`:

```js
export function getVerifiedKeywords(runId) {
  return fetchPipelineJson(`/api/pipeline/${encodeURIComponent(runId)}/verified-keywords`);
}
```

- [ ] **Step 3: Title page loads verified keywords**

Change `TitleView` signature:

```js
function TitleView({ sourceCandidate, onAddReviewProduct, historyService, pipeline }) {
```

Import `getVerifiedKeywords`:

```js
import { getVerifiedKeywords } from './pipeline-client.js';
```

Add state:

```js
const [verifiedKeywords, setVerifiedKeywords] = useState([]);
```

Add effect:

```js
useEffect(() => {
  let cancelled = false;
  if (!pipeline?.currentRun?.runId) {
    setVerifiedKeywords([]);
    return () => { cancelled = true; };
  }
  getVerifiedKeywords(pipeline.currentRun.runId)
    .then((rows) => {
      if (!cancelled) setVerifiedKeywords(Array.isArray(rows) ? rows : []);
    })
    .catch(() => {
      if (!cancelled) setVerifiedKeywords([]);
    });
  return () => { cancelled = true; };
}, [pipeline?.currentRun?.runId]);
```

- [ ] **Step 4: Render verified keyword selector**

Above manual keyword input:

```jsx
{verifiedKeywords.length > 0 && (
  <label className="field">
    <span>当前流程已验真词</span>
    <select
      value=""
      onChange={(event) => {
        const row = verifiedKeywords.find(item => item.keyword === event.target.value);
        if (row) {
          setForm((current) => ({ ...current, keyword: row.keyword }));
        }
      }}
    >
      <option value="">选择已验真关键词</option>
      {verifiedKeywords.map((item) => (
        <option value={item.keyword} key={item.keyword}>
          {item.keyword}
        </option>
      ))}
    </select>
  </label>
)}
```

- [ ] **Step 5: Run build**

```bash
npm run web:build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add bin/server.js apps/web/src/pipeline-client.js apps/web/src/App.jsx
git commit -m "feat: use verified pipeline keywords in title page"
```

---

## Task 8: Align Workflow Canvas With Unified Pipeline API

**Files:**
- Modify: `apps/web/src/WorkflowStudio.jsx`
- Modify: `bin/server.js` only if endpoint gaps are found.

- [ ] **Step 1: Keep canvas templates but clarify data source**

In `WorkflowStudio.jsx`, change visible text:

```jsx
<h1 className="font-bold text-sm tracking-wider text-slate-200">
  流程监控 / 高级编排
</h1>
```

Change console idle text:

```jsx
控制台处于闲置状态。运行流程后会捕获同一 pipeline run 的实时日志。
```

- [ ] **Step 2: Prefer unified current run refresh**

Where history runs are loaded from `/api/workflows/runs`, keep it for canvas-specific snapshots. Add a note in code comment before `fetchHistoryRuns()`:

```js
// Workflow canvas uses the same pipeline run files through the workflow adapter.
// The /api/workflows/runs endpoint adapts pipeline summaries into node states.
```

- [ ] **Step 3: Verify no duplicate run logic was introduced**

Run:

```bash
rg -n "/api/workbench/run|/api/mine/run|/api/pipeline" apps/web/src/WorkflowStudio.jsx apps/web/src/App.jsx
```

Expected:

- `WorkflowStudio.jsx` uses workflow adapter endpoints.
- `App.jsx` uses `/api/pipeline/*` through `pipeline-client.js`.
- `/api/mine/run` remains only for temporary mining compatibility.

- [ ] **Step 4: Build**

```bash
npm run web:build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/WorkflowStudio.jsx
git commit -m "docs: clarify workflow canvas pipeline source"
```

---

## Task 9: Deprecate Confusing Legacy Entrypoints In UI

**Files:**
- Modify: `apps/web/src/App.jsx`
- Modify: `apps/web/src/App.css`

- [ ] **Step 1: Rename temporary mining labels**

In Mining page:

```jsx
<h3>辅助挖词</h3>
<span className="tiny-muted">临时探索，不会自动进入流程</span>
```

For local SSE mining button:

```jsx
{running ? '停止临时挖词' : '临时挖词'}
```

For pipeline mining button:

```jsx
运行当前流程挖词阶段
```

- [ ] **Step 2: Add explanatory hint**

Under the two mining buttons:

```jsx
<div className="form-message">
  临时挖词用于探索；要推进选品流水线，请使用“运行当前流程挖词阶段”或把候选词加入当前流程。
</div>
```

- [ ] **Step 3: Build**

```bash
npm run web:build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/App.jsx apps/web/src/App.css
git commit -m "fix: clarify temporary mining entrypoints"
```

---

## Task 10: Full Verification

**Files:**
- No code changes unless verification reveals defects.

- [ ] **Step 1: Run focused tests**

```bash
node --test apps/web/src/workflow-ui.test.mjs skills/pipeline-flow/test/pipeline-flow.test.js core/test/workflow-pipeline-adapter.test.js
```

Expected: all pass.

- [ ] **Step 2: Run full tests**

```bash
npm test
npm run test:core-skills
npm run web:build
```

Expected:

- `npm test`: all pass
- `npm run test:core-skills`: all pass
- `npm run web:build`: Vite build succeeds

- [ ] **Step 3: Browser smoke**

Start server:

```bash
node bin/server.js
```

Verify in browser:

1. Workbench shows a current flow.
2. Mining page shows current run context.
3. Temporary mining still works.
4. A discovered keyword can be added to current run.
5. Candidate count updates after adding to run.
6. Title page lists verified keywords when run has verified rows.
7. Workflow canvas still opens and node layout is readable.

- [ ] **Step 4: Final commit if smoke fixes were needed**

If any fixes were made:

```bash
git add <changed-files>
git commit -m "fix: complete web pipeline unification"
```

- [ ] **Step 5: Push**

```bash
git push origin codex/executable-workflow-canvas
```

Expected: push succeeds.

---

## Rollout Notes

- Keep `/api/mine/run` during the first rollout. It becomes “临时挖词” compatibility, not the primary pipeline path.
- Keep `/api/workbench/run` until `/api/pipeline/start` has equivalent runtime/cancel behavior.
- Do not remove workflow adapter endpoints; the canvas depends on adapted node states and artifacts.
- Avoid changing scoring thresholds in this plan. Scoring improvement should be a separate plan after run unification lands.

## Self-Review

- Spec coverage: The plan covers shared labels, backend run API, candidate persistence, mining page run context, discovery-to-run, title page verified keyword consumption, canvas clarification, and legacy-entrypoint deconfusion.
- Placeholder scan: No TODO/TBD placeholders remain. Each task includes exact files, code snippets, commands, and expected results.
- Type consistency: `runId`, `candidates`, `counts`, `currentRun`, `runStep`, and `appendCandidates` names are used consistently across backend, client, hook, and page tasks.
