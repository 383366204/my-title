# Executable Workflow Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `WorkflowStudio` into a real production orchestrator for existing `pipeline-flow` runs instead of a separate mock workflow runner.

**Architecture:** Keep `skills/pipeline-flow` and `data/pipeline/runs/<runId>/` as the source of truth. Add a thin workflow adapter that exposes production templates, maps pipeline summaries to canvas node states, starts real CLI-backed runs safely, and lets React render run state and node artifacts. Preserve the current dashboard, mining, and title pages.

**Tech Stack:** Node.js CommonJS, Express, `node:test`, React + Vite, React Flow, file-based run storage under `data/pipeline`.

---

## File Structure

- Create `core/workflow/pipeline-adapter.js`: production workflow templates, parameter sanitization, run command building, summary-to-node-state mapping, artifact readers.
- Create `core/test/workflow-pipeline-adapter.test.js`: unit tests for templates, sanitization, command args, node-state mapping, artifact previews.
- Modify `core/workflow/index.js`: export adapter functions.
- Modify `bin/server.js`: make `/api/workflows/*` production endpoints use the adapter and real pipeline summaries instead of mock `core/workflow` runs.
- Modify `apps/web/src/workflow-ui.js`: add pure helpers for workflow node status/action mapping.
- Modify `apps/web/src/workflow-ui.test.mjs`: cover the new frontend helpers.
- Modify `apps/web/src/WorkflowStudio.jsx`: load production templates/runs, start real workflows, render artifact details and human-review states.
- Modify `apps/web/src/App.css`: style production node statuses and review/action panels.

## Safety Baseline

The implementation must not use `exec()` with user input. Any CLI execution must use `spawn(process.execPath, args, { cwd, env })` where `args` is an array built from sanitized values.

The first implementation supports only known templates:

- `daily-selection-v1`
- `exact-keyword-v1`

It must reject unknown template IDs, unknown modes, unknown node types, and arbitrary graph shapes.

---

### Task 1: Add Production Workflow Adapter

**Files:**
- Create: `core/workflow/pipeline-adapter.js`
- Create: `core/test/workflow-pipeline-adapter.test.js`
- Modify: `core/workflow/index.js`

- [ ] **Step 1: Write failing adapter tests**

Create `core/test/workflow-pipeline-adapter.test.js`:

