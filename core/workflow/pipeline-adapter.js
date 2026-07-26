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
const { getLLMProviderInfo } = require('../llm');

const WORKFLOW_NODE_IDS = {
  start: 'start',
  mine: 'mine',
  keywordReview: 'keywordReview',
  verify: 'verify',
  select: 'select',
  generate: 'generate',
  export: 'export',
  review: 'review',
  end: 'end'
};

const NODE_ORDER = Object.values(WORKFLOW_NODE_IDS);
const WORKFLOW_RUN_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

const ARTIFACT_BY_NODE = {
  [WORKFLOW_NODE_IDS.mine]: { fileKey: 'candidates', type: 'jsonl' },
  [WORKFLOW_NODE_IDS.keywordReview]: { fileKey: 'reviewedCandidates', type: 'jsonl' },
  [WORKFLOW_NODE_IDS.verify]: { fileKey: 'verifiedKeywords', type: 'jsonl' },
  [WORKFLOW_NODE_IDS.select]: { fileKey: 'selectedProducts', type: 'jsonl' },
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
  const withSteps = (nodes) => nodes.map((node, index) => ({
    ...node,
    data: {
      ...node.data,
      stepIndex: index + 1,
      stepTotal: nodes.length
    }
  }));
  const positionNodes = (nodes, { startX = 60, stepX = 260, y = 120 } = {}) => (
    nodes.map((node, index) => ({
      ...node,
      position: { x: startX + index * stepX, y }
    }))
  );
  const startData = mode === 'keyword'
    ? {
        label: '开始',
        description: '输入精确关键词并启动',
        keyword: '',
        export: 20,
        productsPerKeyword: 12,
        length: 60,
        pages: 1
      }
    : {
        label: '开始',
        description: '按种子池启动每日选品',
      mine: 50,
      source: 'sycm_hot',
      rootMode: 'auto',
      rootLimit: 5,
      rootCooldownDays: 7,
        verify: 20,
        generate: 10,
        select: 10,
        export: 20,
        productsPerKeyword: 12,
        length: 60,
        pages: 1
      };
  if (mode === 'manual') {
    return withSteps(positionNodes([
      { id: WORKFLOW_NODE_IDS.start, type: 'production-start', data: { label: '开始', description: '输入关键词后人工筛选', keywords: '', length: 60, export: 20 } },
      { id: WORKFLOW_NODE_IDS.keywordReview, type: 'pipeline-keyword-review', data: { label: '人工选词与选品', description: '输入关键词、勾选 1688 货源或手动添加商品' } },
      { id: WORKFLOW_NODE_IDS.generate, type: 'pipeline-generate', data: { label: 'AI生成标题', description: '根据关键词和商品信息生成标题' } },
      { id: WORKFLOW_NODE_IDS.export, type: 'pipeline-export', data: { label: '输出铺货清单', description: '输出 URL$$标题$$类目 格式' } },
      { id: WORKFLOW_NODE_IDS.end, type: 'production-end', data: { label: '完成', description: '复制或查看标准铺货清单' } }
    ], { startX: 110 }));
  }
  if (mode === 'keyword') {
    return withSteps(positionNodes([
      { id: WORKFLOW_NODE_IDS.start, type: 'production-start', data: startData },
      { id: WORKFLOW_NODE_IDS.verify, type: 'pipeline-verify', data: { label: '生意参谋校验', description: '验证搜索人气和供需' } },
      { id: WORKFLOW_NODE_IDS.select, type: 'pipeline-select', data: { label: '货源选品', description: '搜索1688货源并评分筛选' } },
      { id: WORKFLOW_NODE_IDS.generate, type: 'pipeline-generate', data: { label: '标题生成', description: '基于已选货源生成铺货标题' } },
      { id: WORKFLOW_NODE_IDS.export, type: 'pipeline-export', data: { label: '铺货复核', description: '确认清单、风险和人工加入项' } },
      { id: WORKFLOW_NODE_IDS.end, type: 'production-end', data: { label: '完成', description: '查看结果和批次记录' } }
    ], { startX: 190 }));
  }
  return withSteps(positionNodes([
    { id: WORKFLOW_NODE_IDS.start, type: 'production-start', data: startData },
    { id: WORKFLOW_NODE_IDS.mine, type: 'pipeline-mine', data: { label: '选词挖掘', description: '从种子池扩展候选词' } },
    { id: WORKFLOW_NODE_IDS.keywordReview, type: 'pipeline-keyword-review', data: { label: '人工筛词', description: '人工筛除不适合验真的候选词' } },
    { id: WORKFLOW_NODE_IDS.verify, type: 'pipeline-verify', data: { label: '生意参谋校验', description: '验证搜索人气和供需' } },
    { id: WORKFLOW_NODE_IDS.select, type: 'pipeline-select', data: { label: '货源选品', description: '搜索1688货源并评分筛选' } },
    { id: WORKFLOW_NODE_IDS.generate, type: 'pipeline-generate', data: { label: '标题生成', description: '基于已选货源生成铺货标题' } },
    { id: WORKFLOW_NODE_IDS.export, type: 'pipeline-export', data: { label: '铺货复核', description: '确认清单、风险和人工加入项' } },
    { id: WORKFLOW_NODE_IDS.end, type: 'production-end', data: { label: '完成', description: '查看结果和批次记录' } }
  ]));
}

