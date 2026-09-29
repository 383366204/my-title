import { useCallback } from 'react';

/**
 * Provides node data update functions for the workflow canvas.
 *
 * Handles single-field and batch-field updates with special cases for
 * the start node (selection mode switching, read-only guards, history
 * parameter changes that trigger new runs).
 *
 * @param {object} options
 * @param {Function} options.setNodes React Flow setNodes setter.
 * @param {Function} options.switchSelectionMode From useWorkflowSession.
 * @param {Function} options.prepareNewRunFromHistory From useWorkflowSession.
 * @param {Function} options.setRunStatus From useWorkflowRuntime.
 * @param {string|null} options.currentRunId Current active run ID.
 * @param {string|null} options.activeTemplateId Current template ID.
 * @returns {{ updateNodeData: Function, updateNodeFields: Function }}
 */
export function useNodeDataUpdater({
  setNodes,
  switchSelectionMode,
  prepareNewRunFromHistory,
  setRunStatus,
  currentRunId,
  activeTemplateId
}) {
  const updateNodeData = useCallback((nodeId, field, value) => {
    if (nodeId === 'start' && field === 'selectionMode') {
      switchSelectionMode(value);
      return;
    }
    if (currentRunId && nodeId === 'start' && activeTemplateId === 'selection-v1') return;
    if (currentRunId && nodeId === 'start' && ['dateMode', 'pages'].includes(field)) {
      prepareNewRunFromHistory({ nodeId, fields: { [field]: value } });
      return;
    }
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === nodeId) {
          return { ...node, data: { ...node.data, [field]: value } };
        }
        return node;
      })
    );
  }, [activeTemplateId, currentRunId, prepareNewRunFromHistory, setNodes, switchSelectionMode]);

  const updateNodeFields = useCallback((nodeId, fields) => {
    if (currentRunId && nodeId === 'start' && activeTemplateId === 'selection-v1') return;
    if (!currentRunId && nodeId === 'start' && activeTemplateId === 'selection-v1') {
      fields = { ...fields, status: 'idle', error: null, blocker: null };
      setRunStatus('idle');
    }
    setNodes((currentNodes) => currentNodes.map((node) => (
      node.id === nodeId ? { ...node, data: { ...node.data, ...fields } } : node
    )));
  }, [activeTemplateId, currentRunId, setNodes, setRunStatus]);

  return { updateNodeData, updateNodeFields };
}