```js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  WORKFLOW_NODE_IDS,
  listProductionWorkflowTemplates,
  sanitizeWorkflowParams,
  buildPipelineCliArgs,
  pipelineSummaryToWorkflowRun,
  readWorkflowNodeArtifact
} = require('../workflow');

function tempPipelineDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-adapter-'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, 'utf8');
}

describe('workflow pipeline adapter', () => {
  it('lists fixed production templates', () => {
    const templates = listProductionWorkflowTemplates();
    assert.equal(templates.length, 2);
    assert.deepEqual(templates.map(t => t.id), ['daily-selection-v1', 'exact-keyword-v1']);
    assert.deepEqual(templates[0].workflow.nodes.map(n => n.id), [
      WORKFLOW_NODE_IDS.start,
      WORKFLOW_NODE_IDS.mine,
      WORKFLOW_NODE_IDS.verify,
      WORKFLOW_NODE_IDS.generate,
      WORKFLOW_NODE_IDS.export,
      WORKFLOW_NODE_IDS.review,
      WORKFLOW_NODE_IDS.end
    ]);
  });

  it('sanitizes daily params and clamps ranges', () => {
    const params = sanitizeWorkflowParams('daily', {
      mine: '999',
      verify: '-5',
      generate: 'abc',
      export: '25',
      productsPerKeyword: '200',
      length: '10',
      pages: '4'
    });
    assert.deepEqual(params, {
      mine: 100,
      verify: 20,
      generate: 10,
      export: 25,
      productsPerKeyword: 50,
      length: 30,
      pages: 4
    });
  });

  it('requires exact keyword mode keyword', () => {
    assert.throws(() => sanitizeWorkflowParams('keyword', { keyword: '   ' }), /关键词不能为空/);
    assert.deepEqual(sanitizeWorkflowParams('keyword', {
      keyword: '  纯银项链女高级感  ',
      export: '3',
      productsPerKeyword: '2',
      length: '60'
    }), {
      keyword: '纯银项链女高级感',
      export: 3,
      productsPerKeyword: 2,
      length: 60,
      pages: 1
    });
  });

  it('builds parameterized CLI args without shell strings', () => {
    assert.deepEqual(buildPipelineCliArgs('daily', {
      mine: 5,
      verify: 4,
      generate: 3,
      export: 2,
      productsPerKeyword: 6,
      length: 58,
      pages: 1
    }), [
      'bin/cli.js', 'flow', 'daily', '--json',
      '--mine', '5',
      '--verify', '4',
      '--generate', '3',
      '--export', '2',
      '--products-per-keyword', '6',
      '--length', '58',
      '--pages', '1'
    ]);

    assert.deepEqual(buildPipelineCliArgs('keyword', {
      keyword: '纯银项链女高级感',
      export: 2,
      productsPerKeyword: 6,
      length: 58,
      pages: 1
    }), [
      'bin/cli.js', 'flow', 'keyword', '纯银项链女高级感', '--json',
      '--export', '2',
      '--products-per-keyword', '6',
      '--length', '58',
      '--pages', '1'
    ]);
  });

  it('maps pipeline summary to canvas node states', () => {
    const run = pipelineSummaryToWorkflowRun({
      runId: 'run_1',
      status: 'needs_review',
      stage: 'review',
      requiresUserAction: true,
      nextActionCode: 'review_required',
      blockers: ['review_rejected_rows'],
      counts: {
        candidates: 10,
        sycmVerified: 4,
        generatedProducts: 8,
        readyToDistribute: 3
      }
    });

    assert.equal(run.runId, 'run_1');
    assert.equal(run.status, 'needs_review');
    assert.equal(run.nodeStates.mine.status, 'completed');
    assert.equal(run.nodeStates.verify.status, 'completed');
    assert.equal(run.nodeStates.generate.status, 'completed');
    assert.equal(run.nodeStates.export.status, 'completed');
    assert.equal(run.nodeStates.review.status, 'needs_review');
    assert.equal(run.nodeStates.end.status, 'idle');
    assert.equal(run.requiresUserAction, true);
  });

  it('reads node artifacts from pipeline files', () => {
    const dataDir = tempPipelineDir();
    const runId = 'artifact_run';
    const runDir = path.join(dataDir, 'runs', runId);
    const files = {
      candidates: path.join(runDir, 'candidates.jsonl'),
      sycmResults: path.join(runDir, 'sycm-results.jsonl'),
      verifiedKeywords: path.join(runDir, 'verified-keywords.jsonl'),
      generatedProducts: path.join(runDir, 'generated-products.jsonl'),
      distributionBatch: path.join(runDir, 'distribution-batch.txt'),
      distributionReview: path.join(runDir, 'distribution-review.md')
    };
    writeJson(path.join(runDir, 'run.json'), {
      runId,
      status: 'needs_review',
      files
    });
    writeText(files.candidates, '{"keyword":"pet bed"}\\n');
    writeText(files.sycmResults, '{"keyword":"pet bed","status":"verified"}\\n');
    writeText(files.generatedProducts, '{"title":"Warm pet bed"}\\n');
    writeText(files.distributionBatch, 'https://detail.1688.com/offer/1.html$$Warm pet bed\\n');
    writeText(files.distributionReview, '# Review\\nManual Review Candidates\\n');

    assert.deepEqual(readWorkflowNodeArtifact({ dataDir, runId, nodeId: 'mine' }).items, [{ keyword: 'pet bed' }]);
    assert.deepEqual(readWorkflowNodeArtifact({ dataDir, runId, nodeId: 'verify' }).items, [{ keyword: 'pet bed', status: 'verified' }]);
    assert.deepEqual(readWorkflowNodeArtifact({ dataDir, runId, nodeId: 'generate' }).items, [{ title: 'Warm pet bed' }]);
    assert.match(readWorkflowNodeArtifact({ dataDir, runId, nodeId: 'export' }).text, /Warm pet bed/);
    assert.match(readWorkflowNodeArtifact({ dataDir, runId, nodeId: 'review' }).text, /Manual Review Candidates/);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test core/test/workflow-pipeline-adapter.test.js
```

Expected: fail with missing exports from `../workflow`.

- [ ] **Step 3: Implement `core/workflow/pipeline-adapter.js`**

Create `core/workflow/pipeline-adapter.js`:

