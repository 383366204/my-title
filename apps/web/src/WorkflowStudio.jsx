import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useEdgesState, useNodesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './App.css';
import { getWorkflowTemplateView } from './features/workflow/workflow-node-view.js';
import { useWorkflowConfirmations } from './features/workflow/hooks/use-workflow-confirmations.js';
import { useNodeArtifact } from './features/workflow/hooks/use-node-artifact.js';
import { useWorkflowRuntime } from './features/workflow/hooks/use-workflow-runtime.js';
import { useWorkflowOperations } from './features/workflow/hooks/use-workflow-operations.js';
import { useWorkflowRunCatalog } from './features/workflow/hooks/use-workflow-run-catalog.js';
import { useSeedMiner } from './features/workflow/hooks/use-seed-miner.js';
import { useTitleGeneration } from './features/workflow/hooks/use-title-generation.js';
import { useWorkflowOverlay } from './features/workflow/hooks/use-workflow-overlay.js';
import { useWorkflowLayout } from './features/workflow/hooks/use-workflow-layout.js';
import { useNodeDataUpdater } from './features/workflow/hooks/use-node-data-updater.js';
import { useNodeActionHandler } from './features/workflow/hooks/use-node-action-handler.js';
import { useDistributionCompletion } from './features/workflow/hooks/use-distribution-completion.js';
import { WorkflowConsole } from './features/workflow/components/workflow-console.jsx';
import { WorkflowLeftSidebar } from './features/workflow/components/workflow-left-sidebar.jsx';
import { WorkflowCanvasWorkspace } from './features/workflow/components/workflow-canvas-workspace.jsx';
import { WorkflowRightSidebar } from './features/workflow/components/workflow-right-sidebar.jsx';
import { WorkflowOverlayManager } from './features/workflow/components/workflow-overlay-manager.jsx';
import { useWorkflowSession } from './features/workflow/hooks/use-workflow-session.js';
import { ACTIVE_RUN_STATUSES } from './features/workflow/workflow-statuses.js';
import {
  DEFAULT_WORKFLOW_MODE,
  artifactItems,
  normalizeRunList,
  normalizeTemplateList
} from './features/workflow/workflow-data.js';
import { selectVerifiedRows } from './features/workflow/select-verified-rows.js';
import { copyText } from './features/workflow/copy-text.js';

