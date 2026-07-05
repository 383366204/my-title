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
  if (normalizedState === 'retryable') {
    return { label: '重试节点', action: 'retry-node', tone: 'warn' };
  }
  if (normalizedState === 'blocked' || normalizedState === 'failed') {
    return { label: '查看阻塞', action: 'blocked', tone: 'danger' };
  }
  if (normalizedState === 'completed') {
    return { label: '查看产物', action: 'artifact', tone: 'success' };
  }
  return { label: '查看节点', action: 'inspect', tone: getCanvasNodeTone(normalizedState) };
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