```js
'use strict';

const fs = require('fs');
const path = require('path');
const { summarizePipelineRun, listPipelineRuns, readJsonlPreview, readTextPreview } = require('../pipeline-run-summary');

const DEFAULT_PIPELINE_DIR = path.join(process.cwd(), 'data', 'pipeline');

const WORKFLOW_NODE_IDS = Object.freeze({
  start: 'start',
  mine: 'mine',
  verify: 'verify',
  generate: 'generate',
  export: 'export',
  review: 'review',
  end: 'end'
});

const STAGE_BY_NODE = Object.freeze({
  [WORKFLOW_NODE_IDS.start]: 0,
  [WORKFLOW_NODE_IDS.mine]: 1,
  [WORKFLOW_NODE_IDS.verify]: 2,
  [WORKFLOW_NODE_IDS.generate]: 3,
  [WORKFLOW_NODE_IDS.export]: 4,
  [WORKFLOW_NODE_IDS.review]: 5,
  [WORKFLOW_NODE_IDS.end]: 6
});

function clampInt(value, fallback, min, max) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function sanitizeWorkflowParams(mode, raw = {}) {
  if (mode === 'daily') {
    return {
      mine: clampInt(raw.mine, 50, 1, 100),
      verify: clampInt(raw.verify, 20, 1, 100),
      generate: clampInt(raw.generate, 10, 1, 50),
      export: clampInt(raw.export, 20, 1, 100),
      productsPerKeyword: clampInt(raw.productsPerKeyword, 12, 1, 50),
      length: clampInt(raw.length, 60, 30, 80),
      pages: clampInt(raw.pages, 1, 1, 10)
    };
  }
  if (mode === 'keyword') {
    const keyword = String(raw.keyword || '').trim();
    if (!keyword) throw new Error('关键词不能为空');
    return {
      keyword,
      export: clampInt(raw.export, 20, 1, 100),
      productsPerKeyword: clampInt(raw.productsPerKeyword, 12, 1, 50),
      length: clampInt(raw.length, 60, 30, 80),
      pages: clampInt(raw.pages, 1, 1, 10)
    };
  }
  throw new Error(`不支持的工作流模式: ${mode}`);
}

function productionWorkflowGraph(mode) {
  const keywordNodeLabel = mode === 'keyword' ? '指定关键词' : '开始';
  const nodes = [
    { id: WORKFLOW_NODE_IDS.start, type: 'workflow-start', position: { x: 60, y: 180 }, data: { label: keywordNodeLabel } },
    { id: WORKFLOW_NODE_IDS.mine, type: 'pipeline-stage', position: { x: 300, y: 180 }, data: { label: '挖词', stage: 'mine' } },
    { id: WORKFLOW_NODE_IDS.verify, type: 'pipeline-stage', position: { x: 540, y: 180 }, data: { label: '生意参谋验真', stage: 'verify' } },
    { id: WORKFLOW_NODE_IDS.generate, type: 'pipeline-stage', position: { x: 780, y: 180 }, data: { label: '标题货源', stage: 'generate' } },
    { id: WORKFLOW_NODE_IDS.export, type: 'pipeline-stage', position: { x: 1020, y: 180 }, data: { label: '导出清单', stage: 'export' } },
    { id: WORKFLOW_NODE_IDS.review, type: 'pipeline-stage', position: { x: 1260, y: 180 }, data: { label: '人工复核', stage: 'review' } },
    { id: WORKFLOW_NODE_IDS.end, type: 'pipeline-end', position: { x: 1500, y: 180 }, data: { label: '完成' } }
  ];
  const edges = nodes.slice(0, -1).map((node, index) => ({
    id: `edge_${node.id}_${nodes[index + 1].id}`,
    source: node.id,
    target: nodes[index + 1].id
  }));
  return { nodes, edges };
}

function listProductionWorkflowTemplates() {
  return [
    {
      id: 'daily-selection-v1',
      mode: 'daily',
      name: '每日选品流水线',
      description: '挖词、验真、标题货源、导出、人工复核',
      workflow: productionWorkflowGraph('daily')
    },
    {
      id: 'exact-keyword-v1',
      mode: 'keyword',
      name: '指定关键词流水线',
      description: '用一个明确关键词跑验真、标题货源、导出、人工复核',
      workflow: productionWorkflowGraph('keyword')
    }
  ];
}

function getTemplate(templateId) {
  const template = listProductionWorkflowTemplates().find(item => item.id === templateId);
  if (!template) throw new Error(`未知工作流模板: ${templateId}`);
  return template;
}

function buildPipelineCliArgs(mode, params) {
  if (mode === 'daily') {
    return [
      'bin/cli.js', 'flow', 'daily', '--json',
      '--mine', String(params.mine),
      '--verify', String(params.verify),
      '--generate', String(params.generate),
      '--export', String(params.export),
      '--products-per-keyword', String(params.productsPerKeyword),
      '--length', String(params.length),
      '--pages', String(params.pages)
    ];
  }
  if (mode === 'keyword') {
    return [
      'bin/cli.js', 'flow', 'keyword', params.keyword, '--json',
      '--export', String(params.export),
      '--products-per-keyword', String(params.productsPerKeyword),
      '--length', String(params.length),
      '--pages', String(params.pages)
    ];
  }
  throw new Error(`不支持的工作流模式: ${mode}`);
}

function statusForNode(summary, nodeId) {
  const stageIndex = Number.isFinite(summary.stageIndex) ? summary.stageIndex : 0;
  const nodeIndex = STAGE_BY_NODE[nodeId];
  if (nodeIndex < stageIndex) return 'completed';
  if (nodeIndex > stageIndex) return 'idle';
  if (summary.status === 'needs_review' && nodeId === WORKFLOW_NODE_IDS.review) return 'needs_review';
  if (summary.status === 'awaiting_user_confirmation' && nodeId === WORKFLOW_NODE_IDS.review) return 'waiting_confirmation';
  if (summary.requiresUserAction && nodeId === WORKFLOW_NODE_IDS.verify) return 'blocked';
  if (/failed|empty/.test(String(summary.status || ''))) return 'failed';
  if (summary.status === 'workflow_complete' && nodeId === WORKFLOW_NODE_IDS.end) return 'completed';
  return 'running';
}

function pipelineSummaryToWorkflowRun(summary = {}) {
  const template = getTemplate(summary.workflowTemplateId || 'daily-selection-v1');
  const nodeStates = {};
  template.workflow.nodes.forEach(node => {
    nodeStates[node.id] = {
      id: node.id,
      type: node.type,
      label: node.data && node.data.label,
      status: statusForNode(summary, node.id),
      counts: summary.counts || {},
      error: summary.error || ''
    };
  });
  return {
    ...summary,
    workflow: template.workflow,
    nodeStates,
    requiresUserAction: Boolean(summary.requiresUserAction),
    blockers: Array.isArray(summary.blockers) ? summary.blockers : []
  };
}

function listWorkflowRuns(options = {}) {
  const data = listPipelineRuns({ dataDir: options.dataDir || DEFAULT_PIPELINE_DIR, limit: options.limit || 20 });
  return {
    ...data,
    runs: (data.runs || []).map(pipelineSummaryToWorkflowRun),
    latest: data.latest ? pipelineSummaryToWorkflowRun(data.latest) : null
  };
}

function getWorkflowRun(options = {}) {
  const summary = summarizePipelineRun({
    dataDir: options.dataDir || DEFAULT_PIPELINE_DIR,
    runId: options.runId,
    previewLimit: options.previewLimit || 20,
    reviewChars: options.reviewChars || 12000
  });
  return summary ? pipelineSummaryToWorkflowRun(summary) : null;
}

function readWorkflowNodeArtifact({ dataDir = DEFAULT_PIPELINE_DIR, runId, nodeId }) {
  const summary = summarizePipelineRun({ dataDir, runId, previewLimit: 20, reviewChars: 12000 });
  if (!summary || !summary.files) return { kind: 'empty', items: [], text: '' };
  if (nodeId === WORKFLOW_NODE_IDS.mine) {
    return { kind: 'jsonl', items: readJsonlPreview(summary.files.candidates, 50), text: '' };
  }
  if (nodeId === WORKFLOW_NODE_IDS.verify) {
    return { kind: 'jsonl', items: readJsonlPreview(summary.files.sycmResults || summary.files.verifiedKeywords, 50), text: '' };
  }
  if (nodeId === WORKFLOW_NODE_IDS.generate) {
    return { kind: 'jsonl', items: readJsonlPreview(summary.files.generatedProducts, 50), text: '' };
  }
  if (nodeId === WORKFLOW_NODE_IDS.export) {
    return { kind: 'text', items: [], text: readTextPreview(summary.files.distributionBatch, 12000) };
  }
  if (nodeId === WORKFLOW_NODE_IDS.review) {
    return { kind: 'markdown', items: [], text: readTextPreview(summary.files.distributionReview, 12000) };
  }
  return { kind: 'summary', items: [], text: summary.userMessage || summary.nextAction || '' };
}

module.exports = {
  DEFAULT_PIPELINE_DIR,
  WORKFLOW_NODE_IDS,
  listProductionWorkflowTemplates,
  sanitizeWorkflowParams,
  buildPipelineCliArgs,
  pipelineSummaryToWorkflowRun,
  listWorkflowRuns,
  getWorkflowRun,
  readWorkflowNodeArtifact
};
```

