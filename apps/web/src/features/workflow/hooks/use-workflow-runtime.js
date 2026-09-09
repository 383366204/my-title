import { useCallback, useEffect, useState } from 'react';

import { formatWorkflowProgressLabel, normalizeWorkflowProgressEvent } from '../workflow-node-view.js';
import {
  effectiveCanvasNodeId,
  getCanvasNodeState
} from '../workflow-data.js';
import { useWorkflowEvents } from './use-workflow-events.js';

const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled']);

/**
 * Extract runtime node status and output fields from node state.
 * @param {object} [state={}] Node state object.
 * @returns {object} Extracted node runtime fields.
 */
export function runtimeNodeFields(state = {}) {
  state = state || {};
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
    durationMs: state.durationMs ?? null,
    outputSummary: state.outputSummary || null,
    cooldownRemainingMs: state.cooldownRemainingMs || 0
  };
}

/**
 * Extract progress fields for canvas node patching.
 * @param {object} [currentData={}] Current node data.
 * @param {object} [progress={}] Progress object.
 * @returns {object} Progress fields patch object.
 */
export function progressNodeFields(currentData = {}, progress = {}) {
  const patch = {
    status: progress.status || currentData.status,
    progress: { ...currentData.progress, ...progress }
  };
  for (const field of ['blocker', 'actionHint', 'nextRecommendedAction', 'platformStatus', 'manualAction', 'cooldownRemainingMs']) {
    if (Object.hasOwn(progress, field)) patch[field] = progress[field];
  }
  return patch;
}

/**
 * Immutably patch data of a single canvas node.
 * @param {object} node React Flow node object.
 * @param {object} dataPatch Object containing node data properties to update.
 * @returns {object} Updated node object.
 */
export function patchCanvasNode(node, dataPatch) {
  if (!dataPatch) return node;
  return {
    ...node,
    data: {
      ...node.data,
      ...dataPatch
    }
  };
}

/**
 * Immutably update target node data by node ID in a list of canvas nodes.
 * @param {Array<object>} nodes Canvas nodes array.
 * @param {string} nodeId Target node ID.
 * @param {object} patchData Data patch object.
 * @returns {Array<object>} Updated canvas nodes array.
 */
export function updateNodeById(nodes, nodeId, patchData) {
  if (!nodeId) return nodes;
  return nodes.map((node) => (node.id === nodeId ? patchCanvasNode(node, patchData) : node));
}

/**
 * Own workflow runtime state and translate SSE events into canvas updates.
 * @param {object} options Runtime dependencies.
 * @param {Function} options.setNodes State setter for canvas nodes.
 * @param {Function} options.setSelectedNodeId State setter for selected node ID.
 * @param {Function} options.refreshHistory Function to refresh history list.
 * @returns {object} Runtime state and control callbacks.
 */
export function useWorkflowRuntime({ setNodes, setSelectedNodeId, refreshHistory }) {
  const [currentRunId, setCurrentRunId] = useState(null);
  const [runStatus, setRunStatus] = useState('idle');
  const [logs, setLogs] = useState([]);

  const syncNodeStates = useCallback((nodeStates = {}) => {
    setNodes((currentNodes) => currentNodes.map((node) => {
      const state = getCanvasNodeState(nodeStates, node.id);
      if (!state) return node;
      return patchCanvasNode(node, {
        ...runtimeNodeFields(state),
        onSelect: () => setSelectedNodeId(node.id)
      });
    }));
  }, [setNodes, setSelectedNodeId]);

  const handleRuntimeMessage = useCallback((data, connection) => {
    const payload = data.payload || {};
    if (payload.replay && !['log', 'progress'].includes(data.event)) return;
    if (data.event === 'init') {
      const { status, nodeStates } = payload;
      if (status) setRunStatus(status);
      syncNodeStates(nodeStates);
      return;
    }

    if (data.event === 'status_change') {
      // 追加日志中的状态事件不能抢先关闭连接，终态由同步快照后的通知确认。
      if (payload.eventId) return;
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
      setNodes((currentNodes) => updateNodeById(currentNodes, effectiveNodeId, runtimeNodeFields(state)));
      return;
    }

    if (data.event === 'log') {
      setLogs((previous) => [...previous, data.payload]);
      return;
    }

    if (data.event !== 'progress') return;
    const progress = normalizeWorkflowProgressEvent(data);
    const nodeId = effectiveCanvasNodeId(progress.step || progress.nodeId);
    if (nodeId && !payload.replay) {
      setNodes((currentNodes) => currentNodes.map((node) => (
        node.id === nodeId ? patchCanvasNode(node, progressNodeFields(node.data, progress)) : node
      )));
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
    onConnectionError: ({ reconnecting }) => {
      setLogs((previous) => [...previous, {
        timestamp: new Date().toISOString(),
        level: 'warn',
        message: reconnecting ? '运行连接中断，正在自动恢复。' : '运行连接已关闭，请重新打开运行历史以同步状态。'
      }]);
    },
    onReconnect: () => {
      setLogs((previous) => [...previous, {
        timestamp: new Date().toISOString(), level: 'info', message: '运行连接已恢复，正在同步最新状态。'
      }]);
    },
    onMalformedMessage: () => {
      setLogs((previous) => [...previous, {
        timestamp: new Date().toISOString(),
        level: 'warn',
        message: '收到无法识别的运行事件，已忽略。'
      }]);
    }
  });

  useEffect(() => {
    setNodes((currentNodes) => currentNodes.map((node) => patchCanvasNode(node, { workflowRunStatus: runStatus })));
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
