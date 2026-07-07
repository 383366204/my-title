export const BUSINESS_FUNNEL = [
  { id: 'candidate', label: '候选词' },
  { id: 'verified', label: '大盘验真' },
  { id: 'generated', label: '标题货源' },
  { id: 'pending_review', label: '待确认铺货' },
  { id: 'submitted', label: '已提交' }
];

export function mapPipelineStageToFunnel(stage) {
  const normalized = String(stage || '').toLowerCase();
  if (normalized === 'verified') return 'verified';
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
  if (stage === 'verified') return { label: '生成标题货源', targetTab: 'title', tone: 'default' };
  if (stage === 'generated') return { label: '查看标题货源', targetTab: 'title', tone: needsAction ? 'warn' : 'default' };
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
  const recommended = state.nextRecommendedAction || null;
  const actions = [];

  if (recommended && recommended.action) {
    actions.push({
      action: recommended.action,
      label: recommended.label || '处理阻塞',
      description: recommended.description || ''
    });
  }

  if (nodeId === 'verify' && blocker === 'verified_empty') {
    actions.push({
      action: 'retry-node',
      label: '重跑验真',
      description: '补充候选词或调整参数后，从生意参谋校验节点重新执行。'
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
    return '当前流程验真无结果。补充候选词后，回到流程画布重跑“生意参谋校验”。';
  }
  if (run.status === 'manual_action_required' || run.status === 'verified_partial_manual_required') {
    return '当前流程需要处理生意参谋状态。处理完成后，回到流程画布继续或重跑验真。';
  }
  return '';
}

export function getMiningRecoveryAction(run = null, addedCandidateCount = 0) {
  if (!run || run.status !== 'verified_empty') {
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
    outputSummary: state.outputSummary || ''
  };
}

export function labelWorkflowBlockerReason(blocker) {
  const normalized = String(blocker || '').toLowerCase();
  const labels = {
    verified_empty: '验真无结果',
    sycm_manual_action_required: '生意参谋需要人工处理',
    sycm_partial_manual_required: '生意参谋部分阻塞',
    generate_failed: '标题生成失败',
    export_empty: '导出无结果',
    review_rejected_rows: '需要人工复核'
  };
  return labels[normalized] || String(blocker || '');
}

export function getWorkflowNodeDetailRows(node = {}) {
  const data = node.data || {};
  const view = getWorkflowNodeViewModel(node.id, data);
  const rows = [
    { label: '状态', value: view.statusLabel }
  ];
  if (view.progressLabel) rows.push({ label: '进度', value: view.progressLabel });
  if (data.keyword) rows.push({ label: '关键词', value: data.keyword });
  if (data.count) rows.push({ label: '数量', value: `${data.count}` });
  if (data.maxLength) rows.push({ label: '标题长度', value: `${data.maxLength}` });
  if (view.outputSummary) rows.push({ label: '输出摘要', value: view.outputSummary });
  if (data.error) rows.push({ label: '错误', value: data.error });
  if (data.blocker && !data.error) rows.push({ label: '阻塞原因', value: labelWorkflowBlockerReason(data.blocker) });
  if (data.actionHint && !data.error) rows.push({ label: '处理建议', value: data.actionHint });
  if (view.blockerMessage && !data.error && !data.actionHint) rows.push({ label: view.blockerTitle || '提示', value: view.blockerMessage });
  return rows.filter((row) => row.value !== null && row.value !== undefined && String(row.value).trim() !== '');
}

export function getWorkflowOperationMessage(action, result, error = '') {
  if (result === 'error') {
    const prefix = action === 'pause'
      ? '暂停请求失败'
      : action === 'resume'
        ? '继续请求失败'
        : action === 'retry-node'
          ? '重试请求失败'
          : '操作失败';
    return `${prefix}: ${error || '未知错误'}`;
  }
  if (action === 'pause') return '已请求暂停，当前步骤会在安全边界停止。';
  if (action === 'resume') return '已请求继续，流程会从当前节点恢复。';
  if (action === 'retry-node') return '已请求重试，当前节点及下游步骤会重新执行。';
  return '操作已提交。';
}

export function getWorkflowRunActiveNodeId(run = {}) {
  const priority = ['blocked', 'failed', 'retryable', 'waiting_manual', 'paused', 'needs_review', 'waiting_confirmation', 'running', 'resuming', 'retrying'];
  const nodeStates = run.nodeStates && typeof run.nodeStates === 'object'
    ? Object.entries(run.nodeStates).map(([id, state]) => ({ id, state: state || {} }))
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
    verified: '大盘验真',
    generated: '标题货源',
    review: '人工复核',
    ready: '待铺货',
    submitted: '已提交'
  };
  return labels[stage] || '工作流运行';
}

function labelUnifiedRunStatus(status) {
  const normalized = String(status || '').toLowerCase();
  const labels = {
    verified_empty: '验真无结果',
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
  if (Array.isArray(items)) {
    return { kind: 'json-list', emptyText: '暂无数据项', rows: items, text: '' };
  }
  const text = typeof artifact.text === 'string'
    ? artifact.text
    : typeof artifact.content === 'string'
      ? artifact.content
      : '';
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
    market: {
      searchPopularity: sycmData.searchPopularity ?? null,
      demandSupplyRatio: sycmData.demandSupplyRatio ?? null,
      clickRate: sycmData.clickRate ?? null,
      conversionRate: sycmData.conversionRate ?? null
    },
    raw: candidate
  };
}

export function buildReviewProduct({ keyword, product = {}, candidate = {} }) {
  return {
    id: `${keyword || candidate.keyword || ''}:${product['产品链接'] || product.productUrl || product['铺货标题'] || Date.now()}`,
    keyword: keyword || candidate.keyword || '',
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
  if (mode !== 'keyword') return null;
  const params = getStartNodeParams(nodes);
  if (String(params.keyword || '').trim()) return null;
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