- [ ] **Step 4: Export adapter from `core/workflow/index.js`**

Modify `core/workflow/index.js`:

```js
'use strict';

const registry = require('./registry');
const runStore = require('./run-store');
const events = require('./events');
const scheduler = require('./scheduler');
const validator = require('./validator');
const pipelineAdapter = require('./pipeline-adapter');

module.exports = {
  ...registry,
  ...runStore,
  ...events,
  ...scheduler,
  ...validator,
  ...pipelineAdapter
};
```

- [ ] **Step 5: Run adapter tests**

Run:

```bash
node --test core/test/workflow-pipeline-adapter.test.js
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add core/workflow/index.js core/workflow/pipeline-adapter.js core/test/workflow-pipeline-adapter.test.js
git commit -m "feat: add pipeline workflow adapter"
```

---

### Task 2: Route Workflow APIs To Real Pipeline Runs

**Files:**
- Modify: `bin/server.js`
- Test: `test/workflow.test.js`

- [ ] **Step 1: Add API regression tests**

Extend `test/workflow.test.js` with tests around the pure adapter functions if the file already starts the server. If it does not start the server reliably, add these tests to `core/test/workflow-pipeline-adapter.test.js` instead:

```js
it('rejects unknown production template ids', () => {
  assert.throws(() => sanitizeWorkflowParams('not-real', {}), /不支持的工作流模式/);
});

it('rejects shell-like numeric params by falling back to safe numbers', () => {
  const params = sanitizeWorkflowParams('daily', { mine: '5; rm -rf /', verify: '4 && bad' });
  assert.equal(params.mine, 5);
  assert.equal(params.verify, 4);
});
```

