'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeExactKeywords } = require('../../../core/exact-keywords');
const {
  DEFAULT_FLOW_DIR,
  createRunId,
  flowMine,
  flowReviewCandidates,
  flowVerify,
  flowSelectProducts,
  flowGenerate,
  flowExport,
  flowManualStart,
  flowEnrichManualProducts,
  flowKeywordStart,
  flowKeyword
} = require('../index');
const {
  buildOrderSheet,
  collectOrderSheetProducts,
  prepareOrderSheetDraft
} = require('../../order-sheet');
const {
  buildReviewSheet,
  generateReviewDrafts,
  importReviewSource
} = require('../../review-sheet');
const {
  assertRuntimeRunId,
  initRuntimeState,
  readRuntimeState,
  updateRuntimeState,
  readRuntimeControl,
  clearRuntimeControl,
  appendRuntimeEvent
} = require('./store');

const DEFAULT_STEPS = ['mine', 'keywordReview', 'verify', 'select', 'generate', 'export'];
const KEYWORD_STEPS = ['start', 'verify', 'select', 'generate', 'export'];
const MANUAL_STEPS = ['start', 'select', 'generate', 'export'];
const ORDER_SHEET_STEPS = ['collectRank', 'confirmProducts', 'generateSheet'];
const REVIEW_SHEET_STEPS = ['importSheet', 'generateReviews', 'generateSheet'];
const STOP_STATUSES = new Set([
  'mining_manual_action_required',
  'mining_empty',
  'verified_empty',
  'verified_no_generation_eligible',
  'awaiting_keyword_review',
  'awaiting_product_review',
  'keyword_review_empty',
  'manual_action_required',
  'verified_partial_manual_required',
  'select_failed',
  'generate_failed',
  'needs_review',
  'ready_to_distribute',
  'awaiting_user_confirmation',
  'workflow_complete'
]);
const FAILED_PIPELINE_STATUSES = new Set(['select_failed', 'generate_failed']);
const BLOCKED_PIPELINE_STATUSES = new Set([
  'mining_manual_action_required',
  'mining_empty',
  'manual_action_required',
  'verified_partial_manual_required',
  'awaiting_keyword_review',
  'awaiting_product_review',
  'keyword_review_empty',
  'verified_no_generation_eligible',
  'verified_empty'
]);
const REVIEW_PIPELINE_STATUSES = new Set([
  'needs_review',
  'ready_to_distribute',
  'awaiting_user_confirmation'
]);

function runtimeRunDir(dataDir, runId) {
  assertRuntimeRunId(runId);
  return path.join(dataDir, 'runs', runId);
}

function clampPercent(current, total) {
  const safeCurrent = Number(current);
  const safeTotal = Number(total);
  if (!Number.isFinite(safeCurrent) || !Number.isFinite(safeTotal)) return 0;
  if (safeTotal <= 0) return safeCurrent > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((safeCurrent / safeTotal) * 100)));
}

function normalizeProgress(progress = {}) {
  const current = Number.isFinite(Number(progress.current)) ? Number(progress.current) : 0;
  const total = Number.isFinite(Number(progress.total)) ? Number(progress.total) : 0;
  return {
    status: progress.status || 'running',
    current,
    total,
    percent: clampPercent(current, total),
    message: progress.message || ''
  };
}

function idleProgress() {
  return { status: 'idle', current: 0, total: 0, percent: 0, message: '' };
}

function completedProgress(message = '完成', previous = {}) {
  const total = Math.max(1, Number(previous.total) || 1);
  return { status: 'completed', current: total, total, percent: 100, message };
}

function resetProgressFromStep(progress, steps, startStep) {
  const startIndex = steps.indexOf(startStep);
  if (startIndex < 0) return progress || {};
  return steps.reduce((memo, step, index) => {
    memo[step] = index >= startIndex ? idleProgress() : (progress?.[step] || completedProgress());
    return memo;
  }, {});
}

function createReporter({ dataDir, getRunId, step }) {
  return (progress = {}) => {
    const runId = getRunId();
    const payload = normalizeProgress(progress);
    updateRuntimeState({
      dataDir,
      runId,
      patch: {
        activeStep: step,
        progress: { [step]: payload }
      }
    });
    appendRuntimeEvent({
      dataDir,
      runId,
      event: { event: 'progress', step, ...payload }
    });
    return payload;
  };
}

