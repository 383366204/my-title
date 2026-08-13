export const DEFAULT_WORKFLOW_MODE = 'daily';

export const ACTIVE_RUN_STATUSES = new Set([
  'pending',
  'running',
  'created',
  'mined',
  'verified',
  'products_selected',
  'generated',
  'resuming',
  'retrying',
  'awaiting_keyword_review',
  'awaiting_product_review'
]);

export const MINER_TABS = [
  { id: 'peer', label: '同行词根', endpoint: '/api/miner/peer', needsInput: true },
  { id: 'opp', label: '1688商机', endpoint: '/api/miner/opportunities', needsInput: false },
  { id: 'sycm-market', label: '参谋关联词', endpoint: '/api/miner/sycm-market', needsInput: true }
];

export function artifactItems(state) {
  const artifact = state?.artifact || null;
  if (!artifact) return [];
  if (Array.isArray(artifact.items)) return artifact.items;
  if (Array.isArray(artifact.rows)) return artifact.rows;
  return [];
}

export function candidateKeyword(row = {}) {
  return String(row.keyword || row.word || row.title || row.query || '').trim();
}

function unwrapApiData(payload) {
  return payload?.data || payload || {};
}

/**
 * Normalize workflow template API responses into a validated list.
 * @param {object|object[]} payload API response payload.
 * @returns {object[]} Templates with canvas nodes and edges.
 */
export function normalizeTemplateList(payload) {
  const data = unwrapApiData(payload);
  const rawTemplates = Array.isArray(data)
    ? data
    : data?.templates || data?.items || data?.workflows || [];
  return Array.isArray(rawTemplates)
    ? rawTemplates.filter((template) => template?.workflow?.nodes && template?.workflow?.edges)
    : [];
}

/**
 * Normalize workflow history API responses into a list.
 * @param {object|object[]} payload API response payload.
 * @returns {object[]} Workflow runs.
 */
export function normalizeRunList(payload) {
  const data = unwrapApiData(payload);
  const rawRuns = Array.isArray(data)
    ? data
    : data?.runs || data?.items || data?.history || [];
  return Array.isArray(rawRuns)
    ? rawRuns.filter((run) => run && typeof run === 'object' && (run.runId || run.id))
    : [];
}

/**
 * Resolve the execution mode attached to a workflow template.
 * @param {object} template Workflow template.
 * @returns {string} Workflow mode.
 */
export function getTemplateMode(template) {
  return template?.mode || template?.workflow?.mode || DEFAULT_WORKFLOW_MODE;
}

/**
 * Attach stable canvas state and interaction handlers to a workflow node.
 * @param {object} node Workflow node.
 * @param {Function} selectNode Node selection callback.
 * @param {Function} actionHandler Node action callback.
 * @param {Function} artifactHandler Artifact callback.
 * @param {object} supportedNodeTypes Registered React Flow node types.
 * @param {Function} updateHandler Node field update callback.
 * @returns {object} Canvas-ready node.
 */
export function normalizeCanvasNode(node, selectNode, actionHandler, artifactHandler, supportedNodeTypes = {}, updateHandler) {
  const renderType = supportedNodeTypes[node.type] ? node.type : 'task';
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
      onUpdate: (field, value) => updateHandler?.(node.id, field, value),
      onViewArtifact: () => artifactHandler?.(node.id)
    }
  };
}

/**
 * Remove the retired review node and repair the production canvas edge chain.
 * @param {object} [workflow] Workflow graph.
 * @returns {object} Canvas-compatible workflow graph.
 */
export function normalizeWorkflowForCanvas(workflow = {}) {
  const rawNodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const rawEdges = Array.isArray(workflow.edges) ? workflow.edges : [];
  const startData = rawNodes.find((node) => node?.id === 'start')?.data || {};
  const hasGenerateSheet = rawNodes.some((node) => node?.id === 'generateSheet');
  const nodes = rawNodes
    .filter((node) => node?.id !== 'review')
    .map((node, index, visibleNodes) => ({
      ...node,
      data: {
        ...node.data,
        ...(node.id === 'generateSheet' ? {
          sheetConfig: true,
          sheetType: node.data?.sheetType || startData.sheetType || 'order',
          storeName: node.data?.storeName ?? startData.storeName ?? '',
          orderDate: node.data?.orderDate || startData.orderDate || '',
          productLimit: node.data?.productLimit ?? 0,
          includeRawData: node.data?.includeRawData !== false,
          includeImages: node.data?.includeImages !== false,
          amountMode: node.data?.amountMode || 'average',
          missingAmountPolicy: node.data?.missingAmountPolicy || 'blank',
          cartQuantity: node.data?.cartQuantity ?? 1,
          rowSpan: node.data?.rowSpan ?? 3,
          workRequirement: node.data?.workRequirement || startData.workRequirement || '',
          orderNote: node.data?.orderNote || '',
          reviewGroupSize: node.data?.reviewGroupSize ?? 4,
          includeSpacerRow: node.data?.includeSpacerRow !== false
        } : {}),
        ...(node.id === 'end' && hasGenerateSheet ? { orderSheetDownload: true } : {}),
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
}

/**
 * Map retired node ids to the production canvas node.
 * @param {string} nodeId Backend node identifier.
 * @returns {string} Canvas node identifier.
 */
export function effectiveCanvasNodeId(nodeId) {
  return nodeId === 'review' ? 'export' : nodeId;
}

function shouldPreferLegacyReviewState(state = {}) {
  const status = String(state.status || state.state || '').toLowerCase();
  return ['blocked', 'failed', 'retryable', 'waiting_manual', 'paused', 'needs_review', 'waiting_confirmation', 'running', 'resuming', 'retrying'].includes(status);
}

function mergeCanvasNodeState(primary = {}, legacyReview = {}) {
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
}

/**
 * Read a node state while preserving compatibility with retired review runs.
 * @param {object} nodeStates Node state map.
 * @param {string} nodeId Canvas node identifier.
 * @returns {object|null} Effective node state.
 */
export function getCanvasNodeState(nodeStates = {}, nodeId) {
  if (nodeId === 'export') {
    if (!nodeStates.export && !nodeStates.review) return null;
    return mergeCanvasNodeState(nodeStates.export || {}, nodeStates.review || {});
  }
  return nodeStates?.[nodeId] || null;
}