- [ ] **Step 2: Run the focused test**

Run:

```bash
node --test core/test/workflow-pipeline-adapter.test.js
```

Expected: pass if tests were added to the adapter test file; otherwise the server test should fail until routes are rewired.

- [ ] **Step 3: Replace `/api/workflows/templates`, list, and detail handlers**

In `bin/server.js`, import adapter functions from `core/workflow`:

```js
const {
  listProductionWorkflowTemplates,
  sanitizeWorkflowParams,
  buildPipelineCliArgs,
  listWorkflowRuns,
  getWorkflowRun,
  readWorkflowNodeArtifact
} = require('../core/workflow');
```

Replace handlers:

```js
app.get('/api/workflows/templates', (req, res) => {
  res.json({ ok: true, data: listProductionWorkflowTemplates() });
});

app.get('/api/workflows/runs', (req, res) => {
  try {
    const limit = parsePositiveNumber(req.query.limit, 20);
    res.json({ ok: true, data: listWorkflowRuns({ limit }) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/workflows/runs/:runId', (req, res) => {
  try {
    const run = getWorkflowRun({ runId: req.params.runId });
    if (!run) return res.status(404).json({ ok: false, error: '未找到该工作流运行记录' });
    res.json({ ok: true, data: run });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/workflows/runs/:runId/artifacts/:nodeId', (req, res) => {
  try {
    const artifact = readWorkflowNodeArtifact({
      runId: req.params.runId,
      nodeId: req.params.nodeId
    });
    res.json({ ok: true, data: artifact });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

- [ ] **Step 4: Replace `/api/workflows/run` with safe real CLI spawn**

Use the existing `activeWorkbenchProcess` guard and output handling pattern already present in `POST /api/workbench/run`.

```js
app.post('/api/workflows/run', (req, res) => {
  if (activeWorkbenchProcess) {
    return res.status(409).json({
      ok: false,
      status: 'workflow_busy',
      error: '已有工作流正在运行，请等待完成后再启动。'
    });
  }

  const body = req.body || {};
  const mode = body.mode === 'keyword' ? 'keyword' : 'daily';
  let params;
  try {
    params = sanitizeWorkflowParams(mode, body.params || body);
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }

  const args = buildPipelineCliArgs(mode, params);
  let child;
  try {
    child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }

  const runState = { child, pid: child.pid, mode, stdout: '', stderr: '' };
  activeWorkbenchProcess = runState;

  child.stdout.on('data', chunk => {
    runState.stdout = appendCappedOutput(runState.stdout, chunk);
  });
  child.stderr.on('data', chunk => {
    runState.stderr = appendCappedOutput(runState.stderr, chunk);
  });
  child.on('exit', (code, signal) => {
    if (activeWorkbenchProcess === runState) activeWorkbenchProcess = null;
    if (code === 0) originalLog(`[Workflow Run] ${mode} 工作流完成，pid=${runState.pid}`);
    else originalError(`[Workflow Run] ${mode} 工作流失败，pid=${runState.pid}, code=${code}, signal=${signal || ''}`);
  });

  res.json({ ok: true, data: { status: 'started', pid: child.pid, mode, params } });
});
```

- [ ] **Step 5: Keep unsupported mutation routes explicit**

For `cancel`, `retry-node`, and `resume`, return safe explicit responses until Task 6 implements resume:

```js
app.post('/api/workflows/runs/:runId/cancel', (req, res) => {
  res.status(501).json({ ok: false, error: '当前版本暂不支持取消真实 pipeline 子进程，请等待当前运行完成。' });
});

app.post('/api/workflows/runs/:runId/retry-node', (req, res) => {
  res.status(501).json({ ok: false, error: '当前版本暂不支持单节点重试。' });
});

app.post('/api/workflows/runs/:runId/resume', (req, res) => {
  res.status(501).json({ ok: false, error: '当前版本暂不支持从画布恢复铺货提交。' });
});
```

- [ ] **Step 6: Run tests**

Run:

```bash
node --test core/test/workflow-pipeline-adapter.test.js test/workflow.test.js
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add bin/server.js core/test/workflow-pipeline-adapter.test.js test/workflow.test.js
git commit -m "feat: route workflow api to pipeline runs"
```

---

### Task 3: Add Frontend Workflow Mapping Helpers

**Files:**
- Modify: `apps/web/src/workflow-ui.js`
- Modify: `apps/web/src/workflow-ui.test.mjs`

- [ ] **Step 1: Add failing frontend helper tests**

Append to `apps/web/src/workflow-ui.test.mjs`:

```js
import {
  getCanvasNodeTone,
  getWorkflowNodeAction,
  summarizeWorkflowArtifact
} from './workflow-ui.js';