export default function WorkflowStudio({ initialMode: _initialMode }) {
  // --- Layout ---
  const { leftSidebarCollapsed, rightSidebarCollapsed, toggleLeftSidebar, toggleRightSidebar } = useWorkflowLayout();

  // --- Canvas state (React Flow) ---
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);

  // --- Callback-ref bridges for stable node event handlers ---
  const nodeInteractionRef = useRef({ onAction: null, onViewArtifact: null });
  const nodeUpdateRef = useRef(null);
  const loadHistoryRunRef = useRef(null);
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

  // --- Template & mode ---
  const [activeTemplateId, setActiveTemplateId] = useState(null);
  const [activeTemplateMode, setActiveTemplateMode] = useState(DEFAULT_WORKFLOW_MODE);

  // --- Catalog ---
  const {
    templates, historyRuns, historyLoading, historyError, deletingRunId,
    refreshHistory: fetchHistoryRuns, removeHistoryRun
  } = useWorkflowRunCatalog({ normalizeRuns: normalizeRunList, normalizeTemplates: normalizeTemplateList });

  // --- Runtime ---
  const {
    currentRunId, disconnectRunEvents, listenToRunEvents,
    logs, runStatus, setCurrentRunId, setLogs, setRunStatus
  } = useWorkflowRuntime({ setNodes, setSelectedNodeId, refreshHistory: fetchHistoryRuns });

  // --- Artifact ---
  const [artifactState, setArtifactState, refreshArtifact] = useNodeArtifact({
    runId: currentRunId, nodeId: selectedNodeId,
    limit: ['mine', 'keywordReview'].includes(selectedNodeId) ? 'all'
      : selectedNodeId === 'generate' || selectedNodeId === 'collectRank' ? 200 : undefined
  });

  // --- Feature hooks ---
  const { seedRows, seedDraft, setSeedDraft, seedLoading, seedMessage, loadSeeds, addSeed, toggleSeed, setSeedStatus, deleteSeed, minerTab, setMinerTab, minerInput, setMinerInput, minerResults, minerBusy, runRootMiner } = useSeedMiner({ active: selectedNodeId === 'mine' });
  const { titleForm, setTitleForm, titleLoading, titleResult, titleError, verifiedArtifactRows, useVerifiedKeyword: useVerifiedKeywordForTitle, generateTitleFromNode } = useTitleGeneration({ active: selectedNodeId === 'generate', runId: currentRunId, exactKeywordMode: activeTemplateMode === 'keyword' });
  const { activeOverlay, closeOverlay, openOverlay } = useWorkflowOverlay();

  // Refresh artifact when reopening overlay for same node
  useEffect(() => {
    if (activeOverlay?.nodeId && artifactState.nodeId === activeOverlay.nodeId) refreshArtifact();
  }, [activeOverlay, artifactState.nodeId, refreshArtifact]);

  // --- Derived state ---
  const onNodeClick = useCallback((event, node) => setSelectedNodeId(node.id), []);
  const selectedNode = useMemo(() => nodes.find(n => n.id === selectedNodeId) || null, [nodes, selectedNodeId]);
  const orderedWorkflowNodes = useMemo(() => [...nodes].sort((a, b) => Number(a.data?.stepIndex || 0) - Number(b.data?.stepIndex || 0) || a.position.x - b.position.x), [nodes]);
  const isRunActive = ACTIVE_RUN_STATUSES.has(String(runStatus || '').toLowerCase());
  const isViewingRun = Boolean(currentRunId);

  // Broadcast runId to all nodes
  useEffect(() => {
    setNodes((currentNodes) => currentNodes.map((node) => ({ ...node, data: { ...node.data, workflowRunId: currentRunId || null } })));
  }, [currentRunId, setNodes]);

  const activeTemplate = useMemo(() => templates.find((t) => t.id === activeTemplateId) || templates[0] || null, [templates, activeTemplateId]);
  const activeTemplateView = useMemo(() => getWorkflowTemplateView({ ...activeTemplate, mode: activeTemplateMode }), [activeTemplate, activeTemplateMode]);
  const canCancelRun = Boolean(currentRunId) && isRunActive;
  const canPauseRun = Boolean(currentRunId) && isRunActive;
  const selectedNodeLabel = selectedNode?.data?.label || selectedNode?.id || '未选择节点';
  const activeTemplateLabel = activeTemplate?.name || activeTemplateView.title || '选品流水线';

  // --- Operations ---
  const { handleCancelWorkflow, handleRunWorkflow, launchWorkflow, runRemoteOperation } = useWorkflowOperations({
    activeTemplateId, activeTemplateMode, canCancelRun, currentRunId, edges, listenToRunEvents, nodes,
    refreshHistory: fetchHistoryRuns, reloadRun, runStatus, selectedNodeId, setCurrentRunId, setLogs, setNodes, setRunStatus
  });

  const verifiedRows = useMemo(() => selectVerifiedRows({ nodes, verifiedArtifactRows, artifactState, artifactItems }), [artifactState, nodes, verifiedArtifactRows]);

  // --- Session ---
  const { loadTemplate, switchSelectionMode, prepareNewRunFromHistory, repeatWorkflow, loadHistoryRun, deleteHistoryRun } = useWorkflowSession({
    nodes, edges, templates, activeTemplateMode, currentRunId, isRunActive,
    setNodes, setEdges, setSelectedNodeId, setActiveTemplateId, setActiveTemplateMode,
    setCurrentRunId, setRunStatus, setLogs, setArtifactState,
    disconnectRunEvents, listenToRunEvents, closeOverlay,
    dispatchNodeAction, dispatchNodeArtifactView, dispatchNodeUpdate,
    launchWorkflow, removeHistoryRun
  });

  // --- Extracted hooks ---
  const { updateNodeData, updateNodeFields } = useNodeDataUpdater({
    setNodes, switchSelectionMode, prepareNewRunFromHistory, setRunStatus, currentRunId, activeTemplateId
  });

  const { updateDistributionNodeJob } = useDistributionCompletion({
    setNodes, currentRunId, closeOverlay, setLogs, reloadRun, fetchHistoryRuns
  });

  const { handleNodeAction, handleViewNodeArtifact, retryWorkflowNode } = useNodeActionHandler({
    currentRunId, selectedNodeId, setSelectedNodeId, setLogs, openOverlay,
    handleRunWorkflow, runRemoteOperation, updateDistributionNodeJob, nodes
  });

  // Wire callback-ref bridges
  loadHistoryRunRef.current = loadHistoryRun;
  nodeInteractionRef.current.onAction = handleNodeAction;
  nodeInteractionRef.current.onViewArtifact = handleViewNodeArtifact;
  nodeUpdateRef.current = updateNodeData;

  // --- Confirmations ---
  const { confirmReviewDrafts, confirmOrderSheetProducts, confirmKeywordReview, queryKeywords, confirmProductReview, confirmingReviews, confirmingOrderSheetProducts } = useWorkflowConfirmations({
    currentRunId, activeTemplateMode, setLogs, setRunStatus, setArtifactState, closeOverlay,
    listenToRunEvents, reloadRun, loadHistoryRun, runWorkflowOperation: runRemoteOperation
  });

  // --- Node operation props bundle ---
  const nodeOperationProps = {
    selectedNode, artifactState, currentRunId,
    onKeywordFilterApplied: async (result) => {
      if (result.artifact) setArtifactState({ status: 'ready', nodeId: 'keywordReview', artifact: result.artifact, error: '' });
      updateNodeFields('keywordReview', { keywordFilter: result.config, keywordFilterCounts: result.counts });
    },
    onKeywordFilterRecollected: async result => { await loadHistoryRun(result.runId); await fetchHistoryRuns(); },
    manualMode: activeTemplateMode === 'manual',
    selectionMode: activeTemplateMode,
    seedWorkbench: { seedRows, seedDraft, seedLoading, seedMessage, onSeedDraftChange: setSeedDraft, onLoadSeeds: loadSeeds, onAddSeed: addSeed, onToggleSeed: toggleSeed, onDeleteSeed: deleteSeed, onSetSeedStatus: setSeedStatus, minerTab, minerInput, minerResults, minerBusy, onMinerTabChange: setMinerTab, onMinerInputChange: setMinerInput, onRunMiner: runRootMiner },
    titleWorkbench: { exactKeywordMode: activeTemplateMode === 'keyword', verifiedRows, titleForm, titleLoading, titleResult, titleError, onTitleFormChange: setTitleForm, onUseVerifiedKeyword: useVerifiedKeywordForTitle, onGenerateTitle: generateTitleFromNode },
    reviewActions: { onConfirmKeywordReview: confirmKeywordReview, onQueryKeywords: queryKeywords, onConfirmProductReview: confirmProductReview },
    runtimeActions: { onCopyText: copyText, onRetryNode: retryWorkflowNode, onConfirmOrderSheetProducts: confirmOrderSheetProducts, confirmingOrderSheetProducts, onConfirmReviews: confirmReviewDrafts, confirmingReviews },
    distributionWorkbench: { onDistributionJobChange: updateDistributionNodeJob }
  };

  return (
    <div className="workflow-studio-root">
      <div className="workflow-main-row">
        <WorkflowLeftSidebar
          collapsed={leftSidebarCollapsed} currentRunId={currentRunId} deletingRunId={deletingRunId}
          historyError={historyError} historyLoading={historyLoading} historyRuns={historyRuns}
          templates={templates} activeTemplateId={activeTemplateId} activeTemplate={activeTemplate}
          activeTemplateView={activeTemplateView} onToggle={toggleLeftSidebar}
          onLoadTemplate={loadTemplate} onDeleteRun={deleteHistoryRun} onOpenRun={loadHistoryRun} onRefreshRuns={fetchHistoryRuns}
        />
        <WorkflowCanvasWorkspace
          activeTemplateLabel={activeTemplateLabel} canCancelRun={canCancelRun} canPauseRun={canPauseRun}
          currentRunId={currentRunId} edges={edges} isRunActive={isRunActive} isViewingRun={isViewingRun}
          nodes={nodes} onCancel={handleCancelWorkflow} onEdgesChange={onEdgesChange} onNodeClick={onNodeClick}
          onNodesChange={onNodesChange} onPause={() => runRemoteOperation('pause')}
          onPrepareNewRun={prepareNewRunFromHistory} onRepeatRun={repeatWorkflow} onRun={handleRunWorkflow}
          onSelectNode={setSelectedNodeId} orderedWorkflowNodes={orderedWorkflowNodes} runStatus={runStatus}
          selectedNodeId={selectedNodeId} selectedNodeLabel={selectedNodeLabel}
        />
        <WorkflowRightSidebar collapsed={rightSidebarCollapsed} isViewingRun={isViewingRun} onToggle={toggleRightSidebar} selectedNode={selectedNode} />
      </div>
      <WorkflowOverlayManager
        activeOverlay={activeOverlay} activeTemplateMode={activeTemplateMode} activeTemplateView={activeTemplateView}
        artifactState={artifactState} copyText={copyText} currentRunId={currentRunId}
        nodeOperationProps={nodeOperationProps} nodes={nodes} onClose={closeOverlay}
        onConfirmProductReview={confirmProductReview} onRetryNode={retryWorkflowNode}
        onSaveManualInput={({ defaultKeyword, items }) => {
          updateNodeFields('start', { defaultKeyword, items });
          closeOverlay();
          setLogs((previous) => [...previous, { timestamp: new Date().toISOString(), level: 'info', message: `已准备 ${items.length} 个商品，启动后将获取商品资料、提取候选词并进行验真。` }]);
        }}
        onUpdateNodeData={updateNodeData} onSaveNodeFields={updateNodeFields}
        onKeywordFilterApplied={nodeOperationProps.onKeywordFilterApplied}
        onKeywordFilterRecollected={nodeOperationProps.onKeywordFilterRecollected}
        updateDistributionNodeJob={updateDistributionNodeJob}
      />
      <WorkflowConsole logs={logs} onClear={() => setLogs([])} />
    </div>
  );
}
