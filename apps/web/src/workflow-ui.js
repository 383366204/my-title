export const BUSINESS_FUNNEL = [
  { id: 'candidate', label: '候选词' },
  { id: 'verified', label: '大盘验真' },
  { id: 'selected', label: '货源选品' },
  { id: 'generated', label: '标题生成' },
  { id: 'pending_review', label: '待确认铺货' },
  { id: 'submitted', label: '已提交' }
];

const PIPELINE_FIRST_NAV_ITEMS = [
  { id: 'workflow', label: '选品流水线' }
];

const LEGACY_TARGET_NODE = {
  dashboard: 'review',
  mine: 'mine',
  title: 'generate'
};

const STEP_NODE = {
  start: 'start',
  mine: 'mine',
  keywordReview: 'keywordReview',
  verify: 'verify',
  select: 'select',
  generate: 'generate',
  export: 'export',
  review: 'review',
  submit: 'review'
};

const ORDER_SHEET_DATE_LABELS = {
  latest_day: '最近可用单日',
  last_7_days: '最近 7 天',
  last_30_days: '最近 30 天',
  custom: '自定义日期'
};

const ORDER_SHEET_SORT_LABELS = {
  itmUv: '商品访客数',
  payAmt: '支付金额',
  payItmCnt: '支付件数',
  itemCartCnt: '商品加购件数',
  sucRefundAmt: '成功退款金额'
};

export function getPipelineFirstNavItems() {
  return PIPELINE_FIRST_NAV_ITEMS.map((item) => ({ ...item }));
}

export function getWorkflowNodeIdForLegacyTarget(targetTab) {
  return LEGACY_TARGET_NODE[String(targetTab || '')] || '';
}

export function getPipelineFirstActionTarget(action = {}) {
  const stepNode = STEP_NODE[String(action.step || '')] || '';
  const legacyNode = getWorkflowNodeIdForLegacyTarget(action.targetTab);
  const nodeId = stepNode || legacyNode;
  if (nodeId) return { type: 'select-node', nodeId };
  return { type: 'workspace', nodeId: '' };
}

export function getWorkflowNodePanelKind(nodeId) {
  const normalized = String(nodeId || '');
  if (normalized === 'start') return 'start-config';
  if (normalized === 'mine') return 'keyword-mining';
  if (normalized === 'keywordReview') return 'keyword-review';
  if (normalized === 'verify') return 'sycm-verify';
  if (normalized === 'select') return 'product-select';
  if (normalized === 'generate') return 'title-generate';
  if (normalized === 'generateReviews') return 'review-drafts';
  if (normalized === 'collectRank') return 'order-sheet-products';
  if (normalized === 'confirmProducts') return 'order-sheet-groups';
  if (normalized === 'export') return 'distribution-export';
  if (normalized === 'review') return 'distribution-export';
  if (normalized === 'end') return 'completion';
  return 'artifact';
}

export function mapPipelineStageToFunnel(stage) {
  const normalized = String(stage || '').toLowerCase();
  if (normalized === 'verified') return 'verified';
  if (normalized === 'selected') return 'selected';
  if (normalized === 'generated') return 'generated';
  if (normalized === 'review' || normalized === 'ready') return 'pending_review';
  if (normalized === 'submitted') return 'submitted';
  return 'candidate';
}