test('getCanvasNodeTone maps production node states to visual tones', () => {
  assert.equal(getCanvasNodeTone({ status: 'completed' }), 'success');
  assert.equal(getCanvasNodeTone({ status: 'running' }), 'active');
  assert.equal(getCanvasNodeTone({ status: 'needs_review' }), 'warn');
  assert.equal(getCanvasNodeTone({ status: 'waiting_confirmation' }), 'warn');
  assert.equal(getCanvasNodeTone({ status: 'blocked' }), 'danger');
  assert.equal(getCanvasNodeTone({ status: 'failed' }), 'danger');
  assert.equal(getCanvasNodeTone({ status: 'idle' }), 'muted');
});

test('getWorkflowNodeAction recommends review actions', () => {
  assert.deepEqual(getWorkflowNodeAction('review', { status: 'needs_review' }), {
    label: '处理复核',
    action: 'review',
    tone: 'warn'
  });
  assert.deepEqual(getWorkflowNodeAction('verify', { status: 'blocked' }), {
    label: '查看阻塞',
    action: 'inspect',
    tone: 'danger'
  });
});

test('summarizeWorkflowArtifact produces compact labels', () => {
  assert.equal(summarizeWorkflowArtifact({ kind: 'jsonl', items: [{ keyword: '宠物窝' }, { keyword: '猫碗' }] }), '2 条数据');
  assert.equal(summarizeWorkflowArtifact({ kind: 'text', text: 'a\\nb\\n' }), '2 行文本');
  assert.equal(summarizeWorkflowArtifact({ kind: 'markdown', text: '# Review' }), '复核报告');
});
```

- [ ] **Step 2: Run failing frontend tests**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
```

Expected: fail with missing exports.

- [ ] **Step 3: Implement helpers**

Add to `apps/web/src/workflow-ui.js`:

```js
export function getCanvasNodeTone(state = {}) {
  const status = String(state.status || '').toLowerCase();
  if (status === 'completed') return 'success';
  if (status === 'running') return 'active';
  if (status === 'needs_review' || status === 'waiting_confirmation') return 'warn';
  if (status === 'blocked' || status === 'failed') return 'danger';
  return 'muted';
}

export function getWorkflowNodeAction(nodeId, state = {}) {
  const status = String(state.status || '').toLowerCase();
  if (nodeId === 'review' && (status === 'needs_review' || status === 'waiting_confirmation')) {
    return { label: '处理复核', action: 'review', tone: 'warn' };
  }
  if (status === 'blocked' || status === 'failed') {
    return { label: '查看阻塞', action: 'inspect', tone: 'danger' };
  }
  if (status === 'completed') {
    return { label: '查看产物', action: 'artifact', tone: 'default' };
  }
  return { label: '查看节点', action: 'inspect', tone: 'muted' };
}

export function summarizeWorkflowArtifact(artifact = {}) {
  if (Array.isArray(artifact.items) && artifact.items.length > 0) return `${artifact.items.length} 条数据`;
  if (artifact.kind === 'markdown' && artifact.text) return '复核报告';
  if (artifact.text) {
    const lines = artifact.text.split(/\\r?\\n/).filter(Boolean).length;
    return `${lines} 行文本`;
  }
  return '暂无产物';
}
```

- [ ] **Step 4: Run frontend helper tests**

Run:

```bash
node --test apps/web/src/workflow-ui.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/workflow-ui.js apps/web/src/workflow-ui.test.mjs
git commit -m "feat: add workflow canvas ui helpers"
```

---

### Task 4: Convert WorkflowStudio To Production Templates

**Files:**
- Modify: `apps/web/src/WorkflowStudio.jsx`
- Modify: `apps/web/src/App.css`

- [ ] **Step 1: Replace experiment wording and state names**

In `WorkflowStudio.jsx`, keep `MODE_MONITOR` and `MODE_EXPERIMENT`, but change user-facing labels:

```jsx
<button
  onClick={() => setMode(MODE_MONITOR)}
  className={`mode-toggle ${mode === MODE_MONITOR ? 'mode-toggle-active' : ''}`}
>
  运行监控
</button>
<button
  onClick={() => setMode(MODE_EXPERIMENT)}
  className={`mode-toggle ${mode === MODE_EXPERIMENT ? 'mode-toggle-active' : ''}`}
>
  流程编排
</button>
```

Update the title expression:

```jsx
{mode === MODE_MONITOR ? '流程监控' : '可执行流程编排'}
```

- [ ] **Step 2: Load production templates and runs from rewired APIs**

Keep `fetchTemplates` and `fetchHistoryRuns`, but normalize payloads:

