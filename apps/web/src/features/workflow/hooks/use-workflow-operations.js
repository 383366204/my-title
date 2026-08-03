import { useCallback } from 'react';

import {
  buildWorkflowOperationRequest,
  getWorkflowLaunchParams,
  getWorkflowLaunchBlocker,
  getWorkflowOperationMessage
} from '../../../workflow-ui.js';
import {
  cancelWorkflow,
  runWorkflowOperation as requestWorkflowOperation,
  startWorkflow,
  validateWorkflow
} from '../../../api/workflow-api.js';

/**
 * Own remote workflow commands while the studio keeps local panel interactions.
 * @param {object} options Operation dependencies and current workflow state.
 * @returns {object} Start, cancel, and node-operation callbacks.
 */
export function useWorkflowOperations(options) {
  const {
    activeTemplateId,
    activeTemplateMode,
    canCancelRun,
    currentRunId,
    edges,
    listenToRunEvents,
    nodes,
    refreshHistory,
    reloadRun,
    runStatus,
    selectedNodeId,
    setCurrentRunId,
    setLogs,
    setNodes,
    setRunStatus
  } = options;

  const handleRunWorkflow = useCallback(async () => {
    if (runStatus === 'running') return;

    setLogs([]);
    setRunStatus('pending');
    const launchBlocker = getWorkflowLaunchBlocker(activeTemplateMode, nodes);
    if (launchBlocker) {
      setRunStatus(launchBlocker.status);
      setLogs(launchBlocker.logs);
      setCurrentRunId(null);
      return;
    }

    const workflowDef = {
      nodes: nodes.map((node) => ({
        id: node.id,
        type: node.data?.originalType || node.type,
        position: node.position,
        data: node.data
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target
      }))
    };
    const params = getWorkflowLaunchParams(nodes);

    try {
      const validationPayload = await validateWorkflow({
        templateId: activeTemplateId,
        mode: activeTemplateMode,
        params,
        workflow: workflowDef
      });
      if (validationPayload.ok === false) {
        const errors = validationPayload.data?.errors || [{ message: validationPayload.error || '工作流校验失败' }];
        const typeOnlyErrors = errors.filter((error) => String(error.code || error.message || '').toLowerCase().includes('type'));
        if (typeOnlyErrors.length !== errors.length || !activeTemplateId) {
          setRunStatus('failed');
          setLogs(errors.map((error) => ({
            timestamp: new Date().toISOString(),
            level: 'error',
            message: `[${error.code || 'validation_error'}] ${error.message}`
          })));
          return;
        }
        setLogs(errors.map((error) => ({
          timestamp: new Date().toISOString(),
          level: 'warn',
          message: `[${error.code || 'production_validate'}] ${error.message}`
        })));
      }

      const data = await startWorkflow({
        templateId: activeTemplateId,
        mode: activeTemplateMode,
        params,
        workflow: workflowDef
      });
      const runId = data.runId || null;
      const message = data.message || '工作流已提交。';
      setCurrentRunId(runId);
      setLogs((previous) => [...previous, {
        timestamp: new Date().toISOString(),
        level: runId ? 'info' : 'warn',
        message
      }]);
      if (runId) {
        setRunStatus('running');
        listenToRunEvents(runId);
      } else {
        setRunStatus('completed');
        await refreshHistory();
      }
    } catch (error) {
      alert(`启动请求失败: ${error.message}`);
      setRunStatus('failed');
    }
  }, [
    activeTemplateId,
    activeTemplateMode,
    edges,
    listenToRunEvents,
    nodes,
    refreshHistory,
    runStatus,
    setCurrentRunId,
    setLogs,
    setRunStatus
  ]);

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

  return { handleCancelWorkflow, handleRunWorkflow, runRemoteOperation };
}
