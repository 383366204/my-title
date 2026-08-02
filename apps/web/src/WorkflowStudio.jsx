import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { MarkerType, useEdgesState, useNodesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './App.css';
import {
  formatWorkflowProgressLabel,
  getStartNodeParams,
  buildWorkflowOperationRequest,
  getWorkflowLaunchBlocker,
  getWorkflowOperationMessage,
  getWorkflowRunActiveNodeId,
  getWorkflowTemplateView,
  normalizeWorkflowProgressEvent
} from './workflow-ui.js';
import {
  cancelWorkflow,
  confirmKeywordReview as confirmKeywordReviewRequest,
  confirmProductReview as confirmProductReviewRequest,
  getWorkflowArtifact,
  getWorkflowRun,
  runWorkflowOperation as requestWorkflowOperation,
  startWorkflow,
  validateWorkflow,
} from './api/workflow-api.js';
import { useNodeArtifact } from './features/workflow/hooks/use-node-artifact.js';
import { useWorkflowEvents } from './features/workflow/hooks/use-workflow-events.js';
import { useWorkflowRunCatalog } from './features/workflow/hooks/use-workflow-run-catalog.js';
import { useSeedMiner } from './features/workflow/hooks/use-seed-miner.js';
import { useTitleGeneration } from './features/workflow/hooks/use-title-generation.js';
import { WorkflowConsole } from './features/workflow/components/workflow-console.jsx';
import { WorkflowLeftSidebar } from './features/workflow/components/workflow-left-sidebar.jsx';
import { WorkflowCanvasWorkspace } from './features/workflow/components/workflow-canvas-workspace.jsx';
import { WorkflowRightSidebar } from './features/workflow/components/workflow-right-sidebar.jsx';
import { ManualWorkflowInputPanel } from './features/workflow/components/manual-workflow-input-panel.jsx';
import { nodeTypes } from './features/workflow/workflow-node-types.js';
import { artifactItems, candidateKeyword } from './features/workflow/workflow-data.js';
import { controlDistributionRun } from './api/distribution-api.js';

function copyText(value) {
  const text = String(value || '');
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    if (typeof document.execCommand === 'function' && document.execCommand('copy')) return Promise.resolve();
  } finally {
    textarea.remove();
  }

  if (navigator?.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return Promise.reject(new Error('当前浏览器不支持复制，请升级浏览器后重试。'));
}

const DEFAULT_WORKFLOW_MODE = 'daily';
const ACTIVE_RUN_STATUSES = new Set(['pending', 'running', 'created', 'mined', 'verified', 'products_selected', 'generated', 'resuming', 'retrying', 'awaiting_keyword_review', 'awaiting_product_review']);
const shouldCollapseSidebarInitially = () => (
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(max-width: 980px)').matches
);

const unwrapApiData = (payload) => payload?.data || payload || {};

const normalizeTemplateList = (payload) => {
  const data = unwrapApiData(payload);
  const rawTemplates = Array.isArray(data)
    ? data
    : data?.templates || data?.items || data?.workflows || [];
  return Array.isArray(rawTemplates)
    ? rawTemplates.filter((template) => template?.workflow?.nodes && template?.workflow?.edges)
    : [];
};

const normalizeRunList = (payload) => {
  const data = unwrapApiData(payload);
  const rawRuns = Array.isArray(data)
    ? data
    : data?.runs || data?.items || data?.history || [];
  return Array.isArray(rawRuns) ? rawRuns : [];
};

const getTemplateMode = (template) => template?.mode || template?.workflow?.mode || DEFAULT_WORKFLOW_MODE;

const normalizeCanvasNode = (node, selectNode, actionHandler, artifactHandler) => {
  const renderType = nodeTypes[node.type] ? node.type : 'task';
  return {
    ...node,
    type: renderType,
    data: {
      ...node.data,
      id: node.id,
      originalType: node.data?.originalType || node.type,
      status: node.data?.status || 'idle',
      output: node.data?.output || null,
      error: node.data?.error || null,
      progress: node.data?.progress || null,
      blocker: node.data?.blocker || null,
      actionHint: node.data?.actionHint || null,
      nextRecommendedAction: node.data?.nextRecommendedAction || null,
      platformStatus: node.data?.platformStatus || null,
      manualAction: node.data?.manualAction || null,
      durationMs: node.data?.durationMs || null,
      outputSummary: node.data?.outputSummary || null,
      cooldownRemainingMs: node.data?.cooldownRemainingMs || 0,
      workflowRunStatus: node.data?.workflowRunStatus || 'idle',
      onSelect: () => selectNode(node.id),
      onAction: (action) => actionHandler?.(action, node.id),
      onViewArtifact: () => artifactHandler?.(node.id)
    }
  };
};

const normalizeWorkflowForCanvas = (workflow = {}) => {
  const rawNodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const rawEdges = Array.isArray(workflow.edges) ? workflow.edges : [];
  const nodes = rawNodes
    .filter((node) => node?.id !== 'review')
    .map((node, index, visibleNodes) => ({
      ...node,
      data: {
        ...node.data,
        stepIndex: index + 1,
        stepTotal: visibleNodes.length
      }
    }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = rawEdges.filter((edge) => (
    edge?.source !== 'review'
    && edge?.target !== 'review'
    && nodeIds.has(edge?.source)
    && nodeIds.has(edge?.target)
  ));
  if (nodeIds.has('export') && nodeIds.has('end') && !edges.some((edge) => edge.source === 'export' && edge.target === 'end')) {
    edges.push({ id: 'export-end', source: 'export', target: 'end', type: 'straight' });
  }
  return { ...workflow, nodes, edges };
};

const effectiveCanvasNodeId = (nodeId) => (nodeId === 'review' ? 'export' : nodeId);

const shouldPreferLegacyReviewState = (state = {}) => {
  const status = String(state.status || state.state || '').toLowerCase();
  return ['blocked', 'failed', 'retryable', 'waiting_manual', 'paused', 'needs_review', 'waiting_confirmation', 'running', 'resuming', 'retrying'].includes(status);
};

const mergeCanvasNodeState = (primary = {}, legacyReview = {}) => {
  if (!legacyReview || !shouldPreferLegacyReviewState(legacyReview)) return primary || {};
  return {
    ...(primary || {}),
    ...legacyReview,
    output: {
      ...(primary?.output || {}),
      ...(legacyReview.output || {})
    },
    progress: legacyReview.progress || primary?.progress || null
  };
};

const getCanvasNodeState = (nodeStates = {}, nodeId) => {
  if (nodeId === 'export') {
    if (!nodeStates.export && !nodeStates.review) return null;
    return mergeCanvasNodeState(nodeStates.export || {}, nodeStates.review || {});
  }
  return nodeStates?.[nodeId] || null;
};

export default function WorkflowStudio({ initialMode: _initialMode }) {
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(shouldCollapseSidebarInitially);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(shouldCollapseSidebarInitially);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const initialTemplateLoadedRef = useRef(false);
  const nodeInteractionRef = useRef({ onAction: null, onViewArtifact: null });
  const loadHistoryRunRef = useRef(null);
  const completedDistributionJobsRef = useRef(new Set());
  const dispatchNodeAction = useCallback((action, nodeId) => {
    return nodeInteractionRef.current.onAction?.(action, nodeId);
  }, []);
  const dispatchNodeArtifactView = useCallback((nodeId) => {
    return nodeInteractionRef.current.onViewArtifact?.(nodeId);
  }, []);

  // 工作流执行状态
  const [currentRunId, setCurrentRunId] = useState(null);
  const [runStatus, setRunStatus] = useState('idle'); // 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'
  const [logs, setLogs] = useState([]);
  const [activeTemplateId, setActiveTemplateId] = useState(null);
  const [activeTemplateMode, setActiveTemplateMode] = useState(DEFAULT_WORKFLOW_MODE);
  const {
    templates,
    historyRuns,
    historyLoading,
    historyError,
    deletingRunId,
    refreshHistory: fetchHistoryRuns,
    removeHistoryRun
  } = useWorkflowRunCatalog({
    normalizeRuns: normalizeRunList,
    normalizeTemplates: normalizeTemplateList
  });
  const [artifactState, setArtifactState] = useNodeArtifact({
    runId: currentRunId,
    nodeId: selectedNodeId,
    limit: selectedNodeId === 'generate' ? 200 : undefined
  });
  const {
    seedRows,
    seedDraft,
    setSeedDraft,
    seedLoading,
    seedMessage,
    loadSeeds,
    addSeed,
    toggleSeed,
    setSeedStatus,
    deleteSeed,
    minerTab,
    setMinerTab,
    minerInput,
    setMinerInput,
    minerResults,
    minerBusy,
    runRootMiner
  } = useSeedMiner({ active: selectedNodeId === 'mine' });
  const {
    titleForm,
    setTitleForm,
    titleLoading,
    titleResult,
    titleError,
    verifiedArtifactRows,
    useVerifiedKeyword: useVerifiedKeywordForTitle,
    generateTitleFromNode
  } = useTitleGeneration({ active: selectedNodeId === 'generate', runId: currentRunId });
  const [artifactPreviewOpen, setArtifactPreviewOpen] = useState(false);
  const [artifactPreviewTargetNodeId, setArtifactPreviewTargetNodeId] = useState(null);
  const [manualInputOpen, setManualInputOpen] = useState(false);

  useEffect(() => {
    if (!artifactPreviewTargetNodeId || selectedNodeId !== artifactPreviewTargetNodeId) return;
    setArtifactPreviewOpen(true);
    setArtifactPreviewTargetNodeId(null);
  }, [artifactPreviewTargetNodeId, selectedNodeId]);

  // 加载工作流模板
  const loadTemplate = (template) => {
    disconnectRunEvents();
    const defaultWorkflow = normalizeWorkflowForCanvas(template?.workflow || { nodes: [], edges: [] });
    // 重置节点状态为 idle
    const formattedNodes = (defaultWorkflow.nodes || []).map(n => normalizeCanvasNode({
      ...n,
      data: {
        ...n.data,
        status: 'idle',
        output: null,
        error: null
      }
    }, setSelectedNodeId, dispatchNodeAction, dispatchNodeArtifactView));
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
    setArtifactState({ status: 'empty', nodeId: null, artifact: null, error: '' });
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

  // 点击节点事件
  const onNodeClick = useCallback((event, node) => {
    setSelectedNodeId(node.id);
  }, []);

  // 选中节点对象
  const selectedNode = useMemo(() => {
    return nodes.find(n => n.id === selectedNodeId) || null;
  }, [nodes, selectedNodeId]);
  const orderedWorkflowNodes = useMemo(() => (
    [...nodes].sort((a, b) => (
      Number(a.data?.stepIndex || 0) - Number(b.data?.stepIndex || 0)
      || a.position.x - b.position.x
    ))
  ), [nodes]);

  const isRunActive = ACTIVE_RUN_STATUSES.has(String(runStatus || '').toLowerCase());
  const isViewingRun = Boolean(currentRunId);
  const activeTemplate = useMemo(() => (
    templates.find((template) => template.id === activeTemplateId) || templates[0] || null
  ), [templates, activeTemplateId]);
  const activeTemplateView = useMemo(() => getWorkflowTemplateView(activeTemplate || { mode: activeTemplateMode }), [activeTemplate, activeTemplateMode]);
  const canCancelRun = Boolean(currentRunId) && isRunActive;
  const canPauseRun = Boolean(currentRunId) && isRunActive;
  const selectedNodeLabel = selectedNode?.data?.label || selectedNode?.id || '未选择节点';
  const activeTemplateLabel = activeTemplate?.name || activeTemplateView.title || '选品流水线';
  // 将全局运行状态同步到节点，让暂停、继续、重试等操作直接出现在节点上。
  useEffect(() => {
    setNodes((nds) => nds.map((node) => ({
      ...node,
      data: {
        ...node.data,
        workflowRunStatus: runStatus
      }
    })));
  }, [runStatus, setNodes]);

  const verifiedRows = useMemo(() => {
    const verifyNode = nodes.find((node) => node.id === 'verify');
    const output = verifyNode?.data?.output;
    if (Array.isArray(output?.verifiedKeywords)) return output.verifiedKeywords;
    if (Array.isArray(output?.items)) return output.items;
    if (Array.isArray(output?.rows)) return output.rows;
    if (verifiedArtifactRows.length > 0) return verifiedArtifactRows;
    if (artifactState.nodeId === 'verify') return artifactItems(artifactState);
    return [];
  }, [artifactState, nodes, verifiedArtifactRows]);

  // 修改节点配置参数
  const updateNodeData = (nodeId, field, value) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === nodeId) {
          return {
            ...node,
            data: {
              ...node.data,
              [field]: value
            }
          };
        }
        return node;
      })
    );
  };

  const updateNodeFields = (nodeId, fields) => {
    setNodes((currentNodes) => currentNodes.map((node) => (
      node.id === nodeId ? { ...node, data: { ...node.data, ...fields } } : node
    )));
  };

  // SSE 连接本身由 Hook 管理；页面只解释运行领域事件。
  const { connect: listenToRunEvents, disconnect: disconnectRunEvents } = useWorkflowEvents({
    onMessage: (data, connection) => {

      if (data.event === 'init') {
        // 初始化推送，把节点状态都同步一下
        const { status, nodeStates } = data.payload;
        setRunStatus(status);
        syncNodeStates(nodeStates);
      } else if (data.event === 'status_change') {
        const { status } = data.payload;
        setRunStatus(status);
        if (status === 'completed' || status === 'failed' || status === 'cancelled') {
          connection.disconnect();
          fetchHistoryRuns();
        }
      } else if (data.event === 'node_change') {
        const { nodeId, state } = data.payload;
        const effectiveNodeId = effectiveCanvasNodeId(nodeId);
        setNodes((nds) =>
          nds.map((node) => {
            if (node.id === effectiveNodeId) {
              return {
                ...node,
                data: {
                  ...node.data,
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
                }
              };
            }
            return node;
          })
        );
      } else if (data.event === 'log') {
        const log = data.payload;
        setLogs((prev) => [...prev, log]);
        // 自动滚动到日志底部
        setTimeout(() => {
          const consoleEl = document.getElementById('console-terminal');
          if (consoleEl) {
            consoleEl.scrollTop = consoleEl.scrollHeight;
          }
        }, 50);
      } else if (data.event === 'progress') {
        const progress = normalizeWorkflowProgressEvent(data);
        const nodeId = effectiveCanvasNodeId(progress.step || progress.nodeId);
        if (nodeId && !data.payload?.replay) {
          setNodes((nds) =>
            nds.map((node) => {
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
            })
          );
        }
        const message = progress.message || formatWorkflowProgressLabel(progress);
        if (message) {
          setLogs((prev) => [...prev, {
            timestamp: progress.timestamp || new Date().toISOString(),
            level: 'info',
            message: `[progress:${nodeId || 'workflow'}] ${message}`
          }]);
        }
      }
    },
    onMalformedMessage: () => {
      setLogs((prev) => [...prev, {
        timestamp: new Date().toISOString(),
        level: 'warn',
        message: '收到无法识别的运行事件，已忽略。'
      }]);
    }
  });

  // 同步工作流节点状态到前端组件
  const syncNodeStates = (nodeStates) => {
    setNodes((nds) =>
      nds.map((node) => {
        const state = getCanvasNodeState(nodeStates, node.id);
        if (state) {
          return {
            ...node,
            data: {
              ...node.data,
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
              cooldownRemainingMs: state.cooldownRemainingMs || 0,
              onSelect: () => setSelectedNodeId(node.id)
            }
          };
        }
        return node;
      })
    );
  };

  // 加载指定历史运行记录的详情和日志
  const loadHistoryRun = async (runId, { preserveLogs = false } = {}) => {
    try {
      disconnectRunEvents();
      setSelectedNodeId(null);
      if (!preserveLogs) setLogs([]);
      setRunStatus('pending');

      const run = await getWorkflowRun(runId);
      const defaultWorkflow = normalizeWorkflowForCanvas(run.workflow || { nodes: [], edges: [] });

      setNodes((defaultWorkflow.nodes || []).map(n => {
        const state = getCanvasNodeState(run.nodeStates, n.id);
        return normalizeCanvasNode({
          ...n,
          data: {
            ...n.data,
            status: state.status || 'idle',
            output: state.output || null,
            error: state.error || null,
            progress: state.progress || null,
            blocker: state.blocker || null,
            actionHint: state.actionHint || null,
            nextRecommendedAction: state.nextRecommendedAction || null,
            platformStatus: state.platformStatus || null,
            manualAction: state.manualAction || null,
            durationMs: state.durationMs || null,
            outputSummary: state.outputSummary || null,
            cooldownRemainingMs: state.cooldownRemainingMs || 0
          }
        }, setSelectedNodeId, dispatchNodeAction, dispatchNodeArtifactView);
      }));

      setEdges((defaultWorkflow.edges || []).map(e => ({
        ...e,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' },
        style: { stroke: '#3b82f6', strokeWidth: 2.5 }
      })));

      setCurrentRunId(runId);
      setRunStatus(run.status);
      setActiveTemplateId(defaultWorkflow.id || run.workflow?.id || null);
      setActiveTemplateMode(run.workflow?.mode || run.mode || activeTemplateMode);
      setSelectedNodeId(getWorkflowRunActiveNodeId(run));

      if (ACTIVE_RUN_STATUSES.has(String(run.status || '').toLowerCase())) {
        listenToRunEvents(runId);
      } else if (run.logs && !preserveLogs) {
        setLogs(run.logs);
      }
    } catch (err) {
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
  loadHistoryRunRef.current = loadHistoryRun;

  const deleteHistoryRun = async (runId) => {
    const ok = window.confirm('确认删除这次运行历史？相关产物和日志也会一起删除，此操作不可撤销。');
    if (!ok) return;
    try {
      await removeHistoryRun(runId);
      if (currentRunId === runId) {
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

  // 运行当前画布上的工作流
  const handleRunWorkflow = async () => {
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

    // 格式化工作流的 nodes/edges
    const workflowDef = {
      nodes: nodes.map(n => ({
        id: n.id,
        type: n.data?.originalType || n.type,
        position: n.position,
        data: n.data
      })),
      edges: edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target
      }))
    };

    try {
      const validationPayload = await validateWorkflow({
        templateId: activeTemplateId,
        mode: activeTemplateMode,
        params: getStartNodeParams(nodes),
        workflow: workflowDef
      });
      if (validationPayload.ok === false) {
        const errors = validationPayload.data?.errors || [{ message: validationPayload.error || '工作流校验失败' }];
        const typeOnlyErrors = errors.filter((error) => String(error.code || error.message || '').toLowerCase().includes('type'));
        if (typeOnlyErrors.length !== errors.length || !activeTemplateId) {
          setRunStatus('failed');
          setLogs(errors.map(error => ({
            timestamp: new Date().toISOString(),
            level: 'error',
            message: `[${error.code || 'validation_error'}] ${error.message}`
          })));
          return;
        }
        setLogs(errors.map(error => ({
          timestamp: new Date().toISOString(),
          level: 'warn',
          message: `[${error.code || 'production_validate'}] ${error.message}`
        })));
      }

      const data = await startWorkflow({
        templateId: activeTemplateId,
        mode: activeTemplateMode,
        params: getStartNodeParams(nodes)
      });
      const runId = data.runId || null;
      const message = data.message || '工作流已提交。';
      setCurrentRunId(runId);
      setLogs((prev) => [...prev, {
        timestamp: new Date().toISOString(),
        level: runId ? 'info' : 'warn',
        message
      }]);
      if (runId) {
        setRunStatus('running');
        // 开始 SSE 监听运行事件
        listenToRunEvents(runId);
      } else {
        setRunStatus('completed');
        await fetchHistoryRuns();
      }
    } catch (err) {
      alert(`启动请求失败: ${err.message}`);
      setRunStatus('failed');
    }
  };

  // 取消当前正在执行的工作流
  const handleCancelWorkflow = async () => {
    if (!canCancelRun) return;
    try {
      await cancelWorkflow(currentRunId);
      setLogs((prev) => [...prev, {
        timestamp: new Date().toISOString(),
        level: 'warn',
        message: '已请求取消，当前步骤会在安全边界停止。'
      }]);
    } catch (err) {
      console.error('取消工作流失败', err);
      setLogs((prev) => [...prev, {
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `取消请求失败: ${err.message}`
      }]);
    }
  };

  // 运行工作流恢复与操作
  const runWorkflowOperation = async (action, nodeId = null) => {
    const targetNodeId = nodeId || selectedNodeId;
    const operationNodeId = action === 'mine-more' ? 'mine' : targetNodeId;
    if (action === 'open-review' || action === 'confirm-distribution' || action === 'keyword-review' || action === 'product-review') {
      if (targetNodeId) setSelectedNodeId(targetNodeId);
      if (action === 'open-review' || action === 'confirm-distribution') {
        if (targetNodeId) setArtifactPreviewTargetNodeId(targetNodeId);
        else setArtifactPreviewOpen(true);
      }
      setLogs((prev) => [...prev, {
        timestamp: new Date().toISOString(),
        level: action === 'confirm-distribution' || action === 'keyword-review' ? 'warn' : 'info',
        message: getWorkflowOperationMessage(action, 'success')
      }]);
      return;
    }
    // Chrome 启动是平台准备动作，不依赖某一次流程运行。
    if (!currentRunId && action !== 'start-sycm-chrome') {
      const message = '当前没有可操作的运行记录，请重新选择运行历史后再试。';
      setLogs((prev) => [...prev, {
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
      setLogs((prev) => [...prev, {
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
      if (currentRunId) await loadHistoryRun(currentRunId, { preserveLogs: true });
    } catch (err) {
      const message = getWorkflowOperationMessage(action, 'error', err.message);
      if (currentRunId) await loadHistoryRun(currentRunId, { preserveLogs: true });
      if (operationNodeId) {
        setNodes((currentNodes) => currentNodes.map((node) => (
          node.id === operationNodeId || (action === 'mine-more' && node.id === targetNodeId)
            ? {
                ...node,
                data: {
                  ...node.data,
                  pendingAction: null,
                  operationMessage: message
                }
              }
            : node
        )));
      }
      setLogs((prev) => [...prev, {
        timestamp: new Date().toISOString(),
        level: 'error',
        message
      }]);
      alert(message);
      console.error(err);
    }
  };

  const updateDistributionNodeJob = useCallback((job) => {
    setNodes((currentNodes) => currentNodes.map((node) => (
      node.id === 'export'
        ? { ...node, data: { ...node.data, distributionJob: job || null } }
        : node
    )));
    const workflowRunId = job?.workflowRunId || currentRunId;
    if (job?.status === 'completed' && workflowRunId && !completedDistributionJobsRef.current.has(job.jobId)) {
      completedDistributionJobsRef.current.add(job.jobId);
      const manualMode = job.mode === 'manual';
      setLogs((previous) => [...previous, {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: manualMode
          ? '人工铺货已确认完成，流水线正在进入完成节点。'
          : '自动铺货已确认完成，流水线正在进入完成节点。'
      }]);
      Promise.resolve().then(() => loadHistoryRunRef.current?.(workflowRunId, { preserveLogs: true }));
    }
  }, [currentRunId, setNodes]);

  const handleNodeAction = async (action, nodeId) => {
    if (action === 'manual-input') {
      setSelectedNodeId(nodeId);
      setManualInputOpen(true);
      return;
    }
    if (action === 'artifact' || action === 'inspect' || action === 'blocked' || action === 'review') {
      setSelectedNodeId(nodeId);
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
    return runWorkflowOperation(action, nodeId);
  };

  const handleViewNodeArtifact = (nodeId) => {
    setSelectedNodeId(nodeId);
    setArtifactPreviewTargetNodeId(nodeId);
  };

  // 画布节点由历史数据创建，事件入口必须始终指向当前 render 的运行上下文。
  nodeInteractionRef.current.onAction = handleNodeAction;
  nodeInteractionRef.current.onViewArtifact = handleViewNodeArtifact;

  const retryWorkflowNode = async (nodeId) => {
    if (!currentRunId) return;
    await runWorkflowOperation('retry-node', nodeId);
  };

  const confirmKeywordReview = async (rows = [], manualKeywords = []) => {
    if (!currentRunId) return;
    const approvedKeywords = rows
      .filter((row) => row.reviewDecision !== 'rejected')
      .map((row) => candidateKeyword(row))
      .filter(Boolean);
    const rejectedKeywords = rows
      .filter((row) => row.reviewDecision === 'rejected')
      .map((row) => candidateKeyword(row))
      .filter(Boolean);
    try {
      await confirmKeywordReviewRequest(currentRunId, { approvedKeywords, rejectedKeywords, manualKeywords });
      setLogs((prev) => [...prev, {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: `人工筛词完成，保留 ${approvedKeywords.length} 个，筛除 ${rejectedKeywords.length} 个关键词。`
      }]);
      if (activeTemplateMode === 'manual') {
        await runWorkflowOperation('resume');
      } else {
        await loadHistoryRun(currentRunId);
      }
      setArtifactState((current) => ({ ...current, status: 'loading' }));
      const artifact = await getWorkflowArtifact(currentRunId, 'keywordReview');
      setArtifactState({ status: artifact ? 'ready' : 'empty', nodeId: 'keywordReview', artifact, error: '' });
    } catch (err) {
      const message = `人工筛词确认失败: ${err.message}`;
      setLogs((prev) => [...prev, { timestamp: new Date().toISOString(), level: 'error', message }]);
      alert(message);
    }
  };

  const confirmProductReview = async ({ approvedProductIds = [], manualProducts = [] } = {}) => {
    if (!currentRunId) return;
    try {
      const result = await confirmProductReviewRequest(currentRunId, { approvedProductIds, manualProducts });
      const selectedCount = result.selected?.length || 0;
      setLogs((prev) => [...prev, {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: `人工选品完成，已确认 ${selectedCount} 个商品，流程将继续生成标题。`
      }]);
      await loadHistoryRun(currentRunId);
      setArtifactState({ status: 'loading', nodeId: 'select', artifact: null, error: '' });
      const artifact = await getWorkflowArtifact(currentRunId, 'select');
      setArtifactState({ status: artifact ? 'ready' : 'empty', nodeId: 'select', artifact, error: '' });
    } catch (err) {
      const message = `人工选品确认失败: ${err.message}`;
      setLogs((prev) => [...prev, { timestamp: new Date().toISOString(), level: 'error', message }]);
      alert(message);
    }
  };

  const nodeOperationProps = {
    selectedNode,
    artifactState,
    seedRows,
    seedDraft,
    seedLoading,
    seedMessage,
    onSeedDraftChange: setSeedDraft,
    onLoadSeeds: loadSeeds,
    onAddSeed: addSeed,
    onToggleSeed: toggleSeed,
    onDeleteSeed: deleteSeed,
    onSetSeedStatus: setSeedStatus,
    minerTab,
    minerInput,
    minerResults,
    minerBusy,
    onMinerTabChange: setMinerTab,
    onMinerInputChange: setMinerInput,
    onRunMiner: runRootMiner,
    verifiedRows,
    titleForm,
    titleLoading,
    titleResult,
    titleError,
    onTitleFormChange: setTitleForm,
    onUseVerifiedKeyword: useVerifiedKeywordForTitle,
    onGenerateTitle: generateTitleFromNode,
    onCopyText: copyText,
    onConfirmKeywordReview: confirmKeywordReview,
    onConfirmProductReview: confirmProductReview,
    onRetryNode: retryWorkflowNode,
    currentRunId,
    manualMode: activeTemplateMode === 'manual',
    onDistributionJobChange: updateDistributionNodeJob
  };

  return (
    <div className="workflow-studio-root">
      <div className="workflow-main-row">

      <WorkflowLeftSidebar
        collapsed={leftSidebarCollapsed}
        currentRunId={currentRunId}
        deletingRunId={deletingRunId}
        historyError={historyError}
        historyLoading={historyLoading}
        historyRuns={historyRuns}
        templates={templates}
        activeTemplateId={activeTemplateId}
        activeTemplate={activeTemplate}
        activeTemplateView={activeTemplateView}
        onToggle={() => setLeftSidebarCollapsed((collapsed) => !collapsed)}
        onLoadTemplate={loadTemplate}
        onDeleteRun={deleteHistoryRun}
        onOpenRun={loadHistoryRun}
        onRefreshRuns={fetchHistoryRuns}
      />

      <WorkflowCanvasWorkspace
        activeTemplateLabel={activeTemplateLabel}
        canCancelRun={canCancelRun}
        canPauseRun={canPauseRun}
        currentRunId={currentRunId}
        edges={edges}
        isRunActive={isRunActive}
        isViewingRun={isViewingRun}
        nodes={nodes}
        onCancel={handleCancelWorkflow}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodesChange={onNodesChange}
        onPause={() => runWorkflowOperation('pause')}
        onRun={handleRunWorkflow}
        onSelectNode={setSelectedNodeId}
        orderedWorkflowNodes={orderedWorkflowNodes}
        runStatus={runStatus}
        selectedNodeId={selectedNodeId}
        selectedNodeLabel={selectedNodeLabel}
      />

      <WorkflowRightSidebar
        activeTemplateMode={activeTemplateMode}
        activeTemplateView={activeTemplateView}
        artifactPreviewOpen={artifactPreviewOpen}
        artifactState={artifactState}
        collapsed={rightSidebarCollapsed}
        copyText={copyText}
        currentRunId={currentRunId}
        isViewingRun={isViewingRun}
        onOpenManualInput={() => setManualInputOpen(true)}
        onToggle={() => setRightSidebarCollapsed((collapsed) => !collapsed)}
        operationProps={nodeOperationProps}
        selectedNode={selectedNode}
        setArtifactPreviewOpen={setArtifactPreviewOpen}
        updateDistributionNodeJob={updateDistributionNodeJob}
        updateNodeData={updateNodeData}
      />
      </div>
      {manualInputOpen && (
        <div className="workflow-modal-backdrop" role="presentation" onClick={() => setManualInputOpen(false)}>
          <ManualWorkflowInputPanel
            initialDefaultKeyword={nodes.find((node) => node.id === 'start')?.data?.defaultKeyword || ''}
            initialItems={nodes.find((node) => node.id === 'start')?.data?.items || []}
            onCancel={() => setManualInputOpen(false)}
            onSave={({ defaultKeyword, items }) => {
              updateNodeFields('start', { defaultKeyword, items });
              setManualInputOpen(false);
              setLogs((previous) => [...previous, {
                timestamp: new Date().toISOString(),
                level: 'info',
                message: `已准备 ${items.length} 个商品，启动流水线后将直接获取商品资料。`
              }]);
            }}
          />
        </div>
      )}
      <WorkflowConsole logs={logs} onClear={() => setLogs([])} />
    </div>
  );
}
