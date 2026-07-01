'use strict';

const path = require('path');
const {
  DEFAULT_PIPELINE_DIR,
  summarizePipelineRun,
  listPipelineRuns,
  readJsonlPreview,
  readTextPreview
} = require('../pipeline-run-summary');

const WORKFLOW_NODE_IDS = {
  start: 'start',
  mine: 'mine',
  verify: 'verify',
  generate: 'generate',
  export: 'export',
  review: 'review',
  end: 'end'
};

const NODE_ORDER = Object.values(WORKFLOW_NODE_IDS);

const ARTIFACT_BY_NODE = {
  [WORKFLOW_NODE_IDS.mine]: { fileKey: 'candidates', type: 'jsonl' },
  [WORKFLOW_NODE_IDS.verify]: { fileKey: 'verifiedKeywords', type: 'jsonl' },
  [WORKFLOW_NODE_IDS.generate]: { fileKey: 'generatedProducts', type: 'jsonl' },
  [WORKFLOW_NODE_IDS.export]: { fileKey: 'distributionBatch', type: 'text' },
  [WORKFLOW_NODE_IDS.review]: { fileKey: 'distributionReview', type: 'text' }
};

function clampInt(value, fallback, min, max) {
  const parsed = parseInt(value, 10);
  const next = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, next));
}

function sanitizeBool(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (value == null || value === '') return fallback;
  if (['false', '0', 'no', 'off'].includes(String(value).toLowerCase())) return false;
  if (['true', '1', 'yes', 'on'].includes(String(value).toLowerCase())) return true;
  return fallback;
}

function workflowNodes() {
  return [
    { id: WORKFLOW_NODE_IDS.start, type: 'production-start', data: { label: '开始' }, position: { x: 0, y: 120 } },
    { id: WORKFLOW_NODE_IDS.mine, type: 'pipeline-mine', data: { label: '选词挖掘' }, position: { x: 180, y: 120 } },
    { id: WORKFLOW_NODE_IDS.verify, type: 'pipeline-verify', data: { label: '生意参谋校验' }, position: { x: 360, y: 120 } },
    { id: WORKFLOW_NODE_IDS.generate, type: 'pipeline-generate', data: { label: '标题生成' }, position: { x: 540, y: 120 } },
    { id: WORKFLOW_NODE_IDS.export, type: 'pipeline-export', data: { label: '导出清单' }, position: { x: 720, y: 120 } },
    { id: WORKFLOW_NODE_IDS.review, type: 'pipeline-review', data: { label: '人工复核' }, position: { x: 900, y: 120 } },
    { id: WORKFLOW_NODE_IDS.end, type: 'production-end', data: { label: '完成' }, position: { x: 1080, y: 120 } }
  ];
}

function workflowEdges() {
  const pairs = [
    [WORKFLOW_NODE_IDS.start, WORKFLOW_NODE_IDS.mine],
    [WORKFLOW_NODE_IDS.mine, WORKFLOW_NODE_IDS.verify],
    [WORKFLOW_NODE_IDS.verify, WORKFLOW_NODE_IDS.generate],
    [WORKFLOW_NODE_IDS.generate, WORKFLOW_NODE_IDS.export],
    [WORKFLOW_NODE_IDS.export, WORKFLOW_NODE_IDS.review],
    [WORKFLOW_NODE_IDS.review, WORKFLOW_NODE_IDS.end]
  ];
  return pairs.map(([source, target]) => ({
    id: `${source}-${target}`,
    source,
    target
  }));
}

function template(id, name, mode, description) {
  return {
    id,
    name,
    mode,
    description,
    production: true,
    nodes: workflowNodes(),
    edges: workflowEdges()
  };
}

/**
 * 列出真实 pipeline 对应的固定工作流模板。
 * @returns {Array<object>} 模板列表。
 */
function listProductionWorkflowTemplates() {
  return [
    template('daily-selection-v1', '每日蓝海选品流水线', 'daily', '选词、验真、生成标题并导出铺货清单'),
    template('exact-keyword-v1', '精确关键词选品流水线', 'keyword', '按用户给定关键词生成铺货清单')
  ];
}

/**
 * 清洗 workflow 启动参数，并限制到 CLI 可接受范围。
 * @param {string} mode 工作流模式：daily 或 keyword。
 * @param {object} raw 原始参数。
 * @returns {object} 清洗后的参数。
 */