function workflowEdges(mode = 'daily') {
  const pairs = mode === 'keyword'
    ? [
        [WORKFLOW_NODE_IDS.start, WORKFLOW_NODE_IDS.verify],
        [WORKFLOW_NODE_IDS.verify, WORKFLOW_NODE_IDS.select],
        [WORKFLOW_NODE_IDS.select, WORKFLOW_NODE_IDS.generate],
        [WORKFLOW_NODE_IDS.generate, WORKFLOW_NODE_IDS.export],
        [WORKFLOW_NODE_IDS.export, WORKFLOW_NODE_IDS.end]
      ]
    : mode === 'manual'
      ? [
        [WORKFLOW_NODE_IDS.start, WORKFLOW_NODE_IDS.keywordReview],
        [WORKFLOW_NODE_IDS.keywordReview, WORKFLOW_NODE_IDS.generate],
        [WORKFLOW_NODE_IDS.generate, WORKFLOW_NODE_IDS.export],
        [WORKFLOW_NODE_IDS.export, WORKFLOW_NODE_IDS.end]
      ]
      : [
        [WORKFLOW_NODE_IDS.start, WORKFLOW_NODE_IDS.mine],
        [WORKFLOW_NODE_IDS.mine, WORKFLOW_NODE_IDS.keywordReview],
        [WORKFLOW_NODE_IDS.keywordReview, WORKFLOW_NODE_IDS.verify],
        [WORKFLOW_NODE_IDS.verify, WORKFLOW_NODE_IDS.select],
        [WORKFLOW_NODE_IDS.select, WORKFLOW_NODE_IDS.generate],
        [WORKFLOW_NODE_IDS.generate, WORKFLOW_NODE_IDS.export],
        [WORKFLOW_NODE_IDS.export, WORKFLOW_NODE_IDS.end]
      ];
  return pairs.map(([source, target]) => ({
    id: `${source}-${target}`,
    source,
    target,
    type: 'straight'
  }));
}

function template(id, name, mode, description, meta = {}) {
  return {
    id,
    name,
    mode,
    description,
    entryLabel: meta.entryLabel || '',
    scenarioLabel: meta.scenarioLabel || '',
    flowSummary: meta.flowSummary || '',
    modeHint: meta.modeHint || '',
    production: true,
    workflow: {
      nodes: workflowNodes(mode),
      edges: workflowEdges(mode)
    }
  };
}

/**
 * 列出真实 pipeline 对应的固定工作流模板。
 * @returns {Array<object>} 模板列表。
 */
function listProductionWorkflowTemplates() {
  return [
    template('daily-selection-v1', '每日蓝海选品流水线', 'daily', '选词、验真、生成标题并导出铺货清单', {
      entryLabel: '入口：种子池',
      scenarioLabel: '适合：每天自动发现新机会',
      flowSummary: '流程：选词挖掘 → 人工筛词 → 生意参谋校验 → 货源选品 → 标题生成 → 导出复核',
      modeHint: '从种子池自动扩展候选词，会先执行选词挖掘。'
    }),
    template('exact-keyword-v1', '精确关键词选品流水线', 'keyword', '按用户给定关键词生成铺货清单', {
      entryLabel: '入口：手动关键词',
      scenarioLabel: '适合：验证一个明确目标词',
      flowSummary: '流程：输入关键词 → 跳过挖词 → 生意参谋校验 → 货源选品 → 标题生成 → 导出复核',
      modeHint: '使用你输入的关键词，跳过挖词，直接进入生意参谋校验。'
    }),
    template('manual-selection-v1', '人工选词人工选品流水线', 'manual', '人工确定关键词和货源，AI只生成标题并输出标准清单', {
      entryLabel: '入口：手动关键词',
      scenarioLabel: '适合：精确控制词和商品',
      flowSummary: '流程：人工选词与选品 → AI生成标题 → URL$$标题$$类目',
      modeHint: '先输入关键词并筛选，再勾选 1688 货源或手动添加商品。'
    })
  ];
}

