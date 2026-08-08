import { useCallback } from 'react';

import {
  buildWorkflowOperationRequest,
  getWorkflowOperationMessage
} from '../../../workflow-ui.js';
import {
  cancelWorkflow,
  runWorkflowOperation as requestWorkflowOperation
} from '../../../api/workflow-api.js';

/**
 * Hook for managing in-flight workflow operations (cancel, pause, resume, retry, node actions).
 * @param {object} [options={}] Command options and state callbacks.
 * @param {boolean} [options.canCancelRun] Whether current run can be cancelled.
 * @param {string} [options.currentRunId] Current active run ID.
 * @param {Function} [options.reloadRun] Function to reload run data.
 * @param {string} [options.selectedNodeId] Selected node ID on canvas.
 * @param {Function} [options.setLogs] State setter for log entries.
 * @param {Function} [options.setNodes] State setter for canvas nodes.
 * @param {Function} [options.setRunStatus] State setter for run status.
 * @returns {{ handleCancelWorkflow: Function, runRemoteOperation: Function }} Command handlers.
 */
export function useWorkflowCommands(options = {}) {
  const {
    canCancelRun = false,
    currentRunId = null,
    reloadRun = async () => {},
    selectedNodeId = null,
    setLogs = () => {},
    setNodes = () => {},
    setRunStatus = () => {}
  } = options || {};

  const handleCancelWorkflow = useCallback(async () => {
    if (!canCancelRun) return;
    try {
      await cancelWorkflow(currentRunId);
      setLogs((previous) => [...previous, {
        timestamp: new Date().toISOString(),
        level: 'warn',
        message: '已请求取消，当前步骤会在安全边界停止。'
      }]);
    } catch (error) {
      console.error('取消工作流失败', error);
      setLogs((previous) => [...previous, {
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `取消请求失败: ${error.message}`
      }]);
    }
  }, [canCancelRun, currentRunId, setLogs]);

  const runRemoteOperation = useCallback(async (action, nodeId = null) => {
    const targetNodeId = nodeId || selectedNodeId;
    const operationNodeId = action === 'mine-more' ? 'mine' : targetNodeId;
    if (!currentRunId && action !== 'start-sycm-chrome') {
      const message = '当前没有可操作的运行记录，请重新选择运行历史后再试。';
      setLogs((previous) => [...previous, {
        timestamp: new Date().toISOString(),
        level: 'error',
        message
      }]);
      alert(message);
      return;
    }

    const { endpoint, body } = buildWorkflowOperationRequest(currentRunId, action, operationNodeId);
    const pendingMessage = action === 'mine-more'
      ? '正在补充候选词…'
      : action === 'retry-node'
        ? '正在提交重跑验真请求…'
        : action === 'resume'
          ? '正在恢复流程…'
          : action === 'pause'
            ? '正在提交暂停请求…'
            : action === 'start-sycm-chrome'
              ? '正在启动 Chrome 并打开生意参谋…'
              : '';

    if (operationNodeId && pendingMessage) {
      setNodes((currentNodes) => currentNodes.map((node) => (
        node.id === operationNodeId || (action === 'mine-more' && node.id === targetNodeId)
          ? {
              ...node,
              data: {
                ...node.data,
                status: (action === 'retry-node' || (action === 'mine-more' && node.id === operationNodeId)) ? 'retrying' : node.data.status,
                pendingAction: action,
                operationMessage: pendingMessage,
                blocker: action === 'retry-node' || action === 'mine-more' ? null : node.data.blocker,
                actionHint: action === 'retry-node' || action === 'mine-more' ? null : node.data.actionHint,
                nextRecommendedAction: action === 'retry-node' || action === 'mine-more' ? null : node.data.nextRecommendedAction
              }
            }
          : node
      )));
    }
    if (action === 'retry-node' || action === 'mine-more') setRunStatus('retrying');
    if (action === 'resume') setRunStatus('resuming');

    try {
      const operationResult = await requestWorkflowOperation(endpoint, body);
      const message = getWorkflowOperationMessage(action, operationResult);
      setLogs((previous) => [...previous, {
        timestamp: new Date().toISOString(),
        level: 'info',
        message
      }]);
      if (action === 'start-sycm-chrome') {
        setNodes((currentNodes) => currentNodes.map((node) => (
          node.id === targetNodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  pendingAction: null,
                  operationMessage: message,
                  chromeStartMessage: message
                }
              }
            : node
        )));
        alert(message);
      }
      if (currentRunId) await reloadRun(currentRunId, { preserveLogs: true });
    } catch (error) {
      const message = getWorkflowOperationMessage(action, 'error', error.message);
      if (currentRunId) await reloadRun(currentRunId, { preserveLogs: true });
      if (operationNodeId) {
        setNodes((currentNodes) => currentNodes.map((node) => (
          node.id === operationNodeId || (action === 'mine-more' && node.id === targetNodeId)
            ? { ...node, data: { ...node.data, pendingAction: null, operationMessage: message } }
            : node
        )));
      }
      setLogs((previous) => [...previous, {
        timestamp: new Date().toISOString(),
        level: 'error',
        message
      }]);
      alert(message);
      console.error(error);
    }
  }, [
    currentRunId,
    reloadRun,
    selectedNodeId,
    setLogs,
    setNodes,
    setRunStatus
  ]);

  return { handleCancelWorkflow, runRemoteOperation };
}