function createDefaultStepFns({ dataDir, runId, params, mode = 'daily' }) {
  const keywordMode = mode === 'keyword';
  const manualMode = mode === 'manual';
  const exactKeywords = keywordMode
    ? normalizeExactKeywords(Array.isArray(params.keywords) && params.keywords.length > 0 ? params.keywords : params.keyword)
    : [];
  const keywordCount = Math.max(1, exactKeywords.length);
  const mineLimit = params.mine || params.limit || 50;
  const verifyLimit = keywordMode ? keywordCount : (params.verify || 20);
  const selectLimit = keywordMode ? keywordCount : (params.select || params.generate || 10);
  const generateLimit = keywordMode ? keywordCount : (params.generate || 10);
  const exportLimit = params.export || 20;
  const recordSeedFeedback = mode === 'daily'
    ? params.recordSeedFeedback !== false
    : params.recordSeedFeedback === true;
  const dailyDiscoveryMode = params.discoveryMode || 'inspiration';
  const dailySource = params.source || (dailyDiscoveryMode === 'seed' ? 'sycm_hot' : 'inspiration');

  return {
    start: async ({ reportProgress }) => {
      reportProgress({ current: 0, total: keywordCount, message: keywordMode ? `准备 ${keywordCount} 个精确关键词` : '准备流程' });
      if (manualMode) return flowManualStart({ ...params, dataDir, runId });
      return flowKeywordStart({ ...params, dataDir, runId, keywords: exactKeywords });
    },
    mine: async ({ reportProgress }) => {
      reportProgress({ current: 0, total: mineLimit, message: '开始挖词' });
      return flowMine({
        ...params,
        dataDir,
        runId,
        limit: mineLimit,
        discoveryMode: mode === 'daily' ? dailyDiscoveryMode : params.discoveryMode,
        source: mode === 'daily' ? dailySource : (params.source || 'local'),
        rootMode: params.rootMode || 'auto',
        rootLimit: params.rootLimit || (mode === 'daily' ? 8 : 5),
        rootCooldownDays: params.rootCooldownDays ?? (mode === 'daily' ? 14 : 7),
        familyCooldownDays: params.familyCooldownDays ?? 7,
        inspirationSycmPages: mode === 'daily' ? 1 : params.inspirationSycmPages,
        excludeSeen: params.excludeSeen !== false,
        recordSeen: params.recordSeen !== false,
        recordSeedFeedback,
        autoReplenishSeeds: mode === 'daily'
          ? dailyDiscoveryMode === 'seed' && params.autoReplenishSeeds !== false
          : params.autoReplenishSeeds === true,
        onProgress: reportProgress
      });
    },
    verify: async ({ reportProgress }) => {
      reportProgress({ current: 0, total: verifyLimit, message: '开始验真' });
      return flowVerify({ ...params, dataDir, runId, limit: verifyLimit, recordSeedFeedback, onProgress: reportProgress });
    },
    keywordReview: async ({ reportProgress }) => {
      reportProgress({ current: 0, total: mineLimit, message: '等待人工筛词' });
      return flowReviewCandidates({
        ...params,
        dataDir,
        runId,
        approveAll: mode === 'daily' && params.autoApproveKeywords !== false
      });
    },
    select: async ({ reportProgress }) => {
      if (manualMode) {
        const total = Array.isArray(params.items) ? params.items.length : 0;
        reportProgress({ current: 0, total, message: '开始获取商品资料' });
        return flowEnrichManualProducts({ ...params, dataDir, runId, onProgress: reportProgress });
      }
      reportProgress({ current: 0, total: selectLimit, message: '开始货源选品' });
      const result = await flowSelectProducts({ ...params, dataDir, runId, limit: selectLimit, manualMode, recordSeedFeedback });
      return result;
    },
    generate: async ({ reportProgress }) => {
      reportProgress({ current: 0, total: generateLimit, message: '开始标题生成' });
      return flowGenerate({ ...params, dataDir, runId, limit: generateLimit, manualMode, recordSeedFeedback });
    },
    export: async ({ reportProgress }) => {
      reportProgress({ current: 0, total: exportLimit, message: '开始导出清单' });
      return flowExport({ ...params, dataDir, runId, limit: exportLimit });
    },
    collectRank: async ({ reportProgress }) => {
      reportProgress({ current: 0, total: Math.max(1, Number(params.pages || 1)) + 2, message: '准备采集商品排行' });
      return collectOrderSheetProducts({ ...params, dataDir, runId, onProgress: reportProgress });
    },
    confirmProducts: async ({ reportProgress }) => {
      reportProgress({ current: 0, total: 1, message: '等待确认商品与编组' });
      const result = await prepareOrderSheetDraft({ ...params, dataDir, runId, onProgress: reportProgress });
      reportProgress({ current: 1, total: 1, message: `已准备 ${result.count || 0} 个商品，等待人工确认` });
      return result;
    },
    generateSheet: async ({ reportProgress }) => {
      reportProgress({ current: 0, total: 1, message: mode === 'review-sheet' ? '准备生成评价表' : '准备生成商品排行表格' });
      const result = mode === 'review-sheet'
        ? buildReviewSheet({ ...params, dataDir, runId, onProgress: reportProgress })
        : buildOrderSheet({ ...params, dataDir, runId, onProgress: reportProgress });
      const resolved = await result;
      reportProgress({
        current: 1,
        total: 1,
        message: mode === 'review-sheet'
          ? `已生成 ${resolved.count || 0} 条评价表记录`
          : `已生成 ${resolved.count || 0} 条表格记录`
      });
      return resolved;
    },
    importSheet: async ({ reportProgress }) => {
      reportProgress({ current: 0, total: 1, message: '正在解析上传的刷单表' });
      const result = await importReviewSource({ ...params, dataDir, runId });
      reportProgress({ current: 1, total: 1, message: `已导入 ${result.count} 个商品` });
      return result;
    },
    generateReviews: async ({ reportProgress }) => {
      reportProgress({ current: 0, total: 1, message: '正在生成评价草稿' });
      const result = await generateReviewDrafts({ ...params, dataDir, runId });
      reportProgress({ current: result.count, total: result.count, message: `已生成 ${result.count} 条评价，等待复核` });
      return result;
    },
    review: async ({ reportProgress }) => {
      reportProgress({ current: 1, total: 1, message: '等待人工复核' });
      return { status: 'needs_review' };
    },
    keyword: async ({ reportProgress }) => {
      reportProgress({ current: 0, total: keywordCount, message: `开始处理 ${keywordCount} 个精确关键词` });
      return flowKeyword({ ...params, dataDir, runId, keywords: exactKeywords });
    }
  };
}

