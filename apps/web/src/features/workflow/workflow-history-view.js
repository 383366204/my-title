import { labelWorkflowNodeStatus } from "./workflow-node-view.js";

export function getWorkflowRunActiveNodeId(run = {}) {
  const priority = ['blocked', 'failed', 'retryable', 'waiting_manual', 'paused', 'needs_review', 'waiting_confirmation', 'running', 'resuming', 'retrying'];
  const nodeStates = run.nodeStates && typeof run.nodeStates === 'object'
    ? Object.entries(run.nodeStates).map(([id, state]) => ({ id: id === 'review' ? 'export' : id, state: state || {} }))
    : Array.isArray(run.workflow?.nodes)
      ? run.workflow.nodes.map((node) => ({ id: node.id, state: node.data || {} }))
      : [];

  for (const status of priority) {
    const found = nodeStates.find(({ state }) => String(state.status || state.state || '').toLowerCase() === status);
    if (found?.id) return found.id;
  }

  const lastCompleted = [...nodeStates].reverse().find(({ state }) => (
    String(state.status || state.state || '').toLowerCase() === 'completed'
  ));
  return lastCompleted?.id || nodeStates[0]?.id || null;
}

export function inferRunTitle(run = {}) {
  const explicit = String(run.keyword || run.title || run.name || '').trim();
  if (explicit) return explicit;
  const workflowId = String(run.workflow?.id || run.templateId || '').toLowerCase();
  const workflowMode = String(run.workflow?.mode || run.mode || '').toLowerCase();
  if (workflowId === 'daily-selection-v1' || workflowMode === 'daily') return '每日蓝海选品流水线';
  if (workflowId === 'exact-keyword-v1' || workflowMode === 'keyword') return '精确关键词选品流水线';
  if (workflowId === 'root-keyword-selection-v1' || workflowMode === 'root-keyword') return '词根拓词选品流水线';
  if (workflowId === 'sycm-order-sheet-v1' || workflowMode === 'order-sheet') return '制作刷单表格流水线';
  if (workflowId === 'competitor-analysis-v1' || workflowMode === 'competitor-analysis') return '同行分析流水线';
  const nodes = Array.isArray(run.workflow?.nodes) ? run.workflow.nodes : [];
  const start = nodes.find((node) => node.id === 'start') || nodes[0] || {};
  return String(start.data?.keyword || start.data?.label || run.runId || '未命名流程').trim();
}

export function isOrderSheetRun(run = {}) {
  const workflowId = String(run.workflow?.id || run.templateId || '').toLowerCase();
  const workflowMode = String(run.workflow?.mode || run.mode || run.options?.mode || '').toLowerCase();
  return workflowId === 'sycm-order-sheet-v1' || workflowMode === 'order-sheet';
}

export function isCompetitorRun(run = {}) {
  const workflowId = String(run.workflow?.id || run.templateId || '').toLowerCase();
  const workflowMode = String(run.workflow?.mode || run.mode || run.options?.mode || '').toLowerCase();
  return workflowId === 'competitor-analysis-v1' || workflowMode === 'competitor-analysis';
}

export function labelUnifiedRunStage(run = {}) {
  const stage = String(run.stage || '').toLowerCase();
  if (isOrderSheetRun(run) && ['submitted', 'workflow_complete'].includes(stage)) {
    return '表格已生成';
  }
  if (isCompetitorRun(run)) {
    const activeNode = getWorkflowRunActiveNodeId(run);
    const labels = {
      start: '录入同行',
      resolveShops: '识别同行店铺',
      collectCompetitors: '采集爆款与新品',
      enrichCompetitors: '补全商品链接',
      analyzeCompetitors: '同行对比分析',
      competitorReport: '生成分析报告',
      end: '分析完成'
    };
    return labels[activeNode] || (run.status === 'workflow_complete' ? '分析完成' : '同行分析');
  }
  const labels = {
    seed: '种子启动',
    mined: '灵感选词',
    keyword_review: '人工筛词',
    verified: '大盘验真',
    selected: '货源选品',
    generated: '标题生成',
    review: '铺货复核',
    ready: '待铺货',
    submitted: '已提交'
  };
  return labels[stage] || '工作流运行';
}

export function labelUnifiedRunStatus(status) {
  const normalized = String(status || '').toLowerCase();
  const labels = {
    mining_manual_action_required: '灵感选词需人工处理',
    mining_empty: '灵感选词无结果',
    verified_empty: '验真无结果',
    verified_no_generation_eligible: '无可生成词',
    ready_to_distribute: '待确认铺货',
    manual_action_required: '需要人工处理',
    verified_partial_manual_required: '部分需要人工处理',
    workflow_complete: '流程完成',
    submitted: '已提交'
  };
  return labels[normalized] || labelWorkflowNodeStatus(normalized);
}

export function getPipelineSummaryVisualState(summary = null) {
  if (!summary) return 'idle';
  const status = String(summary.status || '').toLowerCase();
  const stage = String(summary.stage || '').toLowerCase();
  const activeStatuses = new Set([
    'created',
    'started',
    'running',
    'in_progress',
    'processing',
    'mined',
    'verified',
    'products_selected',
    'generated',
    'needs_review',
    'awaiting_user_confirmation'
  ]);
  const pausedStatuses = new Set([
    'mining_manual_action_required',
    'mining_empty',
    'manual_action_required',
    'verified_partial_manual_required',
    'verified_empty',
    'platform_cooling_down',
    'platform_queued',
    'rate_limited',
    'slider_required',
    'login_required',
    'permission_required',
    'sycm_feature_required'
  ]);
  if (summary.ok === false || status.includes('failed')) return 'failed';
  if (status === 'workflow_complete' || status === 'submitted' || stage === 'submitted') return 'completed';
  if (status === 'ready_to_distribute' || status === 'ready' || stage === 'ready') return 'ready';
  if (summary.requiresUserAction || pausedStatuses.has(status)) return 'paused';
  if (activeStatuses.has(status)) return 'running';
  return 'idle';
}

export function getUnifiedRunVisualState(run = {}) {
  const status = String(run.status || '').toLowerCase();
  if (status === 'failed') return 'failed';
  if (['blocked', 'retryable', 'waiting_manual', 'paused', 'manual_action_required'].includes(status)) return 'paused';
  return getPipelineSummaryVisualState(run);
}

export function getPipelineMonitorNodeStatus(stage = {}, summary = null) {
  if (!summary) return 'idle';
  const currentStageIndex = Number.isFinite(Number(summary.stageIndex))
    ? Number(summary.stageIndex)
    : -1;
  if ((summary.ok === false || String(summary.status || '').toLowerCase().includes('failed')) && stage.stageIndex === currentStageIndex) {
    return 'failed';
  }
  if (stage.stageIndex < currentStageIndex) return 'completed';
  if (stage.stageIndex === currentStageIndex) {
    const visualState = getPipelineSummaryVisualState(summary);
    if (visualState === 'completed') return 'completed';
    if (visualState === 'ready') return 'ready';
    return visualState === 'idle' ? 'paused' : visualState;
  }
  return 'idle';
}

export function getUnifiedWorkflowHistoryItem(run = {}) {
  return {
    runId: run.runId || run.id || '',
    title: inferRunTitle(run),
    subtitle: labelUnifiedRunStage(run),
    statusLabel: labelUnifiedRunStatus(run.status),
    visualState: getUnifiedRunVisualState(run),
    updatedAt: run.updatedAt || run.startedAt || run.createdAt || ''
  };
}