```jsx
const fetchTemplates = async () => {
  try {
    const res = await fetch('/api/workflows/templates');
    const data = await res.json();
    const list = data.ok ? unwrapApiData(data) : [];
    setTemplates(Array.isArray(list) ? list : []);
    if (Array.isArray(list) && list.length > 0 && nodes.length === 0) {
      loadTemplate(list[0]);
    }
  } catch (err) {
    setLogs((prev) => prev.concat({
      timestamp: new Date().toISOString(),
      level: 'error',
      message: `获取流程模板失败: ${err.message}`
    }));
  }
};

const fetchHistoryRuns = async () => {
  try {
    const res = await fetch('/api/workflows/runs?limit=20');
    const data = await res.json();
    const payload = data.ok ? unwrapApiData(data) : { runs: [] };
    setHistoryRuns(payload.runs || []);
  } catch (err) {
    setLogs((prev) => prev.concat({
      timestamp: new Date().toISOString(),
      level: 'error',
      message: `获取运行历史失败: ${err.message}`
    }));
  }
};
```

- [ ] **Step 3: Change `handleRunWorkflow` request shape**

Replace graph-submission body with template and params:

```jsx
const activeTemplate = templates.find((template) => {
  const templateNodeIds = (template.workflow?.nodes || []).map((node) => node.id).join(',');
  const currentNodeIds = nodes.map((node) => node.id).join(',');
  return templateNodeIds === currentNodeIds;
}) || templates[0];

const startNode = nodes.find((node) => node.id === 'start');
const workflowParams = startNode?.data || {};

const res = await fetch('/api/workflows/run', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    templateId: activeTemplate?.id || 'daily-selection-v1',
    mode: activeTemplate?.mode || 'daily',
    params: workflowParams
  })
});
```

- [ ] **Step 4: Add artifact loading on node click**

Add state:

```jsx
const [selectedArtifact, setSelectedArtifact] = useState(null);
const [artifactLoading, setArtifactLoading] = useState(false);
```

Add function:

```jsx
const loadNodeArtifact = async (runId, nodeId) => {
  if (!runId || !nodeId) return;
  setArtifactLoading(true);
  try {
    const res = await fetch(`/api/workflows/runs/${runId}/artifacts/${nodeId}`);
    const payload = await res.json();
    if (payload.ok === false) throw new Error(payload.error || '加载节点产物失败');
    setSelectedArtifact(unwrapApiData(payload));
  } catch (err) {
    setSelectedArtifact({ kind: 'error', text: err.message, items: [] });
  } finally {
    setArtifactLoading(false);
  }
};
```

Update node click:

```jsx
const onNodeClick = useCallback((event, node) => {
  setSelectedNodeId(node.id);
  if (currentRunId) {
    loadNodeArtifact(currentRunId, node.id);
  }
}, [currentRunId]);
```

- [ ] **Step 5: Render artifact panel**

In the right panel under selected node details, add:

```jsx
{selectedNode && currentRunId && (
  <div className="workflow-artifact-panel">
    <div className="section-title-row">
      <h3>节点产物</h3>
      <button className="secondary-button muted" type="button" onClick={() => loadNodeArtifact(currentRunId, selectedNode.id)}>
        刷新
      </button>
    </div>
    {artifactLoading ? (
      <p className="muted-copy">加载中...</p>
    ) : selectedArtifact?.items?.length > 0 ? (
      <div className="artifact-list">
        {selectedArtifact.items.slice(0, 12).map((item, index) => (
          <pre key={`${selectedNode.id}-${index}`}>{JSON.stringify(item, null, 2)}</pre>
        ))}
      </div>
    ) : selectedArtifact?.text ? (
      <pre className="artifact-text">{selectedArtifact.text}</pre>
    ) : (
      <p className="muted-copy">暂无产物</p>
    )}
  </div>
)}
```

- [ ] **Step 6: Add CSS**

Add to `apps/web/src/App.css`:

```css
.workflow-artifact-panel {
  border-top: 1px solid rgba(148, 163, 184, 0.2);
  padding: 14px;
}

.artifact-list {
  display: grid;
  gap: 8px;
}

.artifact-list pre,
.artifact-text {
  max-height: 280px;
  overflow: auto;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.72);
  color: #dbeafe;
  font-size: 11px;
  line-height: 1.5;
  padding: 10px;
  white-space: pre-wrap;
}
```

- [ ] **Step 7: Build frontend**

Run:

```bash
npm run web:build
```

Expected: Vite build passes.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/WorkflowStudio.jsx apps/web/src/App.css
git commit -m "feat: connect workflow studio to production runs"
```

---

### Task 5: Add Workflow Run Snapshots And Events

**Files:**
- Modify: `core/workflow/pipeline-adapter.js`
- Modify: `bin/server.js`
- Modify: `core/test/workflow-pipeline-adapter.test.js`

- [ ] **Step 1: Add tests for workflow definition snapshots**

Append:

```js
const {
  writeWorkflowDefinition,
  appendWorkflowEvent,
  readWorkflowEvents
} = require('../workflow');

