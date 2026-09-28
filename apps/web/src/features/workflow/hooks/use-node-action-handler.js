import { useCallback } from 'react';
import { getWorkflowOperationMessage } from '../workflow-node-actions.js';
import {
  getWorkflowCommandAction,
  getWorkflowActionRoute,
  WORKFLOW_ACTION_KINDS,
  WORKFLOW_OVERLAYS
} from '../workflow-action-registry.js';
import { controlDistributionRun } from '../../../api/distribution-api.js';

/**
 * Handles node action dispatch and artifact viewing for the workflow canvas.
 *
 * Routes actions to overlays, commands, or distribution control based on
 * the action registry. Manages the callback-ref bridge so that React Flow
 * nodes (created once during template/history loading) always invoke the
 * latest handler without requiring full canvas reconstruction.
 *
 * @param {object} options
 * @param {string|null} options.currentRunId
 * @param {string|null} options.selectedNodeId
 * @param {Function} options.setSelectedNodeId
 * @param {Function} options.setLogs
 * @param {Function} options.openOverlay From useWorkflowOverlay.
 * @param {Function} options.handleRunWorkflow From useWorkflowOperations.
 * @param {Function} options.runRemoteOperation From useWorkflowOperations.
 * @param {Function} options.updateDistributionNodeJob
 * @param {object[]} options.nodes Current canvas nodes.
 * @returns {{ handleNodeAction, handleViewNodeArtifact, retryWorkflowNode }}
 */
export function useNodeActionHandler({
  currentRunId,
  selectedNodeId,
  setSelectedNodeId,
  setLogs,
  openOverlay,
  handleRunWorkflow,
  runRemoteOperation,
  updateDistributionNodeJob,
  nodes
}) {
  const runWorkflowOperation = useCallback(async (action, nodeId = null) => {
    return runRemoteOperation(action, nodeId);
  }, [runRemoteOperation]);

  const handleNodeAction = useCallback(async (action, nodeId) => {
    if (action === 'launch-selection') {
      if (!currentRunId) return handleRunWorkflow();
      return;
    }
    const targetNodeId = nodeId || selectedNodeId;
    const route = getWorkflowActionRoute(action);
    if (targetNodeId) setSelectedNodeId(targetNodeId);
    if (route.kind === WORKFLOW_ACTION_KINDS.OVERLAY) {
      openOverlay(route.overlay, targetNodeId, { sourceAction: action });
      setLogs((prev) => [...prev, {
        timestamp: new Date().toISOString(),
        level: ['confirm-distribution', 'keyword-review', 'blocked'].includes(action) ? 'warn' : 'info',
        message: getWorkflowOperationMessage(action, 'success')
      }]);
      return;
    }
    if (route.kind === WORKFLOW_ACTION_KINDS.SELECT) {
      return;
    }
    if (action === 'pause-distribution') {
      const job = nodes.find((node) => node.id === nodeId)?.data?.distributionJob;
      if (!job?.jobId || job.status !== 'submitting' || job.requestedAction === 'pause') return;
      try {
        const nextJob = await controlDistributionRun(job.jobId, 'pause');
        updateDistributionNodeJob(nextJob);
        setLogs((prev) => [...prev, {
          timestamp: new Date().toISOString(),
          level: 'warn',
          message: '已请求暂停铺货：当前批次完成后将停止后续商品提交。'
        }]);
      } catch (error) {
        const message = `暂停铺货失败：${error.message}`;
        setLogs((prev) => [...prev, {
          timestamp: new Date().toISOString(),
          level: 'error',
          message
        }]);
        alert(message);
      }
      return;
    }
    return runWorkflowOperation(getWorkflowCommandAction(action), nodeId);
  }, [currentRunId, handleRunWorkflow, nodes, openOverlay, runWorkflowOperation, selectedNodeId, setSelectedNodeId, setLogs, updateDistributionNodeJob]);

  const handleViewNodeArtifact = useCallback((nodeId) => {
    setSelectedNodeId(nodeId);
    openOverlay(WORKFLOW_OVERLAYS.ARTIFACT, nodeId, { sourceAction: 'artifact' });
  }, [openOverlay, setSelectedNodeId]);

  const retryWorkflowNode = useCallback(async (nodeId) => {
    if (!currentRunId) return;
    await runWorkflowOperation('retry-node', nodeId);
  }, [currentRunId, runWorkflowOperation]);

  return { handleNodeAction, handleViewNodeArtifact, retryWorkflowNode };
}
