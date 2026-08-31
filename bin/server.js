'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const { AsyncLocalStorage } = require('async_hooks');
require('dotenv').config();

const {
  listSeeds,
  addSeed,
  loadSeeds,
  saveSeeds,
  mineKeywords,
  auditSeedPool,
  prepareSeedSuggestions,
  buildSeedReplenishmentPlan,
  DEFAULT_DATA_DIR
} = require('../skills/keyword-mining');

const { generateTitlePipeline } = require('../skills/title-gen');
const { searchAll, resolve1688ShareText } = require('../skills/alibaba1688');
const {
  autoLaunchChrome,
  isChromeDevToolsAvailable,
  openChromeUrl,
  SYCM_SELECTORS
} = require('../skills/sycm-research');

const {
  WORKFLOW_NODE_IDS,
  listProductionWorkflowTemplates,
  sanitizeWorkflowParams,
  validateProductionWorkflow,
  resolveProductionWorkflowLaunch,
  resolveProductionWorkflowDefinition,
  writeWorkflowDefinition,
  listWorkflowRuns,
  getWorkflowRun,
  readWorkflowNodeArtifact,
  deleteWorkflowRun
} = require('../core/workflow/pipeline-adapter');
const {
  resumeWorkflow,
  retryWorkflowNode,
  markRunPaused,
  getRun
} = require('../core/workflow');
const {
  createRunId,
  flowMine,
  flowReviewCandidates,
  flowVerify,
  flowSelectProducts,
  flowGenerate,
  flowExport,
  appendRunCandidates,
  flowReviewProducts,
  markRunDistributionComplete
} = require('../skills/pipeline-flow');
const {
  runPipelineRuntime
} = require('../skills/pipeline-flow/runtime/runner');
const {
  confirmReviewDrafts,
  saveReviewSourceUpload
} = require('../skills/review-sheet');
const {
  confirmOrderSheetProducts,
  getOrderSheetDraft,
  saveOrderSheetDraft,
  updateOrderSheetManualProducts
} = require('../skills/order-sheet');
const {
  parseItems,
  checkDistributionReadiness,
  confirmDistributionLog,
  distributeProducts
} = require('../skills/1688-distribution');
const {
  readRuntimeState,
  updateRuntimeState,
  requestRuntimeCancel,
  requestRuntimePause,
  requestRuntimeResume,
  requestRuntimeRetryStep,
  readRuntimeEvents,
  appendRuntimeEvent
} = require('../skills/pipeline-flow/runtime/store');

const {
  listPipelineRuns,
  summarizePipelineRun
} = require('../core/pipeline-run-summary');
const {
  clearPlatformAccessBlocker,
  getPlatformAccessStatus
} = require('../core/platform-access-guard');

const app = express();
// 刷单表草稿会带完整商品 + SKU 数据（单个商品可有数百个规格），默认 100kb 会把保存请求直接拒成 413
const JSON_BODY_LIMIT = process.env.UI_JSON_BODY_LIMIT || '25mb';
app.use(express.json({ limit: JSON_BODY_LIMIT }));

const reactWebPath = path.join(__dirname, '../apps/web/dist');

// AsyncLocalStorage for concurrent SSE log routing
const logStorage = new AsyncLocalStorage();

// Hook console globally once
const originalLog = console.log;
const originalError = console.error;
const WORKBENCH_OUTPUT_LIMIT_BYTES = 200 * 1024;
let activeWorkbenchProcess = null;
const activeDistributionJobs = new Map();
const DISTRIBUTION_JOB_DIR = path.join(process.cwd(), 'data', 'pipeline', 'distribution-runs');

async function resolveManualShareParams(mode, raw = {}) {
  if (mode !== 'manual' || !Array.isArray(raw.items)) return raw;
  const items = await Promise.all(raw.items.slice(0, 100).map(async (item) => {
    const source = String(item?.url || item?.productUrl || '').trim();
    const resolved = await resolve1688ShareText(source);
    return resolved ? { ...item, url: resolved.url, offerId: resolved.offerId } : item;
  }));
  return { ...raw, items };
}

function distributionJobFile(jobId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(String(jobId || ''))) throw new Error('无效的铺货运行 ID。');
  return path.join(DISTRIBUTION_JOB_DIR, `${jobId}.json`);
}

function readDistributionJob(jobId) {
  const file = distributionJobFile(jobId);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function writeDistributionJob(job) {
  fs.mkdirSync(DISTRIBUTION_JOB_DIR, { recursive: true });
  fs.writeFileSync(distributionJobFile(job.jobId), `${JSON.stringify(job, null, 2)}\n`, 'utf8');
  return job;
}

function updateDistributionJob(jobId, patch = {}) {
  const current = activeDistributionJobs.get(jobId) || readDistributionJob(jobId) || {};
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  activeDistributionJobs.set(jobId, next);
  return writeDistributionJob(next);
}

function distributionJobInput(job = {}) {
  return (job.items || []).map(item => (
    `${item.url || ''}$$${item.title || ''}$$${item.category || ''}`
  )).join('\n');
}

async function recheckDistributionJob(job) {
  const input = distributionJobInput(job);
  if (!input) throw new Error('铺货任务没有可复核的商品清单。');
  const reader = app.locals.distributionConfirmationReader || confirmDistributionLog;
  updateDistributionJob(job.jobId, {
    status: 'checking_confirmation',
    confirmationError: '',
    progress: { ...(job.progress || {}), phase: 'checking_confirmation' }
  });
  try {
    const confirmationCheck = await reader({ input });
    const completed = confirmationCheck?.ok === true && confirmationCheck?.status === 'confirmed';
    const next = updateDistributionJob(job.jobId, {
      status: completed ? 'completed' : 'completed_with_issues',
      completed: completed ? Number(job.total || 0) : Number(job.completed || 0),
      failed: completed ? 0 : Number(job.failed || 0),
      confirmationCheck,
      confirmationError: '',
      progress: { ...(job.progress || {}), phase: completed ? 'completed' : 'completed_with_issues' }
    });
    if (completed && next.workflowRunId) {
      syncCompletedDistributionWorkflow({
        ...next,
        result: { ...(next.result || {}), total: next.total, confirmed: next.total, confirmationCheck }
      });
    }
    return next;
  } catch (error) {
    updateDistributionJob(job.jobId, {
      status: 'completed_with_issues',
      confirmationError: error.message,
      progress: { ...(job.progress || {}), phase: 'confirmation_failed' }
    });
    throw error;
  }
}

function syncCompletedDistributionWorkflow(job) {
  if (!job || job.status !== 'completed' || !job.workflowRunId) return;
  const currentSummary = summarizePipelineRun({ runId: job.workflowRunId });
  const currentRuntime = readRuntimeState({ runId: job.workflowRunId });
  if (currentSummary?.status === 'workflow_complete' && currentRuntime?.status === 'completed') return;
  markRunDistributionComplete({
    runId: job.workflowRunId,
    distributionResult: { ...(job.result || {}), method: job.mode || job.result?.method || 'automatic' }
  });
  const runtime = currentRuntime || readRuntimeState({ runId: job.workflowRunId });
  if (!runtime) return;
  updateRuntimeState({
    runId: job.workflowRunId,
    patch: {
      status: 'completed',
      activeStep: 'end',
      progress: {
        ...(runtime.progress || {}),
        export: {
          status: 'completed',
          current: 1,
          total: 1,
          percent: 100,
          message: job.mode === 'manual' ? '人工铺货已确认' : '铺货已确认'
        },
        end: { status: 'completed', current: 1, total: 1, percent: 100, message: '流程完成' }
      },
      requestedAction: null
    }
  });
  appendRuntimeEvent({
    runId: job.workflowRunId,
    event: { event: 'status', status: 'completed', pipelineStatus: 'workflow_complete', step: 'end' }
  });
}

const sendSseLog = (type, args) => {
  const res = logStorage.getStore();
  if (!res) return;
  const message = args.map(arg => {
    if (arg instanceof Error) return arg.stack || arg.message;
    if (typeof arg === 'object') return JSON.stringify(arg);
    return String(arg);
  }).join(' ');
  try {
    res.write(`data: ${JSON.stringify({ type, message })}\n\n`);
  } catch (_) {}
};

console.log = (...args) => {
  sendSseLog('log', args);
  originalLog(...args);
};

console.error = (...args) => {
  sendSseLog('error', args);
  originalError(...args);
};

// Find a free port starting from a default
function findFreePort(startPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(findFreePort(startPort + 1));
      } else {
        reject(err);
      }
    });
    server.listen(startPort, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => {
        resolve(port);
      });
    });
  });
}

// 1. GET /api/status - Get system and data file stats
app.get('/api/status', (req, res) => {
  const stats = {
    env: {
      hasGlmKey: !!process.env.GLM_API_KEY,
      hasAliKey: !!process.env.ALI_1688_AK
    },
    files: {
      seedsCount: 0,
      seenCount: 0,
      rejectedCount: 0,
      cacheCount: 0
    }
  };

  try {
    const seeds = loadSeeds(DEFAULT_DATA_DIR);
    stats.files.seedsCount = seeds.length;
  } catch (_) {}

  const getLineCount = (filename) => {
    try {
      const file = path.join(DEFAULT_DATA_DIR, filename);
      if (fs.existsSync(file)) {
        return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).length;
      }
    } catch (_) {}
    return 0;
  };

  stats.files.seenCount = getLineCount('seen-candidates.jsonl');
  stats.files.rejectedCount = getLineCount('rejected-candidates.jsonl');
  stats.files.cacheCount = getLineCount('verify-cache.jsonl');

  res.json({ ok: true, data: stats });
});

