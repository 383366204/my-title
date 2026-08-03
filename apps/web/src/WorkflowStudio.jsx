import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { MarkerType, useEdgesState, useNodesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './App.css';
import {
  getWorkflowOperationMessage,
  getWorkflowRunActiveNodeId,
  getWorkflowTemplateView
} from './workflow-ui.js';
import {
  confirmKeywordReview as confirmKeywordReviewRequest,
  confirmProductReview as confirmProductReviewRequest,
  getWorkflowArtifact,
  getWorkflowRun
} from './api/workflow-api.js';
import { useNodeArtifact } from './features/workflow/hooks/use-node-artifact.js';
import { useWorkflowRuntime } from './features/workflow/hooks/use-workflow-runtime.js';
import { useWorkflowOperations } from './features/workflow/hooks/use-workflow-operations.js';
import { useWorkflowRunCatalog } from './features/workflow/hooks/use-workflow-run-catalog.js';
import { useSeedMiner } from './features/workflow/hooks/use-seed-miner.js';
import { useTitleGeneration } from './features/workflow/hooks/use-title-generation.js';
import { WorkflowConsole } from './features/workflow/components/workflow-console.jsx';
import { WorkflowLeftSidebar } from './features/workflow/components/workflow-left-sidebar.jsx';
import { WorkflowCanvasWorkspace } from './features/workflow/components/workflow-canvas-workspace.jsx';
import { WorkflowRightSidebar } from './features/workflow/components/workflow-right-sidebar.jsx';
import { ManualWorkflowInputPanel } from './features/workflow/components/manual-workflow-input-panel.jsx';
import { nodeTypes } from './features/workflow/workflow-node-types.js';
import {
  ACTIVE_RUN_STATUSES,
  DEFAULT_WORKFLOW_MODE,
  artifactItems,
  candidateKeyword,
  getCanvasNodeState,
  getTemplateMode,
  normalizeCanvasNode,
  normalizeRunList,
  normalizeTemplateList,
  normalizeWorkflowForCanvas
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
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(shouldCollapseSidebarInitially);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const initialTemplateLoadedRef = useRef(false);
  const nodeInteractionRef = useRef({ onAction: null, onViewArtifact: null });
  const loadHistoryRunRef = useRef(null);
  const completedDistributionJobsRef = useRef(new Set());
  const reloadRun = useCallback((...args) => loadHistoryRunRef.current?.(...args), []);
  const dispatchNodeAction = useCallback((action, nodeId) => {
    return nodeInteractionRef.current.onAction?.(action, nodeId);
  }, []);
  const dispatchNodeArtifactView = useCallback((nodeId) => {
    return nodeInteractionRef.current.onViewArtifact?.(nodeId);
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
    }, setSelectedNodeId, dispatchNodeAction, dispatchNodeArtifactView, nodeTypes));
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
  const {
    handleCancelWorkflow,
    handleRunWorkflow,
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
        }, setSelectedNodeId, dispatchNodeAction, dispatchNodeArtifactView, nodeTypes);
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

  const runWorkflowOperation = async (action, nodeId = null) => {
    const targetNodeId = nodeId || selectedNodeId;
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
      setLogs((previous) => [...previous, {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: manualMode
          ? '人工铺货已确认完成，流水线正在进入完成节点。'
          : '自动铺货已确认完成，流水线正在进入完成节点。'
      }]);
      Promise.resolve().then(() => loadHistoryRunRef.current?.(workflowRunId, { preserveLogs: true }));
    }
  }, [currentRunId, setLogs, setNodes]);

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
