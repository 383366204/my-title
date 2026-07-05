'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_PIPELINE_DIR,
  summarizePipelineRun,
  listPipelineRuns,
  readJsonlPreview,
  readTextPreview
} = require('../pipeline-run-summary');
const {
  readRuntimeState
} = require('../../skills/pipeline-flow/runtime/store');

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
const WORKFLOW_RUN_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

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

function assertSafeWorkflowRunId(runId) {
  if (!WORKFLOW_RUN_ID_PATTERN.test(String(runId || ''))) {
    throw new Error('Invalid workflow run id');
  }
}

function workflowRunDir(dataDir, runId) {
  assertSafeWorkflowRunId(runId);
  return path.join(dataDir || DEFAULT_PIPELINE_DIR, 'runs', runId);
}

/**
 * 写入 workflow 画布定义快照。
 * @param {object} options 写入参数。
 * @param {string} [options.dataDir] pipeline 数据目录。
 * @param {string} options.runId pipeline runId。
 * @param {object} options.definition workflow 定义。
 * @returns {string} 写入的文件路径。
 */
function writeWorkflowDefinition({ dataDir = DEFAULT_PIPELINE_DIR, runId, definition } = {}) {
  const file = path.join(workflowRunDir(dataDir, runId), 'workflow-definition.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(definition, null, 2), 'utf8');
  return file;
}

/**
 * 追加 workflow 画布事件。
 * @param {object} options 写入参数。
 * @param {string} [options.dataDir] pipeline 数据目录。
 * @param {string} options.runId pipeline runId。
 * @param {object} options.event workflow 事件。
 * @returns {string} 写入的文件路径。
 */
function appendWorkflowEvent({ dataDir = DEFAULT_PIPELINE_DIR, runId, event } = {}) {
  const file = path.join(workflowRunDir(dataDir, runId), 'workflow-events.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8');
  return file;
}

/**
 * 读取 workflow 画布事件。
 * @param {object} options 读取参数。
 * @param {string} [options.dataDir] pipeline 数据目录。
 * @param {string} options.runId pipeline runId。
 * @returns {Array<object>} workflow 事件列表。
 */
function readWorkflowEvents({ dataDir = DEFAULT_PIPELINE_DIR, runId } = {}) {
  const file = path.join(workflowRunDir(dataDir, runId), 'workflow-events.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function workflowNodes(mode = 'daily') {
  const startData = mode === 'keyword'
    ? {
        label: '开始',
        keyword: '',
        export: 20,
        productsPerKeyword: 12,
        length: 60,
        pages: 1
      }
    : {
        label: '开始',
        mine: 50,
        verify: 20,
        generate: 10,
        export: 20,
        productsPerKeyword: 12,
        length: 60,
        pages: 1
      };
  return [
    { id: WORKFLOW_NODE_IDS.start, type: 'production-start', data: startData, position: { x: 220, y: 40 } },
    { id: WORKFLOW_NODE_IDS.mine, type: 'pipeline-mine', data: { label: '选词挖掘' }, position: { x: 560, y: 40 } },
    { id: WORKFLOW_NODE_IDS.verify, type: 'pipeline-verify', data: { label: '生意参谋校验' }, position: { x: 900, y: 40 } },
    { id: WORKFLOW_NODE_IDS.generate, type: 'pipeline-generate', data: { label: '标题生成' }, position: { x: 900, y: 260 } },
    { id: WORKFLOW_NODE_IDS.export, type: 'pipeline-export', data: { label: '导出清单' }, position: { x: 560, y: 260 } },
    { id: WORKFLOW_NODE_IDS.review, type: 'pipeline-review', data: { label: '人工复核' }, position: { x: 220, y: 260 } },
    { id: WORKFLOW_NODE_IDS.end, type: 'production-end', data: { label: '完成' }, position: { x: 220, y: 480 } }
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
    workflow: {
      nodes: workflowNodes(mode),
      edges: workflowEdges()
    }
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

function normalizeWorkflowGraph(workflow) {
  if (!workflow || typeof workflow !== 'object') return null;
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const edges = Array.isArray(workflow.edges) ? workflow.edges : [];
  return { nodes, edges };
}

function workflowSignature(workflow) {
  const graph = normalizeWorkflowGraph(workflow);
  if (!graph) return '';
  const nodes = graph.nodes
    .map(node => `${node.id}:${node.type}`)
    .sort()
    .join('|');
  const edges = graph.edges
    .map(edge => `${edge.source}->${edge.target}`)
    .sort()
    .join('|');
  return `${nodes}::${edges}`;
}

function findProductionTemplateForWorkflow(workflow) {
  const signature = workflowSignature(workflow);
  if (!signature) return null;
  return listProductionWorkflowTemplates().find(item => workflowSignature(item.workflow) === signature) || null;
}

/**
 * 校验真实 pipeline workflow 图，不依赖旧实验节点 registry。
 * @param {object} workflow workflow graph。
 * @returns {{ok:boolean, errors:Array<object>, production:boolean, templateId:string}}
 */
function validateProductionWorkflow(workflow) {
  const graph = normalizeWorkflowGraph(workflow);
  if (!graph) {
    return {
      ok: false,
      errors: [{ code: 'invalid_workflow', message: '工作流定义无效' }],
      production: true,
      templateId: ''
    };
  }

  const template = findProductionTemplateForWorkflow(graph);
  if (template) {
    return { ok: true, errors: [], production: true, templateId: template.id };
  }

  return {
    ok: false,
    errors: [{ code: 'production_template_mismatch', message: '工作流必须匹配生产 pipeline 模板' }],
    production: true,
    templateId: ''
  };
}

function extractWorkflowKeyword(workflow) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  const keywordNode = nodes.find(node => {
    if (!node || !node.data || typeof node.data.keyword !== 'string') return false;
    if (node.id === WORKFLOW_NODE_IDS.start || node.type === 'keyword-input' || node.type === 'production-start') return true;
    return node.data.keyword.trim().length > 0;
  });
  return keywordNode ? keywordNode.data.keyword.trim() : '';
}

/**
 * 从新旧 UI 请求体解析真实 pipeline 启动参数。
 * @param {object} body 请求体。
 * @returns {{mode:string, params:object}} 启动模式与参数。
 */
function resolveProductionWorkflowLaunch(body = {}) {
  const templates = listProductionWorkflowTemplates();
  let template = null;
  const workflow = body.workflow && typeof body.workflow === 'object' ? body.workflow : null;
  const templateId = body.templateId || body.template_id || workflow?.id;
  const hasExplicitMode = Object.prototype.hasOwnProperty.call(body, 'mode') || Object.prototype.hasOwnProperty.call(workflow || {}, 'mode');
  const hasExplicitTemplate = Boolean(templateId);
  if (templateId) {
    template = templates.find(item => item.id === templateId);
    if (!template) throw new Error(`未知 workflow template: ${templateId}`);
  }
  if (!template && workflow) template = findProductionTemplateForWorkflow(workflow);

  const params = {
    ...(body.params || {}),
    ...(body.options || {})
  };
  for (const key of ['keyword', 'mine', 'verify', 'generate', 'export', 'productsPerKeyword', 'length', 'port', 'pages', 'minBlueRows', 'fallbackHot']) {
    if (Object.prototype.hasOwnProperty.call(body, key)) params[key] = body[key];
  }

  if (!params.keyword) {
    const keyword = extractWorkflowKeyword(workflow);
    if (keyword) params.keyword = keyword;
  }

  let mode = body.mode || workflow?.mode || template?.mode || '';
  if (params.keyword && !hasExplicitMode && !hasExplicitTemplate) mode = 'keyword';
  if (!mode && params.keyword) mode = 'keyword';
  if (mode === 'daily' && params.keyword && !body.mode && !template) mode = 'keyword';
  if (!mode) {
    throw new Error('无法从工作流解析启动模式，请选择生产模板或提供关键词');
  }

  return { mode, params };
}

function nodeState(id, type, status, output = null, summary = {}) {
  const timestamp = summary.updatedAt || summary.startedAt || null;
  const runNodeState = summary.runtime?.nodeStates?.[id] || {};
  return {
    id,
    type,
    status,
    input: null,
    output: output || runNodeState.output || null,
    error: runNodeState.error || null,
    startedAt: status === 'idle' ? null : (runNodeState.startedAt || summary.startedAt || timestamp),
    completedAt: status === 'completed' || status === 'failed' ? (runNodeState.completedAt || timestamp) : null,
    progress: runNodeState.progress && typeof runNodeState.progress === 'object'
      ? runNodeState.progress
      : normalizeNodeProgress({
          status,
          percent: status === 'completed' ? 100 : 0,
          message: status === 'completed' ? '执行完成' : ''
        }),
    blocker: runNodeState.blocker || null,
    actionHint: runNodeState.actionHint || null,
    platform: runNodeState.platform || null,
    platformStatus: runNodeState.platformStatus || null,
    manualAction: runNodeState.manualAction || null,
    durationMs: runNodeState.durationMs || null,
    outputSummary: runNodeState.outputSummary || null
  };
}

function readRuntimeForSummary(summary, dataDir) {
  if (!summary || !summary.runId) return null;
  try {
    return readRuntimeState({ dataDir, runId: summary.runId });
  } catch (_error) {
    return null;
  }
}

function normalizeNodeProgress(progress = {}) {
  return {
    status: progress.status || 'running',
    current: Number.isFinite(Number(progress.current)) ? Number(progress.current) : 0,
    total: Number.isFinite(Number(progress.total)) ? Number(progress.total) : 0,
    percent: Number.isFinite(Number(progress.percent)) ? Number(progress.percent) : 0,
    message: progress.message || ''
  };
}

function nodeStatusFromRuntimeProgress(progress) {
  const status = progress && progress.status ? String(progress.status) : '';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'failed') return 'failed';
  if (status === 'blocked') return 'blocked';
  if (status === 'waiting_manual') return 'waiting_manual';
  if (status === 'retryable') return 'retryable';
  if (status === 'paused') return 'paused';
  if (status === 'resuming' || status === 'retrying') return 'running';
  if (status === 'needs_review') return 'needs_review';
  if (status === 'waiting_confirmation') return 'waiting_confirmation';
  if (status === 'completed') return 'completed';
  if (status === 'running') return 'running';
  return '';
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

function summaryInterventionForNode(summary, nodeId) {
  const status = summary.status || 'unknown';
  if (nodeId === WORKFLOW_NODE_IDS.verify) {
    if (status === 'verified_empty') {
      return {
        blocker: 'verified_empty',
        actionHint: '生意参谋验真没有通过词。请更换候选词、降低蓝海阈值，或重新挖词后再继续。'
      };
    }
    if (status === 'manual_action_required') {
      return {
        blocker: 'sycm_manual_action_required',
        actionHint: '生意参谋需要人工处理。请确认登录、滑块、权限或功能入口后继续流程。'
      };
    }
    if (status === 'verified_partial_manual_required') {
      return {
        blocker: 'sycm_partial_manual_required',
        actionHint: '部分关键词已验真，但生意参谋仍需要人工处理。可先继续使用已通过词，或处理登录、滑块、权限后继续验真。'
      };
    }
  }
  if (nodeId === WORKFLOW_NODE_IDS.generate && status === 'generate_failed') {
    return {
      blocker: 'generate_failed',
      actionHint: '标题生成失败。请检查 GLM 配置、关键词数据和运行日志后重试。'
    };
  }
  if (nodeId === WORKFLOW_NODE_IDS.export && status === 'export_empty') {
    return {
      blocker: 'export_empty',
      actionHint: '没有可导出的铺货商品。请返回标题生成结果，补充可铺货商品后再导出。'
    };
  }
  if (nodeId === WORKFLOW_NODE_IDS.review && status === 'needs_review') {
    return {
      blocker: 'review_rejected_rows',
      actionHint: '导出前需要人工复核。请打开复核报告，处理风险项后再继续提交。'
    };
  }
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
  const runtime = summary.runtime || null;
  const runtimeProgress = runtime && runtime.progress && typeof runtime.progress === 'object' ? runtime.progress : {};
  const states = NODE_ORDER.reduce((memo, nodeId, index) => {
    const nodeStatus = plannedStates[nodeId] || 'idle';
    const intervention = summaryInterventionForNode(summary, nodeId);
    const initialState = nodeState(nodeId, `pipeline-${nodeId}`, nodeStatus, nodeStatus === 'idle' ? null : outputForNode(nodeId, summary), summary);
    memo[nodeId] = {
      ...initialState,
      blocker: intervention?.blocker || initialState.blocker || null,
      actionHint: intervention?.actionHint || initialState.actionHint || null
    };
    return memo;
  }, {});
  Object.entries(runtimeProgress).forEach(([nodeId, progress]) => {
    if (!states[nodeId]) return;
    const progressDetails = progress && typeof progress === 'object' ? progress : {};
    const normalizedProgress = normalizeNodeProgress(progressDetails);
    const runtimeStatus = nodeStatusFromRuntimeProgress(normalizedProgress);
    states[nodeId] = {
      ...states[nodeId],
      status: runtimeStatus || states[nodeId].status,
      output: states[nodeId].output || outputForNode(nodeId, summary),
      progress: normalizedProgress,
      blocker: progressDetails.blocker || states[nodeId].blocker || null,
      actionHint: progressDetails.actionHint || states[nodeId].actionHint || null,
      platform: progressDetails.platform || states[nodeId].platform || null,
      platformStatus: progressDetails.platformStatus || states[nodeId].platformStatus || null,
      manualAction: progressDetails.manualAction || states[nodeId].manualAction || null,
      durationMs: progressDetails.durationMs || states[nodeId].durationMs || null,
      outputSummary: progressDetails.outputSummary || states[nodeId].outputSummary || null
    };
  });
  if (runtime && runtime.activeStep && states[runtime.activeStep]) {
    const runtimeStatus = nodeStatusFromRuntimeProgress({ status: runtime.status }) || 'running';
    const activeProgress = states[runtime.activeStep].progress || {};
    states[runtime.activeStep] = {
      ...states[runtime.activeStep],
      status: runtimeStatus,
      output: states[runtime.activeStep].output || outputForNode(runtime.activeStep, summary),
      progress: normalizeNodeProgress({
        ...activeProgress,
        status: runtimeStatus,
        message: activeProgress.message || (runtimeStatus === 'paused' ? '已暂停' : '')
      }),
      blocker: runtime.blocker || states[runtime.activeStep].blocker || null,
      actionHint: runtime.actionHint || states[runtime.activeStep].actionHint || null,
      platform: runtime.platform || states[runtime.activeStep].platform || null,
      platformStatus: runtime.platformStatus || states[runtime.activeStep].platformStatus || null,
      manualAction: runtime.manualAction || states[runtime.activeStep].manualAction || null,
      durationMs: runtime.durationMs || states[runtime.activeStep].durationMs || null,
      outputSummary: runtime.outputSummary || states[runtime.activeStep].outputSummary || null
    };
  }
  return states;
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
function pipelineSummaryToWorkflowRun(summary, options = {}) {
  if (!summary) return null;
  const runtime = summary.runtime || readRuntimeForSummary(summary, options.dataDir);
  const summaryWithRuntime = {
    ...summary,
    runtime
  };
  const workflowTemplate = templateForSummary(summary);
  const workflow = workflowTemplate
    ? { id: workflowTemplate.id, mode: workflowTemplate.mode, ...workflowTemplate.workflow }
    : null;
  return {
    runId: summary.runId,
    status: runtime?.status || summary.status || 'unknown',
    workflow,
    nodeStates: buildNodeStates(summaryWithRuntime),
    runtime,
    startedAt: summary.startedAt || '',
    updatedAt: runtime?.updatedAt || summary.updatedAt || summary.startedAt || '',
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
  const runs = result.runs.map(summary => pipelineSummaryToWorkflowRun(summary, { dataDir: options.dataDir }));
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
  const normalized = normalizeRunOptions(runIdOrOptions, options);
  const run = pipelineSummaryToWorkflowRun(summarizePipelineRun(normalized), { dataDir: normalized.dataDir });
  if (!run) return null;
  return {
    ...run,
    workflowEvents: readWorkflowEvents({ dataDir: normalized.dataDir, runId: normalized.runId || run.runId })
  };
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
  validateProductionWorkflow,
  resolveProductionWorkflowLaunch,
  writeWorkflowDefinition,
  appendWorkflowEvent,
  readWorkflowEvents,
  pipelineSummaryToWorkflowRun,
  listWorkflowRuns,
  getWorkflowRun,
  readWorkflowNodeArtifact
};
