'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_FLOW_DIR,
  createRunId,
  flowMine,
  flowVerify,
  flowGenerate,
  flowExport,
  flowKeyword
} = require('../index');
const {
  assertRuntimeRunId,
  initRuntimeState,
  readRuntimeState,
  updateRuntimeState,
  readRuntimeControl,
  clearRuntimeControl,
  appendRuntimeEvent
} = require('./store');

const DEFAULT_STEPS = ['mine', 'verify', 'generate', 'export', 'review'];
const STOP_STATUSES = new Set([
  'verified_empty',
  'manual_action_required',
  'verified_partial_manual_required',
  'generate_failed',
  'needs_review',
  'ready_to_distribute',
  'awaiting_user_confirmation'
]);
const FAILED_PIPELINE_STATUSES = new Set(['generate_failed']);
const BLOCKED_PIPELINE_STATUSES = new Set([
  'manual_action_required',
  'verified_partial_manual_required',
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

function completedProgress(message = '完成') {
  return { status: 'completed', current: 1, total: 1, percent: 100, message };
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

function createDefaultStepFns({ dataDir, runId, params }) {
  const mineLimit = params.mine || params.limit || 50;
  const verifyLimit = params.verify || 20;
  const generateLimit = params.generate || 10;
  const exportLimit = params.export || 20;

  return {
    mine: async ({ reportProgress }) => {
      reportProgress({ current: 0, total: mineLimit, message: '开始挖词' });
      return flowMine({ ...params, dataDir, runId, limit: mineLimit });
    },
    verify: async ({ reportProgress }) => {
      reportProgress({ current: 0, total: verifyLimit, message: '开始验真' });
      return flowVerify({ ...params, dataDir, runId, limit: verifyLimit });
    },
    generate: async ({ reportProgress }) => {
      reportProgress({ current: 0, total: generateLimit, message: '开始生成标题货源' });
      return flowGenerate({ ...params, dataDir, runId, limit: generateLimit });
    },
    export: async ({ reportProgress }) => {
      reportProgress({ current: 0, total: exportLimit, message: '开始导出清单' });
      return flowExport({ ...params, dataDir, runId, limit: exportLimit });
    },
    review: async ({ reportProgress }) => {
      reportProgress({ current: 1, total: 1, message: '等待人工复核' });
      return { status: 'needs_review' };
    },
    keyword: async ({ reportProgress }) => {
      reportProgress({ current: 0, total: 1, message: '开始精确关键词流程' });
      return flowKeyword({ ...params, dataDir, runId, keyword: params.keyword });
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
  const params = options.params || {};
  const mode = options.mode || 'daily';
  const injectedStepFns = options.stepFns || null;
  let runId = options.runId || createRunId();
  let runDir = runtimeRunDir(dataDir, runId);
  const steps = mode === 'keyword' && !injectedStepFns
    ? ['keyword']
    : (options.steps || DEFAULT_STEPS);
  const stepFns = injectedStepFns || createDefaultStepFns({ dataDir, runId, params });
  const existingRuntime = options.preserveRuntime
    ? readRuntimeState({ dataDir, runId })
    : null;
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
        progress
      }
    });
  } else {
    initRuntimeState({ dataDir, runId, steps });
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

      updateRuntimeState({
        dataDir,
        runId,
        patch: {
          progress: {
            [step]: completedProgress()
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