export function getWorkflowAction(run = {}) {
  const stage = mapPipelineStageToFunnel(run.stage);
  const needsAction = Boolean(run.requiresUserAction || run.requiresReview || run.status === 'needs_review');
  if (stage === 'candidate') {
    return { label: needsAction ? '去挖词确认' : '继续挖词', targetTab: 'mine', tone: needsAction ? 'warn' : 'default' };
  }
  if (stage === 'verified') return { label: '执行货源选品', targetTab: 'workflow', step: 'select', tone: 'default' };
  if (stage === 'selected') return { label: '生成标题', targetTab: 'title', step: 'generate', tone: 'default' };
  if (stage === 'generated') return { label: '查看标题结果', targetTab: 'title', tone: needsAction ? 'warn' : 'default' };
  if (stage === 'pending_review') return { label: '处理待复核', targetTab: 'dashboard', tone: needsAction ? 'warn' : 'default' };
  return { label: '查看已提交', targetTab: 'dashboard', tone: 'default' };
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

/**
 * 将工作流节点状态映射到画布展示 tone。
 * @param {string|object} state 节点状态或节点数据。
 * @returns {string} UI tone。
 */
export function getCanvasNodeTone(state) {
  const normalized = String(state || '').toLowerCase();
  if (normalized === 'completed') return 'success';
  if (normalized === 'running') return 'active';
  if (
    normalized === 'needs_review' ||
    normalized === 'waiting_confirmation' ||
    normalized === 'waiting_manual' ||
    normalized === 'paused' ||
    normalized === 'retryable'
  ) {
    return 'warn';
  }
  if (normalized === 'blocked' || normalized === 'failed') return 'danger';
  return 'muted';
}

/**
 * 根据节点和状态返回前端画布节点动作。
 * @param {string} nodeId workflow 节点 ID。
 * @param {string} state 节点状态。
 * @returns {{label: string, action: string, tone: string}} 节点动作。
 */
export function getWorkflowNodeAction(nodeId, state) {
  const normalizedNodeId = String(nodeId || '').toLowerCase();
  const stateDetails = state && typeof state === 'object' ? state : {};
  const normalizedState = String(stateDetails.status || stateDetails.state || state || '').toLowerCase();
  if (normalizedNodeId === 'start' && stateDetails.reviewUpload === true) {
    return {
      label: stateDetails.uploadId ? '查看上传信息' : '上传刷单表',
      action: 'manual-input',
      tone: stateDetails.uploadId ? 'success' : 'warn'
    };
  }
  if (normalizedNodeId === 'generatereviews' && ['needs_review', 'waiting_confirmation'].includes(normalizedState)) {
    return { label: '复核评价', action: 'review-drafts', tone: 'warn' };
  }
  if (normalizedNodeId === 'start' && stateDetails.orderSheetConfig === true) {
    const readOnly = stateDetails.workflowReadOnly === true || !['idle', 'pending'].includes(normalizedState);
    return {
      label: readOnly ? '查看采集条件' : '详细设置',
      action: 'manual-input',
      tone: readOnly ? 'default' : 'warn'
    };
  }
  if (normalizedNodeId === 'start' && ['idle', 'pending'].includes(normalizedState)) {
    if (stateDetails.autoStart === true) {
      return { label: '无需配置', action: 'inspect', tone: 'default' };
    }
    const label = stateDetails.manualInput === true
      ? '录入词和货源'
      : Object.hasOwn(stateDetails, 'keywordsText') || Array.isArray(stateDetails.keywords)
        ? '输入关键词'
        : '配置输入';
    return { label, action: 'manual-input', tone: 'warn' };
  }
  if (
    normalizedNodeId === 'generatesheet'
    && stateDetails.sheetConfig === true
  ) {
    const readOnly = stateDetails.workflowReadOnly === true || !['idle', 'pending'].includes(normalizedState);
    return {
      label: readOnly ? '查看设置' : '详细设置',
      action: 'configure-sheet',
      tone: readOnly ? 'default' : 'warn'
    };
  }
  if (normalizedNodeId === 'select' && stateDetails.manualDirectInput === true && Number(stateDetails.output?.failed || 0) > 0 && normalizedState === 'completed') {
    return { label: '重试失败项', action: 'retry-node', tone: 'warn' };
  }
  if (normalizedNodeId === 'keywordreview' && ['needs_review', 'waiting_confirmation', 'awaiting_keyword_review', 'blocked'].includes(normalizedState)) {
    return { label: '输入/筛词', action: 'keyword-review', tone: 'warn' };
  }
  if (normalizedNodeId === 'select' && ['awaiting_product_review', 'needs_review', 'waiting_confirmation'].includes(normalizedState)) {
    return { label: '勾选货源', action: 'product-review', tone: 'warn' };
  }
  if (normalizedNodeId === 'select' && ['failed', 'blocked', 'retryable'].includes(normalizedState)) {
    return { label: '勾选货源', action: 'product-review', tone: 'warn' };
  }
  if (normalizedNodeId === 'select' && normalizedState === 'completed') {
    return { label: '调整货源', action: 'product-review', tone: 'success' };
  }
  if (normalizedNodeId === 'confirmproducts' && ['needs_review', 'waiting_confirmation', 'paused', 'blocked'].includes(normalizedState)) {
    return { label: '确认商品与编组', action: 'confirm-order-sheet-products', tone: 'warn' };
  }
  if (normalizedNodeId === 'confirmproducts' && normalizedState === 'completed') {
    return { label: '查看组合方案', action: 'confirm-order-sheet-products', tone: 'success' };
  }
  if (normalizedNodeId === 'export' && ['needs_review'].includes(normalizedState)) {
    return { label: '处理铺货复核', action: 'open-review', tone: 'warn' };
  }
  if (normalizedNodeId === 'export' && normalizedState === 'completed') {
    return { label: '查看铺货清单', action: 'confirm-distribution', tone: 'success' };
  }
  if (normalizedNodeId === 'export' && ['waiting_confirmation', 'awaiting_user_confirmation', 'ready', 'ready_to_distribute'].includes(normalizedState)) {
    return { label: '确认铺货', action: 'confirm-distribution', tone: 'warn' };
  }
  if (normalizedNodeId === 'review' && (normalizedState === 'needs_review' || normalizedState === 'waiting_confirmation')) {
    return { label: '处理复核', action: 'review', tone: 'warn' };
  }
  if (normalizedState === 'waiting_manual') {
    return { label: '继续流程', action: 'resume', tone: 'warn' };
  }
  if (normalizedState === 'paused') {
    return { label: '继续流程', action: 'resume', tone: 'warn' };
  }
  if (normalizedState === 'retryable') {
    return { label: '重试节点', action: 'retry-node', tone: 'warn' };
  }
  if (normalizedState === 'failed') {
    return {
      label: normalizedNodeId === 'collectrank' ? '重试采集' : '重试节点',
      action: 'retry-node',
      tone: 'warn'
    };
  }
  if (normalizedState === 'blocked') {
    return { label: '查看阻塞', action: 'blocked', tone: 'danger' };
  }
  if (normalizedState === 'completed') {
    return { label: '查看产物', action: 'artifact', tone: 'success' };
  }
  return { label: '查看节点', action: 'inspect', tone: getCanvasNodeTone(normalizedState) };
}

export function labelWorkflowNodeStatus(status) {
  const normalized = String(status || '').toLowerCase();
  const labels = {
    idle: '未开始',
    pending: '等待启动',
    running: '运行中',
    resuming: '继续中',
    retrying: '重试中',
    completed: '已完成',
    paused: '已暂停',
    waiting_manual: '等待人工处理',
    waiting_confirmation: '等待确认',
    needs_review: '等待复核',
    retryable: '待重试',
    ready: '待铺货',
    blocked: '已阻塞',
    failed: '失败',
    cancelled: '已取消'
  };
  return labels[normalized] || '未知状态';
}

export function getWorkflowBlockerView(state = {}) {
  const status = String(state.status || '').toLowerCase();
  const blocker = String(state.blocker || '').toLowerCase();
  const error = String(state.error || '').trim();
  const actionHint = String(state.actionHint || '').trim();
  const cooldown = Number(state.cooldownRemainingMs || 0);

  if (cooldown > 0) {
    return {
      title: '请求冷却中',
      message: `平台请求频率受限，约 ${Math.ceil(cooldown / 1000)} 秒后可继续。`
    };
  }
  if (['pending', 'running', 'retrying', 'resuming'].includes(status)) return null;
  if (status === 'waiting_manual' || /login|slider|captcha|manual|sycm|taobao|1688/.test(blocker)) {
    return {
      title: '需要人工处理',
      message: actionHint || error || '请处理平台登录、滑块或授权后继续流程。'
    };
  }
  if (status === 'retryable') {
    return {
      title: '可以重试',
      message: error || actionHint || '该节点失败但可以从当前节点重试。'
    };
  }
  if (status === 'blocked' || status === 'failed') {
    return {
      title: status === 'failed' ? '执行失败' : '流程阻塞',
      message: error || actionHint || state.blocker || '请查看节点详情后处理。'
    };
  }
  return null;
}

export function getWorkflowBlockerActions(nodeId, state = {}) {
  const status = String(state.status || '').toLowerCase();
  const blocker = String(state.blocker || '').toLowerCase();
  const error = String(state.error || '').toLowerCase();
  const actionHint = String(state.actionHint || '').toLowerCase();
  const platformStatus = String(state.platformStatus || state.manualAction?.status || '').toLowerCase();
  const recommended = state.nextRecommendedAction || null;
  const actions = [];
  if (!['blocked', 'failed', 'retryable', 'waiting_manual', 'paused'].includes(status)) {
    return actions;
  }
  const chromeFailureText = `${blocker} ${error} ${actionHint} ${platformStatus}`;
  const productDetailsBlocked = nodeId === 'collectRank' && (
    blocker === 'order_sheet_product_details_required' || platformStatus === 'product_details_required'
  );
  const sycmChromeBlocked = ['verify', 'collectRank'].includes(nodeId) && (
    blocker.includes('browser_cdp_unavailable') ||
    blocker.includes('cdp_unavailable') ||
    platformStatus.includes('cdp_unavailable') ||
    error.includes('127.0.0.1:9222') ||
    error.includes('econnrefused') ||
    actionHint.includes('chrome cdp') ||
    /no chrome tab found|chrome[^\n]*(?:tab|debug)|cdp|devtools/.test(chromeFailureText)
  );

  if (recommended && recommended.action && (!sycmChromeBlocked || recommended.action === 'start-sycm-chrome')) {
    const recommendedAction = {
      'confirm-keyword-review': 'keyword-review',
      'resume-after-manual': 'resume',
      'continue-or-fix-sycm': 'resume'
    }[recommended.action] || recommended.action;
    actions.push({
      action: recommendedAction,
      label: recommended.label || '处理阻塞',
      description: recommended.description || ''
    });
  }

  if (sycmChromeBlocked) {
    if (!actions.some((action) => action.action === 'start-sycm-chrome')) {
      actions.push({
        action: 'start-sycm-chrome',
        label: '启动 Chrome',
        description: '打开带调试端口的 Chrome，登录生意参谋后可重新检测或重跑验真。'
      });
    }
    actions.push({
      action: 'retry-node',
      label: nodeId === 'collectRank' ? '重试采集' : '重跑验真',
      description: nodeId === 'collectRank'
        ? 'Chrome 就绪并完成登录后，重新采集商品排行第一页。'
        : 'Chrome 就绪并完成登录后，从生意参谋校验节点重新执行。'
    });
  } else if (nodeId === 'verify' && (blocker === 'verified_empty' || blocker === 'no_generation_eligible_keywords')) {
    actions.push({
      action: 'retry-node',
      label: '重跑验真',
      description: blocker === 'no_generation_eligible_keywords'
        ? '调整候选词或人工放行后，从生意参谋校验节点重新执行。'
        : '补充候选词或调整参数后，从生意参谋校验节点重新执行。'
    });
  } else if (!productDetailsBlocked && ['waiting_manual', 'paused', 'blocked'].includes(status)) {
    actions.push({
      action: 'resume',
      label: '继续流程',
      description: '确认阻塞已处理后，从当前节点继续执行。'
    });
  }

  if (['retryable', 'failed'].includes(status)) {
    actions.push({
      action: 'retry-node',
      label: '重试节点',
      description: '当前节点及下游步骤会重新执行。'
    });
  }

  return actions.filter((action, index, list) => list.findIndex(item => item.action === action.action) === index);
}

export function getMiningRecoveryHint(run = null) {
  if (!run) return '';
  if (run.status === 'verified_empty') {
    return '当前流程验真无结果。补充候选词后，回到选品流水线重跑“生意参谋校验”。';
  }
  if (run.status === 'verified_no_generation_eligible') {
    return '当前流程有验真词，但机会分都未通过。请补充更好的候选词，或人工放行后再继续生成标题。';
  }
  if (run.status === 'manual_action_required' || run.status === 'verified_partial_manual_required') {
    return '当前流程需要处理生意参谋状态。处理完成后，回到选品流水线继续或重跑验真。';
  }
  return '';
}

export function getMiningRecoveryAction(run = null, addedCandidateCount = 0) {
  if (!run || (run.status !== 'verified_empty' && run.status !== 'verified_no_generation_eligible')) {
    return { visible: false, canRetryVerify: false, label: '', message: '' };
  }
  const added = Number.isFinite(Number(addedCandidateCount)) ? Math.max(0, Number(addedCandidateCount)) : 0;
  if (added <= 0) {
    return {
      visible: true,
      canRetryVerify: false,
      label: '重跑生意参谋校验',
      message: '请先补充新的候选词，重复词不会触发重跑验真。'
    };
  }
  return {
    visible: true,
    canRetryVerify: true,
    label: '重跑生意参谋校验',
    message: `已补充 ${added} 个候选词，可以从生意参谋校验节点重跑。`
  };
}

export function getWorkflowNodeViewModel(nodeId, state = {}) {
  const status = state.status || state.state || 'idle';
  const active = ['pending', 'running', 'retrying', 'resuming'].includes(String(status).toLowerCase());
  const progress = state.progress || null;
  const blocker = getWorkflowBlockerView(state);
  const successLabel = active ? '' : getWorkflowNodeSuccessLabel(nodeId, state);
  const resultLocation = getWorkflowNodeResultLocation(nodeId, state);
  return {
    nodeId,
    status,
    statusLabel: labelWorkflowNodeStatus(status),
    tone: getCanvasNodeTone(status),
    progress,
    progressLabel: formatWorkflowProgressLabel(progress),
    progressPercent: progress && Number.isFinite(Number(progress.percent))
      ? Math.max(0, Math.min(100, Number(progress.percent)))
      : 0,
    primaryAction: getWorkflowNodeAction(nodeId, state),
    blockerTitle: blocker?.title || '',
    blockerMessage: blocker?.message || '',
    hasBlocker: Boolean(blocker),
    durationMs: Number.isFinite(Number(state.durationMs)) ? Number(state.durationMs) : null,
    outputSummary: active ? '' : state.outputSummary || successLabel || '',
    successLabel,
    resultLocation,
    configSummary: String(nodeId) === 'start' && state.reviewUpload === true
      ? (state.uploadId ? `${state.uploadName || '刷单表'} · ${state.uploadSummary?.parsedSheetCount || state.groups?.length || 0} 个订单组 · ${state.uploadSummary?.productCount || 0} 个商品` : '尚未上传刷单表')
      : String(nodeId) === 'start' && state.orderSheetConfig === true
      ? getOrderSheetConfigSummary(state)
      : String(nodeId) === 'generateSheet' && state.sheetConfig === true
        ? getSheetConfigSummary(state)
        : ''
  };
}

/**
 * 格式化刷单表流水线的采集条件，供开始节点回显。
 * @param {object} state 开始节点配置。
 * @returns {string} 日期、页数和排序指标摘要。
 */
export function getOrderSheetConfigSummary(state = {}) {
  const dateMode = String(state.dateMode || 'latest_day');
  const dateLabel = dateMode === 'custom' && state.startDate && state.endDate
    ? `${state.startDate} 至 ${state.endDate}`
    : ORDER_SHEET_DATE_LABELS[dateMode] || ORDER_SHEET_DATE_LABELS.latest_day;
  const pages = Math.max(1, Math.min(5, Number.parseInt(state.pages, 10) || 1));
  const sortLabel = ORDER_SHEET_SORT_LABELS[state.sortMetric] || ORDER_SHEET_SORT_LABELS.itmUv;
  return `${dateLabel} · ${pages} 页 · ${sortLabel}降序`;
}

/**
 * 格式化生成业务表格节点的输出配置。
 * @param {object} state 制表节点配置。
 * @returns {string} 表格类型、数量和关键版式摘要。
 */
export function getSheetConfigSummary(state = {}) {
  const sheetType = state.sheetType === 'review' ? 'review' : 'order';
  const limit = Math.max(0, Number.parseInt(state.productLimit, 10) || 0);
  const countLabel = limit > 0 ? `${limit} 个商品` : '全部商品';
  if (sheetType === 'review') {
    if (state.reviewSourceUpload === true) return '评价表 · 按上传订单组';
    const groupSize = [1, 2, 4].includes(Number(state.reviewGroupSize)) ? Number(state.reviewGroupSize) : 4;
    return `评价表 · ${countLabel} · ${groupSize} 个/组`;
  }
  const amountLabel = {
    average: '平均实付',
    payment: '支付金额',
    blank: '金额留空'
  }[state.amountMode] || '平均实付';
  return `刷单表 · ${countLabel} · ${amountLabel}${state.includeImages === false ? ' · 无主图' : ''}`;
}

export function getWorkflowNodeSuccessLabel(nodeId, state = {}) {
  const output = state.output && typeof state.output === 'object' ? state.output : {};
  const normalized = String(nodeId || '');
  if (normalized === 'mine') {
    const count = Number(output.count ?? state.count ?? 0);
    return count > 0 ? `成功 ${count} 个候选词` : '';
  }
  if (normalized === 'keywordReview') {
    const approved = Number(output.approved ?? state.approved ?? 0);
    const rejected = Number(output.rejected ?? state.rejected ?? 0);
    const pending = Number(output.pending ?? state.pending ?? 0);
    if (approved > 0 || rejected > 0) return `通过 ${approved} 个，筛除 ${rejected} 个`;
    if (pending > 0) return `待筛选 ${pending} 个候选词`;
    return '';
  }
  if (normalized === 'verify') {
    const verified = Number(output.verified ?? output.count ?? state.verified ?? 0);
    const rejected = Number(output.rejected ?? state.rejected ?? 0);
    const generationEligible = Number(output.generationEligible ?? verified);
    const opportunityReview = Number(output.opportunityReview ?? Math.max(0, verified - generationEligible));
    if (verified > 0 || rejected > 0) {
      return `验真通过 ${verified} 个，可生成 ${generationEligible} 个，需复核/拒绝 ${opportunityReview} 个，验真拒绝 ${rejected} 个`;
    }
    return '';
  }
  if (normalized === 'generate') {
    const count = Number(output.count ?? state.count ?? 0);
    const titleCount = Number(output.titleCount ?? count);
    const sourceCount = Number(output.sourceCount ?? count);
    return count > 0 ? `${count} 条标题记录（${titleCount} 个标题，关联 ${sourceCount} 个已选货源）` : '';
  }
  if (normalized === 'select') {
    const count = Number(output.productCount ?? output.count ?? state.count ?? 0);
    const failed = Number(output.failed ?? state.failed ?? 0);
    if (state.manualDirectInput === true) {
      if (count > 0 || failed > 0) return `获取 ${count} 个商品，失败 ${failed} 个`;
      return '';
    }
    return count > 0 ? `选中 ${count} 条货源` : '';
  }
  if (normalized === 'export') {
    const count = Number(output.count ?? state.count ?? 0);
    return count > 0 ? `成功 ${count} 条铺货清单` : '';
  }
  if (normalized === 'collectRank') {
    const count = Number(output.count ?? state.count ?? 0);
    const manualCount = Number(output.manualCount ?? 0);
    const rankCount = Number(output.rankCount ?? Math.max(0, count - manualCount));
    if (manualCount > 0) {
      return rankCount > 0 ? `获取 ${rankCount} 个排行商品，追加 ${manualCount} 个指定商品` : `获取 ${manualCount} 个指定商品资料`;
    }
    const pages = Number(output.pages ?? 0);
    const sortLabel = output.sortLabel || '商品访客数';
    return count > 0 ? `采集 ${pages || 1} 页、${count} 条商品，按${sortLabel}降序` : '';
  }
  if (normalized === 'confirmProducts') {
    const groups = Number(output.groupCount ?? state.groupCount ?? 0);
    const products = Number(output.productCount ?? state.productCount ?? 0);
    return groups > 0 ? `已编排 ${groups} 个任务组、${products} 个商品` : '';
  }
  if (normalized === 'importSheet') {
    const groups = Number(output.groupCount || 0);
    const products = Number(output.productCount || 0);
    return products > 0 ? `识别 ${groups} 个订单组、${products} 个商品` : '';
  }
  if (normalized === 'generateReviews') {
    const count = Number(output.count || 0);
    if (count <= 0) return '';
    return output.degraded === true
      ? `已生成 ${count} 条评价草稿，部分使用本地规则`
      : `已生成 ${count} 条评价草稿`;
  }
  if (normalized === 'generateSheet') {
    const count = Number(output.count ?? state.count ?? 0);
    const imageCount = Number(output.imageCount ?? 0);
    if (count <= 0) return '';
    return output.sheetType === 'review'
      ? `生成评价表，写入 ${count} 条商品`
      : `生成刷单表，写入 ${count} 条商品和 ${imageCount} 张主图`;
  }
  return '';
}

export function getWorkflowNodeResultLocation(nodeId, state = {}) {
  const output = state.output && typeof state.output === 'object' ? state.output : {};
  const normalized = String(nodeId || '');
  if (normalized === 'mine') return output.file || '';
  if (normalized === 'keywordReview') return output.file || '';
  if (normalized === 'verify') return output.file || '';
  if (normalized === 'select') return output.file || '';
  if (normalized === 'generate') return output.file || '';
  if (normalized === 'collectRank') return output.file || '';
  if (normalized === 'confirmProducts') return output.file || '';
  if (normalized === 'generateSheet') return output.file || '';
  if (normalized === 'export') {
    const locations = [
      output.batchFile ? `铺货清单：${output.batchFile}` : '',
      output.reviewFile ? `复核报告：${output.reviewFile}` : ''
    ].filter(Boolean);
    return locations.join('\n') || output.file || '';
  }
  if (normalized === 'review') return output.reviewFile || '';
  return output.file || '';
}

export function getWorkflowResultSummaryView(nodeId, state = {}) {
  const normalized = String(nodeId || '');
  const manualProductInput = normalized === 'select' && state.manualDirectInput === true;
  const sheetType = state.output?.sheetType === 'review' ? 'review' : 'order';
  const titles = {
    mine: '灵感选词结果',
    keywordReview: '人工筛词结果',
    verify: '生意参谋校验结果',
    select: '货源选品结果',
    generate: '标题生成结果',
    collectRank: '商品资料获取结果',
    confirmProducts: '商品确认与组合方案',
    generateSheet: sheetType === 'review' ? '商品评价表' : '商品排行刷单表',
    export: '铺货清单与复核结果',
    review: '铺货清单与复核结果',
    end: '流程完成结果'
  };
  if (manualProductInput) titles.select = '商品资料获取结果';
  const hints = {
    mine: '候选词及其灵感来源在下方预览，完整链路保存在运行产物中。',
    keywordReview: '人工确认后的关键词会保存到 reviewed-candidates.jsonl，只有通过项会进入生意参谋校验。',
    verify: '验真通过词在下方结果列表中预览，完整内容保存在 verified-keywords.jsonl。',
    select: '已选货源会按商品信息和机会分展示，完整内容保存在 selected-products.jsonl。',
    generate: '每条标题记录会关联已选货源；完整内容保存在 generated-products.jsonl。',
    collectRank: '排行商品与指定商品会统一展示；自动读取失败的指定商品可在当前节点补充后继续。',
    confirmProducts: '只有确认后的任务组会进入刷单表；备选池中的商品不会输出。',
    generateSheet: sheetType === 'review'
      ? 'Excel 按1拖多评价格式写入刷单日期、店铺和商品标题，并附带生意参谋原始指标。'
      : 'Excel 按动销一拖多格式写入标题、主图、下单金额、做单要求和店铺，并附带生意参谋原始指标。',
    export: '自动导出的清单和被拦截的复核项会合并在下方操作台。',
    review: '自动导出的清单和被拦截的复核项会合并在下方操作台。',
    end: '流程完成后可从各节点查看对应产物。'
  };
  if (manualProductInput) hints.select = '每个1688链接会独立读取商品标题、主图、类目和价格，失败项可从当前节点重试。';
  const actionLabels = {
    mine: '查看候选词',
    keywordReview: '查看筛词结果',
    verify: '查看验真词',
    select: '查看已选货源',
    generate: '查看标题结果',
    collectRank: '核对商品资料',
    confirmProducts: '查看组合方案',
    generateSheet: '下载 Excel',
    export: '查看铺货复核',
    review: '查看铺货复核',
    end: '查看完成结果'
  };
  if (manualProductInput) actionLabels.select = '查看商品资料';
  const countLabel = getWorkflowNodeSuccessLabel(normalized, state);
  const locationLabel = getWorkflowNodeResultLocation(normalized, state);
  return {
    title: titles[normalized] || '节点结果',
    statusLabel: labelWorkflowNodeStatus(state.status || state.state || 'idle'),
    countLabel,
    locationLabel,
    hint: hints[normalized] || '节点结果会在下方展示，完整内容保存在对应产物文件。',
    primaryActionLabel: actionLabels[normalized] || '查看结果',
    empty: !countLabel && !locationLabel
  };
}

export function labelWorkflowBlockerReason(blocker) {
  const normalized = String(blocker || '').toLowerCase();
  const labels = {
    sycm_chrome_unavailable: 'Chrome 调试连接不可用',
    chrome_unavailable: 'Chrome 调试连接不可用',
    no_inspiration_candidates: '没有可用的动态候选词',
    verified_empty: '验真无结果',
    keyword_review_required: '需要人工筛词',
    no_keyword_review_approved: '没有通过筛词的关键词',
    no_generation_eligible_keywords: '没有可生成标题的词',
    sycm_manual_action_required: '生意参谋需要人工处理',
    sycm_partial_manual_required: '生意参谋部分阻塞',
    sycm_login_required: '生意参谋需要登录',
    slider_required: '需要滑块验证',
    captcha_required: '需要验证码',
    login_required: '需要登录',
    permission_required: '权限不足',
    platform_cooldown: '平台请求冷却',
    generate_failed: '标题生成失败',
    export_empty: '导出无结果',
    review_rejected_rows: '需要人工复核',
    order_sheet_product_details_required: '指定商品资料不完整',
    product_confirmation_required: '需要确认商品与编组'
  };
  return labels[normalized] || String(blocker || '');
}

export function getWorkflowNodeDetailRows(node = {}) {
  const data = node.data || {};
  const view = getWorkflowNodeViewModel(node.id, data);
  const manualAction = data.manualAction && typeof data.manualAction === 'object' ? data.manualAction : null;
  const platformStatus = data.platformStatus || manualAction?.status || '';
  const actionHint = data.actionHint || manualAction?.userMessage || '';
  const status = String(data.status || data.state || '').toLowerCase();
  const active = ['pending', 'running', 'retrying', 'resuming'].includes(status);
  const verifyOutput = data.output && typeof data.output === 'object' ? data.output : {};
  const inferredVerifiedEmpty = node.id === 'verify'
    && status === 'blocked'
    && !data.blocker
    && !data.error
    && Number(verifyOutput.verified || 0) === 0
    && Number(verifyOutput.rejected || 0) > 0;
  const inferredVerifyBlocked = node.id === 'verify' && status === 'blocked' && !data.blocker && !data.error && !inferredVerifiedEmpty;
  const rows = [
    { label: '状态', value: view.statusLabel }
  ];
  if (view.progressLabel) rows.push({ label: '进度', value: view.progressLabel });
  if (data.keyword) rows.push({ label: '关键词', value: data.keyword });
  if (data.count) rows.push({ label: '数量', value: `${data.count}` });
  if (data.maxLength) rows.push({ label: '标题长度', value: `${data.maxLength}` });
  if (view.successLabel) rows.push({ label: '成功数量', value: view.successLabel });
  if (view.outputSummary) rows.push({ label: '输出摘要', value: view.outputSummary });
  if (view.resultLocation) rows.push({ label: '产物位置', value: view.resultLocation });
  if (data.error) rows.push({ label: '错误', value: data.error });
  if (data.blocker && !data.error && !active) rows.push({ label: '阻塞原因', value: labelWorkflowBlockerReason(data.blocker) });
  if (inferredVerifiedEmpty) rows.push({ label: '阻塞原因', value: '验真无结果' });
  if (inferredVerifyBlocked) rows.push({ label: '阻塞原因', value: '生意参谋校验阻塞' });
  if (platformStatus && !data.error && !active) rows.push({ label: '平台状态', value: labelWorkflowBlockerReason(platformStatus) });
  if (actionHint && !data.error && !active) rows.push({ label: '处理建议', value: actionHint });
  if (inferredVerifiedEmpty && !actionHint) {
    rows.push({ label: '处理建议', value: '生意参谋验真没有通过词。请更换候选词、降低蓝海阈值，或重新挖词后再继续。' });
  }
  if (inferredVerifyBlocked && !actionHint) {
    rows.push({ label: '处理建议', value: '请检查生意参谋登录、滑块、权限或验真结果为空，再继续或重跑校验。' });
  }
  if (view.blockerMessage && !data.error && !actionHint && !inferredVerifyBlocked) rows.push({ label: view.blockerTitle || '提示', value: view.blockerMessage });
  return rows.filter((row) => row.value !== null && row.value !== undefined && String(row.value).trim() !== '');
}

export function getWorkflowRuntimeActions({ runStatus = '', nodeId = '', state = {} } = {}) {
  const normalizedRunStatus = String(runStatus || '').toLowerCase();
  const normalizedNodeStatus = String(state.status || state.state || '').toLowerCase();
  const activeRunStatuses = new Set(['pending', 'running', 'created', 'mined', 'awaiting_keyword_review', 'keywords_reviewed', 'verified', 'generated', 'resuming', 'retrying']);
  const activeNodeStatuses = new Set(['running', 'resuming', 'retrying']);
  if (!nodeId || !activeRunStatuses.has(normalizedRunStatus) || !activeNodeStatuses.has(normalizedNodeStatus)) {
    return [];
  }
  return [{
    action: 'pause',
    label: '暂停当前流程',
    description: '当前步骤会在安全边界停止，之后可以继续执行。'
  }];
}

export function getWorkflowOperationMessage(action, result, error = '') {
  if (result === 'error') {
    const prefix = action === 'pause'
      ? '暂停请求失败'
      : action === 'resume'
        ? '继续请求失败'
        : action === 'mine-more'
          ? '补充候选词失败'
        : action === 'retry-node'
          ? '重试请求失败'
        : action === 'open-review'
          ? '复核报告打开失败'
        : action === 'confirm-distribution'
            ? '确认铺货失败'
            : action === 'product-review'
              ? '人工选品失败'
            : action === 'start-sycm-chrome'
              ? '启动 Chrome 失败'
          : '操作失败';
    return `${prefix}: ${error || '未知错误'}`;
  }
  if (action === 'pause') return '已请求暂停，当前步骤会在安全边界停止。';
  if (action === 'resume') return '已请求继续，流程会从当前节点恢复。';
  if (action === 'mine-more') return '已开始重新挖掘候选词，完成后会继续生意参谋校验。';
  if (action === 'retry-node') return '已请求重试，当前节点及下游步骤会重新执行。';
  if (action === 'manual-input') return '已打开启动配置，完成输入后即可运行流水线。';
  if (action === 'open-review') return '复核报告已在节点产物中展示。';
  if (action === 'confirm-distribution') return '已打开导出清单预览，可复制铺货内容进行人工铺货，或确认后开始自动铺货。';
  if (action === 'keyword-review') return '已打开人工筛词，请保留或筛除关键词后确认。';
  if (action === 'confirm-keyword-review') return '已打开人工筛词，请核对保留项和筛除项后确认。';
  if (action === 'product-review') return '已打开人工选品，请勾选 1688 货源或手动添加商品后确认。';
  if (action === 'start-sycm-chrome') return result?.userMessage || 'Chrome 已启动。请登录生意参谋后重跑验真。';
  return '操作已提交。';
}

export function buildWorkflowOperationRequest(runId, action, nodeId = '') {
  const encodedRunId = encodeURIComponent(String(runId || ''));
  if (action === 'start-sycm-chrome') {
    return {
      endpoint: '/api/workflows/sycm/chrome/start',
      body: { runId, nodeId }
    };
  }
  if (action === 'retry-node') {
    return {
      endpoint: `/api/workflows/runs/${encodedRunId}/retry-node`,
      body: { nodeId }
    };
  }
  if (action === 'mine-more') {
    return {
      endpoint: `/api/workflows/runs/${encodedRunId}/retry-node`,
      body: { nodeId: 'mine' }
    };
  }
  return {
    endpoint: `/api/workflows/runs/${encodedRunId}/${action}`,
    body: {}
  };
}

export function buildWorkflowDeleteRunRequest(runId) {
  const encodedRunId = encodeURIComponent(String(runId || ''));
  return {
    endpoint: `/api/workflows/runs/${encodedRunId}`,
    options: {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true })
    }
  };
}

