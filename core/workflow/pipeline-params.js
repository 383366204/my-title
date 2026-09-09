'use strict';

const normalizeExactKeywords = require('../exact-keywords').normalizeExactKeywords;
const normalizeRootKeywords = require('../root-keywords').normalizeRootKeywords;
const parseManualItems = require('../../skills/order-sheet/src/manual-items').parseManualItems;
const DEFAULT_ORDER_GROUP_SIZE = require('../../skills/order-sheet/src/order-groups').DEFAULT_ORDER_GROUP_SIZE;
const { WORKFLOW_NODE_IDS, localIsoDate } = require('./pipeline-definition-common');
const { listProductionWorkflowTemplates } = require('./pipeline-templates');

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

function sanitizeOrderSheetDateRange(raw = {}) {
  const dateMode = ['latest_day', 'last_7_days', 'last_30_days', 'custom'].includes(String(raw.dateMode || ''))
    ? String(raw.dateMode)
    : 'latest_day';
  const startDate = String(raw.startDate || '').trim();
  const endDate = String(raw.endDate || '').trim();
  if (dateMode !== 'custom') return { dateMode, startDate: '', endDate: '' };
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(startDate) || !pattern.test(endDate)) throw new Error('自定义日期范围必须填写开始日期和结束日期');
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (start.toISOString().slice(0, 10) !== startDate || end.toISOString().slice(0, 10) !== endDate) {
    throw new Error('自定义日期范围包含无效日期');
  }
  const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  if (!Number.isFinite(days) || days < 1) throw new Error('开始日期不能晚于结束日期');
  if (days > 31) throw new Error('生意参谋自定义日期范围最多选择 31 天');
  return { dateMode, startDate, endDate };
}

function sanitizeOrderDate(value) {
  const orderDate = String(value || '').trim() || localIsoDate();
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(orderDate)) throw new Error('刷单日期格式无效');
  const parsed = new Date(`${orderDate}T00:00:00Z`);
  if (parsed.toISOString().slice(0, 10) !== orderDate) throw new Error('刷单日期无效');
  return orderDate;
}

function normalizeManualOfferUrl(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (parsed.hostname !== '1688.com' && !parsed.hostname.endsWith('.1688.com')) return null;
    const pathMatch = parsed.pathname.match(/\/offer\/(\d+)(?:\.html)?/i);
    const offerId = pathMatch?.[1] || parsed.searchParams.get('offerId') || parsed.searchParams.get('offer_id');
    if (!offerId || !/^\d+$/.test(offerId)) return null;
    return {
      offerId,
      url: `https://detail.1688.com/offer/${offerId}.html`
    };
  } catch (_error) {
    return null;
  }
}

function sanitizeManualWorkflowItems(raw = {}) {
  const defaultKeyword = String(raw.defaultKeyword || '').trim();
  const sourceItems = Array.isArray(raw.items) ? raw.items : [];
  const seenOfferIds = new Set();
  const items = [];
  for (const [index, item] of sourceItems.entries()) {
    const normalizedUrl = normalizeManualOfferUrl(item?.url || item?.productUrl);
    if (!normalizedUrl) throw new Error(`第 ${index + 1} 个 1688 商品链接无效`);
    if (seenOfferIds.has(normalizedUrl.offerId)) {
      throw new Error(`第 ${index + 1} 个 1688 商品链接与前面的商品重复`);
    }
    const keyword = String(item?.keyword || defaultKeyword).trim();
    seenOfferIds.add(normalizedUrl.offerId);
    items.push({
      clientId: String(item?.clientId || `manual-${normalizedUrl.offerId}`).trim(),
      keyword,
      userKeyword: keyword,
      keywordSource: keyword ? 'manual' : 'auto_extract',
      url: normalizedUrl.url,
      offerId: normalizedUrl.offerId,
      title: String(item?.title || item?.sourceTitle || '').trim(),
      category: String(item?.category || item?.recommendedCategory || '').trim()
    });
    if (items.length >= 100) break;
  }
  if (items.length === 0) throw new Error('至少输入一个有效的 1688 商品链接');
  return { defaultKeyword, items };
}

