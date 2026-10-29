'use strict';

const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DEFAULT_FLOW_DIR, initRun, getRun } = require('../../pipeline-flow/src/run-store');
const {
  initRuntimeState,
  readRuntimeState,
  updateRuntimeState,
  readRuntimeControl,
  requestRuntimeCancel
} = require('../../pipeline-flow/runtime/store');
const { runPipelineRuntime, getPeerSteps } = require('../../pipeline-flow/runtime/runner');
const { normalizePeerDiscoveryParams } = require('./params');

/**
 * Initialize a peer discovery task with durable run and runtime records.
 * @param {object} rawParams Raw user parameters.
 * @param {object} [options] Custom dataDir, taskId, runner.
 * @returns {Promise<object>} Initialized task descriptor.
 */
async function initializePeerTask(rawParams = {}, options = {}) {
  const dataDir = options.dataDir || DEFAULT_FLOW_DIR;
  const taskId = options.taskId || `peer_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const params = normalizePeerDiscoveryParams(rawParams);
  const steps = getPeerSteps(params);

  // 1. 初始化业务 run.json 和产物索引
  initRun({
    dataDir,
    runId: taskId,
    options: {
      mode: 'peer-discovery',
      ...params
    }
  });

  // 2. 初始化执行 runtime.json
  const runtime = initRuntimeState({
    dataDir,
    runId: taskId,
    steps,
    mode: 'peer-discovery',
    params
  });

  // 标记为 queued
  const queuedRuntime = updateRuntimeState({
    dataDir,
    runId: taskId,
    patch: { status: 'queued' }
  });

  return {
    taskId,
    runId: taskId,
    dataDir,
    params,
    steps,
    runtime: queuedRuntime || { ...runtime, status: 'queued' }
  };
}

/**
 * Enqueue an initialized peer discovery task for background execution.
 * @param {object} task Task descriptor returned by initializePeerTask.
 * @param {object} [options]
 * @returns {Promise<void>}
 */
async function enqueuePeerTask(task, options = {}) {
  if (!task || !task.taskId) throw new Error('任务描述符无效');
  const dataDir = task.dataDir || DEFAULT_FLOW_DIR;

  try {
    // 异步后台派发，不阻塞当前调用
    setImmediate(async () => {
      try {
        await runPipelineRuntime({
          dataDir,
          runId: task.taskId,
          mode: 'peer-discovery',
          steps: task.steps,
          params: task.params,
          preserveRuntime: true
        });
      } catch (err) {
        try {
          updateRuntimeState({
            dataDir,
            runId: task.taskId,
            patch: {
              status: 'failed',
              error: err?.message || String(err),
              finishedAt: new Date().toISOString()
            }
          });
        } catch (_) {}
      }
    });
  } catch (error) {
    updateRuntimeState({
      dataDir,
      runId: task.taskId,
      patch: { status: 'failed', error: error.message }
    });
    throw error;
  }
}

/**
 * Require a published peer task. Throws not_found or state_corrupt.
 * @param {string} taskId
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function requirePublishedPeerTask(taskId, options = {}) {
  if (!taskId || typeof taskId !== 'string') {
    const err = new Error('无效的任务 ID');
    err.code = 'INVALID_TASK_ID';
    err.status = 400;
    throw err;
  }
  const dataDir = options.dataDir || DEFAULT_FLOW_DIR;
  const runtime = readRuntimeState({ dataDir, runId: taskId });

  if (!runtime) {
    const err = new Error(`未找到任务: ${taskId}`);
    err.code = 'TASK_NOT_FOUND';
    err.status = 404;
    err.notFound = true;
    throw err;
  }

  if (!runtime.status || !Array.isArray(runtime.steps)) {
    const err = new Error(`任务状态文件损坏: ${taskId}`);
    err.code = 'STATE_CORRUPT';
    err.status = 500;
    throw err;
  }

  return {
    taskId,
    dataDir,
    runtime
  };
}

/**
 * Read the current formatted progress snapshot of a peer discovery task.
 * @param {object|string} taskOrId Task descriptor or taskId.
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function readPeerTaskStatus(taskOrId, options = {}) {
  const taskId = typeof taskOrId === 'string' ? taskOrId : taskOrId?.taskId;
  const published = await requirePublishedPeerTask(taskId, options);
  const dataDir = published.dataDir;
  const runtime = readRuntimeState({ dataDir, runId: taskId }) || published.runtime;
  const control = readRuntimeControl({ dataDir, runId: taskId }) || {};

  const isCancelling = (runtime.status === 'running' || runtime.status === 'resuming') &&
    control.requestedAction === 'cancel';

  const snapshot = {
    taskId,
    status: isCancelling ? 'cancelling' : runtime.status,
    activeStep: runtime.activeStep,
    discoveryBranch: runtime.params?.discoveryBranch || 'peer-analysis',
    steps: runtime.steps,
    progress: runtime.progress,
    startedAt: runtime.startedAt,
    updatedAt: runtime.updatedAt,
    manualAction: runtime.manualAction || null,
    error: runtime.error || null
  };

  return snapshot;
}

/**
 * Request cancellation of an active or queued peer discovery task.
 * @param {string} taskId
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function requestPeerTaskCancel(taskId, options = {}) {
  const published = await requirePublishedPeerTask(taskId, options);
  const dataDir = published.dataDir;
  const runtime = readRuntimeState({ dataDir, runId: taskId }) || published.runtime;

  // 已处于终态的任务直接返回已有终态，不修改控制文件
  if (['completed', 'failed', 'cancelled'].includes(runtime.status)) {
    return await readPeerTaskStatus(taskId, options);
  }

  // queued 任务直接标记为 cancelled
  if (runtime.status === 'queued') {
    updateRuntimeState({
      dataDir,
      runId: taskId,
      patch: { status: 'cancelled' }
    });
    return await readPeerTaskStatus(taskId, options);
  }

  // 运行中的任务发出取消信号
  requestRuntimeCancel({ dataDir, runId: taskId, reason: 'user_cancelled' });
  return await readPeerTaskStatus(taskId, options);
}

module.exports = {
  initializePeerTask,
  enqueuePeerTask,
  requirePublishedPeerTask,
  readPeerTaskStatus,
  requestPeerTaskCancel
};
