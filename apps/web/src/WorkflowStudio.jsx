import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useEdgesState, useNodesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './App.css';
import { getWorkflowOperationMessage } from './features/workflow/workflow-node-actions.js';
import { getWorkflowTemplateView } from './features/workflow/workflow-node-view.js';
import { useWorkflowConfirmations } from './features/workflow/hooks/use-workflow-confirmations.js';
import { useNodeArtifact } from './features/workflow/hooks/use-node-artifact.js';
import { useWorkflowRuntime } from './features/workflow/hooks/use-workflow-runtime.js';
import { useWorkflowOperations } from './features/workflow/hooks/use-workflow-operations.js';
import { useWorkflowRunCatalog } from './features/workflow/hooks/use-workflow-run-catalog.js';
import { useSeedMiner } from './features/workflow/hooks/use-seed-miner.js';
import { useTitleGeneration } from './features/workflow/hooks/use-title-generation.js';
import { useWorkflowOverlay } from './features/workflow/hooks/use-workflow-overlay.js';
import { WorkflowConsole } from './features/workflow/components/workflow-console.jsx';
import { WorkflowLeftSidebar } from './features/workflow/components/workflow-left-sidebar.jsx';
import { WorkflowCanvasWorkspace } from './features/workflow/components/workflow-canvas-workspace.jsx';
import { WorkflowRightSidebar } from './features/workflow/components/workflow-right-sidebar.jsx';
import { WorkflowOverlayManager } from './features/workflow/components/workflow-overlay-manager.jsx';
import {
  getWorkflowCommandAction,
  getWorkflowActionRoute,
  WORKFLOW_ACTION_KINDS,
  WORKFLOW_OVERLAYS
} from './features/workflow/workflow-action-registry.js';
import { useWorkflowSession } from './features/workflow/hooks/use-workflow-session.js';
import {
  ACTIVE_RUN_STATUSES,
  DEFAULT_WORKFLOW_MODE,
  artifactItems,
  normalizeRunList,
  normalizeTemplateList
} from './features/workflow/workflow-data.js';
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

const shouldCollapseSidebarInitially = () => (
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(max-width: 980px)').matches
);