function adoptReturnedRunId({ dataDir, currentRunId, returnedRunId }) {
  if (!returnedRunId || returnedRunId === currentRunId) return currentRunId;
  assertRuntimeRunId(returnedRunId);
  const currentDir = runtimeRunDir(dataDir, currentRunId);
  const returnedDir = runtimeRunDir(dataDir, returnedRunId);
  if (fs.existsSync(currentDir) && !fs.existsSync(returnedDir)) {
    fs.mkdirSync(path.dirname(returnedDir), { recursive: true });
    fs.renameSync(currentDir, returnedDir);
  }
  return returnedRunId;
}

function nextStepAfter(steps, step) {
  const currentIndex = steps.indexOf(step);
  return currentIndex >= 0 && currentIndex < steps.length - 1 ? steps[currentIndex + 1] : step;
}

function runtimeStatusForPipelineStatus(pipelineStatus) {
  if (pipelineStatus === 'cancelled') return 'cancelled';
  if (pipelineStatus === 'paused') return 'paused';
  if (FAILED_PIPELINE_STATUSES.has(pipelineStatus)) return 'failed';
  if (BLOCKED_PIPELINE_STATUSES.has(pipelineStatus)) return 'blocked';
  if (REVIEW_PIPELINE_STATUSES.has(pipelineStatus)) return 'needs_review';
  return 'completed';
}

/**
 * Run the pipeline step-by-step while persisting runtime progress and events.
 * @param {object} [options] Runtime options.
 * @param {string} [options.dataDir] Pipeline data directory.
 * @param {string} [options.runId] Existing or caller-selected run id.
 * @param {string} [options.mode] Runtime mode, such as daily or keyword.
 * @param {object} [options.params] Step parameters.
 * @param {string[]} [options.steps] Ordered daily-mode steps.
 * @param {object<string, Function>} [options.stepFns] Injectable step functions for tests.
 * @returns {Promise<{runId: string, runDir: string, status: string}>} Runtime result.
 */