// GET /api/platform/status - Get current status of Taobao, SYCM, and 1688 access guards
app.get('/api/platform/status', (req, res) => {
  try {
    res.json({
      ok: true,
      data: {
        taobao: getPlatformAccessStatus('taobao'),
        sycm: getPlatformAccessStatus('sycm'),
        '1688': getPlatformAccessStatus('1688')
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 1.5 GET /api/workflow/batches - Read-only daily pipeline batch summaries
app.get('/api/workflow/batches', (req, res) => {
  try {
    const limit = parsePositiveNumber(req.query.limit, 20);
    const data = listPipelineRuns({ limit });
    const runs = data.runs.map(withLegacyBatchFields);
    res.json({ ok: true, data: { ...data, runs, latest: runs[0] || null } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 1.6 GET /api/workbench/runs - Daily workbench run summaries
app.get('/api/workbench/runs', (req, res) => {
  try {
    const limit = parsePositiveNumber(req.query.limit, 20);
    res.json({ ok: true, data: listPipelineRuns({ limit }) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 1.7 GET /api/workbench/runs/:runId - Daily workbench run details
app.get('/api/workbench/runs/:runId', (req, res) => {
  try {
    const summary = summarizePipelineRun({ runId: req.params.runId });
    if (!summary) {
      return res.status(404).json({ ok: false, error: '未找到该工作流运行记录' });
    }
    res.json({ ok: true, data: summary });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 1.8 POST /api/workbench/run - Start guarded CLI workflow in background
app.post('/api/workbench/run', (req, res) => {
  if (activeWorkbenchProcess) {
    return res.status(409).json({
      ok: false,
      status: 'workflow_busy',
      error: '已有工作流正在运行，请等待完成后再启动。'
    });
  }

  const body = req.body || {};
  const mode = body.mode === 'keyword' ? 'keyword' : 'daily';
  const keyword = String(body.keyword || '').trim();
  if (mode === 'keyword' && !keyword) {
    return res.status(400).json({ ok: false, error: '关键词不能为空' });
  }

  const args = buildWorkbenchCliArgs(mode, keyword, body);
  let child;
  try {
    child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env
    });
  } catch (err) {
    activeWorkbenchProcess = null;
    return res.status(500).json({ ok: false, error: err.message });
  }

  const runState = {
    child,
    pid: child.pid,
    mode,
    stdout: '',
    stderr: ''
  };
  activeWorkbenchProcess = runState;

  child.stdout.on('data', chunk => {
    runState.stdout = appendCappedOutput(runState.stdout, chunk);
  });
  child.stderr.on('data', chunk => {
    runState.stderr = appendCappedOutput(runState.stderr, chunk);
  });
  child.on('error', err => {
    if (activeWorkbenchProcess === runState) activeWorkbenchProcess = null;
    originalError('[Workbench Run] 子进程启动失败:', err.message);
  });
  child.on('exit', (code, signal) => {
    if (activeWorkbenchProcess === runState) activeWorkbenchProcess = null;
    if (code === 0) {
      originalLog(`[Workbench Run] ${mode} 工作流完成，pid=${runState.pid}`);
    } else {
      originalError(`[Workbench Run] ${mode} 工作流失败，pid=${runState.pid}, code=${code}, signal=${signal || ''}`);
      if (runState.stderr) originalError(runState.stderr.slice(-4000));
    }
  });

  res.json({ ok: true, data: { status: 'started', pid: child.pid, mode } });
});

function parsePositiveNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function withLegacyBatchFields(summary) {
  return {
    ...summary,
    requiresReview: Boolean(
      summary.mustReview ||
      summary.status === 'needs_review' ||
      Number((summary.counts || {}).reviewCandidates || 0) > 0
    ),
    reviewPreview: (summary.previews && summary.previews.distributionReview) || ''
  };
}

function addNumericCliOption(args, flag, value) {
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) {
    args.push(flag, String(num));
  }
}

function buildWorkbenchCliArgs(mode, keyword, options) {
  const args = ['bin/cli.js', 'flow', mode];
  if (mode === 'keyword') args.push(keyword);
  args.push('--json');

  if (mode === 'daily') {
    addNumericCliOption(args, '--mine', options.mine);
    addNumericCliOption(args, '--verify', options.verify);
    addNumericCliOption(args, '--generate', options.generate);
  }
  addNumericCliOption(args, '--export', options.export);
  addNumericCliOption(args, '--products-per-keyword', options.productsPerKeyword);
  addNumericCliOption(args, '--length', options.length);
  addNumericCliOption(args, '--port', options.port);
  addNumericCliOption(args, '--pages', options.pages);

  return args;
}

function appendCappedOutput(current, chunk) {
  const buffer = Buffer.concat([Buffer.from(current), Buffer.from(String(chunk))]);
  if (buffer.length <= WORKBENCH_OUTPUT_LIMIT_BYTES) return buffer.toString('utf8');
  return buffer.subarray(buffer.length - WORKBENCH_OUTPUT_LIMIT_BYTES).toString('utf8');
}

// 1.9 Unified pipeline facade. The React app should treat this as the durable flow API.
app.get('/api/pipeline/current', (req, res) => {
  try {
    const limit = parsePositiveNumber(req.query.limit, 20);
    const data = listPipelineRuns({ limit });
    res.json({
      ok: true,
      data: {
        ...data,
        currentRun: withPipelineRuntimeFields(data.latest)
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/pipeline/runs/:runId', (req, res) => {
  const runId = req.params.runId;
  if (!isValidWorkflowRunIdParam(runId)) {
    return res.status(400).json({ ok: false, error: '无效的运行 ID。' });
  }
  try {
    const summary = summarizePipelineRun({ runId });
    if (!summary) {
      return res.status(404).json({ ok: false, error: '未找到该流程运行记录' });
    }
    res.json({ ok: true, data: withPipelineRuntimeFields(summary) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/pipeline/start', async (req, res) => {
  if (activeWorkbenchProcess) {
    return res.status(409).json({
      ok: false,
      status: 'workflow_busy',
      error: '已有工作流正在运行，请等待完成后再启动。'
    });
  }

  try {
    const launch = resolveProductionWorkflowLaunch(req.body || {});
    const resolvedParams = await resolveManualShareParams(launch.mode, launch.params);
    const params = sanitizeWorkflowParams(launch.mode, resolvedParams);
    const runId = createRunId();
    const definition = resolveProductionWorkflowDefinition(req.body || {}, launch);
    writeWorkflowDefinition({ runId, definition });
    const promise = runPipelineRuntime({ runId, mode: launch.mode, params });
    const runState = { runId, mode: launch.mode, promise };
    activeWorkbenchProcess = runState;

    promise.then(result => {
      if (activeWorkbenchProcess === runState) activeWorkbenchProcess = null;
      originalLog(`[Pipeline Start] ${launch.mode} runtime 完成，runId=${result.runId}, status=${result.runtimeStatus || result.status}`);
    }).catch(err => {
      if (activeWorkbenchProcess === runState) activeWorkbenchProcess = null;
      originalError(`[Pipeline Start] ${launch.mode} runtime 失败，runId=${runId}:`, err.message);
    });

    res.json({
      ok: true,
      data: {
        status: 'started',
        runId,
        mode: launch.mode,
        runtime: readRuntimeState({ runId }),
        currentRun: withPipelineRuntimeFields(summarizePipelineRun({ runId }))
      }
    });
  } catch (err) {
    const status = /未知 workflow mode|未知 workflow template|工作流定义|工作流必须匹配|关键词不能为空|1688 商品链接|商品缺少关键词|商品重复/.test(err.message) ? 400 : 500;
    res.status(status).json({ ok: false, error: err.message });
  }
});

app.post('/api/pipeline/runs/:runId/candidates', async (req, res) => {
  const runId = req.params.runId;
  if (!isValidWorkflowRunIdParam(runId)) {
    return res.status(400).json({ ok: false, error: '无效的运行 ID。' });
  }
  try {
    const result = await appendRunCandidates({
      ...(req.body || {}),
      runId,
      candidates: Array.isArray(req.body?.candidates) ? req.body.candidates : []
    });
    res.json({
      ok: true,
      data: {
        result,
        currentRun: withPipelineRuntimeFields(summarizePipelineRun({ runId }))
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/pipeline/runs/:runId/pause', (req, res) => {
  const runId = req.params.runId;
  if (!isValidWorkflowRunIdParam(runId)) {
    return res.status(400).json({ ok: false, error: '无效的运行 ID。' });
  }
  try {
    const runtime = readRuntimeState({ runId });
    if (!runtime) return res.status(404).json({ ok: false, error: '未找到该流程运行记录' });
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
      mode: runtime.mode || (runtime.steps?.includes('keyword') ? 'keyword' : 'daily'),
      params: runtime.params || {},
      preserveRuntime: true,
      resumeFromStep: runtime.activeStep,
      steps: runtime.steps
    });
    const runState = { runId, mode: 'resume', promise };
    activeWorkbenchProcess = runState;
    promise.then(result => {
      originalLog(`[Pipeline Resume] runtime 完成，runId=${result.runId}, status=${result.runtimeStatus || result.status}`);
    }).catch(err => {
      originalError(`[Pipeline Resume] runtime 失败，runId=${runId}:`, err.message);
    }).finally(() => {
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
  if (!['mine', 'review', 'keywordReview', 'verify', 'select', 'generate', 'export'].includes(step)) {
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
      mode: runtime.mode || (runtime.steps?.includes('keyword') ? 'keyword' : 'daily'),
      params: runtime.params || {},
      preserveRuntime: true,
      retryStep: step,
      steps: runtime.steps
    });
    const runState = { runId, mode: 'retry-step', promise };
    activeWorkbenchProcess = runState;
    promise.then(result => {
      originalLog(`[Pipeline Retry] runtime 完成，runId=${result.runId}, status=${result.runtimeStatus || result.status}`);
    }).catch(err => {
      originalError(`[Pipeline Retry] runtime 失败，runId=${runId}, step=${step}:`, err.message);
    }).finally(() => {
      if (activeWorkbenchProcess === runState) activeWorkbenchProcess = null;
    });
    res.json({ ok: true, data: pipelineRunResponse(runId, { control }) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/pipeline/runs/:runId/:step', async (req, res) => {
  const runId = req.params.runId;
  const step = String(req.params.step || '');
  if (!isValidWorkflowRunIdParam(runId)) {
    return res.status(400).json({ ok: false, error: '无效的运行 ID。' });
  }
  if (!['mine', 'review', 'keywordReview', 'verify', 'select', 'generate', 'export'].includes(step)) {
    return res.status(400).json({ ok: false, error: '不支持的流程步骤。' });
  }
  try {
    const result = await runPipelineStep(step, runId, req.body || {});
    res.json({
      ok: true,
      data: {
        result,
        currentRun: withPipelineRuntimeFields(summarizePipelineRun({ runId }))
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

function getPipelineRuntimeRunner() {
  return app.locals.pipelineRuntimeRunner || runPipelineRuntime;
}

function getSycmChromeLauncher() {
  return app.locals.sycmChromeLauncher || autoLaunchChrome;
}

function getSycmChromePageOpener() {
  return app.locals.sycmChromePageOpener || openChromeUrl;
}

function getSycmChromeAvailabilityChecker() {
  return app.locals.sycmChromeAvailabilityChecker || isChromeDevToolsAvailable;
}

function getSycmAccessStatus() {
  return (app.locals.sycmAccessStatusReader || getPlatformAccessStatus)('sycm');
}

function clearSycmAccessBlocker() {
  return (app.locals.sycmAccessBlockerClearer || clearPlatformAccessBlocker)('sycm');
}

function isRecoverableChromeBlocker(access = {}) {
  const reason = String(access.breaker?.reason || access.manualAction?.message || '');
  return /no chrome tab found|127\.0\.0\.1:9222|econnrefused|chrome[^\n]*(?:tab|debug)|cdp|devtools/i.test(reason);
}

async function recoverSycmAccessAfterChrome(port, { assumeReady = false } = {}) {
  const access = getSycmAccessStatus();
  if (!access.breaker?.open || !isRecoverableChromeBlocker(access)) {
    return { cleared: false, chromeReady: true, access };
  }
  const chromeReady = assumeReady || await getSycmChromeAvailabilityChecker()(port);
  if (!chromeReady) return { cleared: false, chromeReady: false, access };
  return { cleared: true, chromeReady: true, access: clearSycmAccessBlocker() };
}

function pipelineRunResponse(runId, extra = {}) {
  return {
    ...extra,
    runId,
    runtime: readRuntimeState({ runId }),
    currentRun: withPipelineRuntimeFields(summarizePipelineRun({ runId }))
  };
}

function withPipelineRuntimeFields(summary) {
  if (!summary || !summary.runId) return summary || null;
  const runtime = readRuntimeState({ runId: summary.runId });
  const workflow = getWorkflowRun({ runId: summary.runId }) || runtimeOnlyWorkflowSnapshot(summary.runId);
  return {
    ...summary,
    runtime,
    workflow
  };
}

async function runPipelineStep(step, runId, body = {}) {
  const options = {
    ...body,
    runId,
    limit: parsePositiveNumber(body.limit || body[step], step === 'mine' ? 50 : 20)
  };
  if (step === 'mine') {
    options.excludeSeen = body.excludeSeen !== false;
    options.recordSeen = body.recordSeen !== false;
  }
  if (step === 'mine') return flowMine(options);
  if (step === 'review' || step === 'keywordReview') return flowReviewCandidates(options);
  if (step === 'verify') return flowVerify(options);
  if (step === 'select') return flowSelectProducts(options);
  if (step === 'generate') return flowGenerate(options);
  if (step === 'export') return flowExport(options);
  throw new Error('不支持的流程步骤。');
}

// 2. GET /api/seeds/audit - Read-only seed migration and health preview.
app.get('/api/seeds/audit', (req, res) => {
  try {
    const seeds = listSeeds({ dataDir: DEFAULT_DATA_DIR, includePaused: true });
    res.json({ ok: true, data: auditSeedPool(seeds) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 2.1 POST /api/seeds/suggestions/preview - Evaluate discoveries without writing the seed file.
app.post('/api/seeds/suggestions/preview', (req, res) => {
  try {
    const seeds = listSeeds({ dataDir: DEFAULT_DATA_DIR, includePaused: true });
    const result = prepareSeedSuggestions(req.body?.candidates, {
      existingSeeds: seeds,
      maxSuggestions: Number(req.body?.maxSuggestions || 5),
      minQualityScore: Number(req.body?.minQualityScore || 45)
    });
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// 2.2 POST /api/seeds/replenishment/preview - Balance candidates across discovery sources.
app.post('/api/seeds/replenishment/preview', (req, res) => {
  try {
    const seeds = listSeeds({ dataDir: DEFAULT_DATA_DIR, includePaused: true });
    const result = buildSeedReplenishmentPlan(req.body?.sources, {
      existingSeeds: seeds,
      sourceQuotas: req.body?.sourceQuotas,
      maxSuggestions: Number(req.body?.maxSuggestions || 8),
      minQualityScore: Number(req.body?.minQualityScore || 45)
    });
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// 2.3 GET /api/seeds - Get enriched, sorted seed list (including paused)
app.get('/api/seeds', (req, res) => {
  try {
    const seeds = listSeeds({ dataDir: DEFAULT_DATA_DIR, includePaused: true });
    res.json({ ok: true, data: auditSeedPool(seeds).profiles });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 3. POST /api/seeds - Add or update a seed
app.post('/api/seeds', (req, res) => {
  const { keyword, category, priority, type, status } = req.body;
  try {
    const seed = addSeed(keyword, {
      category,
      priority: Number(priority),
      type,
      status,
      source: 'manual',
      dataDir: DEFAULT_DATA_DIR
    });
    res.json({ ok: true, data: seed });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// 4. POST /api/seeds/:keyword/toggle - Pause/resume a seed
app.post('/api/seeds/:keyword/toggle', (req, res) => {
  const keywordToToggle = req.params.keyword;
  try {
    const seeds = loadSeeds(DEFAULT_DATA_DIR);
    const seed = seeds.find(s => s.keyword === keywordToToggle);
    if (!seed) {
      return res.status(404).json({ ok: false, error: '种子词不存在' });
    }
    seed.status = seed.status === 'paused' ? 'active' : 'paused';
    saveSeeds(seeds, DEFAULT_DATA_DIR);
    res.json({ ok: true, data: seed });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 4.5 POST /api/seeds/:keyword/status - Move a seed through its lifecycle.
app.post('/api/seeds/:keyword/status', (req, res) => {
  const keyword = req.params.keyword;
  const status = String(req.body?.status || '').trim().toLowerCase();
  const allowedStatuses = new Set(['active', 'observing', 'explore', 'cooling', 'paused', 'disabled']);
  if (!allowedStatuses.has(status)) {
    return res.status(400).json({ ok: false, error: '不支持的种子状态。' });
  }
  try {
    const seeds = loadSeeds(DEFAULT_DATA_DIR);
    const seed = seeds.find(item => item.keyword === keyword);
    if (!seed) return res.status(404).json({ ok: false, error: '种子词不存在' });
    seed.status = status;
    seed.statusReason = String(req.body?.reason || '').trim();
    seed.statusUpdatedAt = new Date().toISOString();
    saveSeeds(seeds, DEFAULT_DATA_DIR);
    const { recordSeedEvent } = require('../skills/keyword-mining');
    recordSeedEvent({ type: 'status', keyword, status, reason: seed.statusReason, source: 'manual' }, DEFAULT_DATA_DIR);
    res.json({ ok: true, data: seed });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 5. DELETE /api/seeds/:keyword - Delete a seed
app.delete('/api/seeds/:keyword', (req, res) => {
  const keywordToDelete = req.params.keyword;
  try {
    const seeds = loadSeeds(DEFAULT_DATA_DIR);
    const index = seeds.findIndex(s => s.keyword === keywordToDelete);
    if (index === -1) {
      return res.status(404).json({ ok: false, error: '种子词不存在' });
    }
    seeds.splice(index, 1);
    saveSeeds(seeds, DEFAULT_DATA_DIR);
    res.json({ ok: true, message: '种子已删除' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 6. GET /api/mine/run - Run keyword mining with live logs via SSE
app.get('/api/mine/run', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const options = {
    count: parseInt(req.query.count, 10) || 50,
    source: req.query.source || 'local',
    sycmPrecheck: req.query.sycmPrecheck === 'true',
    autoSeedHighTier: req.query.autoSeedHighTier === 'true',
    minSearchPopularity: parseInt(req.query.minSearchPopularity, 10) || 50,
    dataDir: DEFAULT_DATA_DIR,
    persist: true
  };

  let isClosed = false;
  req.on('close', () => {
    isClosed = true;
    originalLog(`🔌 客户端连接已关闭，挖掘任务的响应通道已终止。`);
  });

  logStorage.run(res, async () => {
    try {
      console.log(`🚀 开始挖掘关键词任务，参数:`, JSON.stringify(options));
      const result = await mineKeywords(options);
      if (!isClosed) {
        res.write(`data: ${JSON.stringify({ type: 'result', data: result })}\n\n`);
      }
    } catch (err) {
      if (!isClosed) {
        console.error(`❌ 挖掘任务发生异常:`, err.message);
        res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      }
    } finally {
      res.end();
    }
  });
});

// 7. POST /api/title/generate - Generate product titles & advice
app.post('/api/title/generate', async (req, res) => {
  const { keyword, maxLength, useImageSearch, peerTitles } = req.body;
  if (!keyword) {
    return res.status(400).json({ ok: false, error: '关键词不能为空' });
  }

  try {
    // 调用 generateTitlePipeline，注入 1688 商品搜索适配器，解决货源空结果的 Bug (P1)
    const result = await generateTitlePipeline(keyword, {
      maxLength: parseInt(maxLength, 10) || 60,
      useImageSearch: !!useImageSearch,
      peerTitles: Array.isArray(peerTitles) ? peerTitles : null,
      searchProducts: ({ coreWord, blueOceanWord, modifiers, semanticGroups }) =>
        searchAll(coreWord, blueOceanWord, modifiers, semanticGroups)
    });
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 8. POST /api/config/clean - Clear verify cache, seen or rejected historical lists
app.post('/api/config/clean', (req, res) => {
  const { type } = req.body; // 'cache' | 'seen' | 'rejected'
  const files = {
    cache: 'verify-cache.jsonl',
    seen: 'seen-candidates.jsonl',
    rejected: 'rejected-candidates.jsonl'
  };

  const filename = files[type];
  if (!filename) {
    return res.status(400).json({ ok: false, error: '不支持清除该类型文件' });
  }

  try {
    const file = path.join(DEFAULT_DATA_DIR, filename);
    if (fs.existsSync(file)) {
      fs.writeFileSync(file, '', 'utf8');
    }
    res.json({ ok: true, message: `${type} 缓存已清除` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==================== Core Root Miner APIs ====================
const { searchTaobaoTitles } = require('../skills/title-gen/src/search-taobao');
const { extractNouns } = require('../core/word-segmenter');
const { precheckCandidates } = require('../skills/keyword-mining/src/sycm-precheck');
const { fetchOpportunities } = require('../skills/alibaba1688');
const { extractSycmData } = require('../skills/sycm-research');

// 9. POST /api/miner/peer - Extract competitor word roots & verify with SYCM
app.post('/api/miner/peer', async (req, res) => {
  const { keyword } = req.body;
  if (!keyword) {
    return res.status(400).json({ ok: false, error: '关键词/链接不能为空' });
  }

  try {
    console.log(`🔍 正在获取淘宝同行 "${keyword}" 的标题...`);
    let titles = await searchTaobaoTitles(keyword, { maxResults: 15 });

    if (!titles.length) {
      return res.json({
        ok: true,
        data: [],
        warning: '未获取到淘宝同行标题，未使用模拟数据。请确认淘宝工具可用，或换一个关键词重试。'
      });
    }

    // Segment titles and extract nouns
    const nounCandidates = extractNouns(titles).slice(0, 15);
    if (!nounCandidates.length) {
      return res.json({ ok: true, data: [] });
    }

    console.log(`✓ 提取出候选词根:`, nounCandidates.map(c => c.word).join(', '));
    console.log(`🔌 正在对提取的候选词根进行生意参谋热度校验...`);

    // Verify with SYCM (popularity > 10)
    let pcResult;
    try {
      pcResult = await precheckCandidates(nounCandidates.map(c => ({ keyword: c.word })), { minSearchPopularity: 10 });
    } catch (sycmErr) {
      return res.status(502).json({
        ok: false,
        error: `生意参谋验证失败，未输出未验真词根: ${sycmErr.message}`
      });
    }

    const verified = pcResult.passed.map(p => {
      const match = nounCandidates.find(c => c.word === p.keyword);
      return {
        word: p.keyword,
        count: match ? match.count : 1,
        searchPopularity: p.searchPopularity
      };
    }).sort((a, b) => b.searchPopularity - a.searchPopularity);

    res.json({ ok: true, data: verified });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 10. POST /api/miner/opportunities - Extract 1688 opportunities & verify with SYCM
app.post('/api/miner/opportunities', async (req, res) => {
  try {
    console.log(`🔍 正在抓取 1688 爆款商机商品...`);
    const bizData = await fetchOpportunities();
    const products = bizData?.opportunityOffers || [];
    const titles = products.map(p => p.title || p.subject || '').filter(Boolean);

    if (!titles.length) {
      return res.json({ ok: true, data: [] });
    }

    // Segment and extract nouns
    const nounCandidates = extractNouns(titles).slice(0, 15);
    if (!nounCandidates.length) {
      return res.json({ ok: true, data: [] });
    }

    console.log(`🔌 正在对 1688 商机词根进行生意参谋热度校验...`);
    let pcResult;
    try {
      pcResult = await precheckCandidates(nounCandidates.map(c => ({ keyword: c.word })), { minSearchPopularity: 10 });
    } catch (sycmErr) {
      return res.status(502).json({
        ok: false,
        error: `生意参谋验证失败，未输出未验真商机词根: ${sycmErr.message}`
      });
    }

    const verified = pcResult.passed.map(p => {
      const match = nounCandidates.find(c => c.word === p.keyword);
      return {
        word: p.keyword,
        count: match ? match.count : 1,
        searchPopularity: p.searchPopularity
      };
    }).sort((a, b) => b.searchPopularity - a.searchPopularity);

    res.json({ ok: true, data: verified });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 11. POST /api/miner/sycm-market - Directly grab related words from SYCM
app.post('/api/miner/sycm-market', async (req, res) => {
  const { keyword } = req.body;
  if (!keyword) {
    return res.status(400).json({ ok: false, error: '核心词根不能为空' });
  }

  try {
    console.log(`🔍 正在直接从生意参谋抓取 "${keyword}" 的关联词榜单...`);
    const sycmRes = await extractSycmData(keyword, { mode: 'hot', maxPages: 1, port: 9222 });
    const items = sycmRes.data || [];

    const data = items.map(item => ({
      word: item.keyword,
      searchPopularity: parseSearchPop(item.searchPopularity),
      demandSupplyRatio: parsePercentOrNumber(item.demandSupplyRatio)
    })).sort((a, b) => b.searchPopularity - a.searchPopularity);

    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

function parseSearchPop(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const m = String(val).replace(/,/g, '').match(/(\d[\d]*)/);
  return m ? parseInt(m[1], 10) : 0;
}

function parsePercentOrNumber(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const str = String(val).trim();
  if (str.endsWith('%')) {
    const num = parseFloat(str.slice(0, -1));
    return Number.isFinite(num) ? num / 100 : 0;
  }
  const num = parseFloat(str);
  return Number.isFinite(num) ? num : 0;
}

// ==================== Workflow APIs ====================

// 1. GET /api/workflows/templates - 获取工作流模板列表
app.get('/api/workflows/templates', (req, res) => {
  res.json({ ok: true, data: listProductionWorkflowTemplates() });
});

// 1.5 POST /api/distribution/check - 检查人工复核后的铺货清单，不提交
app.post('/api/distribution/check', async (req, res) => {
  try {
    const input = String(req.body?.input || '').trim();
    if (!input) {
      return res.status(400).json({ ok: false, error: '铺货清单为空，请先保留或加入至少 1 个商品。' });
    }
    const { checkDistributionReadiness } = require('../skills/1688-distribution');
    const result = await checkDistributionReadiness({
      input,
      batchSize: parsePositiveNumber(req.body?.batchSize, 20),
      port: parsePositiveNumber(req.body?.port, process.env.BROWSER_CDP_PORT || process.env.CHROME_DEBUG_PORT || 9222),
      skipBrowser: req.body?.skipBrowser === true
    });
    return res.json({ ok: true, data: result });
  } catch (err) {
    const status = err && err.code === 'INVALID_ITEM' ? 400 : 500;
    return res.status(status).json({ ok: false, error: err.message });
  }
});

// 1.6 POST /api/distribution/submit - 经用户确认后启动后台自动铺货
app.post('/api/distribution/submit', async (req, res) => {
  try {
    if (req.body?.confirm !== true) {
      return res.status(400).json({ ok: false, error: '自动铺货需要用户明确确认。' });
    }
    const input = String(req.body?.input || '').trim();
    const items = parseItems(input);
    if (items.length === 0) {
      return res.status(400).json({ ok: false, error: '铺货清单为空。' });
    }
    const runningJob = [...activeDistributionJobs.values()].find(job => ['checking', 'submitting', 'paused'].includes(job.status));
    if (runningJob) {
      return res.status(409).json({ ok: false, error: `已有铺货任务正在处理：${runningJob.jobId}` });
    }

    const readiness = await checkDistributionReadiness({
      input,
      batchSize: parsePositiveNumber(req.body?.batchSize, 20),
      port: parsePositiveNumber(req.body?.port, process.env.BROWSER_CDP_PORT || process.env.CHROME_DEBUG_PORT || 9222)
    });
    if (!readiness.canSubmit) {
      return res.status(409).json({ ok: false, error: '铺货环境检查未通过。', data: readiness });
    }

    const jobId = `${req.body?.runId || createRunId()}-distribution`;
    const job = writeDistributionJob({
      jobId,
      workflowRunId: req.body?.runId || '',
      status: 'submitting',
      requestedAction: null,
      total: items.length,
      completed: 0,
      failed: 0,
      skipped: 0,
      batchSize: parsePositiveNumber(req.body?.batchSize, 20),
      progress: { batchIndex: 0, batchTotal: Math.ceil(items.length / parsePositiveNumber(req.body?.batchSize, 20)), phase: 'starting' },
      items: items.map(item => ({ offerId: item.offerId, url: item.url, title: item.title, category: item.category })),
      results: [],
      startedAt: new Date().toISOString()
    });
    activeDistributionJobs.set(jobId, job);

    distributeProducts({
      input,
      batchSize: job.batchSize,
      port: parsePositiveNumber(req.body?.port, process.env.BROWSER_CDP_PORT || process.env.CHROME_DEBUG_PORT || 9222),
      onProgress: async (event) => {
        const results = event.results || [];
        updateDistributionJob(jobId, {
          status: event.status === 'pause' ? 'paused' : event.status === 'cancel' ? 'cancelled' : 'submitting',
          progress: { batchIndex: event.batchIndex || 0, batchTotal: event.batchTotal || job.progress.batchTotal, phase: event.phase || '' },
          results,
          completed: results.filter(row => row.status === 'confirmed' || row.ok === true).reduce((sum, row) => sum + Number(row.count || 0), 0),
          failed: results.filter(row => row.status && row.status !== 'confirmed' && !row.skipped).reduce((sum, row) => sum + Number(row.count || 0), 0),
          skipped: results.filter(row => row.skipped).reduce((sum, row) => sum + Number(row.count || 0), 0)
        });
      },
      shouldStop: async () => {
        const current = activeDistributionJobs.get(jobId) || readDistributionJob(jobId);
        return current?.requestedAction || null;
      }
    }).then(result => {
      const finalStatus = result.stoppedStatus === 'pause'
        ? 'paused'
        : result.stoppedStatus === 'cancel'
          ? 'cancelled'
          : result.ok
            ? 'completed'
            : 'completed_with_issues';
      if (finalStatus === 'completed' && job.workflowRunId) {
        try {
          syncCompletedDistributionWorkflow({ ...job, status: finalStatus, result });
        } catch (workflowError) {
          originalError(`[Distribution Complete] 工作流状态回写失败，runId=${job.workflowRunId}:`, workflowError.message);
        }
      }
      updateDistributionJob(jobId, {
        status: finalStatus,
        result,
        results: result.batches || [],
        progress: { batchIndex: result.batches?.length || 0, batchTotal: job.progress.batchTotal, phase: finalStatus },
        requestedAction: null
      });
      activeDistributionJobs.delete(jobId);
    }).catch(error => {
      updateDistributionJob(jobId, { status: 'failed', error: error.message, requestedAction: null });
      activeDistributionJobs.delete(jobId);
    });

    return res.json({ ok: true, data: { jobId, status: 'submitting', total: items.length } });
  } catch (err) {
    const status = err && err.code === 'INVALID_ITEM' ? 400 : 500;
    return res.status(status).json({ ok: false, error: err.message });
  }
});

// 1.7 POST /api/distribution/manual-complete - 用户在外部手动铺货后确认完成
app.post('/api/distribution/manual-complete', (req, res) => {
  try {
    if (req.body?.confirm !== true) {
      return res.status(400).json({ ok: false, error: '人工铺货完成需要用户明确确认。' });
    }
    const workflowRunId = String(req.body?.runId || '').trim();
    if (!workflowRunId) {
      return res.status(400).json({ ok: false, error: '缺少工作流运行 ID。' });
    }
    const input = String(req.body?.input || '').trim();
    const items = parseItems(input);
    if (items.length === 0) {
      return res.status(400).json({ ok: false, error: '人工铺货清单为空。' });
    }
    const incompleteItem = items.find(item => !item.url || !item.title);
    if (incompleteItem) {
      return res.status(400).json({ ok: false, error: '人工铺货清单必须包含链接和标题；类目可在人工铺货时补充。' });
    }

    const currentSummary = summarizePipelineRun({ runId: workflowRunId });
    if (!currentSummary?.runId) {
      return res.status(404).json({ ok: false, error: '未找到对应的工作流运行。' });
    }
    const allowedStatuses = new Set(['ready_to_distribute', 'needs_review', 'awaiting_user_confirmation', 'workflow_complete']);
    if (!allowedStatuses.has(currentSummary.status)) {
      return res.status(409).json({ ok: false, error: `当前流程状态为 ${currentSummary.status || '未知'}，还不能确认人工铺货完成。` });
    }

    const jobId = `${workflowRunId}-distribution`;
    const existingJob = activeDistributionJobs.get(jobId) || readDistributionJob(jobId);
    if (existingJob?.status === 'completed' && existingJob?.mode === 'manual') {
      return res.json({ ok: true, data: existingJob });
    }
    if (existingJob?.status === 'completed') {
      return res.status(409).json({ ok: false, error: '该流水线已经通过自动铺货完成，不能改记为人工铺货。' });
    }
    if (currentSummary.status === 'workflow_complete') {
      return res.status(409).json({ ok: false, error: '该流水线已经完成，无需再次确认人工铺货。' });
    }
    if (existingJob && ['checking', 'checking_confirmation', 'submitting', 'paused'].includes(existingJob.status)) {
      return res.status(409).json({ ok: false, error: '自动铺货任务仍在处理中，请先暂停或取消后再确认人工铺货。' });
    }

    const completedAt = new Date().toISOString();
    const job = writeDistributionJob({
      jobId,
      workflowRunId,
      mode: 'manual',
      status: 'completed',
      requestedAction: null,
      total: items.length,
      completed: items.length,
      failed: 0,
      skipped: 0,
      items: items.map(item => ({ offerId: item.offerId, url: item.url, title: item.title, category: item.category })),
      results: [],
      result: {
        ok: true,
        status: 'manually_confirmed',
        method: 'manual',
        total: items.length,
        confirmed: items.length
      },
      progress: { batchIndex: 1, batchTotal: 1, phase: 'manual_completed' },
      startedAt: existingJob?.startedAt || completedAt,
      completedAt,
      previousStatus: existingJob?.status || null
    });
    activeDistributionJobs.delete(jobId);
    syncCompletedDistributionWorkflow(job);
    return res.json({ ok: true, data: job });
  } catch (err) {
    const status = err && err.code === 'INVALID_ITEM' ? 400 : /未找到|不存在/.test(String(err?.message || '')) ? 404 : 500;
    return res.status(status).json({ ok: false, error: err.message });
  }
});

app.get('/api/distribution/runs/:jobId', (req, res) => {
  try {
    let job = activeDistributionJobs.get(req.params.jobId) || readDistributionJob(req.params.jobId);
    if (!job) return res.status(404).json({ ok: false, error: '未找到铺货任务。' });
    if (job.status === 'completed' && job.workflowRunId) {
      try {
        syncCompletedDistributionWorkflow(job);
        job = readDistributionJob(req.params.jobId) || job;
      } catch (workflowError) {
        originalError(`[Distribution Complete] 历史任务状态回写失败，runId=${job.workflowRunId}:`, workflowError.message);
      }
    }
    return res.json({ ok: true, data: job });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/distribution/runs/:jobId/:action', async (req, res) => {
  const action = String(req.params.action || '');
  if (!['pause', 'cancel', 'recheck'].includes(action)) {
    return res.status(400).json({ ok: false, error: '不支持的铺货控制操作。' });
  }
  try {
    const job = activeDistributionJobs.get(req.params.jobId) || readDistributionJob(req.params.jobId);
    if (!job) return res.status(404).json({ ok: false, error: '未找到铺货任务。' });
    if (action === 'recheck') {
      if (!['completed_with_issues', 'checking_confirmation'].includes(job.status)) {
        return res.status(409).json({ ok: false, error: `当前任务状态为${job.status}，无需重新核对。` });
      }
      const next = await recheckDistributionJob(job);
      return res.json({ ok: true, data: next });
    }
    if (!['submitting', 'paused'].includes(job.status)) {
      return res.status(409).json({ ok: false, error: `当前任务状态为${job.status}，不能执行该操作。` });
    }
    const next = updateDistributionJob(req.params.jobId, {
      requestedAction: action,
      controlMessage: action === 'pause' ? '将在当前批次完成后暂停' : '将在当前批次完成后取消'
    });
    return res.json({ ok: true, data: next });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

// 2. GET /api/workflows/runs - 获取历史工作流运行记录列表
app.get('/api/workflows/runs', (req, res) => {
  try {
    const limit = parsePositiveNumber(req.query.limit, 20);
    res.json({ ok: true, data: listWorkflowRuns({ limit }) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 2.2 DELETE /api/workflows/runs/:runId - 删除历史运行记录及其产物
app.delete('/api/workflows/runs/:runId', (req, res) => {
  const runId = req.params.runId;
  try {
    if (req.body?.confirm !== true) {
      return res.status(400).json({ ok: false, error: '删除运行历史需要确认。' });
    }
    if (activeWorkbenchProcess && activeWorkbenchProcess.runId === runId) {
      return res.status(409).json({ ok: false, error: '当前运行仍在执行中，不能删除。' });
    }
    const runtime = readRuntimeState({ runId });
    const runtimeStatus = String(runtime?.status || '').toLowerCase();
    if (['running', 'retrying', 'resuming', 'cancelling'].includes(runtimeStatus)) {
      return res.status(409).json({ ok: false, error: '当前运行仍在执行中，不能删除。' });
    }

    const result = deleteWorkflowRun({ runId });
    if (!result.ok) {
      return res.status(404).json({ ok: false, error: '未找到该运行历史。' });
    }
    return res.json({ ok: true, data: result });
  } catch (err) {
    const status = /Invalid workflow run id|Invalid runtime run id/.test(err.message) ? 400 : 500;
    return res.status(status).json({ ok: false, error: err.message });
  }
});

app.post('/api/review-sheets/upload', express.raw({
  type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'],
  limit: '12mb'
}), async (req, res) => {
  try {
    const encodedName = String(req.get('x-file-name') || '刷单表.xlsx');
    let fileName = encodedName;
    try { fileName = decodeURIComponent(encodedName); } catch (_) { /* Keep the supplied name. */ }
    const result = await saveReviewSourceUpload({ buffer: req.body, fileName });
    const { sourceFile: _sourceFile, ...publicResult } = result;
    return res.json({ ok: true, data: publicResult });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/workflows/runs/:runId/review-confirm', (req, res) => {
  if (activeWorkbenchProcess) {
    return res.status(409).json({ ok: false, error: '已有工作流正在运行，请等待完成后再继续。' });
  }
  try {
    const runId = req.params.runId;
    const runtime = readRuntimeState({ runId });
    if (!runtime || runtime.mode !== 'review-sheet') {
      return res.status(409).json({ ok: false, error: '当前运行不是评价表流水线。' });
    }
    const confirmed = confirmReviewDrafts({ runId, reviews: req.body?.reviews || [] });
    const promise = runPipelineRuntime({
      runId,
      mode: 'review-sheet',
      params: runtime.params,
      preserveRuntime: true,
      resumeFromStep: 'generateSheet'
    });
    const runState = { runId, mode: 'review-sheet', promise };
    activeWorkbenchProcess = runState;
    promise.then(result => {
      if (activeWorkbenchProcess === runState) activeWorkbenchProcess = null;
      originalLog(`[Review Sheet] runtime 完成，runId=${result.runId}, status=${result.runtimeStatus || result.status}`);
    }).catch(err => {
      if (activeWorkbenchProcess === runState) activeWorkbenchProcess = null;
      originalError(`[Review Sheet] runtime 失败，runId=${runId}:`, err.message);
    });
    return res.json({ ok: true, data: { status: 'resuming', count: confirmed.count, runId } });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/api/workflows/runs/:runId/order-sheet/draft', (req, res) => {
  try {
    const runId = req.params.runId;
    const runtime = readRuntimeState({ runId });
    if (!runtime || runtime.mode !== 'order-sheet') {
      return res.status(409).json({ ok: false, error: '当前运行不是刷单表流水线。' });
    }
    const draft = getOrderSheetDraft({ runId });
    return res.json({ ok: true, data: draft });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});
app.get('/api/workflows/runs/:runId/order-sheet-draft', (req, res) => {
  try {
    const runId = req.params.runId;
    const runtime = readRuntimeState({ runId });
    if (!runtime || runtime.mode !== 'order-sheet') {
      return res.status(409).json({ ok: false, error: '当前运行不是刷单表流水线。' });
    }
    const draft = getOrderSheetDraft({ runId });
    return res.json({ ok: true, data: draft });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/workflows/runs/:runId/order-sheet/draft', (req, res) => {
  try {
    const runId = req.params.runId;
    const runtime = readRuntimeState({ runId });
    if (!runtime || runtime.mode !== 'order-sheet') {
      return res.status(409).json({ ok: false, error: '当前运行不是刷单表流水线。' });
    }
    const saved = saveOrderSheetDraft({
      runId,
      items: Array.isArray(req.body?.items) ? req.body.items : undefined,
      groups: Array.isArray(req.body?.groups) ? req.body.groups : undefined,
      unassignedItems: Array.isArray(req.body?.unassignedItems) ? req.body.unassignedItems : undefined,
      dragCount: req.body?.dragCount,
      expectedRevision: req.body?.revision
    });
    return res.json({ ok: true, data: saved });
  } catch (err) {
    return res.status(err.code === 'ORDER_SHEET_DRAFT_CONFLICT' ? 409 : 400).json({ ok: false, error: err.message });
  }
});
app.post('/api/workflows/runs/:runId/order-sheet-draft', (req, res) => {
  try {
    const runId = req.params.runId;
    const runtime = readRuntimeState({ runId });
    if (!runtime || runtime.mode !== 'order-sheet') {
      return res.status(409).json({ ok: false, error: '当前运行不是刷单表流水线。' });
    }
    const saved = saveOrderSheetDraft({
      runId,
      items: Array.isArray(req.body?.items) ? req.body.items : undefined,
      groups: Array.isArray(req.body?.groups) ? req.body.groups : undefined,
      unassignedItems: Array.isArray(req.body?.unassignedItems) ? req.body.unassignedItems : undefined,
      dragCount: req.body?.dragCount,
      expectedRevision: req.body?.revision
    });
    return res.json({ ok: true, data: saved });
  } catch (err) {
    return res.status(err.code === 'ORDER_SHEET_DRAFT_CONFLICT' ? 409 : 400).json({ ok: false, error: err.message });
  }
});

function handleConfirmOrderSheet(req, res) {
  if (activeWorkbenchProcess) {
    return res.status(409).json({ ok: false, error: '已有工作流正在运行，请等待完成后再继续。' });
  }
  try {
    const runId = req.params.runId;
    const runtime = readRuntimeState({ runId });
    if (!runtime || runtime.mode !== 'order-sheet') {
      return res.status(409).json({ ok: false, error: '当前运行不是刷单表流水线。' });
    }
    if (runtime.status === 'running' || runtime.status === 'resuming') {
      return res.status(409).json({ ok: false, error: '流水线已在运行中，请勿重复提交。' });
    }

    const items = Array.isArray(req.body?.items) ? req.body.items : undefined;
    const groups = Array.isArray(req.body?.groups) ? req.body.groups : undefined;

    if (items) {
      const updated = updateOrderSheetManualProducts({ runId, items });
      if (updated.missingCount > 0) {
        updateRuntimeState({
          runId,
          patch: {
            status: 'blocked',
            activeStep: 'collectRank',
            blocker: 'order_sheet_product_details_required',
            actionHint: `仍有 ${updated.missingCount} 个指定商品缺少标题，请补充后继续。`,
            manualAction: { platform: 'taobao', status: 'product_details_required', missingCount: updated.missingCount }
          }
        });
        return res.status(409).json({ ok: false, error: `仍有 ${updated.missingCount} 个商品缺少标题。`, data: updated });
      }
    }

    const confirmed = confirmOrderSheetProducts({
      runId,
      items,
      groups,
      unassignedItems: Array.isArray(req.body?.unassignedItems) ? req.body.unassignedItems : undefined,
      dragCount: req.body?.dragCount,
      expectedRevision: req.body?.revision
    });

    const params = {
      ...(runtime.params || {}),
      ...(confirmed.groups ? { groups: confirmed.groups } : {})
    };

    updateRuntimeState({
      runId,
      patch: {
        status: 'paused',
        activeStep: 'generateSheet',
        params,
        blocker: null,
        actionHint: null,
        platform: null,
        platformStatus: null,
        manualAction: null,
        progress: {
          collectRank: { status: 'completed', current: confirmed.count, total: confirmed.count, percent: 100, message: `已确认 ${confirmed.count} 个商品资料` },
          confirmProducts: { status: 'completed', current: confirmed.groupCount, total: confirmed.groupCount, percent: 100, message: `已确认 ${confirmed.groupCount} 个商品组` },
          generateSheet: { status: 'idle', current: 0, total: 1, percent: 0, message: '等待生成表格' }
        }
      }
    });

    const promise = getPipelineRuntimeRunner()({
      runId,
      mode: 'order-sheet',
      params,
      preserveRuntime: true,
      resumeFromStep: 'generateSheet',
      steps: runtime.steps
    });
    const runState = { runId, mode: 'order-sheet-confirm', promise };
    activeWorkbenchProcess = runState;
    promise.then(result => {
      originalLog(`[Order Sheet] runtime 完成，runId=${result.runId}, status=${result.runtimeStatus || result.status}`);
    }).catch(err => {
      originalError(`[Order Sheet] runtime 失败，runId=${runId}:`, err.message);
    }).finally(() => {
      if (activeWorkbenchProcess === runState) activeWorkbenchProcess = null;
    });
    return res.json({ ok: true, data: { status: 'resuming', count: confirmed.count, groupCount: confirmed.groupCount, runId } });
  } catch (err) {
    return res.status(err.code === 'ORDER_SHEET_DRAFT_CONFLICT' ? 409 : 400).json({ ok: false, error: err.message });
  }
}

app.post('/api/workflows/runs/:runId/order-sheet/confirm', handleConfirmOrderSheet);
app.post('/api/workflows/runs/:runId/order-sheet-confirm', handleConfirmOrderSheet);
app.post('/api/workflows/runs/:runId/order-sheet-products', handleConfirmOrderSheet);

// 2.5 POST /api/workflows/validate - 运行前校验工作流图
app.post('/api/workflows/validate', (req, res) => {
  try {
    const result = validateProductionWorkflow(req.body && req.body.workflow);
    res.status(result.ok ? 200 : 400).json({ ok: result.ok, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 2.6 POST /api/1688/resolve-share - 将手机分享口令或短链转换成标准商品链接
app.post('/api/1688/resolve-share', async (req, res) => {
  try {
    const input = String(req.body?.input || '').trim();
    if (!input) return res.status(400).json({ ok: false, error: '分享内容为空。' });
    if (input.length > 8192) return res.status(400).json({ ok: false, error: '单条分享内容过长。' });
    const result = await resolve1688ShareText(input);
    if (!result) return res.status(422).json({ ok: false, error: '没有从分享内容中识别到有效的 1688 商品。' });
    return res.json({ ok: true, data: result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: `解析 1688 分享内容失败：${err.message}` });
  }
});

// 3. POST /api/workflows/run - 启动一个新工作流
app.post('/api/workflows/run', async (req, res) => {
  if (activeWorkbenchProcess) {
    return res.status(409).json({
      ok: false,
      status: 'workflow_busy',
      error: '已有工作流正在运行，请等待完成后再启动。'
    });
  }

  try {
    const launch = resolveProductionWorkflowLaunch(req.body || {});
    const resolvedParams = await resolveManualShareParams(launch.mode, launch.params);
    const params = sanitizeWorkflowParams(launch.mode, resolvedParams);
    const runId = createRunId();
    const definition = resolveProductionWorkflowDefinition(req.body || {}, launch);
    writeWorkflowDefinition({ runId, definition });
    const promise = runPipelineRuntime({ runId, mode: launch.mode, params });
    const runState = {
      runId,
      mode: launch.mode,
      promise
    };
    activeWorkbenchProcess = runState;

    promise.then(result => {
      if (activeWorkbenchProcess === runState) activeWorkbenchProcess = null;
      originalLog(`[Workflow Run] ${launch.mode} runtime 完成，runId=${result.runId}, status=${result.runtimeStatus || result.status}`);
    }).catch(err => {
      if (activeWorkbenchProcess === runState) activeWorkbenchProcess = null;
      originalError(`[Workflow Run] ${launch.mode} runtime 失败，runId=${runId}:`, err.message);
    });

    res.json({
      ok: true,
      data: {
        status: 'started',
        runId,
        mode: launch.mode,
        monitor: 'workflow',
        message: `真实 workflow runtime 已启动，runId=${runId}。`
      }
    });
  } catch (err) {
    if (activeWorkbenchProcess && !activeWorkbenchProcess.pid && !activeWorkbenchProcess.promise) activeWorkbenchProcess = null;
    const status = /未知 workflow mode|未知 workflow template|工作流定义|工作流必须匹配|关键词不能为空|1688 商品链接|商品缺少关键词|商品重复/.test(err.message) ? 400 : 500;
    res.status(status).json({ ok: false, error: err.message });
  }
});

// 4. GET /api/workflows/runs/:runId/artifacts/:nodeId - 读取节点产物
app.get('/api/workflows/runs/:runId/artifacts/:nodeId', (req, res) => {
  try {
    const artifact = readWorkflowNodeArtifact({
      runId: req.params.runId,
      nodeId: req.params.nodeId,
      limit: parsePositiveNumber(req.query.limit, 50),
      maxChars: parsePositiveNumber(req.query.maxChars, 10000)
    });
    if (!artifact) {
      return res.status(404).json({ ok: false, error: '未找到该节点产物' });
    }
    res.json({ ok: true, data: artifact });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 4.1 GET /api/workflows/runs/:runId/artifacts/:nodeId/raw - 打开节点产物原文
app.post('/api/workflows/runs/:runId/keyword-review', (req, res) => {
  const runId = req.params.runId;
  if (!isValidWorkflowRunIdParam(runId)) {
    return res.status(400).json({ ok: false, error: '无效的运行 ID。' });
  }
  try {
    const result = flowReviewCandidates({
      runId,
      approvedKeywords: Array.isArray(req.body?.approvedKeywords) ? req.body.approvedKeywords : [],
      rejectedKeywords: Array.isArray(req.body?.rejectedKeywords) ? req.body.rejectedKeywords : [],
      manualKeywords: Array.isArray(req.body?.manualKeywords) ? req.body.manualKeywords : [],
      approveAll: req.body?.approveAll === true
    });
    const runtime = readRuntimeState({ runId });
    if (runtime && result.status === 'keywords_reviewed') {
      const nextStep = runtime.steps?.includes('verify') ? 'verify' : 'select';
      updateRuntimeState({
        runId,
        patch: {
          status: 'paused',
          activeStep: nextStep,
          blocker: null,
          actionHint: null,
          manualAction: null,
          progress: {
            keywordReview: {
              status: 'completed',
              current: result.approved.length,
              total: result.approved.length + result.rejected.length,
              percent: 100,
              message: `人工筛词完成，通过 ${result.approved.length} 个`
            },
            ...(runtime.steps?.includes('verify') ? { verify: {
              status: 'idle',
              current: 0,
              total: 0,
              percent: 0,
              message: '等待继续生意参谋校验'
            } } : { select: {
              status: 'idle',
              current: 0,
              total: 0,
              percent: 0,
              message: '等待继续加载货源'
            } })
          }
        }
      });
    }
    res.json({
      ok: true,
      data: {
        result,
        currentRun: withPipelineRuntimeFields(summarizePipelineRun({ runId }))
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/workflows/runs/:runId/product-review', (req, res) => {
  const runId = req.params.runId;
  if (!isValidWorkflowRunIdParam(runId)) {
    return res.status(400).json({ ok: false, error: '无效的运行 ID。' });
  }
  try {
    const result = flowReviewProducts({
      runId,
      approvedProductIds: Array.isArray(req.body?.approvedProductIds) ? req.body.approvedProductIds : [],
      manualProducts: Array.isArray(req.body?.manualProducts) ? req.body.manualProducts : [],
      approveAll: req.body?.approveAll === true
    });
    const runtime = readRuntimeState({ runId });
    if (runtime && result.status === 'products_selected') {
      updateRuntimeState({
        runId,
        patch: {
          status: 'paused',
          activeStep: 'generate',
          blocker: null,
          actionHint: null,
          progress: {
            select: { status: 'completed', current: result.selected.length, total: result.selected.length, percent: 100, message: `人工选品完成，保留 ${result.selected.length} 个商品` },
            generate: { status: 'idle', current: 0, total: 0, percent: 0, message: '等待继续生成标题' }
          }
        }
      });
    }
    return res.json({ ok: true, data: { result, currentRun: withPipelineRuntimeFields(summarizePipelineRun({ runId })) } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/workflows/runs/:runId/artifacts/:nodeId/raw', (req, res) => {
  try {
    const artifact = readWorkflowNodeArtifact({
      runId: req.params.runId,
      nodeId: req.params.nodeId,
      limit: 1,
      maxChars: 1
    });
    if (!artifact || !artifact.file || !fs.existsSync(artifact.file)) {
      return res.status(404).type('text/plain').send('未找到该节点产物');
    }
    if (artifact.type === 'xlsx') {
      return res.download(artifact.file, artifact.filename || path.basename(artifact.file));
    }
    res.type('text/plain; charset=utf-8').send(fs.readFileSync(artifact.file, 'utf8'));
  } catch (err) {
    res.status(500).type('text/plain').send(err.message);
  }
});

// 5. GET /api/workflows/runs/:runId - 获取工作流运行的最新状态与日志
app.get('/api/workflows/runs/:runId', (req, res) => {
  try {
    const runObj = getWorkflowRun({ runId: req.params.runId });
    if (!runObj) {
      return res.status(404).json({ ok: false, error: '未找到该运行记录' });
    }
    res.json({ ok: true, data: runObj });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 6. POST /api/workflows/runs/:runId/cancel - 请求 runtime 在安全边界取消
app.post('/api/workflows/runs/:runId/cancel', (req, res) => {
  const runId = req.params.runId;
  if (!isValidWorkflowRunIdParam(runId)) {
    return res.status(400).json({ ok: false, error: '无效的运行 ID。' });
  }
  try {
    const control = requestRuntimeCancel({
      runId,
      reason: req.body?.reason || 'user_cancelled'
    });
    res.json({ ok: true, data: { runId, status: 'cancel_requested', control } });
  } catch (err) {
    const status = /Invalid runtime run id/.test(err.message) ? 400 : 500;
    res.status(status).json({ ok: false, error: err.message });
  }
});

// 7. POST /api/workflows/runs/:runId/retry-node - 重试某个特定节点
app.post('/api/workflows/runs/:runId/retry-node', async (req, res) => {
  const runId = req.params.runId;
  try {
    const nodeId = String(req.body?.nodeId || '').trim();
    if (!nodeId) {
      return res.status(400).json({ ok: false, error: 'nodeId is required' });
    }
    const runtime = readRuntimeState({ runId });
    if (runtime) {
      if (!['mine', 'keywordReview', 'verify', 'select', 'generate', 'export', 'collectRank', 'generateSheet'].includes(nodeId)) {
        return res.status(400).json({ ok: false, error: '不支持的流程步骤。' });
      }
      const manualOrderSheetCollection = nodeId === 'collectRank'
        && runtime.mode === 'order-sheet'
        && runtime.params?.inputMode === 'manual';
      if (nodeId === 'verify' || nodeId === 'collectRank') {
        const port = parsePositiveNumber(runtime.params?.port || process.env.SYCM_DEBUG_PORT || 9222, 9222);
        if (manualOrderSheetCollection) {
          const chromeReady = await getSycmChromeAvailabilityChecker()(port);
          if (!chromeReady) {
            return res.status(409).json({
              ok: false,
              code: 'CHROME_REQUIRED',
              error: `Chrome 调试连接仍不可用（端口 ${port}）。请先点击节点上的“启动 Chrome”，登录淘宝后再重试获取商品资料。`
            });
          }
        } else {
          const recovery = await recoverSycmAccessAfterChrome(port);
          if (!recovery.chromeReady) {
            return res.status(409).json({
              ok: false,
              code: 'SYCM_CHROME_REQUIRED',
              error: `Chrome 调试连接仍不可用（端口 ${port}）。请先点击节点上的“启动 Chrome”，完成登录后再重试当前节点。`
            });
          }
        }
      }
      if (activeWorkbenchProcess) {
        return res.status(409).json({ ok: false, error: '已有工作流正在运行，请等待完成后再重试。' });
      }
      const control = requestRuntimeRetryStep({ runId, step: nodeId });
      const promise = getPipelineRuntimeRunner()({
        runId,
        mode: runtime.mode || (runtime.steps?.includes('keyword') ? 'keyword' : 'daily'),
        params: runtime.params || {},
        preserveRuntime: true,
        retryStep: nodeId,
        steps: runtime.steps
      });
      const runState = { runId, mode: 'workflow-retry-step', promise };
      activeWorkbenchProcess = runState;
      promise.then(result => {
        originalLog(`[Workflow Retry] runtime 完成，runId=${result.runId}, status=${result.runtimeStatus || result.status}`);
      }).catch(err => {
        originalError(`[Workflow Retry] runtime 失败，runId=${runId}, step=${nodeId}:`, err.message);
      }).finally(() => {
        if (activeWorkbenchProcess === runState) activeWorkbenchProcess = null;
      });
      return res.json({ ok: true, data: pipelineRunResponse(runId, { control }) });
    }
    await retryWorkflowNode(runId, nodeId);
    return res.json({ ok: true, run: getRun(runId) });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

// 8. POST /api/workflows/runs/:runId/resume - 继续执行工作流
app.post('/api/workflows/runs/:runId/resume', async (req, res) => {
  const runId = req.params.runId;
  try {
    const runtime = readRuntimeState({ runId });
    if (runtime) {
      if (activeWorkbenchProcess) {
        return res.status(409).json({ ok: false, error: '已有工作流正在运行，请等待完成后再继续。' });
      }
      const control = requestRuntimeResume({ runId });
      const promise = getPipelineRuntimeRunner()({
        runId,
        mode: runtime.mode || (runtime.steps?.includes('keyword') ? 'keyword' : 'daily'),
        params: runtime.params || {},
        preserveRuntime: true,
        resumeFromStep: runtime.activeStep,
        steps: runtime.steps
      });
      const runState = { runId, mode: 'workflow-resume', promise };
      activeWorkbenchProcess = runState;
      promise.then(result => {
        originalLog(`[Workflow Resume] runtime 完成，runId=${result.runId}, status=${result.runtimeStatus || result.status}`);
      }).catch(err => {
        originalError(`[Workflow Resume] runtime 失败，runId=${runId}:`, err.message);
      }).finally(() => {
        if (activeWorkbenchProcess === runState) activeWorkbenchProcess = null;
      });
      return res.json({ ok: true, data: pipelineRunResponse(runId, { control }) });
    }
    await resumeWorkflow(runId);
    return res.json({ ok: true, run: getRun(runId) });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

// 8.5. POST /api/workflows/runs/:runId/pause - 暂停执行工作流
app.post('/api/workflows/runs/:runId/pause', (req, res) => {
  const runId = req.params.runId;
  try {
    const runtime = readRuntimeState({ runId });
    if (runtime) {
      const control = requestRuntimePause({
        runId,
        reason: req.body?.reason || 'user_paused'
      });
      return res.json({ ok: true, data: pipelineRunResponse(runId, { control }) });
    }
    const run = markRunPaused(runId);
    if (!run) {
      return res.status(404).json({ ok: false, error: '工作流运行不存在' });
    }
    return res.json({ ok: true, run });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

// 8.6. POST /api/workflows/sycm/chrome/start - 启动生意参谋调试浏览器
app.post('/api/workflows/sycm/chrome/start', async (req, res) => {
  const port = parsePositiveNumber(req.body?.port || process.env.SYCM_DEBUG_PORT || 9222, 9222);
  const chromeProfileDir = req.body?.chromeProfileDir || process.env.SYCM_CHROME_PROFILE_DIR;
  const workflowRuntime = req.body?.runId && isValidWorkflowRunIdParam(req.body.runId)
    ? readRuntimeState({ runId: req.body.runId })
    : null;
  const manualOrderSheetCollection = req.body?.nodeId === 'collectRank'
    && workflowRuntime?.mode === 'order-sheet'
    && workflowRuntime.params?.inputMode === 'manual';
  const firstManualItemId = manualOrderSheetCollection
    ? String(workflowRuntime.params?.manualItems?.[0]?.itemId || '').trim()
    : '';
  const manualProductUrl = /^\d+$/.test(firstManualItemId)
    ? `https://item.taobao.com/item.htm?id=${firstManualItemId}`
    : 'https://item.taobao.com/';
  const targetUrl = req.body?.url
    || (manualOrderSheetCollection ? manualProductUrl : '')
    || (req.body?.nodeId === 'collectRank' ? 'https://sycm.taobao.com/cc/item_rank' : '')
    || process.env.SYCM_START_URL
    || SYCM_SELECTORS.SEARCH_URL;
  try {
    const launchResult = await getSycmChromeLauncher()(port, { userDataDir: chromeProfileDir });
    if (!launchResult || launchResult.success !== true) {
      return res.status(500).json({
        ok: false,
        status: 'chrome_launch_failed',
        port,
        message: launchResult?.message || 'Chrome 启动失败',
        userMessage: manualOrderSheetCollection
          ? 'Chrome 启动失败。请手动启动带远程调试端口的 Chrome，登录淘宝后重试获取商品资料。'
          : 'Chrome 启动失败。请手动启动带远程调试端口的 Chrome，然后重跑验真。'
      });
    }
    if (!manualOrderSheetCollection) await recoverSycmAccessAfterChrome(port, { assumeReady: true });
    let openResult = null;
    try {
      openResult = await getSycmChromePageOpener()(port, targetUrl);
    } catch (openErr) {
      return res.json({
        ok: true,
        status: 'ready',
        port,
        url: targetUrl,
        message: launchResult.message || 'Chrome 已启动并就绪',
        openStatus: 'open_page_failed',
        openMessage: openErr.message,
        userMessage: manualOrderSheetCollection
          ? `Chrome 已启动，但没有自动打开淘宝商品页。请在该 Chrome 中手动打开：${targetUrl}`
          : `Chrome 已启动，但没有自动打开生意参谋页面。请在该 Chrome 中手动打开：${targetUrl}`
      });
    }
    return res.json({
      ok: true,
      status: 'ready',
      port,
      url: targetUrl,
      openStatus: openResult?.success === false ? 'open_page_failed' : 'opened',
      message: launchResult.message || 'Chrome 已启动并就绪',
      userMessage: manualOrderSheetCollection
        ? 'Chrome 已启动并打开待读取的淘宝商品。请确认淘宝已登录，然后点击“重试获取商品资料”。'
        : 'Chrome 已启动并就绪，已打开生意参谋页面。请登录或完成验证后重跑验真。'
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      status: 'chrome_launch_failed',
      port,
      message: err.message,
      userMessage: 'Chrome 启动失败。请手动启动带远程调试端口的 Chrome，然后重跑验真。'
    });
  }
});

// 8.7. POST /api/distribution/chrome/start - 启动铺货专用调试浏览器
app.post('/api/distribution/chrome/start', async (req, res) => {
  const port = parsePositiveNumber(req.body?.port || process.env.BROWSER_CDP_PORT || process.env.CHROME_DEBUG_PORT || 9222, 9222);
  const chromeProfileDir = req.body?.chromeProfileDir || process.env.SYCM_CHROME_PROFILE_DIR;
  const distributionUrl = req.body?.url || 'https://item.jnesoft.com/';
  try {
    const launchResult = await getSycmChromeLauncher()(port, { userDataDir: chromeProfileDir });
    if (!launchResult || launchResult.success !== true) {
      return res.status(500).json({
        ok: false,
        status: 'chrome_launch_failed',
        port,
        message: launchResult?.message || 'Chrome 启动失败',
        userMessage: `铺货 Chrome 启动失败（调试端口 ${port}）。请关闭占用该端口的 Chrome 后重试。`
      });
    }
    try {
      await getSycmChromePageOpener()(port, distributionUrl);
    } catch (openErr) {
      return res.json({
        ok: true,
        status: 'ready',
        port,
        url: distributionUrl,
        openStatus: 'open_page_failed',
        openMessage: openErr.message,
        userMessage: `Chrome 已启动，但铺货页面未自动打开。请在该 Chrome 中手动打开：${distributionUrl}`
      });
    }
    return res.json({
      ok: true,
      status: 'ready',
      port,
      url: distributionUrl,
      openStatus: 'opened',
      message: launchResult.message || 'Chrome 已启动并就绪',
      userMessage: '铺货 Chrome 已启动，并已打开铺货平台。登录后点击重新检查。'
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      status: 'chrome_launch_failed',
      port,
      message: err.message,
      userMessage: `铺货 Chrome 启动失败（调试端口 ${port}）。请确认 Chrome 已安装后重试。`
    });
  }
});

// 9. GET /api/workflows/runs/:runId/events - 轮询真实 pipeline 状态并以 SSE 推送
app.get('/api/workflows/runs/:runId/events', (req, res) => {
  const runId = req.params.runId;
  if (!isValidWorkflowRunIdParam(runId)) {
    return res.status(400).json({ ok: false, error: '无效的运行 ID，请等待真实 pipeline runId 创建后再订阅事件。' });
  }
  const runObj = getWorkflowRun({ runId }) || runtimeOnlyWorkflowSnapshot(runId);
  if (!runObj) {
    return res.status(404).json({ ok: false, error: '未找到运行记录' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); // 确保 headers 刷出

  // 初始化推送
  res.write(`data: ${JSON.stringify({ event: 'init', payload: { status: runObj.status, nodeStates: runObj.nodeStates } })}\n\n`);
  const allInitialRuntimeEvents = readRuntimeEvents({ runId });
  allInitialRuntimeEvents.slice(-100).forEach(event => {
    writeWorkflowSseEvent(res, event.event || event.type || 'runtime_event', {
      ...event,
      replay: true
    });
  });

  let lastSnapshot = JSON.stringify({ status: runObj.status, nodeStates: runObj.nodeStates });
  let runtimeEventCount = allInitialRuntimeEvents.length;
  const timer = setInterval(() => {
    try {
      const latestEvents = readRuntimeEvents({ runId });
      if (latestEvents.length > runtimeEventCount) {
        latestEvents.slice(runtimeEventCount).forEach(event => {
          writeWorkflowSseEvent(res, event.event || event.type || 'runtime_event', event);
        });
        runtimeEventCount = latestEvents.length;
      }

      const latest = getWorkflowRun({ runId }) || runtimeOnlyWorkflowSnapshot(runId);
      if (!latest) return;
      const nextSnapshot = JSON.stringify({ status: latest.status, nodeStates: latest.nodeStates });
      if (nextSnapshot === lastSnapshot) return;
      lastSnapshot = nextSnapshot;
      res.write(`data: ${JSON.stringify({ event: 'init', payload: { status: latest.status, nodeStates: latest.nodeStates } })}\n\n`);
      // 先同步节点终态，再通知客户端断开终态事件流，避免完成节点和下载按钮停留在旧状态。
      res.write(`data: ${JSON.stringify({ event: 'status_change', payload: { status: latest.status } })}\n\n`);
    } catch (err) {
      res.write(`data: ${JSON.stringify({ event: 'log', payload: { level: 'error', message: err.message } })}\n\n`);
    }
  }, 3000);

  req.on('close', () => {
    clearInterval(timer);
  });
});

function isValidWorkflowRunIdParam(runId) {
  const value = String(runId || '').trim();
  return Boolean(value) && value !== 'null' && value !== 'undefined' && /^[A-Za-z0-9_-]+$/.test(value);
}

function writeWorkflowSseEvent(res, event, payload) {
  res.write(`data: ${JSON.stringify({ event, payload })}\n\n`);
}

function runtimeOnlyWorkflowSnapshot(runId) {
  const runtime = readRuntimeState({ runId });
  if (!runtime) return null;
  const nodeStates = Object.values(WORKFLOW_NODE_IDS).reduce((memo, nodeId) => {
    memo[nodeId] = {
      id: nodeId,
      type: `pipeline-${nodeId}`,
      status: nodeId === WORKFLOW_NODE_IDS.start ? 'completed' : 'idle',
      input: null,
      output: null,
      error: null,
      startedAt: runtime.startedAt || null,
      completedAt: null
    };
    return memo;
  }, {});
  Object.entries(runtime.progress || {}).forEach(([nodeId, progress]) => {
    if (!nodeStates[nodeId]) return;
    nodeStates[nodeId] = {
      ...nodeStates[nodeId],
      status: progress.status || nodeStates[nodeId].status,
      progress
    };
  });
  if (runtime.activeStep && nodeStates[runtime.activeStep] && !nodeStates[runtime.activeStep].progress) {
    nodeStates[runtime.activeStep] = {
      ...nodeStates[runtime.activeStep],
      status: runtime.status === 'cancelled' ? 'cancelled' : 'running',
      progress: { status: runtime.status === 'cancelled' ? 'cancelled' : 'running', current: 0, total: 0, percent: 0, message: '' }
    };
  }
  return {
    runId,
    status: runtime.status || 'running',
    nodeStates,
    runtime
  };
}

function sendWorkflowNotImplemented(action) {
  return (req, res) => {
    res.status(501).json({
      ok: false,
      error: `Workflow ${action} is not implemented for production pipeline runs yet.`
    });
  };
}

// React SPA entry. API routes must stay above this fallback.
app.use(express.static(reactWebPath));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, error: 'API not found' });
  }
  const indexPath = path.join(reactWebPath, 'index.html');
  if (!fs.existsSync(indexPath)) return next();
  res.sendFile(indexPath);
});

// 请求体超限时返回结构化 JSON，避免前端只拿到 HTML 报错页
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413)) {
    return res.status(413).json({
      ok: false,
      code: 'PAYLOAD_TOO_LARGE',
      error: `请求体超过上限（${JSON_BODY_LIMIT}），请减少商品或规格数量后重试`,
      userMessage: `本次提交内容过大（上限 ${JSON_BODY_LIMIT}），服务器已拒绝，请精简后重试。`
    });
  }
  return next(err);
});

// Boot Server (Explicitly bind to localhost 127.0.0.1 for local boundaries security P2)
const defaultPort = parseInt(process.env.UI_PORT, 10) || 3000;
if (process.env.NODE_ENV !== 'test') {
  findFreePort(defaultPort).then(port => {
    app.listen(port, '127.0.0.1', () => {
      console.log(`\n======================================================`);
      console.log(`🌟 电商选品可视化工具 (Local Web UI) 服务已启动`);
      console.log(`🔗 本地安全链接: http://127.0.0.1:${port}`);
      console.log(`======================================================\n`);
    });
  }).catch(err => {
    console.error('无法启动服务器端口扫描:', err.message);
  });
}

module.exports = app;