export function getWorkflowTemplateView(template = {}) {
  const mode = String(template.mode || template.workflow?.mode || '').toLowerCase();
  const id = String(template.id || '').toLowerCase();
  const isKeyword = mode === 'keyword' || id === 'exact-keyword-v1';
  const isManual = mode === 'manual' || id === 'manual-selection-v1';
  const isOrderSheet = mode === 'order-sheet' || id === 'sycm-order-sheet-v1';
  const defaults = isOrderSheet
    ? {
        entryLabel: '入口：生意参谋商品排行',
        scenarioLabel: '适合：按指定范围制作商品动销表',
        flowSummary: '流程：设置日期/页数/指标 → 商品排行 → 降序采集 → Excel',
        modeHint: '选择日期范围、采集页数和排序指标，使用当前 Chrome 登录态生成可下载表格。'
      }
    : isManual
    ? {
        entryLabel: '入口：手动关键词',
        scenarioLabel: '适合：精确控制词和商品',
        flowSummary: '流程：人工选词 → 人工选品 → AI生成标题 → URL$$标题$$类目',
        modeHint: '先输入关键词并筛选，再勾选 1688 货源或手动添加商品。'
      }
    : isKeyword
    ? {
        entryLabel: '入口：手动关键词',
        scenarioLabel: '适合：批量验证明确目标词',
        flowSummary: '流程：批量输入关键词 → 跳过挖词 → 生意参谋校验 → 货源选品 → 标题生成 → 导出复核',
        modeHint: '每行输入一个关键词，系统会逐词验真、选品和生成标题。'
      }
    : {
        entryLabel: '入口：动态灵感',
        scenarioLabel: '适合：每天自动发现新机会',
        flowSummary: '流程：灵感选词 → 人工筛词 → 生意参谋校验 → 货源选品 → 标题生成 → 导出复核',
        modeHint: '从新闻、字典、日历和趋势动态发现商品词根，不要求预先维护种子池。'
      };
  return {
    entryLabel: template.entryLabel || defaults.entryLabel,
    scenarioLabel: template.scenarioLabel || defaults.scenarioLabel,
    flowSummary: template.flowSummary || defaults.flowSummary,
    modeHint: template.modeHint || defaults.modeHint
  };
}

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

