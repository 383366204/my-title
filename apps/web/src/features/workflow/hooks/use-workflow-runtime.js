import { useCallback, useEffect, useState } from 'react';

import {
  formatWorkflowProgressLabel,
  normalizeWorkflowProgressEvent
} from '../../../workflow-ui.js';
import {
  effectiveCanvasNodeId,
  getCanvasNodeState
} from '../workflow-data.js';
import { useWorkflowEvents } from './use-workflow-events.js';

const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function runtimeNodeFields(state = {}) {
  return {
    status: state.status,
    output: state.output,
    error: state.error,
    progress: state.progress || null,
    blocker: state.blocker || null,
    actionHint: state.actionHint || null,
    nextRecommendedAction: state.nextRecommendedAction || null,
    platformStatus: state.platformStatus || null,
    manualAction: state.manualAction || null,
    durationMs: state.durationMs || null,
    outputSummary: state.outputSummary || null,
    cooldownRemainingMs: state.cooldownRemainingMs || 0
  };
}

/**
 * Own workflow runtime state and translate SSE events into canvas updates.
 * @param {object} options Runtime dependencies.
 * @param {Function} options.setNodes React Flow node setter.
 * @param {Function} options.setSelectedNodeId Selected-node setter.
 * @param {Function} options.refreshHistory Refresh persisted run history.
 * @returns {object} Runtime state, setters, and event connection controls.
 */
export function useWorkflowRuntime({ setNodes, setSelectedNodeId, refreshHistory }) {
  const [currentRunId, setCurrentRunId] = useState(null);
  const [runStatus, setRunStatus] = useState('idle');
  const [logs, setLogs] = useState([]);

  const syncNodeStates = useCallback((nodeStates = {}) => {
    setNodes((currentNodes) => currentNodes.map((node) => {
      const state = getCanvasNodeState(nodeStates, node.id);
      if (!state) return node;
      return {
        ...node,
        data: {
          ...node.data,
          ...runtimeNodeFields(state),
          onSelect: () => setSelectedNodeId(node.id)
        }
      };
    }));
  }, [setNodes, setSelectedNodeId]);

  const handleRuntimeMessage = useCallback((data, connection) => {
    const payload = data.payload || {};
    if (data.event === 'init') {
      const { status, nodeStates } = payload;
      if (status) setRunStatus(status);
      syncNodeStates(nodeStates);
      return;
    }

    if (data.event === 'status_change') {
      const { status } = payload;
      if (status) setRunStatus(status);
      if (TERMINAL_RUN_STATUSES.has(status)) {
        connection.disconnect();
        refreshHistory?.();
      }
      return;
    }

    if (data.event === 'node_change') {
      const { nodeId, state } = payload;
      const effectiveNodeId = effectiveCanvasNodeId(nodeId);
      setNodes((currentNodes) => currentNodes.map((node) => (
        node.id === effectiveNodeId
          ? { ...node, data: { ...node.data, ...runtimeNodeFields(state) } }
          : node
      )));
      return;
    }

    if (data.event === 'log') {
      setLogs((previous) => [...previous, data.payload]);
      setTimeout(() => {
        const consoleElement = document.getElementById('console-terminal');
        if (consoleElement) consoleElement.scrollTop = consoleElement.scrollHeight;
      }, 50);
      return;
    }

    if (data.event !== 'progress') return;
    const progress = normalizeWorkflowProgressEvent(data);
    const nodeId = effectiveCanvasNodeId(progress.step || progress.nodeId);
    if (nodeId && !payload.replay) {
      setNodes((currentNodes) => currentNodes.map((node) => {
        if (node.id !== nodeId) return node;
        return {
          ...node,
          data: {
            ...node.data,
            status: progress.status || node.data.status,
            progress,
            blocker: progress.blocker || node.data.blocker || null,
            actionHint: progress.actionHint || node.data.actionHint || null,
            nextRecommendedAction: progress.nextRecommendedAction || node.data.nextRecommendedAction || null,
            platformStatus: progress.platformStatus || node.data.platformStatus || null,
            manualAction: progress.manualAction || node.data.manualAction || null,
            cooldownRemainingMs: progress.cooldownRemainingMs || node.data.cooldownRemainingMs || 0
          }
        };
      }));
    }
    const message = progress.message || formatWorkflowProgressLabel(progress);
    if (message) {
      setLogs((previous) => [...previous, {
        timestamp: progress.timestamp || new Date().toISOString(),
        level: 'info',
        message: `[progress:${nodeId || 'workflow'}] ${message}`
      }]);
    }
  }, [refreshHistory, setNodes, syncNodeStates]);

  const { connect: listenToRunEvents, disconnect: disconnectRunEvents } = useWorkflowEvents({
    onMessage: handleRuntimeMessage,
    onMalformedMessage: () => {
      setLogs((previous) => [...previous, {
        timestamp: new Date().toISOString(),
        level: 'warn',
        message: '收到无法识别的运行事件，已忽略。'
      }]);
    }
  });

  useEffect(() => {
    setNodes((currentNodes) => currentNodes.map((node) => ({
      ...node,
      data: { ...node.data, workflowRunStatus: runStatus }
    })));
  }, [runStatus, setNodes]);

  return {
    currentRunId,
    disconnectRunEvents,
    listenToRunEvents,
    logs,
    runStatus,
    setCurrentRunId,
    setLogs,
    setRunStatus,
    syncNodeStates
  };
}
