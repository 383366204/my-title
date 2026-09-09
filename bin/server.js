'use strict';
const { createRuntimeView } = require('../core/server/runtime-view');
const { createSycmAccessRecovery } = require('../core/server/sycm-access-recovery');

const { buildWorkbenchCliArgs, appendCappedOutput } = require('../core/server/workbench-cli');

const { registerHttpFallbacks } = require('../core/server/http-fallbacks');

const { registerSelectionReviewRoutes } = require('../core/server/selection-review-routes');

const { createDistributionJobs } = require('../core/server/distribution-jobs');
const { registerDistributionRoutes } = require('../core/server/distribution-routes');

const { registerWorkflowQueryRoutes } = require('../core/server/workflow-query-routes');
const { registerOrderSheetDraftRoutes } = require('../core/server/order-sheet-draft-routes');
const { createWorkbenchCoordinator } = require('../core/server/workbench-coordinator');
const { registerPipelineRoutes } = require('../core/server/pipeline-routes');
const { registerWorkflowControlRoutes } = require('../core/server/workflow-control-routes');
const { registerWorkbenchRoutes } = require('../core/server/workbench-routes');
const { registerSeedRoutes } = require('../core/server/seed-routes');
const { registerResearchRoutes } = require('../core/server/research-routes');
const { registerPlatformRoutes } = require('../core/server/platform-routes');
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
  recordSeedEvent,
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
const { TaobaoNativeClient } = require('../skills/competitor-analysis');
const { launchTaobaoDesktop } = require('../skills/title-gen/src/taobao-utils');
const {
  checkReviewDrafts,
  confirmReviewDrafts,
  saveReviewDrafts,
  rewriteReviewDrafts,
  addReviewAttachment,
  listReviewAttachments,
  readReviewAttachment,
  removeReviewAttachment,
  regroupReviewSourceUpload,
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
const workbench = createWorkbenchCoordinator();
const { pipelineRunResponse, withPipelineRuntimeFields, runtimeOnlyWorkflowSnapshot } = createRuntimeView({
  readRuntimeState,
  summarizePipelineRun,
  getWorkflowRun,
  WORKFLOW_NODE_IDS
});
const { recoverSycmAccessAfterChrome } = createSycmAccessRecovery({
  getSycmAccessStatus,
  getSycmChromeAvailabilityChecker,
  clearSycmAccessBlocker
});

async function resolveManualShareParams(mode, raw = {}) {
  if (mode !== 'manual' || !Array.isArray(raw.items)) return raw;
  const items = await Promise.all(raw.items.slice(0, 100).map(async (item) => {
    const source = String(item?.url || item?.productUrl || '').trim();
    const resolved = await resolve1688ShareText(source);
    return resolved ? { ...item, url: resolved.url, offerId: resolved.offerId } : item;
  }));
  return { ...raw, items };
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

registerSeedRoutes(app, {
  DEFAULT_DATA_DIR,
  listSeeds,
  auditSeedPool,
  prepareSeedSuggestions,
  buildSeedReplenishmentPlan,
  addSeed,
  loadSeeds,
  saveSeeds,
  recordSeedEvent,
  fs,
  path
});

registerPlatformRoutes(app, {
  getPlatformAccessStatus,
  parsePositiveNumber,
  isValidWorkflowRunIdParam,
  readRuntimeState,
  SYCM_SELECTORS,
  getSycmChromeLauncher,
  recoverSycmAccessAfterChrome,
  getSycmChromePageOpener,
  launchTaobaoDesktop,
  TaobaoNativeClient
});

// 1.5 GET /api/workflow/batches - Read-only daily pipeline batch summaries

registerWorkbenchRoutes(app, {
  parsePositiveNumber,
  listPipelineRuns,
  summarizePipelineRun,
  workbench,
  buildWorkbenchCliArgs,
  spawn,
  appendCappedOutput,
  originalLog,
  originalError
});

function parsePositiveNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

registerPipelineRoutes(app, {
  parsePositiveNumber,
  listPipelineRuns,
  withPipelineRuntimeFields,
  isValidWorkflowRunIdParam,
  summarizePipelineRun,
  workbench,
  resolveProductionWorkflowLaunch,
  resolveManualShareParams,
  sanitizeWorkflowParams,
  createRunId,
  resolveProductionWorkflowDefinition,
  writeWorkflowDefinition,
  getPipelineRuntimeRunner,
  originalLog,
  originalError,
  readRuntimeState,
  appendRunCandidates,
  requestRuntimePause,
  pipelineRunResponse,
  requestRuntimeResume,
  requestRuntimeRetryStep,
  runPipelineStep
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

// ==================== Core Root Miner APIs ====================
const { searchTaobaoTitles } = require('../skills/title-gen/src/search-taobao');
const { extractNouns } = require('../core/word-segmenter');
const { precheckCandidates } = require('../skills/keyword-mining/src/sycm-precheck');
const { fetchOpportunities } = require('../skills/alibaba1688');
const { extractSycmData } = require('../skills/sycm-research');

// ==================== Workflow APIs ====================

// 模板、历史记录、节点产物与 SSE 查询共用同一组运行访问依赖。
registerWorkflowQueryRoutes(app, {
  listProductionWorkflowTemplates,
  parsePositiveNumber,
  listWorkflowRuns,
  workbench,
  readRuntimeState,
  deleteWorkflowRun,
  readWorkflowNodeArtifact,
  getWorkflowRun,
  isValidWorkflowRunIdParam,
  runtimeOnlyWorkflowSnapshot,
  readRuntimeEvents
});

// 铺货任务存储与 HTTP 路由共享一个服务实例，确认读取器在请求时获取。
const distributionJobs = createDistributionJobs({
  jobDir: path.join(process.cwd(), 'data', 'pipeline', 'distribution-runs'),
  getConfirmationReader: () => app.locals.distributionConfirmationReader || confirmDistributionLog,
  summarizePipelineRun,
  readRuntimeState,
  markRunDistributionComplete,
  updateRuntimeState,
  appendRuntimeEvent
});
registerDistributionRoutes(app, {
  jobs: distributionJobs,
  parseItems,
  checkDistributionReadiness,
  parsePositiveNumber,
  createRunId,
  distributeProducts,
  summarizePipelineRun,
  originalError
});

app.post('/api/review-sheets/upload', express.raw({
  type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'],
  limit: '12mb'
}), async (req, res) => {
  try {
    const encodedName = String(req.get('x-file-name') || '刷单表.xlsx');
    let fileName = encodedName;
    try { fileName = decodeURIComponent(encodedName); } catch (_) { /* Keep the supplied name. */ }
    const result = await saveReviewSourceUpload({
      buffer: req.body,
      fileName,
      groupSize: req.query.groupSize
    });
    const { sourceFile: _sourceFile, ...publicResult } = result;
    return res.json({ ok: true, data: publicResult });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

// 改每组商品数后重新分组：直接复用已上传的源文件，不用重新选文件
app.post('/api/review-sheets/uploads/:uploadId/group-size', async (req, res) => {
  try {
    const result = await regroupReviewSourceUpload({
      uploadId: req.params.uploadId,
      groupSize: req.body?.groupSize
    });
    const { sourceFile: _sourceFile, ...publicResult } = result;
    return res.json({ ok: true, data: publicResult });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});
// 评价配图：上传、列表、回图、删除。文件名一律服务端生成，只按清单里的相对路径取文件。
app.post('/api/workflows/runs/:runId/review-assets', express.raw({
  type: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/octet-stream'],
  limit: '8mb'
}), async (req, res) => {
  try {
    const encodedName = String(req.get('x-file-name') || '');
    let fileName = encodedName;
    try { fileName = decodeURIComponent(encodedName); } catch (_) { /* Keep the supplied name. */ }
    const result = await addReviewAttachment({
      runId: req.params.runId,
      draftId: String(req.query.draftId || ''),
      buffer: req.body,
      fileName
    });
    return res.json({ ok: true, data: result });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/api/workflows/runs/:runId/review-assets', (req, res) => {
  try {
    return res.json({ ok: true, data: listReviewAttachments({ runId: req.params.runId }) });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/api/workflows/runs/:runId/review-assets/:attachmentId', (req, res) => {
  try {
    const asset = readReviewAttachment({ runId: req.params.runId, attachmentId: req.params.attachmentId });
    res.setHeader('Content-Type', asset.contentType);
    res.setHeader('Cache-Control', 'no-store');
    return fs.createReadStream(asset.absolutePath).pipe(res);
  } catch (err) {
    return res.status(404).json({ ok: false, error: err.message });
  }
});

app.delete('/api/workflows/runs/:runId/review-assets/:attachmentId', (req, res) => {
  try {
    const result = removeReviewAttachment({
      runId: req.params.runId,
      draftId: String(req.query.draftId || ''),
      attachmentId: req.params.attachmentId
    });
    return res.json({ ok: true, data: result });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

// 评价草稿自动缓存：只落盘人工修改，不推进状态、不触发后续节点
app.post('/api/workflows/runs/:runId/review-drafts', (req, res) => {
  try {
    const runId = req.params.runId;
    const runtime = readRuntimeState({ runId });
    if (!runtime || runtime.mode !== 'review-sheet') {
      return res.status(409).json({ ok: false, error: '当前运行不是评价表流水线。' });
    }
    const reviews = Array.isArray(req.body?.reviews) ? req.body.reviews : [];
    const result = saveReviewDrafts({ runId, reviews });
    return res.json({ ok: true, data: result });
  } catch (err) {
    return res.status(err.code === 'REVIEW_DRAFT_LOCKED' ? 409 : 400).json({ ok: false, error: err.message });
  }
});

app.post('/api/workflows/runs/:runId/review-drafts/check', (req, res) => {
  try {
    const runId = req.params.runId;
    const runtime = readRuntimeState({ runId });
    if (!runtime || runtime.mode !== 'review-sheet') {
      return res.status(409).json({ ok: false, error: '当前运行不是评价表流水线。' });
    }
    return res.json({ ok: true, data: checkReviewDrafts({ runId }) });
  } catch (err) {
    return res.status(err.code === 'REVIEW_DRAFT_LOCKED' ? 409 : 400).json({ ok: false, error: err.message });
  }
});

app.post('/api/workflows/runs/:runId/review-drafts/rewrite', async (req, res) => {
  try {
    const runId = req.params.runId;
    const runtime = readRuntimeState({ runId });
    if (!runtime || runtime.mode !== 'review-sheet') {
      return res.status(409).json({ ok: false, error: '当前运行不是评价表流水线。' });
    }
    const result = await rewriteReviewDrafts({
      runId,
      ids: Array.isArray(req.body?.ids) ? req.body.ids : [],
      reviewTone: runtime.params?.reviewTone,
      reviewLength: runtime.params?.reviewLength,
      useAI: runtime.params?.useAI
    });
    return res.json({ ok: true, data: result });
  } catch (err) {
    return res.status(err.code === 'REVIEW_DRAFT_LOCKED' ? 409 : 400).json({ ok: false, error: err.message });
  }
});

app.post('/api/workflows/runs/:runId/review-confirm', (req, res) => {
  if (workbench.current) {
    return res.status(409).json({ ok: false, error: '已有工作流正在运行，请等待完成后再继续。' });
  }
  try {
    const runId = req.params.runId;
    const runtime = readRuntimeState({ runId });
    if (!runtime || runtime.mode !== 'review-sheet') {
      return res.status(409).json({ ok: false, error: '当前运行不是评价表流水线。' });
    }
    const confirmed = confirmReviewDrafts({ runId, reviews: req.body?.reviews || [] });
    const runState = { runId, mode: 'review-sheet' };
    const promise = workbench.run(runState, () => runPipelineRuntime({
      runId,
      mode: 'review-sheet',
      params: runtime.params,
      preserveRuntime: true,
      resumeFromStep: 'generateSheet'
    }));
    promise.then(result => {
      originalLog(`[Review Sheet] runtime 完成，runId=${result.runId}, status=${result.runtimeStatus || result.status}`);
    }).catch(err => {
      originalError(`[Review Sheet] runtime 失败，runId=${runId}:`, err.message);
    });
    return res.json({ ok: true, data: { status: 'resuming', count: confirmed.count, runId } });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

registerOrderSheetDraftRoutes(app, { readRuntimeState, getOrderSheetDraft, saveOrderSheetDraft });

function handleConfirmOrderSheet(req, res) {
  if (workbench.current) {
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

    const runState = { runId, mode: 'order-sheet-confirm' };
    const promise = workbench.run(runState, () => getPipelineRuntimeRunner()({
      runId,
      mode: 'order-sheet',
      params,
      preserveRuntime: true,
      resumeFromStep: 'generateSheet',
      steps: runtime.steps
    }));
    promise.then(result => {
      originalLog(`[Order Sheet] runtime 完成，runId=${result.runId}, status=${result.runtimeStatus || result.status}`);
    }).catch(err => {
      originalError(`[Order Sheet] runtime 失败，runId=${runId}:`, err.message);
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

registerResearchRoutes(app, {
  logStorage,
  originalLog,
  mineKeywords,
  DEFAULT_DATA_DIR,
  generateTitlePipeline,
  searchAll,
  searchTaobaoTitles,
  extractNouns,
  precheckCandidates,
  fetchOpportunities,
  extractSycmData,
  resolve1688ShareText
});

registerWorkflowControlRoutes(app, {
  validateProductionWorkflow,
  workbench,
  isValidWorkflowRunIdParam,
  requestRuntimeCancel,
  readRuntimeState,
  getPipelineRuntimeRunner,
  parsePositiveNumber,
  getSycmChromeAvailabilityChecker,
  recoverSycmAccessAfterChrome,
  requestRuntimeRetryStep,
  pipelineRunResponse,
  retryWorkflowNode,
  getRun,
  requestRuntimeResume,
  resumeWorkflow,
  requestRuntimePause,
  markRunPaused,
  resolveProductionWorkflowLaunch,
  resolveManualShareParams,
  sanitizeWorkflowParams,
  createRunId,
  resolveProductionWorkflowDefinition,
  writeWorkflowDefinition,
  originalLog,
  originalError
});

// 人工筛词确认后暂停在下一步骤，等待用户继续。
registerSelectionReviewRoutes(app, {
  isValidWorkflowRunIdParam,
  flowReviewCandidates,
  flowReviewProducts,
  readRuntimeState,
  updateRuntimeState,
  withPipelineRuntimeFields,
  summarizePipelineRun
});

function isValidWorkflowRunIdParam(runId) {
  const value = String(runId || '').trim();
  return Boolean(value) && value !== 'null' && value !== 'undefined' && /^[A-Za-z0-9_-]+$/.test(value);
}

registerHttpFallbacks(app, { reactWebPath, jsonBodyLimit: JSON_BODY_LIMIT });

// Boot Server (Explicitly bind to localhost 127.0.0.1 for local boundaries security P2)
const defaultPort = parseInt(process.env.UI_PORT, 10) || 3000;
const runningUnderNodeTest = Boolean(process.env.NODE_TEST_CONTEXT);
if (process.env.NODE_ENV !== 'test' && !runningUnderNodeTest) {
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