function inferRunTitle(run = {}) {
  const explicit = String(run.keyword || run.title || run.name || '').trim();
  if (explicit) return explicit;
  const workflowId = String(run.workflow?.id || run.templateId || '').toLowerCase();
  const workflowMode = String(run.workflow?.mode || run.mode || '').toLowerCase();
  if (workflowId === 'daily-selection-v1' || workflowMode === 'daily') return '每日蓝海选品流水线';
  if (workflowId === 'exact-keyword-v1' || workflowMode === 'keyword') return '精确关键词选品流水线';
  if (workflowId === 'sycm-order-sheet-v1' || workflowMode === 'order-sheet') return '制作刷单表格流水线';
  const nodes = Array.isArray(run.workflow?.nodes) ? run.workflow.nodes : [];
  const start = nodes.find((node) => node.id === 'start') || nodes[0] || {};
  return String(start.data?.keyword || start.data?.label || run.runId || '未命名流程').trim();
}

function isOrderSheetRun(run = {}) {
  const workflowId = String(run.workflow?.id || run.templateId || '').toLowerCase();
  const workflowMode = String(run.workflow?.mode || run.mode || run.options?.mode || '').toLowerCase();
  return workflowId === 'sycm-order-sheet-v1' || workflowMode === 'order-sheet';
}

