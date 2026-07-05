'use strict';

const { getRun, updateRun, addRunLog } = require('./run-store');
const { emitRunEvent } = require('./events');
const { getNodeDefinition } = require('./registry');
const { normalizeNodeProgress, normalizePlatformError } = require('./state-helper');

// 用于存储当前正在执行的 promise，便于取消或者跟踪
const activeRuns = new Map();

/**
 * 启动工作流运行
 * @param {string} runId 工作流运行 ID
 */
async function startWorkflow(runId) {
  const runObj = getRun(runId);
  if (!runObj) {
    throw new Error(`找不到工作流运行记录: ${runId}`);
  }

  if (runObj.status !== 'pending') {
    throw new Error(`工作流当前状态不能启动: ${runObj.status}`);
  }

  // 更新为 running 状态
  updateRun(runId, { status: 'running', startedAt: new Date().toISOString() });
  emitRunEvent(runId, 'status_change', { status: 'running' });

  const logger = {
    info: (msg) => {
      addRunLog(runId, 'info', msg);
      emitRunEvent(runId, 'log', { level: 'info', message: msg });
    },
    warn: (msg) => {
      addRunLog(runId, 'warn', msg);
      emitRunEvent(runId, 'log', { level: 'warn', message: msg });
    },
    error: (msg) => {
      addRunLog(runId, 'error', msg);
      emitRunEvent(runId, 'log', { level: 'error', message: msg });
    }
  };

  logger.info(`✨ 工作流启动成功 [RunId: ${runId}]`);

  const executionPromise = (async () => {
    try {
      await executeWorkflowGraph(runId, logger);
    } catch (err) {
      logger.error(`❌ 工作流运行异常终止: ${err.message}`);
      const isPlatformError = err.name === 'PlatformAccessError' ||
        err.status !== undefined ||
        err.cooldownRemainingMs !== undefined ||
        err.platform !== undefined;
      const runStatus = isPlatformError ? normalizePlatformError(err).status : 'failed';
      updateRun(runId, { status: runStatus, error: err.message });
      emitRunEvent(runId, 'status_change', { status: runStatus, error: err.message });
    } finally {
      activeRuns.delete(runId);
    }
  })();

  activeRuns.set(runId, executionPromise);
  return executionPromise;
}

/**
 * 取消正在运行的工作流
 * @param {string} runId 运行 ID
 */
function cancelWorkflow(runId) {
  const runObj = getRun(runId);
  if (!runObj) return false;

  if (runObj.status !== 'running' && runObj.status !== 'pending') {
    return false;
  }

  // 更新状态为 cancelled
  updateRun(runId, { status: 'cancelled', updatedAt: new Date().toISOString() });
  emitRunEvent(runId, 'status_change', { status: 'cancelled' });

  addRunLog(runId, 'warn', `🛑 工作流被用户取消。`);
  emitRunEvent(runId, 'log', { level: 'warn', message: `🛑 工作流被用户取消。` });

  return true;
}

/**
 * 执行工作流图（带依赖解析的拓扑执行器）
 */