/**
 * 清洗 workflow 启动参数，并限制到 CLI 可接受范围。
 * @param {string} mode 工作流模式：daily、keyword 或 manual。
 * @param {object} raw 原始参数。
 * @returns {object} 清洗后的参数。
 */
function sanitizeWorkflowParams(mode, raw = {}) {
  if (mode === 'daily') {
    return {
      mine: clampInt(raw.mine, 50, 1, 200),
      source: ['local', 'ai', 'hybrid', 'sycm_hot', 'sycm_blue'].includes(String(raw.source || '').trim()) ? String(raw.source).trim() : 'sycm_hot',
      rootMode: String(raw.rootMode || 'auto') === 'seed' ? 'seed' : 'auto',
      rootLimit: clampInt(raw.rootLimit, 5, 1, 20),
      rootCooldownDays: clampInt(raw.rootCooldownDays, 7, 0, 60),
      maxObservingSeeds: clampInt(raw.maxObservingSeeds, 3, 0, 10),
      maxNewSeeds: clampInt(raw.maxNewSeeds, 3, 0, 10),
      autoReplenishSeeds: sanitizeBool(raw.autoReplenishSeeds, true),
      recordSeedFeedback: sanitizeBool(raw.recordSeedFeedback, true),
      verify: clampInt(raw.verify, 20, 1, 200),
      generate: clampInt(raw.generate, 10, 1, 100),
      export: clampInt(raw.export, 20, 1, 100),
      productsPerKeyword: clampInt(raw.productsPerKeyword, 12, 1, 50),
      length: clampInt(raw.length, 60, 30, 80),
      port: clampInt(raw.port, 9222, 1, 65535),
      pages: clampInt(raw.pages, 1, 1, 5),
      minBlueRows: clampInt(raw.minBlueRows, 1, 0, 50),
      fallbackHot: sanitizeBool(raw.fallbackHot, true),
      autoApproveKeywords: sanitizeBool(raw.autoApproveKeywords, true),
      autoExpandVerify: sanitizeBool(raw.autoExpandVerify, true),
      verifyReserve: clampInt(raw.verifyReserve, 8, 0, 30),
      autoAllowReviewKeywords: sanitizeBool(raw.autoAllowReviewKeywords, true),
      reviewKeywordLimit: clampInt(raw.reviewKeywordLimit, 2, 1, 5)
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
  if (mode === 'manual') {
    const keywords = String(raw.keywords || '').split(/\r?\n|[,，]/).map(item => item.trim()).filter(Boolean);
    if (keywords.length === 0) throw new Error('至少输入一个关键词');
    return {
      keywords: [...new Set(keywords)].slice(0, 100),
      export: clampInt(raw.export, 20, 1, 100),
      length: clampInt(raw.length, 60, 30, 80)
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
    pushFlag(args, '--verify-reserve', clean.verifyReserve);
    if (!clean.fallbackHot) args.push('--no-hot-fallback');
    if (!clean.autoExpandVerify) args.push('--no-auto-expand-verify');
    if (!clean.autoAllowReviewKeywords) args.push('--no-auto-continue-review-keywords');
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
  for (const key of ['keyword', 'keywords', 'mine', 'source', 'rootMode', 'rootLimit', 'rootCooldownDays', 'maxObservingSeeds', 'maxNewSeeds', 'autoReplenishSeeds', 'recordSeedFeedback', 'verify', 'generate', 'export', 'productsPerKeyword', 'length', 'port', 'pages', 'minBlueRows', 'fallbackHot', 'autoApproveKeywords', 'autoExpandVerify', 'verifyReserve', 'autoAllowReviewKeywords', 'reviewKeywordLimit']) {
    if (Object.prototype.hasOwnProperty.call(body, key)) params[key] = body[key];
  }

  if (!params.keyword && !params.keywords) {
    const keyword = extractWorkflowKeyword(workflow);
    if (keyword) params.keyword = keyword;
  }

  let mode = body.mode || workflow?.mode || template?.mode || '';
  if (params.keywords && !hasExplicitMode && !hasExplicitTemplate) mode = 'manual';
  if (params.keyword && !hasExplicitMode && !hasExplicitTemplate) mode = 'keyword';
  if (!mode && params.keywords) mode = 'manual';
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
  if (status === 'awaiting_product_review') return 'waiting_confirmation';
  if (status === 'completed') return 'completed';
  if (status === 'running') return 'running';
  return '';
}

function outputForNode(id, summary) {
  const counts = summary.counts || {};
  if (id === WORKFLOW_NODE_IDS.start) return { runId: summary.runId };
  if (id === WORKFLOW_NODE_IDS.mine) return { count: Number(counts.candidates || 0), file: summary.files?.candidates || '' };
  if (id === WORKFLOW_NODE_IDS.keywordReview) {
    return {
      approved: Number(counts.keywordReviewApproved || 0),
      rejected: Number(counts.keywordReviewRejected || 0),
      pending: Number(counts.keywordReviewPending || 0),
      file: summary.files?.reviewedCandidates || ''
    };
  }
  if (id === WORKFLOW_NODE_IDS.verify) {
    return {
      verified: Number(counts.sycmVerified || 0),
      rejected: Number(counts.sycmRejected || 0),
      generationEligible: Number(counts.sycmGenerationEligible || 0),
      opportunityReview: Number(counts.sycmOpportunityReview || 0),
      file: summary.files?.verifiedKeywords || ''
    };
  }
  if (id === WORKFLOW_NODE_IDS.select) {
    const hasSelectedFile = Boolean(summary.files?.selectedProducts && fs.existsSync(summary.files.selectedProducts));
    const count = Number(counts.selectedProducts || (!hasSelectedFile ? counts.generatedProducts : 0) || 0);
    return {
      count,
      productCount: count,
      file: summary.files?.selectedProducts || ''
    };
  }
  if (id === WORKFLOW_NODE_IDS.generate) {
    const count = Number(counts.generatedProducts || 0);
    return {
      count,
      recordCount: count,
      titleCount: count,
      sourceCount: count,
      file: summary.files?.generatedProducts || ''
    };
  }
  if (id === WORKFLOW_NODE_IDS.export) {
    return {
      count: Number(summary.batchCount || counts.readyToDistribute || 0),
      batchFile: summary.batchFile || summary.files?.distributionBatch || '',
      reviewFile: summary.reviewFile || summary.files?.distributionReview || '',
      mustReview: !!summary.mustReview
    };
  }
  if (id === WORKFLOW_NODE_IDS.review) {
    return { reviewFile: summary.reviewFile || summary.files?.distributionReview || '', mustReview: !!summary.mustReview };
  }
  if (id === WORKFLOW_NODE_IDS.end) return { canSubmit: !!summary.canSubmit };
  return null;
}

function firstSycmFailure(summary) {
  const file = summary.files?.sycmResults;
  const rows = readJsonlPreview(file, 20);
  return rows.find(row => row && row.ok === false && (row.manualAction || row.error || row.status)) || null;
}

function sycmFailureIntervention(row) {
  if (!row) return null;
  const status = String(row.status || row.manualAction?.status || 'transient_failure');
  const error = String(row.error || row.manualAction?.error || '');
  const userMessage = String(row.manualAction?.userMessage || '').trim();
  const cdpUnavailable = /ECONNREFUSED|127\.0\.0\.1:9222|no chrome tab found|chrome[^\n]*(?:tab|debug)|cdp|devtools/i.test(error);

  if (cdpUnavailable) {
    return {
      blocker: 'sycm_transient_failure',
      actionHint: `Chrome CDP 不可用，生意参谋校验无法连接 9222 调试端口。原始错误：${error}`,
      platform: 'sycm',
      platformStatus: status,
      manualAction: {
        platform: 'sycm',
        status,
        userMessage: userMessage || '请启动带远程调试端口的 Chrome，登录生意参谋后重试。'
      },
      nextRecommendedAction: {
        action: 'start-sycm-chrome',
        label: '启动 Chrome',
        description: '启动带远程调试端口的 Chrome，登录生意参谋后重试校验。'
      }
    };
  }

  return {
    blocker: `sycm_${status}`,
    actionHint: userMessage || error || '生意参谋校验失败，请处理平台访问问题后重试。',
    platform: 'sycm',
    platformStatus: status,
    manualAction: row.manualAction || { platform: 'sycm', status, userMessage },
    nextRecommendedAction: {
      action: 'resume-after-manual',
      label: '我已处理，继续流程',
      description: '处理生意参谋访问问题后，从当前节点继续。'
    }
  };
}

function summaryInterventionForNode(summary, nodeId) {
  const status = summary.status || 'unknown';
  if (nodeId === WORKFLOW_NODE_IDS.keywordReview) {
    if (status === 'awaiting_keyword_review') {
      return {
        blocker: 'keyword_review_required',
        actionHint: '请先人工筛选候选词。确认后的关键词才会进入生意参谋校验，避免浪费平台请求。',
        nextRecommendedAction: {
          action: 'confirm-keyword-review',
          label: '确认筛词结果',
          description: '将当前保留的候选词写入人工筛词产物，然后继续生意参谋校验。'
        }
      };
    }
    if (status === 'keyword_review_empty') {
      return {
        blocker: 'no_keyword_review_approved',
        actionHint: '人工筛词后没有保留关键词。请返回选词挖掘补充候选词，或重新筛选。',
        nextRecommendedAction: {
          action: 'mine-more',
          label: '补充候选词',
          description: '回到选词挖掘节点补充候选词。'
        }
      };
    }
  }
  if (nodeId === WORKFLOW_NODE_IDS.verify) {
    const sycmFailure = sycmFailureIntervention(firstSycmFailure(summary));
    if (sycmFailure && ['verified_empty', 'manual_action_required', 'verified_partial_manual_required'].includes(status)) {
      return sycmFailure;
    }
    if (status === 'verified_empty') {
      return {
        blocker: 'verified_empty',
        actionHint: '生意参谋验真没有通过词。请更换候选词、降低蓝海阈值，或重新挖词后再继续。',
        nextRecommendedAction: {
          action: 'mine-more',
          label: '补充候选词',
          description: '当前没有通过生意参谋验真的词，先补充候选词再重跑验真。'
        }
      };
    }
    if (status === 'verified_no_generation_eligible') {
      return {
        blocker: 'no_generation_eligible_keywords',
        actionHint: '生意参谋有验真词，但关键词机会分都未通过。请补充候选词、调整筛选参数，或人工放行后再生成标题。',
        nextRecommendedAction: {
          action: 'mine-more',
          label: '补充候选词',
          description: '先补充更符合蓝海机会的候选词，再重跑生意参谋校验。'
        }
      };
    }
    if (status === 'manual_action_required') {
      return {
        blocker: 'sycm_manual_action_required',
        actionHint: '生意参谋需要人工处理。请确认登录、滑块、权限或功能入口后继续流程。',
        nextRecommendedAction: {
          action: 'resume-after-manual',
          label: '我已处理，继续流程',
          description: '处理登录、滑块、权限或功能入口后，从当前节点继续。'
        }
      };
    }
    if (status === 'verified_partial_manual_required') {
      return {
        blocker: 'sycm_partial_manual_required',
        actionHint: '部分关键词已验真，但生意参谋仍需要人工处理。可先继续使用已通过词，或处理登录、滑块、权限后继续验真。',
        nextRecommendedAction: {
          action: 'continue-or-fix-sycm',
          label: '继续使用已通过词',
          description: '已有部分关键词通过，可继续生成；也可以先处理生意参谋后重试验真。'
        }
      };
    }
  }
  if (nodeId === WORKFLOW_NODE_IDS.generate && status === 'generate_failed') {
    const failure = (summary.previews?.generatedProducts || [])
      .find(row => row && row.status === 'generate_failed');
    const llmInfo = getLLMProviderInfo({ provider: failure?.llmProvider });
    const llmModel = failure?.llmModel || llmInfo.model;
    const providerLabel = llmModel
      ? `${llmInfo.label}（${llmModel}）`
      : llmInfo.label;
    const reason = String(failure?.error || '').trim();
    const isTimeout = failure?.code === 'title_generation_timeout' || /标题生成超时/.test(reason);
    const timeoutAdvice = llmInfo.provider === 'minimax'
      ? '模型配置已识别，请重跑标题生成；系统将使用更长的 MiniMax 生成时限。'
      : '模型配置已识别，请减少单次商品数量或调高标题生成时限后重跑。';
    return {
      blocker: 'generate_failed',
      actionHint: reason
        ? `标题生成失败。当前使用 ${providerLabel}。失败原因：${reason}${isTimeout ? `。${timeoutAdvice}` : ''}`
        : `标题生成失败。当前使用 ${providerLabel}。请检查当前模型服务配置、关键词数据和运行日志后重试。`,
      llmProvider: llmInfo.provider,
      llmModel,
      nextRecommendedAction: {
        action: 'retry-node',
        label: '重跑标题生成',
        description: isTimeout
          ? '使用更长的标题生成时限重新运行当前节点。'
          : '保留当前产物并重新运行标题生成节点。'
      }
    };
  }
  if (nodeId === WORKFLOW_NODE_IDS.select && status === 'select_failed') {
    return {
      blocker: 'no_selected_products',
      actionHint: '货源选品没有选出可用商品。请检查 1688 搜索配置、放宽选品数量，或回到生意参谋节点更换候选词。',
      nextRecommendedAction: {
        action: 'retry-node',
        label: '重跑货源选品',
        description: '重新搜索 1688 货源并计算商品机会分。'
      }
    };
  }
  if (nodeId === WORKFLOW_NODE_IDS.export && status === 'export_empty') {
    return {
      blocker: 'export_empty',
      actionHint: '没有可导出的铺货商品。请返回标题生成结果，补充可铺货商品后再导出。'
    };
  }
  if (nodeId === WORKFLOW_NODE_IDS.export && status === 'needs_review') {
    return {
      blocker: 'review_rejected_rows',
      actionHint: '铺货前需要人工复核。请在铺货复核节点处理风险项后再继续提交。',
      nextRecommendedAction: {
        action: 'open-review',
        label: '处理铺货复核',
        description: '查看自动清单、拦截原因，并人工加入可铺货项。'
      }
    };
  }
  if (nodeId === WORKFLOW_NODE_IDS.export && (status === 'ready_to_distribute' || status === 'awaiting_user_confirmation')) {
    return {
      nextRecommendedAction: {
        action: 'confirm-distribution',
        label: '确认铺货清单',
        description: '铺货前必须人工确认具体商品清单，确认后再进入提交动作。'
      }
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

  if (status === 'manual_action_required' || status === 'verified_partial_manual_required' || status === 'verified_empty' || status === 'verified_no_generation_eligible') {
    completeBefore(states, WORKFLOW_NODE_IDS.verify);
    states[WORKFLOW_NODE_IDS.verify] = 'blocked';
    return states;
  }

  if (status === 'generate_failed') {
    completeBefore(states, WORKFLOW_NODE_IDS.generate);
    states[WORKFLOW_NODE_IDS.generate] = 'failed';
    return states;
  }

  if (status === 'select_failed') {
    completeBefore(states, WORKFLOW_NODE_IDS.select);
    states[WORKFLOW_NODE_IDS.select] = 'failed';
    return states;
  }

  if (status === 'needs_review') {
    completeBefore(states, WORKFLOW_NODE_IDS.export);
    states[WORKFLOW_NODE_IDS.export] = 'needs_review';
    return states;
  }

  if (status === 'ready_to_distribute' || status === 'awaiting_user_confirmation') {
    completeBefore(states, WORKFLOW_NODE_IDS.export);
    states[WORKFLOW_NODE_IDS.export] = 'waiting_confirmation';
    return states;
  }

  if (status === 'created') {
    completeThrough(states, WORKFLOW_NODE_IDS.start);
    states[WORKFLOW_NODE_IDS.mine] = 'running';
    return states;
  }

  if (status === 'mined') {
    completeThrough(states, WORKFLOW_NODE_IDS.mine);
    states[WORKFLOW_NODE_IDS.keywordReview] = 'running';
    return states;
  }

  if (status === 'awaiting_keyword_review' || status === 'keyword_review_empty') {
    completeThrough(states, WORKFLOW_NODE_IDS.mine);
    states[WORKFLOW_NODE_IDS.keywordReview] = 'blocked';
    return states;
  }

  if (status === 'keywords_reviewed') {
    completeThrough(states, WORKFLOW_NODE_IDS.keywordReview);
    states[WORKFLOW_NODE_IDS.verify] = 'running';
    return states;
  }

  if (status === 'verified') {
    completeThrough(states, WORKFLOW_NODE_IDS.verify);
    states[WORKFLOW_NODE_IDS.select] = 'running';
    return states;
  }

  if (status === 'products_selected') {
    completeThrough(states, WORKFLOW_NODE_IDS.select);
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
      actionHint: intervention?.actionHint || initialState.actionHint || null,
      nextRecommendedAction: intervention?.nextRecommendedAction || initialState.nextRecommendedAction || null,
      platform: intervention?.platform || initialState.platform || null,
      platformStatus: intervention?.platformStatus || initialState.platformStatus || null,
      manualAction: intervention?.manualAction || initialState.manualAction || null
    };
    return memo;
  }, {});
  Object.entries(runtimeProgress).forEach(([nodeId, progress]) => {
    const manualMode = summary.options?.mode === 'manual';
    const effectiveNodeId = nodeId === WORKFLOW_NODE_IDS.review
      ? WORKFLOW_NODE_IDS.export
      : manualMode && nodeId === WORKFLOW_NODE_IDS.select
        ? WORKFLOW_NODE_IDS.keywordReview
        : nodeId;
    if (!states[effectiveNodeId]) return;
    const progressDetails = progress && typeof progress === 'object' ? progress : {};
    const normalizedProgress = normalizeNodeProgress(progressDetails);
    const runtimeStatus = nodeStatusFromRuntimeProgress(normalizedProgress);
    states[effectiveNodeId] = {
      ...states[effectiveNodeId],
      status: runtimeStatus || states[effectiveNodeId].status,
      output: states[effectiveNodeId].output || outputForNode(effectiveNodeId, summary),
      progress: normalizedProgress,
      blocker: progressDetails.blocker || states[effectiveNodeId].blocker || null,
      actionHint: progressDetails.actionHint || states[effectiveNodeId].actionHint || null,
      nextRecommendedAction: progressDetails.nextRecommendedAction || states[effectiveNodeId].nextRecommendedAction || null,
      platform: progressDetails.platform || states[effectiveNodeId].platform || null,
      platformStatus: progressDetails.platformStatus || states[effectiveNodeId].platformStatus || null,
      manualAction: progressDetails.manualAction || states[effectiveNodeId].manualAction || null,
      durationMs: progressDetails.durationMs || states[effectiveNodeId].durationMs || null,
      outputSummary: progressDetails.outputSummary || states[effectiveNodeId].outputSummary || null
    };
  });
  const activeStep = runtime?.activeStep === WORKFLOW_NODE_IDS.review
    ? WORKFLOW_NODE_IDS.export
    : summary.options?.mode === 'manual' && runtime?.activeStep === WORKFLOW_NODE_IDS.select
      ? WORKFLOW_NODE_IDS.keywordReview
      : runtime?.activeStep;
  if (runtime && activeStep && states[activeStep]) {
    const runtimeStatus = nodeStatusFromRuntimeProgress({ status: runtime.status }) || 'running';
    const activeProgress = states[activeStep].progress || {};
    states[activeStep] = {
      ...states[activeStep],
      status: runtimeStatus,
      output: states[activeStep].output || outputForNode(activeStep, summary),
      progress: normalizeNodeProgress({
        ...activeProgress,
        status: runtimeStatus,
        message: activeProgress.message || (runtimeStatus === 'paused' ? '已暂停' : '')
      }),
      blocker: runtime.blocker || states[activeStep].blocker || null,
      actionHint: runtime.actionHint || states[activeStep].actionHint || null,
      nextRecommendedAction: runtime.nextRecommendedAction || states[activeStep].nextRecommendedAction || null,
      platform: runtime.platform || states[activeStep].platform || null,
      platformStatus: runtime.platformStatus || states[activeStep].platformStatus || null,
      manualAction: runtime.manualAction || states[activeStep].manualAction || null,
      durationMs: runtime.durationMs || states[activeStep].durationMs || null,
      outputSummary: runtime.outputSummary || states[activeStep].outputSummary || null
    };
  }
  return states;
}

function templateForSummary(summary) {
  const options = summary.options || {};
  const mode = summary.options?.mode || (options.keyword || summary.exactKeyword ? 'keyword' : 'daily');
  const id = mode === 'keyword' ? 'exact-keyword-v1' : mode === 'manual' ? 'manual-selection-v1' : 'daily-selection-v1';
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
    if (normalized.nodeId === WORKFLOW_NODE_IDS.keywordReview) {
      if (summary.options?.mode === 'manual') {
        const selectedFile = summary.files?.selectedProducts;
        const selectedRows = readJsonlPreview(selectedFile, normalized.limit || 50);
        if (selectedRows.length > 0) {
          return {
            runId: summary.runId,
            nodeId: normalized.nodeId,
            file: selectedFile || file,
            type: 'jsonl',
            rows: selectedRows
          };
        }
      }
      const reviewedRows = readJsonlPreview(file, normalized.limit || 50);
      if (reviewedRows.length > 0) {
        return {
          runId: summary.runId,
          nodeId: normalized.nodeId,
          file,
          type: 'jsonl',
          rows: reviewedRows
        };
      }
      const candidateRows = readJsonlPreview(summary.files?.candidates, normalized.limit || 50);
      return {
        runId: summary.runId,
        nodeId: normalized.nodeId,
        file: summary.files?.candidates || file,
        type: 'jsonl',
        derivedFrom: 'candidates',
        rows: candidateRows.map(row => ({
          ...row,
          reviewStatus: 'pending',
          status: row.status || 'keyword_pending_review'
        }))
      };
    }
    if (normalized.nodeId === WORKFLOW_NODE_IDS.select) {
      const rows = readJsonlPreview(file, normalized.limit || 50);
      if (rows.length > 0) {
        return {
          runId: summary.runId,
          nodeId: normalized.nodeId,
          file,
          type: 'jsonl',
          rows
        };
      }
      const generatedFile = summary.files && summary.files.generatedProducts;
      const generatedRows = readJsonlPreview(generatedFile, normalized.limit || 50);
      if (generatedRows.length > 0) {
        return {
          runId: summary.runId,
          nodeId: normalized.nodeId,
          file: generatedFile,
          type: 'jsonl',
          derivedFrom: 'generatedProducts',
          rows: generatedRows.map(row => ({
            status: 'selected',
            keyword: row.keyword || row.selectedKeyword || '',
            selectedKeyword: row.selectedKeyword || row.keyword || '',
            product: row.selectedProduct?.product || row.product || {},
            url: row.url || row.product?.['产品链接'] || row.product?.detailUrl || '',
            sourceTitle: row.selectedProduct?.sourceTitle || row.product?.['链接原标题'] || row.product?.subject || row.product?.title || row.title || '',
            title: row.selectedProduct?.sourceTitle || row.product?.['链接原标题'] || row.product?.subject || row.product?.title || row.title || '',
            price: row.selectedProduct?.price || row.product?.['商品原价'] || row.product?.price || '',
            sales30days: row.selectedProduct?.sales30days || row.product?.['30天销量'] || row.product?.sales30days || row.product?.monthlySales || '',
            imageUrl: row.selectedProduct?.imageUrl || row.product?.['主图链接'] || row.product?.imageUrl || row.product?.image || '',
            productOpportunity: row.selectedProduct?.productOpportunity || row.productOpportunity || null,
            keywordOpportunity: row.keywordOpportunity || null,
            opportunityScore: row.opportunityScore || row.productOpportunity?.score || '',
            decision: row.decision || row.productOpportunity?.decision || '',
            nextAction: row.nextAction || row.productOpportunity?.nextAction || '',
            derivedFrom: 'generated-products'
          }))
        };
      }
    }
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

/**
 * 删除真实 pipeline workflow run 目录，并在必要时清理 latest 指针。
 * @param {object} options 删除参数。
 * @param {string} [options.dataDir] pipeline 数据目录。
 * @param {string} options.runId pipeline runId。
 * @returns {{ok:boolean,runId:string,deleted:object}} 删除结果。
 */
function deleteWorkflowRun({ dataDir = DEFAULT_PIPELINE_DIR, runId } = {}) {
  assertSafeWorkflowRunId(runId);
  const baseDir = path.resolve(dataDir || DEFAULT_PIPELINE_DIR);
  const runDir = path.resolve(workflowRunDir(baseDir, runId));
  const runsDir = path.resolve(baseDir, 'runs');
  const relative = path.relative(runsDir, runDir);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid workflow run path');
  }

  const existed = fs.existsSync(runDir);
  if (existed) {
    fs.rmSync(runDir, { recursive: true, force: true });
  }

  const latestFile = path.join(baseDir, 'latest.json');
  let latestCleared = false;
  if (fs.existsSync(latestFile)) {
    try {
      const latest = JSON.parse(fs.readFileSync(latestFile, 'utf8'));
      if (latest && latest.runId === runId) {
        fs.rmSync(latestFile, { force: true });
        latestCleared = true;
      }
    } catch (_) {
      // Keep malformed latest.json untouched unless it clearly points to this run.
    }
  }

  return {
    ok: existed,
    runId,
    deleted: {
      pipelineRun: existed,
      latestPointer: latestCleared
    }
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
  readWorkflowNodeArtifact,
  deleteWorkflowRun
};