export default function WorkflowStudio({ initialMode: _initialMode }) {
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(shouldCollapseSidebarInitially);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(true);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const nodeInteractionRef = useRef({ onAction: null, onViewArtifact: null });
  const nodeUpdateRef = useRef(null);
  const loadHistoryRunRef = useRef(null);
  const completedDistributionJobsRef = useRef(new Set());
  const reloadRun = useCallback((...args) => loadHistoryRunRef.current?.(...args), []);
  const dispatchNodeAction = useCallback((action, nodeId) => {
    return nodeInteractionRef.current.onAction?.(action, nodeId);
  }, []);
  const dispatchNodeArtifactView = useCallback((nodeId) => {
    return nodeInteractionRef.current.onViewArtifact?.(nodeId);
  }, []);
  const dispatchNodeUpdate = useCallback((nodeId, field, value) => {
    return nodeUpdateRef.current?.(nodeId, field, value);
  }, []);

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
  const {
    currentRunId,
    disconnectRunEvents,
    listenToRunEvents,
    logs,
    runStatus,
    setCurrentRunId,
    setLogs,
    setRunStatus
  } = useWorkflowRuntime({
    setNodes,
    setSelectedNodeId,
    refreshHistory: fetchHistoryRuns
  });
  const [artifactState, setArtifactState, refreshArtifact] = useNodeArtifact({
    runId: currentRunId,
    nodeId: selectedNodeId,
    limit: ['mine', 'keywordReview'].includes(selectedNodeId)
      ? 'all'
      : selectedNodeId === 'generate' || selectedNodeId === 'collectRank' ? 200 : undefined
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
  const { activeOverlay, closeOverlay, openOverlay } = useWorkflowOverlay();
  // 重新打开同一节点的弹窗时强制刷新产物：评价草稿的自动保存写在服务端，
  // 不重新请求就会一直显示首次打开时缓存在内存里的旧内容
  useEffect(() => {
    if (activeOverlay?.nodeId && artifactState.nodeId === activeOverlay.nodeId) {
      refreshArtifact();
    }
  }, [activeOverlay, artifactState.nodeId, refreshArtifact]);

  // 加载工作流模板

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
  useEffect(() => {
    setNodes((currentNodes) => currentNodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        workflowRunId: currentRunId || null
      }
    })));
  }, [currentRunId, setNodes]);
  const activeTemplate = useMemo(() => (
    templates.find((template) => template.id === activeTemplateId) || templates[0] || null
  ), [templates, activeTemplateId]);
  const activeTemplateView = useMemo(() => getWorkflowTemplateView(activeTemplate || { mode: activeTemplateMode }), [activeTemplate, activeTemplateMode]);
  const canCancelRun = Boolean(currentRunId) && isRunActive;
  const canPauseRun = Boolean(currentRunId) && isRunActive;
  const selectedNodeLabel = selectedNode?.data?.label || selectedNode?.id || '未选择节点';
  const activeTemplateLabel = activeTemplate?.name || activeTemplateView.title || '选品流水线';
  const {
    handleCancelWorkflow,
    handleRunWorkflow,
    launchWorkflow,
    runRemoteOperation
  } = useWorkflowOperations({
    activeTemplateId,
    activeTemplateMode,
    canCancelRun,
    currentRunId,
    edges,
    listenToRunEvents,
    nodes,
    refreshHistory: fetchHistoryRuns,
    reloadRun,
    runStatus,
    selectedNodeId,
    setCurrentRunId,
    setLogs,
    setNodes,
    setRunStatus
  });
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

  const { loadTemplate, prepareNewRunFromHistory, repeatWorkflow, loadHistoryRun, deleteHistoryRun } = useWorkflowSession({
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
  });

  // 修改节点配置参数
  const updateNodeData = (nodeId, field, value) => {
    if (currentRunId && nodeId === 'start' && ['dateMode', 'pages'].includes(field)) {
      prepareNewRunFromHistory({ nodeId, fields: { [field]: value } });
      return;
    }
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

  // 加载指定历史运行记录的详情和日志
  loadHistoryRunRef.current = loadHistoryRun;

  const runWorkflowOperation = async (action, nodeId = null) => {
    return runRemoteOperation(action, nodeId);
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
      closeOverlay();
      setLogs((previous) => [...previous, {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: manualMode
          ? '人工铺货已确认完成，流水线正在进入完成节点。'
          : '自动铺货已确认完成，流水线正在进入完成节点。'
      }]);
      Promise.resolve().then(async () => {
        await loadHistoryRunRef.current?.(workflowRunId, { preserveLogs: true });
        await fetchHistoryRuns();
      });
    }
  }, [closeOverlay, currentRunId, fetchHistoryRuns, setLogs, setNodes]);

  const handleNodeAction = async (action, nodeId) => {
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
  };

  const handleViewNodeArtifact = (nodeId) => {
    setSelectedNodeId(nodeId);
    openOverlay(WORKFLOW_OVERLAYS.ARTIFACT, nodeId, { sourceAction: 'artifact' });
  };

  // 画布节点由历史数据创建，事件入口必须始终指向当前 render 的运行上下文。
  nodeInteractionRef.current.onAction = handleNodeAction;
  nodeInteractionRef.current.onViewArtifact = handleViewNodeArtifact;
  nodeUpdateRef.current = updateNodeData;

  const retryWorkflowNode = async (nodeId) => {
    if (!currentRunId) return;
    await runWorkflowOperation('retry-node', nodeId);
  };

  const { confirmReviewDrafts, confirmOrderSheetProducts, confirmKeywordReview, confirmProductReview, confirmingReviews, confirmingOrderSheetProducts } = useWorkflowConfirmations({
    currentRunId,
    activeTemplateMode,
    setLogs,
    setRunStatus,
    setArtifactState,
    closeOverlay,
    listenToRunEvents,
    reloadRun,
    loadHistoryRun,
    runWorkflowOperation
  });

  const nodeOperationProps = {
    selectedNode,
    artifactState,
    currentRunId,
    manualMode: activeTemplateMode === 'manual',
    seedWorkbench: {
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
      onRunMiner: runRootMiner
    },
    titleWorkbench: {
      verifiedRows,
      titleForm,
      titleLoading,
      titleResult,
      titleError,
      onTitleFormChange: setTitleForm,
      onUseVerifiedKeyword: useVerifiedKeywordForTitle,
      onGenerateTitle: generateTitleFromNode
    },
    reviewActions: {
      onConfirmKeywordReview: confirmKeywordReview,
      onConfirmProductReview: confirmProductReview
    },
    runtimeActions: {
      onCopyText: copyText,
      onRetryNode: retryWorkflowNode,
      onConfirmOrderSheetProducts: confirmOrderSheetProducts,
      confirmingOrderSheetProducts,
      onConfirmReviews: confirmReviewDrafts,
      confirmingReviews
    },
    distributionWorkbench: {
      onDistributionJobChange: updateDistributionNodeJob
    }
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
        onToggle={() => {
          if (shouldCollapseSidebarInitially()) setRightSidebarCollapsed(true);
          setLeftSidebarCollapsed((collapsed) => !collapsed);
        }}
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
        onPrepareNewRun={prepareNewRunFromHistory}
        onRepeatRun={repeatWorkflow}
        onRun={handleRunWorkflow}
        onSelectNode={setSelectedNodeId}
        orderedWorkflowNodes={orderedWorkflowNodes}
        runStatus={runStatus}
        selectedNodeId={selectedNodeId}
        selectedNodeLabel={selectedNodeLabel}
      />

      <WorkflowRightSidebar
        collapsed={rightSidebarCollapsed}
        isViewingRun={isViewingRun}
        onToggle={() => {
          if (shouldCollapseSidebarInitially()) setLeftSidebarCollapsed(true);
          setRightSidebarCollapsed((collapsed) => !collapsed);
        }}
        selectedNode={selectedNode}
      />
      </div>
      <WorkflowOverlayManager
        activeOverlay={activeOverlay}
        activeTemplateMode={activeTemplateMode}
        activeTemplateView={activeTemplateView}
        artifactState={artifactState}
        copyText={copyText}
        currentRunId={currentRunId}
        nodeOperationProps={nodeOperationProps}
        nodes={nodes}
        onClose={closeOverlay}
        onConfirmProductReview={confirmProductReview}
        onRetryNode={retryWorkflowNode}
        onSaveManualInput={({ defaultKeyword, items }) => {
          updateNodeFields('start', { defaultKeyword, items });
          closeOverlay();
          setLogs((previous) => [...previous, {
            timestamp: new Date().toISOString(),
            level: 'info',
            message: `已准备 ${items.length} 个商品，启动后将获取商品资料、提取候选词并进行验真。`
          }]);
        }}
        onUpdateNodeData={updateNodeData}
        updateDistributionNodeJob={updateDistributionNodeJob}
      />
      <WorkflowConsole logs={logs} onClear={() => setLogs([])} />
    </div>
  );
}
