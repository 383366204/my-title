import { useCallback, useRef } from 'react';

import {
  getWorkflowLaunchParams,
  getWorkflowLaunchBlocker
} from '../../../workflow-ui.js';
import {
  startWorkflow,
  validateWorkflow
} from '../../../api/workflow-api.js';

/**
 * Pure helper to build workflow definition payload for validation and start APIs.
 * @param {Array} nodes React Flow nodes.
 * @param {Array} edges React Flow edges.
 * @returns {object} Standardized workflow definition.
 */
export function buildWorkflowDefinition(nodes = [], edges = []) {
  return {
    nodes: (nodes || []).map((node) => ({
      id: node.id,
      type: node.data?.originalType || node.type,
      position: node.position,
      data: node.data
    })),
    edges: (edges || []).map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target
    }))
  };
}

/**
 * Hook for workflow launch validation and execution.
 * @param {object} [options={}] Launch options and state callbacks.
 * @param {string} [options.activeTemplateId] Active workflow template ID.
 * @param {string} [options.activeTemplateMode] Active workflow mode ('manual' | 'production').
 * @param {Array} [options.edges] Canvas edges.
 * @param {Function} [options.listenToRunEvents] Function to subscribe to SSE events for a run.
 * @param {Array} [options.nodes] Canvas nodes.
 * @param {Function} [options.refreshHistory] Function to refresh run history list.
 * @param {string} [options.runStatus] Current workflow run status.
 * @param {Function} [options.setCurrentRunId] State setter for current run ID.
 * @param {Function} [options.setLogs] State setter for log entries.
 * @param {Function} [options.setRunStatus] State setter for run status.
 * @returns {{ handleRunWorkflow: Function }} Object containing handleRunWorkflow callback.
 */
export function useWorkflowLaunch(options = {}) {
  const {
    activeTemplateId = '',
    activeTemplateMode = 'production',
    edges = [],
    listenToRunEvents = () => {},
    nodes = [],
    refreshHistory = async () => {},
    runStatus = 'idle',
    setCurrentRunId = () => {},
    setLogs = () => {},
    setRunStatus = () => {}
  } = options || {};
  const launchingRef = useRef(false);

  const launchWorkflow = useCallback(async ({ workflowNodes = nodes, workflowEdges = edges } = {}) => {
    if (runStatus === 'running' || launchingRef.current) return false;
    launchingRef.current = true;

    try {
      setLogs([]);
      setRunStatus('pending');
      const launchBlocker = getWorkflowLaunchBlocker(activeTemplateMode, workflowNodes);
      if (launchBlocker) {
        setRunStatus(launchBlocker.status);
        setLogs(launchBlocker.logs);
        setCurrentRunId(null);
        return false;
      }

      const workflowDef = buildWorkflowDefinition(workflowNodes, workflowEdges);
      const params = getWorkflowLaunchParams(workflowNodes);

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
          return false;
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
      return true;
    } catch (error) {
      alert(`启动请求失败: ${error.message}`);
      setRunStatus('failed');
      return false;
    } finally {
      launchingRef.current = false;
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

  const handleRunWorkflow = useCallback(() => launchWorkflow(), [launchWorkflow]);

  return { handleRunWorkflow, launchWorkflow };
}