/**
 * 清洗 workflow 启动参数，并限制到 CLI 可接受范围。
 * @param {string} mode 工作流模式：daily、keyword 或 manual。
 * @param {object} raw 原始参数。
 * @returns {object} 清洗后的参数。
 */
function sanitizeWorkflowParams(mode, raw = {}) {
  if (mode === 'daily') {
    const discoveryMode = ['inspiration', 'seed', 'hybrid'].includes(String(raw.discoveryMode || '').trim())
      ? String(raw.discoveryMode).trim()
      : 'inspiration';
    return {
      mine: clampInt(raw.mine, 50, 1, 200),
      discoveryMode,
      source: ['local', 'ai', 'hybrid', 'sycm_hot', 'sycm_blue', 'inspiration'].includes(String(raw.source || '').trim())
        ? String(raw.source).trim()
        : discoveryMode === 'inspiration' || discoveryMode === 'hybrid' ? 'inspiration' : 'sycm_hot',
      rootMode: String(raw.rootMode || 'auto') === 'seed' ? 'seed' : 'auto',
      rootLimit: clampInt(raw.rootLimit, 8, 1, 20),
      rootCooldownDays: clampInt(raw.rootCooldownDays, 14, 0, 60),
      familyCooldownDays: clampInt(raw.familyCooldownDays, 7, 0, 60),
      inspirationSycmPages: clampInt(raw.inspirationSycmPages, 1, 1, 1),
      inspirationUseLLM: sanitizeBool(raw.inspirationUseLLM, true),
      maxObservingSeeds: clampInt(raw.maxObservingSeeds, 3, 0, 10),
      maxObservingPoolSize: clampInt(raw.maxObservingPoolSize, 24, 3, 100),
      maxNewSeeds: clampInt(raw.maxNewSeeds, 3, 0, 10),
      autoReplenishSeeds: sanitizeBool(raw.autoReplenishSeeds, discoveryMode === 'seed'),
      recordSeedFeedback: sanitizeBool(raw.recordSeedFeedback, true),
      verify: clampInt(raw.verify, 20, 1, 200),
      select: clampInt(raw.select, 10, 1, 100),
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
    const keywords = normalizeExactKeywords(
      Array.isArray(raw.keywords) && raw.keywords.length > 0 ? raw.keywords : raw.keyword
    );
    if (keywords.length === 0) throw new Error('关键词不能为空');
    return {
      keyword: keywords[0],
      ...(keywords.length > 1 ? { keywords } : {}),
      export: clampInt(raw.export, 20, 1, 100),
      productsPerKeyword: clampInt(raw.productsPerKeyword, 12, 1, 50),
      length: clampInt(raw.length, 60, 30, 80),
      port: clampInt(raw.port, 9222, 1, 65535),
      pages: clampInt(raw.pages, 1, 1, 5),
      minBlueRows: clampInt(raw.minBlueRows, 1, 0, 50),
      fallbackHot: sanitizeBool(raw.fallbackHot, true)
    };
  }
  if (mode === 'root-keyword') {
    const normalizedRoots = normalizeRootKeywords(
      Array.isArray(raw.roots) && raw.roots.length > 0 ? raw.roots : raw.rootsText
    );
    if (normalizedRoots.roots.length === 0) throw new Error('词根不能为空');
    const riskProfile = ['conservative', 'standard', 'custom'].includes(String(raw.sycmRiskProfile || ''))
      ? String(raw.sycmRiskProfile)
      : 'standard';
    const presets = riskProfile === 'conservative'
      ? { minInterval: 90000, maxInterval: 180000, batchSize: 8, minCooldown: 600000, maxCooldown: 1200000 }
      : { minInterval: 45000, maxInterval: 90000, batchSize: 10, minCooldown: 300000, maxCooldown: 600000 };
    const minInterval = riskProfile === 'custom'
      ? clampInt(raw.sycmMinIntervalMs, 45000, 15000, 600000)
      : presets.minInterval;
    const minCooldown = riskProfile === 'custom'
      ? clampInt(raw.sycmMinBatchCooldownMs, 300000, 60000, 3600000)
      : presets.minCooldown;
    return {
      roots: normalizedRoots.roots,
      rootsText: normalizedRoots.roots.join('\n'),
      duplicateRoots: normalizedRoots.duplicates,
      sycmMode: String(raw.sycmMode || 'hot') === 'blue' ? 'blue' : 'hot',
      period: ['7d', '30d', 'day', 'week', 'month'].includes(String(raw.period || '')) ? String(raw.period) : '7d',
      compareType: String(raw.compareType || '') === 'yearSync' ? 'yearSync' : 'cycle',
      sycmRiskProfile: riskProfile,
      sycmMinIntervalMs: minInterval,
      sycmMaxIntervalMs: riskProfile === 'custom'
        ? clampInt(raw.sycmMaxIntervalMs, 90000, minInterval, 900000)
        : presets.maxInterval,
      sycmBatchSize: riskProfile === 'custom'
        ? clampInt(raw.sycmBatchSize, 10, 1, 100)
        : presets.batchSize,
      sycmMinBatchCooldownMs: minCooldown,
      sycmMaxBatchCooldownMs: riskProfile === 'custom'
        ? clampInt(raw.sycmMaxBatchCooldownMs, 600000, minCooldown, 7200000)
        : presets.maxCooldown,
      sycmMaxRetries: clampInt(raw.sycmMaxRetries, 2, 0, 5),
      sycmMaxPages: 9999,
      productsPerKeyword: clampInt(raw.productsPerKeyword, 12, 1, 50),
      length: clampInt(raw.length, 60, 30, 80),
      port: clampInt(raw.port, 9222, 1, 65535),
      reuseInspirationSycmData: true,
      sycmEvidenceMaxAgeHours: 24
    };
  }
  if (mode === 'manual') {
    const manualInput = sanitizeManualWorkflowItems(raw);
    return {
      defaultKeyword: manualInput.defaultKeyword,
      items: manualInput.items,
      verify: clampInt(raw.verify, Math.max(1, manualInput.items.length * 3), 1, 200),
      port: clampInt(raw.port, 9222, 1, 65535),
      pages: clampInt(raw.pages, 1, 1, 5),
      minBlueRows: clampInt(raw.minBlueRows, 1, 0, 50),
      fallbackHot: sanitizeBool(raw.fallbackHot, true),
      autoAllowReviewKeywords: sanitizeBool(raw.autoAllowReviewKeywords, true),
      export: clampInt(raw.export, 20, 1, 100),
      length: clampInt(raw.length, 60, 30, 80)
    };
  }
  if (mode === 'order-sheet') {
    const inputMode = ['rank', 'manual', 'hybrid'].includes(String(raw.inputMode || ''))
      ? String(raw.inputMode)
      : 'rank';
    const manualItems = parseManualItems(raw.manualItems, raw.manualItemsText);
    if (inputMode === 'manual' && manualItems.length === 0) {
      throw new Error('manual 模式下必须包含至少 1 条手工商品');
    }
    const effectiveInputMode = (inputMode === 'hybrid' && manualItems.length === 0) ? 'rank' : inputMode;

    const dateRange = effectiveInputMode === 'manual'
      ? { dateMode: 'latest_day', startDate: '', endDate: '' }
      : sanitizeOrderSheetDateRange(raw);
    const amountMode = ['average', 'payment', 'blank'].includes(String(raw.amountMode || ''))
      ? String(raw.amountMode)
      : 'average';
    const missingAmountPolicy = ['blank', 'mark', 'skip'].includes(String(raw.missingAmountPolicy || ''))
      ? String(raw.missingAmountPolicy)
      : 'blank';
    const reviewGroupSize = [1, 2, 4].includes(Number(raw.reviewGroupSize))
      ? Number(raw.reviewGroupSize)
      : 4;
    return {
      inputMode: effectiveInputMode,
      manualItemsText: String(raw.manualItemsText || '').trim(),
      manualItems,
      port: clampInt(raw.port, 9222, 1, 65535),
      ...dateRange,
      sheetType: 'order',
      orderDate: sanitizeOrderDate(raw.orderDate),
      storeName: String(raw.storeName || '').trim().slice(0, 50),
      pages: clampInt(raw.pages, 1, 1, 5),
      sortMetric: ['payAmt', 'sucRefundAmt', 'payItmCnt', 'itemCartCnt', 'itmUv'].includes(String(raw.sortMetric || ''))
        ? String(raw.sortMetric)
        : 'itmUv',
      productLimit: clampInt(raw.productLimit, 0, 0, 500),
      fileName: String(raw.fileName || '').trim().slice(0, 80),
      includeRawData: sanitizeBool(raw.includeRawData, true),
      includeImages: sanitizeBool(raw.includeImages, true),
      amountMode,
      missingAmountPolicy,
      cartQuantity: clampInt(raw.cartQuantity, 1, 1, 20),
      rowSpan: clampInt(raw.rowSpan, 3, 1, 5),
      dragCount: clampInt(raw.dragCount, DEFAULT_ORDER_GROUP_SIZE, 1, 20),
      workRequirement: String(raw.workRequirement || '').trim().slice(0, 200),
      orderNote: String(raw.orderNote || '').trim().slice(0, 100),
      reviewGroupSize,
      includeSpacerRow: sanitizeBool(raw.includeSpacerRow, true)
    };
  }
  if (mode === 'review-sheet') {
    const groups = Array.isArray(raw.groups) ? raw.groups.slice(0, 200).map(group => ({
      id: String(group?.id || '').slice(0, 80),
      orderDate: sanitizeOrderDate(group?.orderDate),
      storeName: String(group?.storeName || '').trim().slice(0, 50),
      buyerName: String(group?.buyerName || '').trim().slice(0, 80),
      buyerPhone: String(group?.buyerPhone || '').trim().slice(0, 30),
      orderNumber: String(group?.orderNumber || '').trim().slice(0, 80)
    })) : [];
    if (!String(raw.uploadId || '').trim()) throw new Error('请先上传刷单表');
    return {
      uploadId: String(raw.uploadId).trim(),
      uploadName: String(raw.uploadName || '').trim().slice(0, 120),
      groups,
      reviewTone: String(raw.reviewTone || '自然真实').trim().slice(0, 30),
      reviewLength: clampInt(raw.reviewLength, 35, 15, 100),
      useAI: sanitizeBool(raw.useAI, true),
      fileName: String(raw.fileName || '').trim().slice(0, 80),
      includeSpacerRow: sanitizeBool(raw.includeSpacerRow, true),
      sheetType: 'review'
    };
  }
  if (mode === 'competitor-analysis') {
    const competitorText = String(raw.competitorText || '').trim();
    const competitorInputs = Array.isArray(raw.competitorInputs)
      ? raw.competitorInputs.map(value => String(value || '').trim()).filter(Boolean).slice(0, 20)
      : [];
    if (!competitorText && competitorInputs.length === 0) throw new Error('请至少输入一条淘宝或天猫同行链接');
    return {
      competitorText,
      competitorInputs,
      maxShops: clampInt(raw.maxShops, 5, 1, 10),
      hotLimit: clampInt(raw.hotLimit, 20, 5, 50),
      newLimit: clampInt(raw.newLimit, 20, 5, 50),
      detailLimit: clampInt(raw.detailLimit, 20, 0, 50),
      waitMs: clampInt(raw.waitMs, 1200, 500, 10000),
      compareHistory: sanitizeBool(raw.compareHistory, true)
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
    pushFlag(args, '--discovery-mode', clean.discoveryMode);
    pushFlag(args, '--source', clean.source);
    pushFlag(args, '--root-mode', clean.rootMode);
    pushFlag(args, '--root-limit', clean.rootLimit);
    pushFlag(args, '--root-cooldown-days', clean.rootCooldownDays);
    pushFlag(args, '--family-cooldown-days', clean.familyCooldownDays);
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
    if (!clean.inspirationUseLLM) args.push('--no-inspiration-llm');
    args.push('--json');
    return args;
  }
  if (mode === 'keyword') {
    const keywordInput = Array.isArray(clean.keywords) ? clean.keywords.join('\n') : clean.keyword;
    const args = ['bin/cli.js', 'flow', 'keyword', keywordInput];
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
 * @param {{templateId?:string,mode?:string}|string} [options] 明确选择的模板或模式。
 * @returns {{ok:boolean, errors:Array<object>, production:boolean, templateId:string}}
 */
function validateProductionWorkflow(workflow, options = {}) {
  const graph = normalizeWorkflowGraph(workflow);
  if (!graph) {
    return {
      ok: false,
      errors: [{ code: 'invalid_workflow', message: '工作流定义无效' }],
      production: true,
      templateId: ''
    };
  }

  const templates = listProductionWorkflowTemplates();
  const requestedTemplateId = typeof options === 'string'
    ? options
    : String(options?.templateId || '').trim();
  const requestedMode = typeof options === 'object'
    ? String(options?.mode || '').trim()
    : '';
  const requestedTemplate = requestedTemplateId
    ? templates.find(item => item.id === requestedTemplateId)
    : requestedMode
      ? templates.find(item => item.mode === requestedMode)
      : null;

  if (requestedTemplateId && !requestedTemplate) {
    return {
      ok: false,
      errors: [{ code: 'unknown_production_template', message: `未知 workflow template: ${requestedTemplateId}` }],
      production: true,
      templateId: ''
    };
  }

  if (requestedTemplate) {
    if (workflowSignature(graph) === workflowSignature(requestedTemplate.workflow)) {
      return { ok: true, errors: [], production: true, templateId: requestedTemplate.id };
    }
    return {
      ok: false,
      errors: [{ code: 'production_template_mismatch', message: '工作流定义与所选模板不一致' }],
      production: true,
      templateId: requestedTemplate.id
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

function extractWorkflowKeywords(workflow) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  const keywordNode = nodes.find(node => {
    if (!node || !node.data) return false;
    const hasKeywords = node.data.keywordsText != null || node.data.keywords != null || node.data.keyword != null;
    if (!hasKeywords) return false;
    if (node.id === WORKFLOW_NODE_IDS.start || node.type === 'keyword-input' || node.type === 'production-start') return true;
    return normalizeExactKeywords(node.data.keywordsText ?? node.data.keywords ?? node.data.keyword).length > 0;
  });
  if (!keywordNode) return [];
  return normalizeExactKeywords(
    keywordNode.data.keywordsText ?? keywordNode.data.keywords ?? keywordNode.data.keyword
  );
}

function extractWorkflowRoots(workflow) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  const start = nodes.find(node => node?.id === WORKFLOW_NODE_IDS.start) || nodes[0];
  return normalizeRootKeywords(start?.data?.rootsText ?? start?.data?.roots ?? '').roots;
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
  for (const key of ['keyword', 'keywords', 'roots', 'rootsText', 'sycmMode', 'period', 'compareType', 'sycmRiskProfile', 'sycmMinIntervalMs', 'sycmMaxIntervalMs', 'sycmBatchSize', 'sycmMinBatchCooldownMs', 'sycmMaxBatchCooldownMs', 'sycmMaxRetries', 'mine', 'discoveryMode', 'source', 'rootMode', 'rootLimit', 'rootCooldownDays', 'familyCooldownDays', 'inspirationSycmPages', 'inspirationUseLLM', 'maxObservingSeeds', 'maxObservingPoolSize', 'maxNewSeeds', 'autoReplenishSeeds', 'recordSeedFeedback', 'verify', 'select', 'generate', 'export', 'productsPerKeyword', 'length', 'port', 'pages', 'minBlueRows', 'fallbackHot', 'autoApproveKeywords', 'autoExpandVerify', 'verifyReserve', 'autoAllowReviewKeywords', 'reviewKeywordLimit', 'workRequirement', 'dateMode', 'startDate', 'endDate', 'orderDate', 'storeName', 'sheetType', 'sortMetric', 'productLimit', 'fileName', 'includeRawData', 'includeImages', 'amountMode', 'missingAmountPolicy', 'cartQuantity', 'rowSpan', 'orderNote', 'reviewGroupSize', 'includeSpacerRow', 'uploadId', 'uploadName', 'groups', 'reviewTone', 'reviewLength', 'useAI', 'inputMode', 'manualItems', 'manualItemsText', 'competitorText', 'competitorInputs', 'maxShops', 'hotLimit', 'newLimit', 'detailLimit', 'waitMs', 'compareHistory']) {
    if (Object.prototype.hasOwnProperty.call(body, key)) params[key] = body[key];
  }

  if (!params.keyword && !params.keywords) {
    const keywords = extractWorkflowKeywords(workflow);
    if (keywords.length > 0) params.keyword = keywords[0];
    if (keywords.length > 1) params.keywords = keywords;
  }
  if (!params.roots && !params.rootsText) {
    const roots = extractWorkflowRoots(workflow);
    if (roots.length > 0) params.roots = roots;
  }

  let mode = body.mode || workflow?.mode || template?.mode || '';
  if (params.keywords && !hasExplicitMode && !hasExplicitTemplate) mode = params.items ? 'manual' : 'keyword';
  if (params.keyword && !hasExplicitMode && !hasExplicitTemplate) mode = 'keyword';
  if (!mode && params.keywords) mode = params.items ? 'manual' : 'keyword';
  if (!mode && params.keyword) mode = 'keyword';
  if (mode === 'daily' && params.keyword && !body.mode && !template) mode = 'keyword';
  if (!mode) {
    throw new Error('无法从工作流解析启动模式，请选择生产模板或提供关键词');
  }

  return { mode, params };
}

/**
 * Resolve and validate the exact workflow definition persisted for a launch.
 * @param {object} [body] Launch request body.
 * @param {{mode:string,params:object}} [launch] Resolved launch data.
 * @returns {object} Workflow definition snapshot.
 */
function resolveProductionWorkflowDefinition(body = {}, launch = resolveProductionWorkflowLaunch(body)) {
  const templates = listProductionWorkflowTemplates();
  const submitted = normalizeWorkflowGraph(body.workflow);
  let template = null;

  if (submitted) {
    const requestedTemplateId = body.templateId || body.template_id;
    const validation = validateProductionWorkflow(submitted, {
      templateId: requestedTemplateId,
      mode: requestedTemplateId ? '' : launch.mode
    });
    if (!validation.ok) throw new Error(validation.errors[0]?.message || '工作流定义无效');
    template = templates.find(item => item.id === validation.templateId) || null;
  } else {
    const requestedTemplateId = body.templateId || body.template_id;
    template = templates.find(item => item.id === requestedTemplateId)
      || templates.find(item => item.mode === launch.mode)
      || null;
  }

  if (!template) throw new Error('无法解析工作流定义');
  const graph = submitted || template.workflow;
  return {
    id: template.id,
    mode: launch.mode,
    nodes: graph.nodes,
    edges: graph.edges
  };
}

module.exports = { sanitizeWorkflowParams, buildPipelineCliArgs, validateProductionWorkflow, resolveProductionWorkflowLaunch, resolveProductionWorkflowDefinition };