function sanitizeWorkflowParams(mode, raw = {}) {
  if (mode === 'daily') {
    return {
      mine: clampInt(raw.mine, 50, 1, 200),
      verify: clampInt(raw.verify, 20, 1, 200),
      generate: clampInt(raw.generate, 10, 1, 100),
      export: clampInt(raw.export, 20, 1, 100),
      productsPerKeyword: clampInt(raw.productsPerKeyword, 12, 1, 50),
      length: clampInt(raw.length, 60, 30, 80),
      port: clampInt(raw.port, 9222, 1, 65535),
      pages: clampInt(raw.pages, 1, 1, 5),
      minBlueRows: clampInt(raw.minBlueRows, 1, 0, 50),
      fallbackHot: sanitizeBool(raw.fallbackHot, true)
    };
  }
  if (mode === 'keyword') {
    const keyword = String(raw.keyword || '').trim();
    if (!keyword) throw new Error('关键词不能为空');
    return {
      keyword,
      export: clampInt(raw.export, 20, 1, 100),
      productsPerKeyword: clampInt(raw.productsPerKeyword, 12, 1, 50),
      length: clampInt(raw.length, 60, 30, 80),
      port: clampInt(raw.port, 9222, 1, 65535),
      pages: clampInt(raw.pages, 1, 1, 5),
      minBlueRows: clampInt(raw.minBlueRows, 1, 0, 50),
      fallbackHot: sanitizeBool(raw.fallbackHot, true)
    };
  }
  throw new Error(`未知 workflow mode: ${mode}`);
}

function pushFlag(args, flag, value) {
  args.push(flag, String(value));
}

/**
 * 构造可直接传给 child_process.spawn 的 CLI 参数数组。
 * @param {string} mode 工作流模式：daily 或 keyword。
 * @param {object} params 已清洗或待清洗参数。
 * @returns {string[]} spawn 参数数组。
 */
function buildPipelineCliArgs(mode, params = {}) {
  const clean = sanitizeWorkflowParams(mode, params);
  if (mode === 'daily') {
    const args = ['bin/cli.js', 'flow', 'daily'];
    pushFlag(args, '--mine', clean.mine);
    pushFlag(args, '--verify', clean.verify);
    pushFlag(args, '--generate', clean.generate);
    pushFlag(args, '--export', clean.export);
    pushFlag(args, '--products-per-keyword', clean.productsPerKeyword);
    pushFlag(args, '--length', clean.length);
    pushFlag(args, '--port', clean.port);
    pushFlag(args, '--pages', clean.pages);
    pushFlag(args, '--min-blue-rows', clean.minBlueRows);
    if (!clean.fallbackHot) args.push('--no-hot-fallback');
    args.push('--json');
    return args;
  }
  if (mode === 'keyword') {
    const args = ['bin/cli.js', 'flow', 'keyword', clean.keyword];
    pushFlag(args, '--export', clean.export);
    pushFlag(args, '--products-per-keyword', clean.productsPerKeyword);
    pushFlag(args, '--length', clean.length);
    pushFlag(args, '--port', clean.port);
    pushFlag(args, '--pages', clean.pages);
    pushFlag(args, '--min-blue-rows', clean.minBlueRows);
    if (!clean.fallbackHot) args.push('--no-hot-fallback');
    args.push('--json');
    return args;
  }
  throw new Error(`未知 workflow mode: ${mode}`);
}

function nodeState(id, type, status, output = null, summary = {}) {
  const timestamp = summary.updatedAt || summary.startedAt || null;
  return {
    id,
    type,
    status,
    input: null,
    output,
    error: null,
    startedAt: status === 'idle' ? null : (summary.startedAt || timestamp),
    completedAt: status === 'completed' || status === 'failed' ? timestamp : null
  };
}

function outputForNode(id, summary) {
  const counts = summary.counts || {};
  if (id === WORKFLOW_NODE_IDS.start) return { runId: summary.runId };
  if (id === WORKFLOW_NODE_IDS.mine) return { count: Number(counts.candidates || 0), file: summary.files?.candidates || '' };
  if (id === WORKFLOW_NODE_IDS.verify) {
    return {
      verified: Number(counts.sycmVerified || 0),
      rejected: Number(counts.sycmRejected || 0),
      file: summary.files?.verifiedKeywords || ''
    };
  }
  if (id === WORKFLOW_NODE_IDS.generate) {
    return { count: Number(counts.generatedProducts || 0), file: summary.files?.generatedProducts || '' };
  }
  if (id === WORKFLOW_NODE_IDS.export) {
    return { count: Number(summary.batchCount || counts.readyToDistribute || 0), batchFile: summary.batchFile || summary.files?.distributionBatch || '' };
  }
  if (id === WORKFLOW_NODE_IDS.review) {
    return { reviewFile: summary.reviewFile || summary.files?.distributionReview || '', mustReview: !!summary.mustReview };
  }
  if (id === WORKFLOW_NODE_IDS.end) return { canSubmit: !!summary.canSubmit };
  return null;
}

