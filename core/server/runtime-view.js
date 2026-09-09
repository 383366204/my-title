'use strict';

/**
 * 创建运行摘要与画布快照适配器。
 * @param {object} deps 请求时读取的运行状态或平台状态依赖。
 * @returns {object} 共享适配方法。
 */
function createRuntimeView({ readRuntimeState, summarizePipelineRun, getWorkflowRun, WORKFLOW_NODE_IDS }) {
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

  return { pipelineRunResponse, withPipelineRuntimeFields, runtimeOnlyWorkflowSnapshot };
}

module.exports = { createRuntimeView };
