import { useEffect, useRef } from 'react';
import { MarkerType } from '@xyflow/react';
import { getWorkflowRun } from '../../../api/workflow-api.js';
import { getWorkflowRunActiveNodeId } from '../workflow-history-view.js';
import { runtimeNodeFields } from './use-workflow-runtime.js';
import { nodeTypes } from '../workflow-node-types.js';
import { ACTIVE_RUN_STATUSES, getCanvasNodeState, getTemplateMode, normalizeCanvasNode, normalizeWorkflowForCanvas, resetWorkflowNodeData } from '../workflow-data.js';

/**
 * 管理模板切换、历史载入与复制运行，隔离过期历史请求。
 * @param {object} options Canvas state and run dependencies.
 * @returns {object} Session actions.
 */
export function useWorkflowSession({
  nodes,
  edges,
  templates,
  activeTemplateMode,
  currentRunId,
  isRunActive,
  setNodes,
  setEdges,
  setSelectedNodeId,
  setActiveTemplateId,
  setActiveTemplateMode,
  setCurrentRunId,
  setRunStatus,
  setLogs,
  setArtifactState,
  disconnectRunEvents,
  listenToRunEvents,
  closeOverlay,
  dispatchNodeAction,
  dispatchNodeArtifactView,
  dispatchNodeUpdate,
  launchWorkflow,
  removeHistoryRun
}) {
  const initialTemplateLoadedRef = useRef(false);
  const historyRequestRef = useRef(0);
  const loadTemplate = (template) => {
    historyRequestRef.current++;
    disconnectRunEvents();
    const defaultWorkflow = normalizeWorkflowForCanvas(template?.workflow || { nodes: [], edges: [] });
    // 重置节点状态为 idle
    const formattedNodes = (defaultWorkflow.nodes || []).map(n => normalizeCanvasNode({
      ...n,
      data: {
        ...n.data,
        workflowReadOnly: false,
        status: 'idle',
        output: null,
        error: null
      }
    }, setSelectedNodeId, dispatchNodeAction, dispatchNodeArtifactView, nodeTypes, dispatchNodeUpdate));
    setNodes(formattedNodes);
    setEdges((defaultWorkflow.edges || []).map(e => ({
      ...e,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' },
      style: { stroke: '#3b82f6', strokeWidth: 2.5 }
    })));
    setActiveTemplateId(template?.id || null);
    setActiveTemplateMode(getTemplateMode(template));
    setSelectedNodeId(null);
    setRunStatus('idle');
    setCurrentRunId(null);
    setLogs([]);
    closeOverlay();
    setArtifactState({ status: 'empty', nodeId: null, artifact: null, error: '' });
  };


  const buildFreshRunNodes = (sourceNodes, override = null) => {
    const overrideNodeId = override?.nodeId || null;
    const overrideFields = override?.fields && typeof override.fields === 'object' ? override.fields : {};
    return sourceNodes.map((node) => normalizeCanvasNode({
      ...node,
      data: resetWorkflowNodeData(
        node.data,
        node.id === overrideNodeId ? overrideFields : {}
      )
    }, setSelectedNodeId, dispatchNodeAction, dispatchNodeArtifactView, nodeTypes, dispatchNodeUpdate));
  };


  const resetRunView = (freshNodes, selectedId, message) => {
    historyRequestRef.current++;
    disconnectRunEvents();
    setNodes(freshNodes);
    setCurrentRunId(null);
    setRunStatus('idle');
    setSelectedNodeId(selectedId);
    setLogs(message ? [{
      timestamp: new Date().toISOString(),
      level: 'info',
      message
    }] : []);
    closeOverlay();
    setArtifactState({ status: 'empty', nodeId: null, artifact: null, error: '' });
  };


  const prepareNewRunFromHistory = (override = null) => {
    const overrideNodeId = override?.nodeId || null;
    const freshNodes = buildFreshRunNodes(nodes, override);
    resetRunView(
      freshNodes,
      overrideNodeId || 'start',
      overrideNodeId
        ? '已基于历史配置新建流程，并更新采集条件。确认无误后即可运行。'
        : '已复制历史配置。请调整日期、页数或表格设置后运行。'
    );
  };


  const repeatWorkflow = async () => {
    if (isRunActive || nodes.length === 0) return false;
    const freshNodes = buildFreshRunNodes(nodes);
    resetRunView(freshNodes, 'start', '已按当前配置创建新运行。');
    return launchWorkflow({ workflowNodes: freshNodes, workflowEdges: edges });
  };


  const loadHistoryRun = async (runId, { preserveLogs = false } = {}) => {
    const request = ++historyRequestRef.current;
    try {
      disconnectRunEvents();
      setSelectedNodeId(null);
      if (!preserveLogs) setLogs([]);
      setRunStatus('pending');
      setCurrentRunId(runId);
      closeOverlay();

      const run = await getWorkflowRun(runId);
      if (request !== historyRequestRef.current) return;
      if (!run || typeof run !== 'object') {
        throw new Error('历史运行记录为空或已被删除');
      }
      const defaultWorkflow = normalizeWorkflowForCanvas(run.workflow || { nodes: [], edges: [] });

      setNodes((defaultWorkflow.nodes || []).map(n => {
        const state = getCanvasNodeState(run.nodeStates, n.id) || {};
        return normalizeCanvasNode({
          ...n,
          data: {
            ...resetWorkflowNodeData(n.data),
            ...runtimeNodeFields(state),
            workflowReadOnly: true,
            status: state.status || 'idle',
          }
        }, setSelectedNodeId, dispatchNodeAction, dispatchNodeArtifactView, nodeTypes, dispatchNodeUpdate);
      }));

      setEdges((defaultWorkflow.edges || []).map(e => ({
        ...e,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' },
        style: { stroke: '#3b82f6', strokeWidth: 2.5 }
      })));

      setCurrentRunId(runId);
      setRunStatus(run.status);
      const historyMode = run.workflow?.mode || run.mode || activeTemplateMode;
      const historyWorkflowId = defaultWorkflow.id || run.workflow?.id || '';
      const historyTemplate = templates.find((template) => template.id === historyWorkflowId)
        || templates.find((template) => template.mode === historyMode);
      setActiveTemplateId(historyTemplate?.id || historyWorkflowId || null);
      setActiveTemplateMode(historyMode);
      setSelectedNodeId(getWorkflowRunActiveNodeId(run));

      if (ACTIVE_RUN_STATUSES.has(String(run.status || '').toLowerCase())) {
        listenToRunEvents(runId);
      } else if (run.logs && !preserveLogs) {
        setLogs(run.logs);
      }
    } catch (err) {
      if (request !== historyRequestRef.current) return;
      console.error('加载历史记录失败', err);
      setCurrentRunId(null);
      setRunStatus('failed');
      setLogs([{
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `加载历史记录失败: ${err.message}`
      }]);
    }
  };


  const deleteHistoryRun = async (runId) => {
    const ok = window.confirm('确认删除这次运行历史？相关产物和日志也会一起删除，此操作不可撤销。');
    if (!ok) return;
    const request = historyRequestRef.current;
    try {
      await removeHistoryRun(runId);
      if (request === historyRequestRef.current && currentRunId === runId) {
        disconnectRunEvents();
        setCurrentRunId(null);
        setRunStatus('idle');
        setLogs([]);
        setSelectedNodeId(null);
        setArtifactState({ status: 'empty', nodeId: null, artifact: null, error: '' });
        if (templates[0]) loadTemplate(templates[0]);
      }
    } catch (err) {
      console.error('删除运行历史失败', err);
    }
  };


  const loadTemplateRef = useRef(loadTemplate);
  loadTemplateRef.current = loadTemplate;

  // 模板仅在首次加载时应用，之后由用户在画布左栏显式切换。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (initialTemplateLoadedRef.current || templates.length === 0) return;
    initialTemplateLoadedRef.current = true;
    loadTemplateRef.current(templates[0]);
  }, [templates]);

  useEffect(() => () => { historyRequestRef.current++; }, []);
  return { loadTemplate, prepareNewRunFromHistory, repeatWorkflow, loadHistoryRun, deleteHistoryRun };
}