function completeBefore(states, nodeId) {
  const stopIndex = NODE_ORDER.indexOf(nodeId);
  NODE_ORDER.forEach((id, index) => {
    if (index < stopIndex) states[id] = 'completed';
  });
}

function completeThrough(states, nodeId) {
  const stopIndex = NODE_ORDER.indexOf(nodeId);
  NODE_ORDER.forEach((id, index) => {
    if (index <= stopIndex) states[id] = 'completed';
  });
}

function statusPlanForSummary(summary) {
  const status = summary.status || 'unknown';
  const states = NODE_ORDER.reduce((memo, nodeId) => {
    memo[nodeId] = 'idle';
    return memo;
  }, {});

  if (status === 'workflow_complete') {
    completeThrough(states, WORKFLOW_NODE_IDS.end);
    return states;
  }

  if (status === 'manual_action_required' || status === 'verified_partial_manual_required' || status === 'verified_empty') {
    completeBefore(states, WORKFLOW_NODE_IDS.verify);
    states[WORKFLOW_NODE_IDS.verify] = 'blocked';
    return states;
  }

  if (status === 'generate_failed') {
    completeBefore(states, WORKFLOW_NODE_IDS.generate);
    states[WORKFLOW_NODE_IDS.generate] = 'failed';
    return states;
  }

  if (status === 'needs_review') {
    completeBefore(states, WORKFLOW_NODE_IDS.review);
    states[WORKFLOW_NODE_IDS.review] = 'needs_review';
    return states;
  }

  if (status === 'ready_to_distribute' || status === 'awaiting_user_confirmation') {
    completeBefore(states, WORKFLOW_NODE_IDS.review);
    states[WORKFLOW_NODE_IDS.review] = 'waiting_confirmation';
    return states;
  }

  if (status === 'created') {
    completeThrough(states, WORKFLOW_NODE_IDS.start);
    states[WORKFLOW_NODE_IDS.mine] = 'running';
    return states;
  }

  if (status === 'mined') {
    completeThrough(states, WORKFLOW_NODE_IDS.mine);
    states[WORKFLOW_NODE_IDS.verify] = 'running';
    return states;
  }

  if (status === 'verified') {
    completeThrough(states, WORKFLOW_NODE_IDS.verify);
    states[WORKFLOW_NODE_IDS.generate] = 'running';
    return states;
  }

  if (status === 'generated') {
    completeThrough(states, WORKFLOW_NODE_IDS.generate);
    states[WORKFLOW_NODE_IDS.export] = 'running';
    return states;
  }

  if (status === 'export_empty') {
    completeBefore(states, WORKFLOW_NODE_IDS.export);
    states[WORKFLOW_NODE_IDS.export] = 'failed';
    return states;
  }

  // 未知状态只展示已创建 run，避免误把后续生产步骤标为完成。
  completeThrough(states, WORKFLOW_NODE_IDS.start);
  states[WORKFLOW_NODE_IDS.mine] = 'running';
  return states;
}

function buildNodeStates(summary) {
  const plannedStates = statusPlanForSummary(summary);
  return NODE_ORDER.reduce((states, nodeId, index) => {
    const nodeStatus = plannedStates[nodeId] || 'idle';
    states[nodeId] = nodeState(nodeId, `pipeline-${nodeId}`, nodeStatus, nodeStatus === 'idle' ? null : outputForNode(nodeId, summary), summary);
    return states;
  }, {});
}

function templateForSummary(summary) {
  const options = summary.options || {};
  const mode = options.keyword || summary.exactKeyword ? 'keyword' : 'daily';
  const id = mode === 'keyword' ? 'exact-keyword-v1' : 'daily-selection-v1';
  return listProductionWorkflowTemplates().find(item => item.id === id);
}

/**
 * 将 pipeline summary 转为画布 workflow run 结构。
 * @param {object} summary pipeline-run-summary 输出。
 * @returns {object|null} workflow run。
 */