async function executeWorkflowGraph(runId, logger) {
  // 获取最新状态
  let runObj = getRun(runId);
  const nodes = runObj.workflow.nodes || [];
  const edges = runObj.workflow.edges || [];

  // 构建依赖图
  // target -> inputs (sources)
  const inEdges = {};
  // source -> targets
  const outEdges = {};

  nodes.forEach(n => {
    inEdges[n.id] = [];
    outEdges[n.id] = [];
  });

  edges.forEach(e => {
    if (inEdges[e.target]) {
      inEdges[e.target].push(e.source);
    }
    if (outEdges[e.source]) {
      outEdges[e.source].push(e.target);
    }
  });

  // 记录节点的执行状态
  const nodeStates = runObj.nodeStates;

  // 待执行节点队列。初始时，入度为 0 且状态为 idle 的节点
  const queue = nodes.filter(n => inEdges[n.id].length === 0).map(n => n.id);

  while (queue.length > 0) {
    // 每次开始前检查工作流是否被取消
    runObj = getRun(runId);
    if (runObj.status === 'cancelled') {
      logger.warn('执行被取消，停止后续节点执行');
      return;
    }

    const nodeId = queue.shift();
    const node = nodes.find(n => n.id === nodeId);
    if (!node) continue;

    // 检查前置节点是否都已成功完成
    const parents = inEdges[nodeId];
    const anyParentFailed = parents.some(pId => nodeStates[pId]?.status === 'failed');
    if (anyParentFailed) {
      logger.error(`节点 [${node.data?.label || nodeId}] 无法执行，因为前置节点执行失败`);
      nodeStates[nodeId].status = 'failed';
      nodeStates[nodeId].error = '前置节点失败';
      updateRun(runId, { nodeStates });
      emitRunEvent(runId, 'node_change', { nodeId, state: nodeStates[nodeId] });
      throw new Error(`节点依赖未就绪: 前置节点执行失败`);
    }

    // 收集所有前驱节点的输出作为当前节点的输入
    const inputs = {};
    parents.forEach(pId => {
      const parentOutput = nodeStates[pId]?.output || {};
      Object.assign(inputs, parentOutput);
    });

    // 节点自身的 params
    const params = node.data || {};

    // 更新节点状态为 running，并重置相关的可观测状态
    nodeStates[nodeId].status = 'running';
    nodeStates[nodeId].startedAt = new Date().toISOString();
    nodeStates[nodeId].error = null;
    nodeStates[nodeId].progress = normalizeNodeProgress({ status: 'running', percent: 0, message: '开始执行' });
    nodeStates[nodeId].blocker = null;
    nodeStates[nodeId].actionHint = null;
    nodeStates[nodeId].platformStatus = null;
    nodeStates[nodeId].durationMs = null;
    nodeStates[nodeId].outputSummary = null;
    updateRun(runId, { nodeStates });
    emitRunEvent(runId, 'node_change', { nodeId, state: nodeStates[nodeId] });

    logger.info(`▶️ 开始执行节点: [${params.label || node.type}] (${nodeId})`);

    const nodeDef = getNodeDefinition(node.type);
    if (!nodeDef) {
      const errMsg = `未知的节点类型: ${node.type}`;
      nodeStates[nodeId].status = 'failed';
      nodeStates[nodeId].error = errMsg;
      nodeStates[nodeId].completedAt = new Date().toISOString();
      updateRun(runId, { nodeStates });
      emitRunEvent(runId, 'node_change', { nodeId, state: nodeStates[nodeId] });
      throw new Error(errMsg);
    }

    try {
      // 执行节点逻辑
      const output = await nodeDef.execute(inputs, params, { logger, runId });

      // 更新节点为 completed
      nodeStates[nodeId].status = 'completed';
      nodeStates[nodeId].output = output;
      nodeStates[nodeId].completedAt = new Date().toISOString();
      const durationMs = nodeStates[nodeId].startedAt ? (Date.now() - Date.parse(nodeStates[nodeId].startedAt)) : null;
      nodeStates[nodeId].durationMs = durationMs;
      nodeStates[nodeId].progress = normalizeNodeProgress({ status: 'completed', percent: 100, message: '执行完成' });

      let summaryStr = null;
      if (output) {
        if (typeof output === 'object') {
          const keys = Object.keys(output);
          if (keys.length === 1 && Array.isArray(output[keys[0]])) {
            summaryStr = `${keys[0]} ${output[keys[0]].length} 条`;
          } else {
            summaryStr = JSON.stringify(output);
            if (summaryStr.length > 60) {
              summaryStr = summaryStr.substring(0, 57) + '...';
            }
          }
        } else {
          summaryStr = String(output);
        }
      }
      nodeStates[nodeId].outputSummary = summaryStr;

      updateRun(runId, { nodeStates });
      emitRunEvent(runId, 'node_change', { nodeId, state: nodeStates[nodeId] });

      logger.info(`✅ 节点执行完成: [${params.label || node.type}]`);

      // 寻找下一个可以执行的节点
      const children = outEdges[nodeId];
      children.forEach(cId => {
        // 检查这个子节点的所有前驱是否都已完成
        const cParents = inEdges[cId];
        const allCompleted = cParents.every(pId => nodeStates[pId]?.status === 'completed');
        if (allCompleted && !queue.includes(cId) && nodeStates[cId].status === 'idle') {
          queue.push(cId);
        }
      });

    } catch (nodeErr) {
      logger.error(`❌ 节点执行错误 [${params.label || node.type}]: ${nodeErr.message}`);

      const isPlatformError = nodeErr.name === 'PlatformAccessError' ||
        nodeErr.status !== undefined ||
        nodeErr.cooldownRemainingMs !== undefined ||
        nodeErr.platform !== undefined;

      if (isPlatformError) {
        const norm = normalizePlatformError(nodeErr);
        nodeStates[nodeId].status = norm.status;
        nodeStates[nodeId].blocker = norm.blocker;
        nodeStates[nodeId].actionHint = norm.actionHint;
        nodeStates[nodeId].platformStatus = norm.platformStatus;
        if (norm.cooldownRemainingMs) {
          nodeStates[nodeId].cooldownRemainingMs = norm.cooldownRemainingMs;
        }
      } else {
        nodeStates[nodeId].status = 'failed';
      }

      nodeStates[nodeId].error = nodeErr.message;
      nodeStates[nodeId].completedAt = new Date().toISOString();
      const durationMs = nodeStates[nodeId].startedAt ? (Date.now() - Date.parse(nodeStates[nodeId].startedAt)) : null;
      nodeStates[nodeId].durationMs = durationMs;
      nodeStates[nodeId].progress = normalizeNodeProgress({
        status: nodeStates[nodeId].status,
        percent: 100,
        message: nodeStates[nodeId].status === 'retryable' ? '等待重试' : '执行中断'
      });

      updateRun(runId, { nodeStates });
      emitRunEvent(runId, 'node_change', { nodeId, state: nodeStates[nodeId] });
      throw nodeErr; // 抛出错误以终止整个工作流
    }
  }

  // 运行到这里代表所有节点都成功完成了
  updateRun(runId, { status: 'completed', updatedAt: new Date().toISOString() });
  emitRunEvent(runId, 'status_change', { status: 'completed' });
  logger.info(`🎉 工作流全部节点执行完毕！[RunId: ${runId}]`);
}

module.exports = {
  startWorkflow,
  cancelWorkflow
};
