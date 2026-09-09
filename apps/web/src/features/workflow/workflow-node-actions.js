export const BUSINESS_FUNNEL = [
  { id: "candidate", label: "候选词" },
  { id: "verified", label: "大盘验真" },
  { id: "selected", label: "货源选品" },
  { id: "generated", label: "标题生成" },
  { id: "pending_review", label: "待确认铺货" },
  { id: "submitted", label: "已提交" }
];

const PIPELINE_FIRST_NAV_ITEMS = [
  { id: "workflow", label: "选品流水线" }
];

const LEGACY_TARGET_NODE = {
  dashboard: "review",
  mine: "mine",
  title: "generate"
};

const STEP_NODE = {
  start: "start",
  mine: "mine",
  keywordReview: "keywordReview",
  verify: "verify",
  select: "select",
  generate: "generate",
  export: "export",
  review: "review",
  submit: "review"
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
  if (normalizedNodeId === 'start' && stateDetails.competitorConfig === true) {
    const hasInput = Boolean(String(stateDetails.competitorText || '').trim());
    return {
      label: hasInput ? '查看同行设置' : '录入同行',
      action: 'manual-input',
      tone: hasInput ? 'success' : 'warn'
    };
  }
  if (normalizedNodeId === 'start' && ['idle', 'pending'].includes(normalizedState)) {
    if (stateDetails.autoStart === true) {
      return { label: '无需配置', action: 'inspect', tone: 'default' };
    }
    const label = stateDetails.manualInput === true
      ? '录入1688链接'
      : Object.hasOwn(stateDetails, 'rootsText') || Array.isArray(stateDetails.roots)
        ? '输入词根'
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
  if (normalizedNodeId === 'enrichcompetitors' && Number(stateDetails.output?.failed || 0) > 0 && normalizedState === 'completed') {
    return { label: '重试失败链接', action: 'retry-node', tone: 'warn' };
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
  const chromeBlocked = ['mine', 'verify', 'collectRank'].includes(nodeId) && (
    blocker.includes('browser_cdp_unavailable') ||
    blocker.includes('cdp_unavailable') ||
    platformStatus.includes('cdp_unavailable') ||
    error.includes('127.0.0.1:9222') ||
    error.includes('econnrefused') ||
    actionHint.includes('chrome cdp') ||
    /no chrome tab found|chrome[^\n]*(?:tab|debug)|cdp|devtools/.test(chromeFailureText)
  );
  const productDetailChromeBlocked = nodeId === 'collectRank' && (
    blocker.includes('order_sheet_browser_cdp_unavailable') ||
    String(state.platform || '').toLowerCase() === 'taobao'
  );

  if (recommended && recommended.action && (!chromeBlocked || recommended.action === 'start-sycm-chrome')) {
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

  if (chromeBlocked) {
    if (!actions.some((action) => action.action === 'start-sycm-chrome')) {
      actions.push({
        action: 'start-sycm-chrome',
        label: '启动 Chrome',
        description: productDetailChromeBlocked
          ? '打开带调试端口的 Chrome，登录淘宝后重新读取商品资料。'
          : '打开带调试端口的 Chrome，登录生意参谋后可重新检测或重跑验真。'
      });
    }
    actions.push({
      action: 'retry-node',
      label: productDetailChromeBlocked ? '重试获取商品资料' : nodeId === 'collectRank' ? '重试采集' : nodeId === 'mine' ? '继续拓词' : '重跑验真',
      description: productDetailChromeBlocked
        ? 'Chrome 就绪并登录淘宝后，重新读取全部指定商品的标题、价格和规格。'
        : nodeId === 'collectRank'
          ? 'Chrome 就绪并完成登录后，重新采集商品排行第一页。'
          : nodeId === 'mine'
            ? 'Chrome 就绪并完成登录后，从未完成词根继续拓词。'
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

export function getWorkflowRuntimeActions({ runStatus = "", nodeId = "", state = {} } = {}) {
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

export function getWorkflowOperationMessage(action, result, error = "") {
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
              : action === 'start-taobao-native'
                ? '启动淘宝客户端失败'
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
  if (action === 'start-taobao-native') return result?.userMessage || '淘宝客户端已打开。请完成登录或验证后重试。';
  return '操作已提交。';
}