function pipelineSummaryToWorkflowRun(summary) {
  if (!summary) return null;
  const workflow = templateForSummary(summary);
  return {
    runId: summary.runId,
    status: summary.status || 'unknown',
    workflow,
    nodeStates: buildNodeStates(summary),
    startedAt: summary.startedAt || '',
    updatedAt: summary.updatedAt || summary.startedAt || '',
    error: summary.error || null,
    logs: [],
    stage: summary.stage,
    counts: summary.counts || {},
    files: summary.files || {},
    batchFile: summary.batchFile || '',
    reviewFile: summary.reviewFile || '',
    batchCount: summary.batchCount || 0,
    requiresUserAction: !!summary.requiresUserAction,
    blockers: Array.isArray(summary.blockers) ? summary.blockers : [],
    nextActionCode: summary.nextActionCode || '',
    nextCommand: summary.nextCommand || '',
    allowedCommands: Array.isArray(summary.allowedCommands) ? summary.allowedCommands : [],
    userMessage: summary.userMessage || '',
    previews: summary.previews || {}
  };
}

/**
 * 列出真实 pipeline run，并映射为 workflow run。
 * @param {object} options 查询参数。
 * @param {string} [options.dataDir] pipeline 数据目录。
 * @param {number} [options.limit] 最大数量。
 * @returns {{runs:Array<object>, latest:object|null}} workflow run 列表。
 */
function listWorkflowRuns(options = {}) {
  const result = listPipelineRuns(options);
  const runs = result.runs.map(pipelineSummaryToWorkflowRun);
  return {
    runs,
    latest: runs[0] || null
  };
}

/**
 * 获取单个真实 pipeline run 的 workflow 映射。
 * @param {string} runId pipeline runId。
 * @param {object} options 查询参数。
 * @param {string} [options.dataDir] pipeline 数据目录。
 * @returns {object|null} workflow run。
 */
function normalizeRunOptions(runIdOrOptions, maybeOptions = {}) {
  if (runIdOrOptions && typeof runIdOrOptions === 'object') {
    return { ...runIdOrOptions };
  }
  return { ...maybeOptions, runId: runIdOrOptions };
}

function getWorkflowRun(runIdOrOptions, options = {}) {
  return pipelineSummaryToWorkflowRun(summarizePipelineRun(normalizeRunOptions(runIdOrOptions, options)));
}

/**
 * 读取 workflow 节点对应的 pipeline artifact。
 * @param {string} runId pipeline runId。
 * @param {string} nodeId workflow 节点 ID。
 * @param {object} options 读取参数。
 * @param {string} [options.dataDir] pipeline 数据目录。
 * @param {number} [options.limit] JSONL 最大行数。
 * @param {number} [options.maxChars] 文本最大字符数。
 * @returns {object|null} artifact 内容。
 */
function normalizeArtifactOptions(runIdOrOptions, nodeId, maybeOptions = {}) {
  if (runIdOrOptions && typeof runIdOrOptions === 'object') {
    return { ...runIdOrOptions };
  }
  return { ...maybeOptions, runId: runIdOrOptions, nodeId };
}

function readWorkflowNodeArtifact(runIdOrOptions, nodeId, options = {}) {
  const normalized = normalizeArtifactOptions(runIdOrOptions, nodeId, options);
  const summary = summarizePipelineRun({ dataDir: normalized.dataDir, runId: normalized.runId, previewLimit: 0, reviewChars: 1 });
  const artifact = ARTIFACT_BY_NODE[normalized.nodeId];
  if (!summary || !artifact) return null;
  const file = summary.files && summary.files[artifact.fileKey];
  if (!file) return null;
  if (artifact.type === 'jsonl') {
    return {
      runId: summary.runId,
      nodeId: normalized.nodeId,
      file,
      type: 'jsonl',
      rows: readJsonlPreview(file, normalized.limit || 50)
    };
  }
  return {
    runId: summary.runId,
    nodeId: normalized.nodeId,
    file,
    type: 'text',
    text: readTextPreview(file, normalized.maxChars || 10000)
  };
}

module.exports = {
  DEFAULT_PIPELINE_DIR,
  WORKFLOW_NODE_IDS,
  listProductionWorkflowTemplates,
  sanitizeWorkflowParams,
  buildPipelineCliArgs,
  pipelineSummaryToWorkflowRun,
  listWorkflowRuns,
  getWorkflowRun,
  readWorkflowNodeArtifact
};