async function runPipelineRuntime(options = {}) {
  const dataDir = options.dataDir || DEFAULT_FLOW_DIR;
  const injectedStepFns = options.stepFns || null;
  let runId = options.runId || createRunId();
  let runDir = runtimeRunDir(dataDir, runId);
  const existingRuntime = options.preserveRuntime
    ? readRuntimeState({ dataDir, runId })
    : null;
  const params = options.params == null ? (existingRuntime?.params || {}) : options.params;
  const mode = options.mode || existingRuntime?.mode || 'daily';
  const steps = options.steps || (
    mode === 'keyword'
      ? KEYWORD_STEPS
      : mode === 'manual'
        ? MANUAL_STEPS
        : mode === 'order-sheet'
          ? ORDER_SHEET_STEPS
          : mode === 'review-sheet'
            ? REVIEW_SHEET_STEPS
          : DEFAULT_STEPS
  );
  const stepFns = injectedStepFns || createDefaultStepFns({ dataDir, runId, params, mode });
  const startStep = options.retryStep || options.resumeFromStep || existingRuntime?.activeStep || steps[0];
  const startIndex = Math.max(0, steps.indexOf(startStep));
  const stepsToRun = steps.slice(startIndex);

  if (existingRuntime) {
    clearRuntimeControl({ dataDir, runId });
    const progress = options.retryStep
      ? resetProgressFromStep(existingRuntime.progress || {}, steps, options.retryStep)
      : (existingRuntime.progress || {});
    updateRuntimeState({
      dataDir,
      runId,
      patch: {
        status: options.retryStep ? 'retrying' : 'resuming',
        activeStep: startStep,
        requestedAction: null,
        platform: null,
        platformStatus: null,
        manualAction: null,
        blocker: null,
        actionHint: null,
        nextRecommendedAction: null,
        error: null,
        mode,
        params,
        progress
      }
    });
  } else {
    initRuntimeState({ dataDir, runId, steps, mode, params });
  }
  appendRuntimeEvent({
    dataDir,
    runId,
    event: { event: 'status', status: existingRuntime ? (options.retryStep ? 'retrying' : 'resuming') : 'running', step: startStep || '' }
  });

  let lastResult = { runId, runDir, status: 'running' };
  try {
    for (const step of stepsToRun) {
      updateRuntimeState({
        dataDir,
        runId,
        patch: {
          status: 'running',
          activeStep: step,
          platform: null,
          platformStatus: null,
          manualAction: null,
          blocker: null,
          actionHint: null,
          nextRecommendedAction: null,
          error: null,
          progress: {
            [step]: { status: 'running', current: 0, total: 0, percent: 0, message: '' }
          }
        }
      });
      appendRuntimeEvent({
        dataDir,
        runId,
        event: { event: 'step_started', step, status: 'running' }
      });

      const stepFn = stepFns[step];
      if (!stepFn) throw new Error(`Unknown runtime step: ${step}`);

      lastResult = await stepFn({
        dataDir,
        runId,
        runDir,
        params,
        reportProgress: createReporter({ dataDir, getRunId: () => runId, step })
      }) || {};

      const returnedRunId = lastResult.runId;
      const nextRunId = adoptReturnedRunId({ dataDir, currentRunId: runId, returnedRunId });
      if (nextRunId !== runId) {
        runId = nextRunId;
        runDir = lastResult.runDir || runtimeRunDir(dataDir, runId);
      }

      const reportedProgress = readRuntimeState({ dataDir, runId })?.progress?.[step] || {};
      updateRuntimeState({
        dataDir,
        runId,
        patch: {
          progress: {
            [step]: completedProgress(reportedProgress.message || '完成', reportedProgress)
          }
        }
      });
      appendRuntimeEvent({
        dataDir,
        runId,
        event: { event: 'step_completed', step, status: 'completed' }
      });

      const control = readRuntimeControl({ dataDir, runId });
      const nextStep = nextStepAfter(steps, step);
      if (control.requestedAction === 'cancel') {
        updateRuntimeState({
          dataDir,
          runId,
          patch: {
            status: 'cancelled',
            requestedAction: 'cancel',
            activeStep: nextStep
          }
        });
        appendRuntimeEvent({
          dataDir,
          runId,
          event: { event: 'status', status: 'cancelled', reason: control.reason || '' }
        });
        return { runId, runDir, status: 'cancelled', runtimeStatus: 'cancelled' };
      }

      if (control.requestedAction === 'pause') {
        clearRuntimeControl({ dataDir, runId });
        updateRuntimeState({
          dataDir,
          runId,
          patch: {
            status: 'paused',
            requestedAction: 'pause',
            activeStep: nextStep
          }
        });
        appendRuntimeEvent({
          dataDir,
          runId,
          event: { event: 'status', status: 'paused', reason: control.reason || '' }
        });
        return { runId, runDir, status: 'paused', runtimeStatus: 'paused' };
      }

      if (lastResult.status && STOP_STATUSES.has(lastResult.status)) break;
    }

    const pipelineStatus = lastResult.status || 'completed';
    const runtimeStatus = runtimeStatusForPipelineStatus(pipelineStatus);
    updateRuntimeState({
      dataDir,
      runId,
      patch: {
        status: runtimeStatus,
        platform: lastResult.platform,
        manualAction: lastResult.manualAction
      }
    });
    appendRuntimeEvent({
      dataDir,
      runId,
      event: {
        event: 'status',
        status: runtimeStatus,
        pipelineStatus
      }
    });
    return { ...lastResult, runId, runDir, status: pipelineStatus, runtimeStatus };
  } catch (error) {
    updateRuntimeState({
      dataDir,
      runId,
      patch: {
        status: 'failed',
        error: error.message
      }
    });
    appendRuntimeEvent({
      dataDir,
      runId,
      event: { event: 'status', status: 'failed', error: error.message }
    });
    throw error;
  }
}

module.exports = {
  runPipelineRuntime
};
