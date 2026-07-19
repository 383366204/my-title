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
 * @param {string} state 节点状态。
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
  const normalizedState = String(state || '').toLowerCase();
  if (normalizedNodeId === 'keywordreview' && ['needs_review', 'waiting_confirmation', 'awaiting_keyword_review', 'blocked'].includes(normalizedState)) {
    return { label: '输入/筛词', action: 'keyword-review', tone: 'warn' };
  }
  if (normalizedNodeId === 'select' && ['awaiting_product_review', 'needs_review', 'waiting_confirmation'].includes(normalizedState)) {
    return { label: '人工选品', action: 'product-review', tone: 'warn' };
  }
  if (normalizedNodeId === 'export' && ['needs_review'].includes(normalizedState)) {
    return { label: '处理铺货复核', action: 'open-review', tone: 'warn' };
  }
  if (normalizedNodeId === 'export' && ['waiting_confirmation', 'awaiting_user_confirmation', 'ready', 'ready_to_distribute', 'completed'].includes(normalizedState)) {
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
    return { label: '重试节点', action: 'retry-node', tone: 'warn' };
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
  const sycmChromeBlocked = nodeId === 'verify' && (
    blocker.includes('browser_cdp_unavailable') ||
    blocker.includes('cdp_unavailable') ||
    platformStatus.includes('cdp_unavailable') ||
    error.includes('127.0.0.1:9222') ||
    error.includes('econnrefused') ||
    actionHint.includes('chrome cdp')
  );

  if (recommended && recommended.action) {
    actions.push({
      action: recommended.action,
      label: recommended.label || '处理阻塞',
      description: recommended.description || ''
    });
  }

  if (sycmChromeBlocked) {
    actions.push({
      action: 'start-sycm-chrome',
      label: '启动 Chrome',
      description: '打开带调试端口的 Chrome，登录生意参谋后可重新检测或重跑验真。'
    });
    actions.push({
      action: 'retry-node',
      label: '重跑验真',
      description: 'Chrome 就绪并完成登录后，从生意参谋校验节点重新执行。'
    });
  } else if (nodeId === 'verify' && (blocker === 'verified_empty' || blocker === 'no_generation_eligible_keywords')) {
    actions.push({
      action: 'retry-node',
      label: '重跑验真',
      description: blocker === 'no_generation_eligible_keywords'
        ? '调整候选词或人工放行后，从生意参谋校验节点重新执行。'
        : '补充候选词或调整参数后，从生意参谋校验节点重新执行。'
    });
  } else if (['waiting_manual', 'paused', 'blocked'].includes(status)) {
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

  return actions.filter((action, index, list) => (
    list.findIndex(item => item.action === action.action && item.label === action.label) === index
  ));
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
  const progress = state.progress || null;
  const blocker = getWorkflowBlockerView(state);
  const successLabel = getWorkflowNodeSuccessLabel(nodeId, state);
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
    primaryAction: getWorkflowNodeAction(nodeId, status),
    blockerTitle: blocker?.title || '',
    blockerMessage: blocker?.message || '',
    hasBlocker: Boolean(blocker),
    durationMs: Number.isFinite(Number(state.durationMs)) ? Number(state.durationMs) : null,
    outputSummary: state.outputSummary || successLabel || '',
    successLabel,
    resultLocation
  };
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
    return count > 0 ? `选中 ${count} 条货源` : '';
  }
  if (normalized === 'export') {
    const count = Number(output.count ?? state.count ?? 0);
    return count > 0 ? `成功 ${count} 条铺货清单` : '';
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
  const titles = {
    mine: '选词挖掘结果',
    keywordReview: '人工筛词结果',
    verify: '生意参谋校验结果',
    select: '货源选品结果',
    generate: '标题生成结果',
    export: '铺货清单与复核结果',
    review: '铺货清单与复核结果',
    end: '流程完成结果'
  };
  const hints = {
    mine: '候选词在下方结果列表中预览，完整内容保存在 candidates.jsonl。',
    keywordReview: '人工确认后的关键词会保存到 reviewed-candidates.jsonl，只有通过项会进入生意参谋校验。',
    verify: '验真通过词在下方结果列表中预览，完整内容保存在 verified-keywords.jsonl。',
    select: '已选货源会按商品信息和机会分展示，完整内容保存在 selected-products.jsonl。',
    generate: '每条标题记录会关联已选货源；完整内容保存在 generated-products.jsonl。',
    export: '自动导出的清单和被拦截的复核项会合并在下方操作台。',
    review: '自动导出的清单和被拦截的复核项会合并在下方操作台。',
    end: '流程完成后可从各节点查看对应产物。'
  };
  const actionLabels = {
    mine: '查看候选词',
    keywordReview: '查看筛词结果',
    verify: '查看验真词',
    select: '查看已选货源',
    generate: '查看标题结果',
    export: '查看铺货复核',
    review: '查看铺货复核',
    end: '查看完成结果'
  };
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
    review_rejected_rows: '需要人工复核'
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
  if (data.blocker && !data.error) rows.push({ label: '阻塞原因', value: labelWorkflowBlockerReason(data.blocker) });
  if (inferredVerifiedEmpty) rows.push({ label: '阻塞原因', value: '验真无结果' });
  if (inferredVerifyBlocked) rows.push({ label: '阻塞原因', value: '生意参谋校验阻塞' });
  if (platformStatus && !data.error) rows.push({ label: '平台状态', value: labelWorkflowBlockerReason(platformStatus) });
  if (actionHint && !data.error) rows.push({ label: '处理建议', value: actionHint });
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
  if (action === 'retry-node') return '已请求重试，当前节点及下游步骤会重新执行。';
  if (action === 'open-review') return '复核报告已在节点产物中展示。';
  if (action === 'confirm-distribution') return '已打开铺货复核，请在清单预览中确认商品后开始自动铺货。';
  if (action === 'keyword-review') return '已打开人工筛词，请保留或筛除关键词后确认。';
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
  const defaults = isManual
    ? {
        entryLabel: '入口：手动关键词',
        scenarioLabel: '适合：精确控制词和商品',
        flowSummary: '流程：人工选词 → 人工选品 → AI生成标题 → URL$$标题$$类目',
        modeHint: '先输入关键词并筛选，再勾选 1688 货源或手动添加商品。'
      }
    : isKeyword
    ? {
        entryLabel: '入口：手动关键词',
        scenarioLabel: '适合：验证一个明确目标词',
        flowSummary: '流程：输入关键词 → 跳过挖词 → 生意参谋校验 → 货源选品 → 标题生成 → 导出复核',
        modeHint: '使用你输入的关键词，跳过选词挖掘，直接进入生意参谋校验。'
      }
    : {
        entryLabel: '入口：种子池',
        scenarioLabel: '适合：每天自动发现新机会',
        flowSummary: '流程：选词挖掘 → 人工筛词 → 生意参谋校验 → 货源选品 → 标题生成 → 导出复核',
        modeHint: '从种子池自动扩展候选词，会先执行选词挖掘。'
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
  const nodes = Array.isArray(run.workflow?.nodes) ? run.workflow.nodes : [];
  const start = nodes.find((node) => node.id === 'start') || nodes[0] || {};
  return String(start.data?.keyword || start.data?.label || run.runId || '未命名流程').trim();
}

function labelUnifiedRunStage(run = {}) {
  const stage = String(run.stage || '').toLowerCase();
  const labels = {
    seed: '种子启动',
    mined: '选词挖掘',
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

/**
 * 汇总 workflow 节点产物的前端展示文案。
 * @param {object|null} artifact 节点产物。
 * @returns {string} 产物摘要。
 */
export function summarizeWorkflowArtifact(artifact) {
  if (!artifact) return '暂无产物';
  const type = String(artifact.type || '').toLowerCase();
  const file = String(artifact.file || '').toLowerCase();
  if (type === 'jsonl') {
    const items = Array.isArray(artifact.items) ? artifact.items : artifact.rows;
    return `${Array.isArray(items) ? items.length : 0} 条数据`;
  }
  const text = typeof artifact.text === 'string' ? artifact.text : '';
  if (!text.trim()) return '暂无产物';
  if (type === 'markdown' || file.endsWith('.md')) return '复核报告';
  const lines = text.split(/\r?\n/).filter(line => line.length > 0);
  return `${lines.length} 行文本`;
}

function candidateTitle(row = {}) {
  return String(row.keyword || row.word || row.title || row.query || row.name || '').trim() || '未命名候选词';
}

function candidateScore(row = {}) {
  const value = row.localScore ?? row.score ?? row.sycmScore?.score ?? row.metrics?.score;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : null;
}

function candidateMeta(row = {}) {
  const parts = [];
  const score = candidateScore(row);
  if (score !== null) parts.push(`评分 ${score}`);
  if (row.source) parts.push(String(row.source));
  if (row.searchPopularity) parts.push(`搜索人气 ${row.searchPopularity}`);
  if (row.competition) parts.push(`竞争 ${row.competition}`);
  return parts.join(' · ');
}

function metricValue(row = {}, keys = []) {
  for (const key of keys) {
    const value = key.split('.').reduce((memo, part) => (memo && memo[part] !== undefined ? memo[part] : undefined), row);
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

function compactMetric(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return `${label} ${value}`;
}

const OPPORTUNITY_DECISION_LABELS = {
  continue: '可生成',
  observe: '观察',
  review: '人工复核',
  reject: '停止'
};

const OPPORTUNITY_ACTION_LABELS = {
  search_1688: '搜索货源',
  manual_review: '人工复核',
  stop: '停止'
};

const SCORE_REASON_LABELS = {
  local_high_intent: '本地挖词意图强',
  local_weak: '本地挖词质量偏弱',
  sycm_blue: '严格蓝海通过',
  sycm_blue_relaxed: '放宽蓝海通过',
  sycm_hot: '只通过热搜降级',
  sycm_passed: '生意参谋通过',
  sycm_not_passed: '生意参谋指标未通过',
  sycm_missing: '缺少生意参谋数据',
  keyword_length_edge: '关键词长度不理想',
  fallback_hot: '热搜降级',
  fallback_blue_relaxed: '放宽蓝海降级',
  fallback_used: '降级查询',
  banned_keyword: '命中违禁词'
};

function labelOpportunityDecision(value) {
  return OPPORTUNITY_DECISION_LABELS[String(value || '').trim()] || String(value || '');
}

function labelOpportunityAction(value) {
  return OPPORTUNITY_ACTION_LABELS[String(value || '').trim()] || String(value || '');
}

function labelScoreReason(value) {
  return SCORE_REASON_LABELS[String(value || '').trim()] || String(value || '');
}

function formatScoreTerm(term = {}) {
  const value = Number(term.value);
  const prefix = Number.isFinite(value) && value > 0 ? '+' : '';
  return `${term.label || term.key || '评分项'} ${Number.isFinite(value) ? `${prefix}${value}` : ''}`.trim();
}

function businessRowTitle(row = {}) {
  return String(
    row.title
    || row['铺货标题']
    || row.keyword
    || row.word
    || row.productTitle
    || row['链接原标题']
    || row.name
    || ''
  ).trim() || '未命名结果';
}

function selectedKeyword(row = {}) {
  return String(row.selectedKeyword || row.keyword || row.blueOceanWord || row.product?.蓝海词 || row['蓝海词'] || '').trim();
}

function businessRowMeta(row = {}, nodeId = '') {
  const parts = [];
  if (nodeId === 'verify') {
    const score = candidateScore(row);
    if (score !== null) parts.push(`评分 ${score}`);
    if (row.keywordOpportunity?.score !== undefined) parts.push(`机会分 ${row.keywordOpportunity.score}`);
    if (row.keywordOpportunity?.decision) parts.push(`决策 ${labelOpportunityDecision(row.keywordOpportunity.decision)}`);
    if (row.status) parts.push(String(row.status));
    if (row.source) parts.push(String(row.source));
  } else if (nodeId === 'select') {
    const keyword = selectedKeyword(row);
    if (keyword) parts.push(`选词 ${keyword}`);
    if (row.productOpportunity?.score !== undefined) parts.push(`货源分 ${row.productOpportunity.score}`);
    if (row.productOpportunity?.decision) parts.push(`决策 ${labelOpportunityDecision(row.productOpportunity.decision)}`);
    if (row.sourceTitle || row.productTitle || row.product?.['链接原标题']) {
      parts.push(String(row.sourceTitle || row.productTitle || row.product?.['链接原标题']));
    }
  } else if (nodeId === 'generate') {
    const keyword = selectedKeyword(row);
    if (keyword) parts.push(`选词 ${keyword}`);
    if (row.productTitle || row['链接原标题'] || row.product?.['链接原标题']) {
      parts.push(String(row.productTitle || row['链接原标题'] || row.product?.['链接原标题']));
    }
  } else if (nodeId === 'export') {
    const keyword = selectedKeyword(row);
    if (keyword) parts.push(`选词 ${keyword}`);
    if (row.status) parts.push(String(row.status));
  }
  return parts.join(' · ');
}

function businessMetrics(row = {}, nodeId = '') {
  if (nodeId === 'verify') {
    return [
      compactMetric('搜索人气', metricValue(row, ['searchPopularity', 'sycmData.searchPopularity', 'marketMetrics.searchPopularity'])),
      compactMetric('供需比', metricValue(row, ['demandSupplyRatio', 'sycmData.demandSupplyRatio', 'marketMetrics.demandSupplyRatio'])),
      compactMetric('点击率', metricValue(row, ['clickRate', 'sycmData.clickRate', 'marketMetrics.clickRate'])),
      compactMetric('转化率', metricValue(row, ['conversionRate', 'sycmData.conversionRate', 'marketMetrics.conversionRate'])),
      compactMetric('下一步', labelOpportunityAction(row.keywordOpportunity?.nextAction)),
      row.keywordOpportunity?.breakdown?.gapToContinue
        ? compactMetric('距生成线还差', row.keywordOpportunity.breakdown.gapToContinue)
        : ''
    ].filter(Boolean);
  }
  if (nodeId === 'select' || nodeId === 'generate' || nodeId === 'export') {
    const keyword = selectedKeyword(row);
    return [
      keyword ? compactMetric('选词', keyword) : '',
      compactMetric('价格', metricValue(row, ['price', '商品原价', 'minPrice', 'product.商品原价', 'product.price'])),
      compactMetric('销量', metricValue(row, ['sales', 'sales30days', '30天销量', 'monthlySales', 'product.30天销量', 'product.sales'])),
      compactMetric('好评率', metricValue(row, ['positiveRate', '好评率', 'product.好评率'])),
      compactMetric('复购率', metricValue(row, ['repurchaseRate', '复购率', 'product.复购率']))
    ].filter(Boolean);
  }
  return [];
}

function businessDescription(row = {}, nodeId = '') {
  if (nodeId === 'select' && row.productOpportunity) {
    const opportunity = row.productOpportunity || {};
    const reasons = Array.isArray(opportunity.reasons)
      ? opportunity.reasons.map(labelScoreReason).join('，')
      : '';
    const risks = Array.isArray(opportunity.riskFlags)
      ? opportunity.riskFlags.map(labelScoreReason).join('，')
      : '';
    const suggestion = opportunity.decision === 'continue'
      ? '建议继续进入标题生成。'
      : opportunity.decision === 'observe'
        ? '建议人工观察货源稳定性后再放行。'
        : '建议停止使用该货源。';
    return [
      reasons ? `依据：${reasons}` : '',
      risks ? `风险：${risks}` : '',
      suggestion
    ].filter(Boolean).join('；');
  }
  if (row.keywordOpportunity) {
    const breakdown = row.keywordOpportunity.breakdown || {};
    const positive = Array.isArray(breakdown.positive) ? breakdown.positive.map(formatScoreTerm).join('，') : '';
    const negative = Array.isArray(breakdown.negative) ? breakdown.negative.map(formatScoreTerm).join('，') : '';
    const reasons = Array.isArray(row.keywordOpportunity.reasons)
      ? row.keywordOpportunity.reasons.map(labelScoreReason).join('，')
      : '';
    const risks = Array.isArray(row.keywordOpportunity.riskFlags)
      ? row.keywordOpportunity.riskFlags.map(labelScoreReason).join('，')
      : '';
    const suggestion = row.keywordOpportunity.decision === 'continue'
      ? '建议继续进入标题与货源生成。'
      : row.keywordOpportunity.decision === 'observe'
        ? '建议加入观察池，或人工确认后再放行。'
        : '建议停止生成，补充更具体的蓝海候选词。';
    return [
      positive ? `加分：${positive}` : '',
      negative ? `扣分：${negative}` : '',
      reasons ? `依据：${reasons}` : '',
      risks ? `风险：${risks}` : '',
      suggestion
    ].filter(Boolean).join('；');
  }
  return String(
    row.reason
    || row.选品理由
    || row.product?.选品理由
    || row.gateReason
    || row.risk
    || row.riskReason
    || row.nextAction
    || row.productUrl
    || row['产品链接']
    || row.product?.['产品链接']
    || ''
  ).trim();
}

function mapBusinessRows(items = [], nodeId = '') {
  return items.map((item) => ({
    title: businessRowTitle(item),
    meta: businessRowMeta(item, nodeId),
    metrics: businessMetrics(item, nodeId),
    description: businessDescription(item, nodeId),
    raw: item
  }));
}

function parseDistributionBatch(text = '') {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\$\$|\t|,/).map((part) => part.trim()).filter(Boolean);
      const url = parts.find((part) => /^https?:\/\//.test(part)) || '';
      const title = parts.find((part) => part && part !== url && !/^\d+(\.\d+)?$/.test(part)) || line;
      const price = parts.find((part) => /^\d+(\.\d+)?$/.test(part)) || '';
      return {
        title,
        meta: price ? `价格 ${price}` : '',
        metrics: [],
        description: url,
        raw: { line, url, price }
      };
    });
}

const REVIEW_SECTION_GROUP = {
  'Recommended Submit': 'recommended',
  'Manual Review Candidates': 'manual',
  'Hard Rejected': 'rejected'
};

const REVIEW_FIELD = {
  'Export Status': 'status',
  'Review Reasons': 'reason',
  URL: 'url',
  Title: 'title',
  Category: 'category',
  'Category Confidence': 'categoryConfidence',
  'Category Reason': 'categoryReason',
  'Verify Mode': 'verifyMode',
  Confidence: 'confidence',
  Usage: 'usage',
  'Keyword Opportunity': 'keywordOpportunity',
  'Product Opportunity': 'productOpportunity',
  'Product Risk Flags': 'riskFlags',
  Decision: 'decision',
  Risk: 'risk',
  Fallback: 'fallback',
  'SYCM Reason': 'sycmReason'
};

function pushReviewRow(rows, row) {
  if (!row) return;
  rows.push({
    ...row,
    title: row.title || row.heading || '未命名复核项',
    reason: row.reason || '',
    raw: { ...row }
  });
}

function parseDistributionReview(text = '') {
  const rows = [];
  let group = '';
  let current = null;

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const section = line.match(/^##\s+(.+)$/);
    if (section) {
      pushReviewRow(rows, current);
      current = null;
      group = REVIEW_SECTION_GROUP[section[1].trim()] || group;
      continue;
    }

    const heading = line.match(/^###\s+\d+\.\s+(.+)$/);
    if (heading) {
      pushReviewRow(rows, current);
      current = { group: group || 'manual', heading: heading[1].trim() };
      continue;
    }

    const field = line.match(/^-\s+([^:]+):\s*(.*)$/);
    if (field && current) {
      const fieldName = field[1].trim();
      const key = REVIEW_FIELD[fieldName] || fieldName.replace(/\s+/g, '_').toLowerCase();
      current[key] = field[2].trim();
    }
  }

  pushReviewRow(rows, current);
  return rows;
}

export function getWorkflowArtifactView(artifact, nodeId = '') {
  const effectiveNodeId = nodeId || artifact?.nodeId || '';
  if (effectiveNodeId === 'start') {
    return { kind: 'none', emptyText: '开始节点没有产物。', rows: [], text: '' };
  }
  if (!artifact) {
    return { kind: 'empty', emptyText: '选择运行记录后，节点完成产物会在这里展示。', rows: [], text: '' };
  }
  const type = String(artifact.type || '').toLowerCase();
  const items = Array.isArray(artifact.items) ? artifact.items : artifact.rows;
  if (effectiveNodeId === 'mine' && Array.isArray(items)) {
    return {
      kind: 'candidate-list',
      emptyText: '暂无候选词',
      rows: items.map((item) => ({
        title: candidateTitle(item),
        meta: candidateMeta(item),
        description: String(item.reason || item.keywordOpportunity || item.nextAction || '').trim(),
        raw: item
      })),
      text: ''
    };
  }
  if (effectiveNodeId === 'keywordReview' && Array.isArray(items)) {
    return {
      kind: 'candidate-list',
      title: '人工筛词结果',
      emptyText: '暂无待筛选候选词',
      rows: items.map((item) => ({
        title: candidateTitle(item),
        meta: [
          candidateMeta(item),
          item.reviewStatus === 'approved' ? '已通过' : item.reviewStatus === 'rejected' ? '已筛除' : '待确认'
        ].filter(Boolean).join(' · '),
        description: String(item.reviewReason || item.reason || item.nextAction || '').trim(),
        raw: item
      })),
      text: ''
    };
  }
  if (effectiveNodeId === 'verify' && Array.isArray(items)) {
    return {
      kind: 'business-list',
      title: '验真通过词',
      emptyText: '暂无验真通过词',
      rows: mapBusinessRows(items, effectiveNodeId),
      text: ''
    };
  }
  if (effectiveNodeId === 'select' && Array.isArray(items)) {
    return {
      kind: 'business-list',
      title: '货源选品结果',
      emptyText: '暂无已选货源',
      rows: mapBusinessRows(items, effectiveNodeId),
      text: ''
    };
  }
  if (effectiveNodeId === 'generate' && Array.isArray(items)) {
    return {
      kind: 'business-list',
      title: '标题与货源链接',
      emptyText: '暂无标题与货源链接',
      rows: mapBusinessRows(items, effectiveNodeId),
      text: ''
    };
  }
  if (effectiveNodeId === 'export' && Array.isArray(items)) {
    return {
      kind: 'business-list',
      title: '待确认铺货清单',
      emptyText: '暂无铺货清单',
      rows: mapBusinessRows(items, effectiveNodeId),
      text: ''
    };
  }
  const text = typeof artifact.text === 'string'
    ? artifact.text
    : typeof artifact.content === 'string'
      ? artifact.content
      : '';
  if (effectiveNodeId === 'export' && text.trim()) {
    return {
      kind: 'business-list',
      title: '待确认铺货清单',
      emptyText: '暂无铺货清单',
      rows: parseDistributionBatch(text),
      text: ''
    };
  }
  if (effectiveNodeId === 'review' && text.trim()) {
    return {
      kind: 'review-list',
      title: '铺货复核',
      emptyText: '暂无复核项',
      rows: parseDistributionReview(text),
      text: ''
    };
  }
  if (Array.isArray(items)) {
    return { kind: 'json-list', emptyText: '暂无数据项', rows: items, text: '' };
  }
  return {
    kind: type === 'json' ? 'json-text' : 'text',
    emptyText: '暂无文本产物',
    rows: [],
    text: text || (type === 'json' ? JSON.stringify(artifact, null, 2) : '')
  };
}

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
  const { status, state, output, error, progress, onSelect, originalType, ...params } = startNode.data;
  return params;
}

export function getWorkflowLaunchBlocker(mode, nodes = []) {
  const params = getStartNodeParams(nodes);
  if (mode === 'manual') {
    if (String(params.keywords || '').trim()) return null;
    const message = '请至少输入一个关键词';
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
  if (mode !== 'keyword' || String(params.keyword || '').trim()) return null;
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