function labelUnifiedRunStage(run = {}) {
  const stage = String(run.stage || '').toLowerCase();
  if (isOrderSheetRun(run) && ['submitted', 'workflow_complete'].includes(stage)) {
    return '表格已生成';
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

function labelUnifiedRunStatus(status) {
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

function getUnifiedRunVisualState(run = {}) {
  const status = String(run.status || '').toLowerCase();
  if (status === 'failed') return 'failed';
  if (['blocked', 'retryable', 'waiting_manual', 'paused', 'manual_action_required'].includes(status)) return 'paused';
  return getPipelineSummaryVisualState(run);
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

export {
  getWorkflowArtifactView,
  summarizeWorkflowArtifact
} from './features/workflow/artifact-view.js';

export function normalizeCandidateForTitle(candidate = {}) {
  const sycmData = candidate.sycmData || candidate.marketMetrics || {};
  return {
    keyword: String(candidate.keyword || '').trim(),
    score: candidate.localScore ?? candidate.score ?? null,
    source: candidate.source || 'manual',
    gateStatus: candidate.gateStatus || (candidate.canDistribute ? 'verified' : 'candidate'),
    gateReason: candidate.gateReason || candidate.lastReason || '',
    canDistribute: Boolean(candidate.canDistribute),
    marketScore: candidate.marketScore ?? sycmData.marketScore ?? null,
    confidence: candidate.marketMetrics?.confidence || candidate.confidence || null,
    scoreBreakdown: candidate.marketMetrics?.breakdown || candidate.scoreBreakdown || null,
    market: {
      searchPopularity: sycmData.searchPopularity ?? null,
      demandSupplyRatio: sycmData.demandSupplyRatio ?? null,
      clickRate: sycmData.clickRate ?? null,
      conversionRate: sycmData.conversionRate ?? sycmData.payConversionRate ?? null,
      buyerCount: sycmData.buyerCount ?? null,
      onlineProductCount: sycmData.onlineProductCount ?? null,
      trend: sycmData.trend ?? null
    },
    raw: candidate
  };
}

export function buildReviewProduct({ keyword, product = {}, candidate = {} }) {
  return {
    id: `${keyword || candidate.keyword || ''}:${product['产品链接'] || product.productUrl || product['铺货标题'] || Date.now()}`,
    keyword: keyword || candidate.keyword || '',
    selectedKeyword: keyword || candidate.selectedKeyword || candidate.keyword || '',
    title: product['铺货标题'] || product.title || '',
    productTitle: product['链接原标题'] || product.productTitle || '',
    productUrl: product['产品链接'] || product.productUrl || '',
    imageUrl: product['主图链接'] || product.imageUrl || '',
    price: product['商品原价'] || product.price || '',
    canDistribute: Boolean(candidate.canDistribute),
    reason: candidate.gateReason || candidate.reason || ''
  };
}

/**
 * 格式化 workflow 节点进度文案。
 * @param {object|null} progress 节点进度。
 * @returns {string} 进度展示文案。
 */
export function formatWorkflowProgressLabel(progress) {
  if (!progress || typeof progress !== 'object') return '';
  const parts = [];
  const hasCurrent = progress.current !== null && progress.current !== undefined && progress.current !== '';
  const hasTotal = progress.total !== null && progress.total !== undefined && progress.total !== '';
  const hasPercent = progress.percent !== null && progress.percent !== undefined && progress.percent !== '';
  const message = String(progress.message || '').trim();
  if (message) parts.push(message);
  if (hasCurrent && hasTotal) parts.push(`${progress.current}/${progress.total}`);
  if (hasPercent) parts.push(`${progress.percent}%`);
  return parts.join(' · ');
}

/**
 * 归一化 workflow SSE progress 事件，兼容 payload 包裹和扁平 runtime event。
 * @param {object|null} event SSE 事件数据。
 * @returns {object} 节点进度。
 */
export function normalizeWorkflowProgressEvent(event) {
  if (!event || typeof event !== 'object') return {};
  const source = event.payload && typeof event.payload === 'object' ? event.payload : event;
  const { event: _event, ...progress } = source;
  return progress;
}

export function isWorkflowInputNodeType(type) {
  return type === 'keyword-input' || type === 'input' || type === 'start';
}

export function getStartNodeParams(nodes = []) {
  const startNode = nodes.find((node) => isWorkflowInputNodeType(node.type) || node.id === 'start') || nodes[0];
  if (!startNode?.data) return {};
  const params = { ...startNode.data };
  ['status', 'state', 'output', 'error', 'progress', 'onSelect', 'originalType'].forEach((key) => delete params[key]);
  return params;
}

export function parseExactKeywords(input) {
  return [...new Set((Array.isArray(input) ? input : [input])
    .flatMap((value) => String(value || '').split(/[\r\n,，;；、]+/))
    .map((value) => value.trim())
    .filter(Boolean))];
}

function isAllowedOrderSheetItemUrl(url) {
  const hostname = url.hostname.toLowerCase();
  const allowedHost = ['item.taobao.com', 'detail.tmall.com', 'detail.tmall.hk'].includes(hostname)
    || hostname === 'm.taobao.com'
    || hostname.endsWith('.m.taobao.com')
    || hostname === 'tb.cn'
    || hostname.endsWith('.tb.cn');
  const defaultPort = url.protocol === 'https:' ? ['', '443'] : url.protocol === 'http:' ? ['', '80'] : [];
  return allowedHost && defaultPort.includes(url.port);
}

function parseOrderSheetManualItem(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    return { itemId: text, productUrl: `https://item.taobao.com/item.htm?id=${text}` };
  }
  const urlText = text.match(/https?:\/\/[^\s，,；;]+/i)?.[0] || '';
  if (!urlText) return null;
  try {
    const url = new URL(urlText);
    if (!isAllowedOrderSheetItemUrl(url)) return null;
    const queryId = url.searchParams.get('id') || url.searchParams.get('itemId');
    const pathId = url.pathname.match(/\/(?:item\/|i?)(\d+)(?:\.html?)?/i)?.[1] || '';
    const itemId = /^\d+$/.test(String(queryId || '')) ? String(queryId) : pathId;
    return {
      itemId,
      productUrl: url.href,
      ...(itemId ? {} : { sourceKey: `url:${url.href}` })
    };
  } catch {
    return null;
  }
}

/**
 * Parse order-sheet item IDs and Taobao/Tmall links for immediate UI feedback.
 * Backend validation repeats the same trust boundary before starting a run.
 * @param {string} input Multiline product input.
 * @param {Array<object>} [overrides=[]] User-entered product details.
 * @returns {{items:Array<object>, totalCount:number, duplicateCount:number, invalidCount:number, truncatedCount:number}}
 */
export function parseOrderSheetManualItems(input, overrides = []) {
  const tokens = String(input || '').split(/[\r\n,，;；、]+/).map((item) => item.trim()).filter(Boolean);
  const byKey = new Map();
  let duplicateCount = 0;
  let invalidCount = 0;
  let truncatedCount = 0;
  for (const token of tokens) {
    const parsed = parseOrderSheetManualItem(token);
    if (!parsed) {
      invalidCount += 1;
      continue;
    }
    const key = parsed.itemId || parsed.sourceKey;
    if (byKey.has(key)) {
      duplicateCount += 1;
      continue;
    }
    if (byKey.size >= 100) {
      truncatedCount += 1;
      continue;
    }
    byKey.set(key, {
      ...parsed,
      title: '',
      imageUrl: '',
      storeName: '',
      orderAmount: null,
      sourceType: 'manual',
      enrichmentStatus: 'pending'
    });
  }
  for (const override of Array.isArray(overrides) ? overrides : []) {
    const key = String(override?.itemId || override?.sourceKey || '').trim();
    if (!key || !byKey.has(key)) continue;
    const current = byKey.get(key);
    byKey.set(key, {
      ...current,
      ...(String(override.title || '').trim() ? { title: String(override.title).trim() } : {}),
      ...(String(override.imageUrl || '').trim() ? { imageUrl: String(override.imageUrl).trim() } : {}),
      ...(String(override.storeName || '').trim() ? { storeName: String(override.storeName).trim() } : {}),
      ...(Number(override.orderAmount) > 0 ? { orderAmount: Number(override.orderAmount) } : {})
    });
  }
  return { items: [...byKey.values()], totalCount: tokens.length, duplicateCount, invalidCount, truncatedCount };
}

/**
 * Collect executable parameters from the canvas using backend parameter names.
 * @param {Array<object>} nodes Canvas nodes.
 * @returns {object} Workflow launch parameters.
 */
export function getWorkflowLaunchParams(nodes = []) {
  const params = { ...getStartNodeParams(nodes) };
  const dataFor = (id) => nodes.find((node) => node.id === id)?.data || {};
  const mine = dataFor('mine');
  const verify = dataFor('verify');
  const select = dataFor('select');
  const generate = dataFor('generate');
  const exportNode = dataFor('export');
  const generateSheet = dataFor('generateSheet');
  const generateReviews = dataFor('generateReviews');

  if (params.keywordsText != null || params.keywords != null) {
    const keywords = parseExactKeywords(params.keywordsText ?? params.keywords);
    params.keyword = keywords[0] || String(params.keyword || '').trim();
    if (keywords.length > 1) params.keywords = keywords;
    else delete params.keywords;
    delete params.keywordsText;
  }

  if (params.maxLength != null && params.length == null) params.length = params.maxLength;
  delete params.maxLength;
  if (mine.mine != null || mine.count != null) params.mine = mine.mine ?? mine.count;
  if (verify.verify != null || verify.limit != null || verify.count != null) {
    params.verify = verify.verify ?? verify.limit ?? verify.count;
  }
  if (select.select != null || select.limit != null || select.count != null) {
    params.select = select.select ?? select.limit ?? select.count;
  }
  if (generate.generate != null || generate.limit != null || generate.count != null) {
    params.generate = generate.generate ?? generate.limit ?? generate.count;
  }
  if (generate.length != null || generate.maxLength != null) {
    params.length = generate.length ?? generate.maxLength;
  }
  if (exportNode.export != null || exportNode.limit != null || exportNode.count != null) {
    params.export = exportNode.export ?? exportNode.limit ?? exportNode.count;
  }
  for (const key of ['sheetType', 'storeName', 'orderDate', 'productLimit', 'fileName', 'includeRawData', 'includeImages', 'amountMode', 'missingAmountPolicy', 'cartQuantity', 'rowSpan', 'workRequirement', 'orderNote', 'reviewGroupSize', 'includeSpacerRow']) {
    if (generateSheet[key] != null) params[key] = generateSheet[key];
  }
  for (const key of ['reviewTone', 'reviewLength', 'useAI']) {
    if (generateReviews[key] != null) params[key] = generateReviews[key];
  }
  return params;
}

export function getWorkflowLaunchBlocker(mode, nodes = []) {
  const params = getStartNodeParams(nodes);
  if (mode === 'review-sheet') {
    const groups = Array.isArray(params.groups) ? params.groups : [];
    if (!params.uploadId || groups.length === 0) {
      const message = '请先在上传刷单表节点选择并解析 .xlsx 文件';
      return { status: 'blocked', error: message, logs: [{ timestamp: new Date().toISOString(), level: 'error', message: `[review_source_required] ${message}` }] };
    }
    const missing = groups.flatMap((group, index) => ['orderDate', 'storeName', 'buyerName', 'buyerPhone', 'orderNumber']
      .filter((field) => !String(group?.[field] || '').trim())
      .map((field) => `${index + 1}:${field}`));
    if (missing.length > 0) {
      const message = `还有 ${missing.length} 项订单信息未补全，请填写日期、店铺、旺旺、手机号和订单号`;
      return { status: 'blocked', error: message, logs: [{ timestamp: new Date().toISOString(), level: 'error', message: `[review_order_info_required] ${message}` }] };
    }
    return null;
  }
  if (mode === 'manual') {
    const items = Array.isArray(params.items) ? params.items : [];
    if (items.length > 0 && items.every((item) => String(item?.keyword || params.defaultKeyword || '').trim() && /1688\.com/i.test(String(item?.url || '')))) return null;
    const message = '请先在开始节点录入关键词和有效的 1688 商品链接';
    return {
      status: 'blocked',
      error: message,
      logs: [{
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `[keywords_required] ${message}`
      }]
    };
  }
  if (mode === 'order-sheet') {
    const inputMode = ['rank', 'manual', 'hybrid'].includes(params.inputMode) ? params.inputMode : 'rank';
    const parsed = parseOrderSheetManualItems(params.manualItemsText || '', params.manualItems || []);
    if (inputMode === 'manual' && parsed.items.length === 0) {
      const message = '请至少输入一个有效的淘宝或天猫商品 ID／链接';
      return {
        status: 'blocked',
        error: message,
        logs: [{ timestamp: new Date().toISOString(), level: 'error', message: `[order_sheet_items_required] ${message}` }]
      };
    }
  }
  if (mode === 'order-sheet' && params.inputMode !== 'manual' && params.dateMode === 'custom') {
    const startDate = String(params.startDate || '');
    const endDate = String(params.endDate || '');
    const start = /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? new Date(`${startDate}T00:00:00Z`) : null;
    const end = /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? new Date(`${endDate}T00:00:00Z`) : null;
    const days = start && end ? Math.floor((end.getTime() - start.getTime()) / 86400000) + 1 : 0;
    const message = !start || !end
      ? '请选择完整的开始日期和结束日期'
      : days < 1
        ? '开始日期不能晚于结束日期'
        : days > 31
          ? '生意参谋自定义日期范围最多选择 31 天'
          : '';
    if (message) {
      return {
        status: 'blocked',
        error: message,
        logs: [{ timestamp: new Date().toISOString(), level: 'error', message: `[date_range_invalid] ${message}` }]
      };
    }
  }
  if (mode !== 'keyword') return null;
  const keywords = parseExactKeywords(params.keywordsText ?? params.keywords ?? params.keyword);
  if (keywords.length > 20) {
    const message = '一次最多输入 20 个关键词';
    return {
      status: 'blocked',
      error: message,
      logs: [{
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `[keywords_limit_exceeded] ${message}`
      }]
    };
  }
  if (keywords.length > 0) return null;
  const message = '关键词不能为空';
  return {
    status: 'blocked',
    error: message,
    logs: [{
      timestamp: new Date().toISOString(),
      level: 'error',
      message: `[keyword_required] ${message}`
    }]
  };
}