it('writes workflow definition and event files into pipeline run dir', () => {
  const dataDir = tempPipelineDir();
  const runId = 'snapshot_run';
  const definition = { templateId: 'daily-selection-v1', mode: 'daily', params: { mine: 5 } };
  writeWorkflowDefinition({ dataDir, runId, definition });
  appendWorkflowEvent({ dataDir, runId, event: { type: 'started', nodeId: 'start' } });
  const runDir = path.join(dataDir, 'runs', runId);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(runDir, 'workflow-definition.json'), 'utf8')), definition);
  assert.deepEqual(readWorkflowEvents({ dataDir, runId }).map(item => item.type), ['started']);
});
```

- [ ] **Step 2: Implement snapshot helpers**

Add to `pipeline-adapter.js`:

```js
function workflowRunDir(dataDir, runId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(String(runId || ''))) throw new Error('Invalid run id');
  return path.join(dataDir || DEFAULT_PIPELINE_DIR, 'runs', runId);
}

function writeWorkflowDefinition({ dataDir = DEFAULT_PIPELINE_DIR, runId, definition }) {
  const runDir = workflowRunDir(dataDir, runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'workflow-definition.json'), JSON.stringify(definition, null, 2), 'utf8');
}

function appendWorkflowEvent({ dataDir = DEFAULT_PIPELINE_DIR, runId, event }) {
  const runDir = workflowRunDir(dataDir, runId);
  fs.mkdirSync(runDir, { recursive: true });
  const payload = { ...event, timestamp: event.timestamp || new Date().toISOString() };
  fs.appendFileSync(path.join(runDir, 'workflow-events.jsonl'), JSON.stringify(payload) + '\\n', 'utf8');
}

function readWorkflowEvents({ dataDir = DEFAULT_PIPELINE_DIR, runId }) {
  const file = path.join(workflowRunDir(dataDir, runId), 'workflow-events.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split(/\\r?\\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}
```

Export the three functions.

- [ ] **Step 3: Attach events to run detail**

In `getWorkflowRun`, add:

```js
const run = pipelineSummaryToWorkflowRun(summary);
run.workflowEvents = readWorkflowEvents({ dataDir: options.dataDir || DEFAULT_PIPELINE_DIR, runId: options.runId });
return run;
```

- [ ] **Step 4: Run adapter tests**

Run:

```bash
node --test core/test/workflow-pipeline-adapter.test.js
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add core/workflow/pipeline-adapter.js core/test/workflow-pipeline-adapter.test.js bin/server.js
git commit -m "feat: persist workflow canvas snapshots"
```

---

### Task 6: Verification And Browser Smoke

**Files:**
- No planned source edits unless verification reveals a bug.

- [ ] **Step 1: Run backend and frontend tests**

Run:

```bash
node --test core/test/workflow-pipeline-adapter.test.js apps/web/src/workflow-ui.test.mjs
npm run web:build
```

Expected: both test commands pass and Vite build succeeds.

- [ ] **Step 2: Run broader project checks**

Run:

```bash
npm test
npm run test:core-skills
```

Expected: pass. If `test:core-skills` requires external credentials and fails for that reason, capture the exact failing test and error in the final implementation notes.

- [ ] **Step 3: Start local UI**

Run:

```bash
node bin/server.js
```

Expected: server prints local URL, normally `http://127.0.0.1:3001`.

- [ ] **Step 4: Browser smoke test**

Open the local URL and verify:

- Dashboard still loads.
- System > Workflow canvas opens inside the React shell.
- Canvas shows production templates.
- Running with invalid exact keyword shows a validation error.
- Running daily workflow starts a real background pipeline or returns a clear busy/error state.
- Clicking nodes does not clip the right panel.
- Artifact panel shows empty state or real artifacts without layout overlap.

- [ ] **Step 5: Commit verification fixes if needed**

If any smoke issue required edits:

```bash
git add <changed-files>
git commit -m "fix: polish executable workflow canvas"
```

- [ ] **Step 6: Push branch**

```bash
git push origin master
```

---

## Self-Review

Spec coverage:

- Real `pipeline-flow` source of truth: Task 1 and Task 2.
- Production templates: Task 1 and Task 4.
- Real node status and artifacts: Task 1, Task 4, Task 5.
- Human review visibility: Task 1 and Task 4; resume stays explicit `501` until a separate follow-up implementation because safe submission needs a separate confirmation design.
- Safety boundaries: Task 1 and Task 2 use sanitized params and `spawn` args.
- Tests: Tasks 1, 2, 3, and 6.

Known intentional deferral:

- Full resume/submit behavior is not implemented in this plan because it can trigger distribution-related consequences. This plan exposes the review state and keeps resume blocked with a clear `501` until a follow-up plan designs confirmation and submission semantics.
