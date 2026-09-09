'use strict';

const fs = require('fs');
const path = require('path');
const { parseCompetitorInputs } = require('./src/input-parser');
const { analyzeCompetitorData, compareCompetitorSnapshots } = require('./src/analyzer');
const { collectSortedShopProducts, enrichCompetitorProduct, resolveCompetitorShop } = require('./src/collector');
const { writeCompetitorReport } = require('./src/report-writer');
const { TaobaoNativeClient } = require('./src/taobao-native-client');
const {
  DEFAULT_FLOW_DIR,
  appendJsonl,
  getRun,
  initRun,
  readJsonl,
  writeRun
} = require('../pipeline-flow/src/run-store');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(file, fallback) {
  if (!file || !fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_error) { return fallback; }
}

function replaceJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '', 'utf8');
  appendJsonl(file, rows);
}

function findPreviousCompetitorSnapshot(dataDir, runId, shopKeys) {
  const runsDir = path.join(dataDir, 'runs');
  if (!fs.existsSync(runsDir)) return null;
  const wantedShops = new Set(shopKeys || []);
  const candidates = [];
  for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === runId) continue;
    const runDir = path.join(runsDir, entry.name);
    const run = readJson(path.join(runDir, 'run.json'), null);
    if (!run || run.options?.mode !== 'competitor-analysis') continue;
    const shops = readJsonl(path.join(runDir, 'competitor-shops.jsonl'));
    if (!shops.some(shop => wantedShops.has(shop.shopKey))) continue;
    candidates.push({
      runId: entry.name,
      updatedAt: run.updatedAt || run.startedAt || '',
      hotProducts: readJsonl(path.join(runDir, 'competitor-hot-products.jsonl')).filter(item => wantedShops.has(item.shopKey)),
      newProducts: readJsonl(path.join(runDir, 'competitor-new-products.jsonl')).filter(item => wantedShops.has(item.shopKey))
    });
  }
  return candidates.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] || null;
}

function ensureCompetitorFiles(run, runDir) {
  run.files = run.files || {};
  run.files.competitorInput = run.files.competitorInput || path.join(runDir, 'competitor-input.json');
  run.files.competitorShops = run.files.competitorShops || path.join(runDir, 'competitor-shops.jsonl');
  run.files.competitorHotProducts = run.files.competitorHotProducts || path.join(runDir, 'competitor-hot-products.jsonl');
  run.files.competitorNewProducts = run.files.competitorNewProducts || path.join(runDir, 'competitor-new-products.jsonl');
  run.files.competitorProductDetails = run.files.competitorProductDetails || path.join(runDir, 'competitor-product-details.jsonl');
  run.files.competitorAnalysis = run.files.competitorAnalysis || path.join(runDir, 'competitor-analysis.json');
  run.files.competitorReport = run.files.competitorReport || path.join(runDir, '同行分析报告.xlsx');
  run.files.competitorCollectionState = run.files.competitorCollectionState || path.join(runDir, 'competitor-collection-state.json');
  return run.files;
}

function manualActionResult(context, errors, message) {
  context.run.status = 'manual_action_required';
  context.run.requiresUserAction = true;
  context.run.blockers = ['taobao_native_manual_action_required'];
  context.run.manualAction = {
    platform: 'taobao-native',
    status: errors[0]?.code || 'manual_action_required',
    userMessage: message,
    errors
  };
  writeRun(context.runDir, context.run);
  return {
    runId: context.runId,
    runDir: context.runDir,
    status: context.run.status,
    platform: 'taobao-native',
    manualAction: context.run.manualAction,
    errors
  };
}

function collectionFailureMessage(errors, collected) {
  const codes = new Set(errors.map(item => item.code));
  const prefix = `${errors.length} 个同行榜单采集失败${collected > 0 ? `，已保留 ${collected} 个成功样本` : ''}。`;
  if (codes.has('TAOBAO_NATIVE_ACCESS_RESTRICTED')) {
    return `${prefix}淘宝桌面版当前返回“内测期间仅开放部分用户”。请先完全退出并重新启动客户端；如果重启后仍持续出现，再检查客户端版本或账号开放状态。`;
  }
  if (codes.has('TAOBAO_NATIVE_NOT_READY') || codes.has('TAOBAO_NATIVE_TOOL_ERROR') || codes.has('TAOBAO_NATIVE_FAILED')) {
    return `${prefix}淘宝桌面版自动化执行层未就绪。请完全退出并重新打开淘宝桌面版，等待首页加载完成后再重试；若客户端仍提示“内测期间仅开放部分用户”，则当前账号暂时无法自动采集。`;
  }
  const accessCodes = new Set([
    'TAOBAO_LOGIN_REQUIRED',
    'TAOBAO_SECURITY_VERIFICATION_REQUIRED',
    'TAOBAO_NATIVE_TIMEOUT',
    'TAOBAO_NATIVE_UNAVAILABLE'
  ]);
  const needsPlatformAction = errors.some(item => accessCodes.has(item.code));
  return needsPlatformAction
    ? `${prefix}请在淘宝客户端完成登录或安全验证后重试当前节点。`
    : `${prefix}淘宝店铺的排序页面未完整加载，点击“重新采集失败榜单”即可续跑，不会重复采集成功项。`;
}

function isTaobaoPlatformBlocker(error) {
  return new Set([
    'TAOBAO_LOGIN_REQUIRED',
    'TAOBAO_SECURITY_VERIFICATION_REQUIRED',
    'TAOBAO_NATIVE_TIMEOUT',
    'TAOBAO_NATIVE_UNAVAILABLE',
    'TAOBAO_NATIVE_ACCESS_RESTRICTED',
    'TAOBAO_NATIVE_NOT_READY',
    'TAOBAO_NATIVE_TOOL_ERROR',
    'TAOBAO_NATIVE_FAILED'
  ]).has(error?.code);
}

function persistEnrichmentSummary(context, details) {
  const linkedCount = details.filter(item => item.itemId && item.productUrl).length;
  const failedDetails = details.filter(item => item.enrichmentStatus === 'failed');
  context.run.counts = {
    ...(context.run.counts || {}),
    competitorProductDetails: linkedCount,
    competitorProductLinkFailed: failedDetails.length
  };
  context.run.competitor = {
    ...(context.run.competitor || {}),
    enrichmentErrors: failedDetails.map(item => ({
      stage: item.sortType === 'new' ? '新品链接' : '爆款链接',
      target: `${item.shopName || '未知店铺'}：${item.title || '未知商品'}`,
      code: item.enrichmentCode || 'ENRICH_FAILED',
      message: item.enrichmentError || '商品链接补全失败'
    }))
  };
  return { linkedCount, failedDetails };
}

/** Resolve all pasted links to unique Taobao/Tmall shops. */
async function resolveCompetitorShops(options = {}) {
  const dataDir = options.dataDir || DEFAULT_FLOW_DIR;
  const context = initRun({ dataDir, runId: options.runId, options: { ...options, client: undefined, mode: 'competitor-analysis' } });
  const files = ensureCompetitorFiles(context.run, context.runDir);
  const parsed = parseCompetitorInputs(options.competitorText || options.competitorInputs || [], { limit: options.maxShops || 10 });
  if (parsed.links.length === 0) throw new Error('请至少输入一条有效的淘宝或天猫分享链接');
  writeJson(files.competitorInput, parsed);
  const client = options.client || new TaobaoNativeClient(options);
  const byShop = new Map();
  const errors = [];
  for (let index = 0; index < parsed.links.length; index += 1) {
    options.onProgress?.({ current: index, total: parsed.links.length, message: `正在识别第 ${index + 1}/${parsed.links.length} 条同行链接` });
    try {
      const shop = await resolveCompetitorShop(parsed.links[index], { ...options, client });
      if (!byShop.has(shop.shopKey)) byShop.set(shop.shopKey, shop);
    } catch (error) {
      errors.push({ stage: 'resolve', target: parsed.links[index].inputUrl, code: error.code || 'RESOLVE_FAILED', message: error.message });
    }
  }
  const shops = [...byShop.values()];
  replaceJsonl(files.competitorShops, shops);
  context.run.options = { ...context.run.options, ...options, client: undefined, mode: 'competitor-analysis' };
  context.run.counts = { ...(context.run.counts || {}), competitorInputs: parsed.links.length, competitorShops: shops.length, competitorResolveFailed: errors.length };
  context.run.competitor = { errors, duplicateShops: parsed.links.length - errors.length - shops.length };
  if (shops.length === 0) return manualActionResult(context, errors, '没有识别到可分析的同行店铺。请打开淘宝客户端、完成登录或验证后重试。');
  context.run.status = 'competitor_shops_resolved';
  context.run.requiresUserAction = false;
  context.run.blockers = [];
  context.run.manualAction = null;
  writeRun(context.runDir, context.run);
  options.onProgress?.({ current: parsed.links.length, total: parsed.links.length, message: `识别 ${shops.length} 家同行店铺` });
  return { runId: context.runId, runDir: context.runDir, status: context.run.status, shops, errors };
}

/** Collect hot and new sorted lists for every resolved shop. */
async function collectCompetitorProducts(options = {}) {
  const context = getRun({ dataDir: options.dataDir || DEFAULT_FLOW_DIR, runId: options.runId });
  const files = ensureCompetitorFiles(context.run, context.runDir);
  const shops = readJsonl(files.competitorShops);
  const state = readJson(files.competitorCollectionState, { completed: [], errors: [] });
  const completed = new Set(state.completed || []);
  let errors = Array.isArray(state.errors) ? state.errors : [];
  const hotRows = readJsonl(files.competitorHotProducts);
  const newRows = readJsonl(files.competitorNewProducts);
  const client = options.client || new TaobaoNativeClient(options);
  const tasks = shops.flatMap(shop => [['hot', shop], ['new', shop]]);
  let handled = completed.size;
  for (const [sortType, shop] of tasks) {
    const key = `${shop.shopKey}:${sortType}`;
    if (completed.has(key)) continue;
    if (options.shouldStop?.() === 'pause') {
      context.run.status = 'paused';
      writeRun(context.runDir, context.run);
      return { runId: context.runId, runDir: context.runDir, status: 'paused', stepIncomplete: true };
    }
    options.onProgress?.({ current: handled, total: tasks.length, message: `正在采集 ${shop.shopName} 的${sortType === 'hot' ? '销量榜' : '新品榜'}` });
    try {
      const result = await collectSortedShopProducts(shop, sortType, {
        ...options,
        client,
        limit: sortType === 'hot' ? options.hotLimit : options.newLimit
      });
      const target = sortType === 'hot' ? hotRows : newRows;
      target.push(...result.products);
      completed.add(key);
      errors = errors.filter(item => item.taskKey !== key);
    } catch (error) {
      errors = errors.filter(item => item.taskKey !== key);
      errors.push({ taskKey: key, stage: sortType, target: shop.shopName, code: error.code || 'COLLECT_FAILED', message: error.message });
    }
    handled += 1;
    replaceJsonl(files.competitorHotProducts, hotRows);
    replaceJsonl(files.competitorNewProducts, newRows);
    writeJson(files.competitorCollectionState, { completed: [...completed], errors });
  }
  context.run.counts = {
    ...(context.run.counts || {}),
    competitorHotProducts: hotRows.length,
    competitorNewProducts: newRows.length,
    competitorCollectFailed: errors.length
  };
  context.run.competitor = { ...(context.run.competitor || {}), errors };
  if (errors.length > 0) {
    const collected = hotRows.length + newRows.length;
    return manualActionResult(
      context,
      errors,
      collectionFailureMessage(errors, collected)
    );
  }
  context.run.status = 'competitor_products_collected';
  writeRun(context.runDir, context.run);
  options.onProgress?.({ current: tasks.length, total: tasks.length, message: `采集 ${hotRows.length} 个爆款样本、${newRows.length} 个新品样本` });
  return { runId: context.runId, runDir: context.runDir, status: context.run.status, hotCount: hotRows.length, newCount: newRows.length, errors };
}

/** Resolve stable item links for the top products of each list. */
async function enrichCompetitorProducts(options = {}) {
  const context = getRun({ dataDir: options.dataDir || DEFAULT_FLOW_DIR, runId: options.runId });
  const files = ensureCompetitorFiles(context.run, context.runDir);
  const shops = readJsonl(files.competitorShops);
  const hotRows = readJsonl(files.competitorHotProducts);
  const newRows = readJsonl(files.competitorNewProducts);
  let details = readJsonl(files.competitorProductDetails);
  const detailKeys = new Set(details.filter(item => item.itemId).map(item => `${item.shopKey}:${item.sortType}:${item.title}`));
  const parsedDetailLimit = Number.parseInt(options.detailLimit, 10);
  const detailLimit = Math.max(0, Math.min(50, Number.isFinite(parsedDetailLimit) ? parsedDetailLimit : 20));
  const candidates = shops.flatMap(shop => [
    ...hotRows.filter(item => item.shopKey === shop.shopKey).slice(0, detailLimit),
    ...newRows.filter(item => item.shopKey === shop.shopKey).slice(0, detailLimit)
  ]).filter((item, index, rows) => rows.findIndex(row => `${row.shopKey}:${row.sortType}:${row.title}` === `${item.shopKey}:${item.sortType}:${item.title}`) === index);
  const client = options.client || new TaobaoNativeClient(options);
  for (let index = 0; index < candidates.length; index += 1) {
    const product = candidates[index];
    const key = `${product.shopKey}:${product.sortType}:${product.title}`;
    if (detailKeys.has(key)) continue;
    if (options.shouldStop?.() === 'pause') {
      context.run.status = 'paused';
      writeRun(context.runDir, context.run);
      return { runId: context.runId, runDir: context.runDir, status: 'paused', stepIncomplete: true };
    }
    options.onProgress?.({ current: index, total: candidates.length, message: `正在补全商品链接 ${index + 1}/${candidates.length}` });
    const shop = shops.find(item => item.shopKey === product.shopKey);
    details = details.filter(item => `${item.shopKey}:${item.sortType}:${item.title}` !== key);
    try {
      details.push(await enrichCompetitorProduct(shop, product, { ...options, client }));
    } catch (error) {
      details.push({ ...product, enrichmentStatus: 'failed', enrichmentError: error.message, enrichmentCode: error.code || 'ENRICH_FAILED' });
      if (isTaobaoPlatformBlocker(error)) {
        replaceJsonl(files.competitorProductDetails, details);
        const { linkedCount } = persistEnrichmentSummary(context, details);
        const failedItem = {
          stage: product.sortType === 'new' ? '新品链接' : '爆款链接',
          target: `${product.shopName || '未知店铺'}：${product.title || '未知商品'}`,
          code: error.code || 'TAOBAO_NATIVE_FAILED',
          message: error.message
        };
        return manualActionResult(
          context,
          [failedItem],
          `商品链接补全已暂停，已保留 ${linkedCount} 条成功链接。${error.code === 'TAOBAO_NATIVE_ACCESS_RESTRICTED'
            ? '淘宝客户端返回“内测期间仅开放部分用户”，请完全退出并重新启动客户端后重试；若仍持续出现，再检查账号开放状态。'
            : '请恢复淘宝桌面版登录或自动化执行状态后重试当前节点；已成功的商品不会重复处理。'}`
        );
      }
    }
    detailKeys.add(key);
    replaceJsonl(files.competitorProductDetails, details);
  }
  const detailsByKey = new Map(details.map(item => [`${item.shopKey}:${item.sortType}:${item.title}`, item]));
  const mergeDetails = rows => rows.map(item => ({ ...item, ...(detailsByKey.get(`${item.shopKey}:${item.sortType}:${item.title}`) || {}) }));
  replaceJsonl(files.competitorHotProducts, mergeDetails(hotRows));
  replaceJsonl(files.competitorNewProducts, mergeDetails(newRows));
  const { linkedCount, failedDetails } = persistEnrichmentSummary(context, details);
  const failedCount = failedDetails.length;
  context.run.status = 'competitor_products_enriched';
  writeRun(context.runDir, context.run);
  return { runId: context.runId, runDir: context.runDir, status: context.run.status, count: linkedCount, failedCount };
}

/** Analyze persisted competitor product lists. */
async function analyzeCompetitors(options = {}) {
  const context = getRun({ dataDir: options.dataDir || DEFAULT_FLOW_DIR, runId: options.runId });
  const files = ensureCompetitorFiles(context.run, context.runDir);
  const shops = readJsonl(files.competitorShops);
  const hotProducts = readJsonl(files.competitorHotProducts);
  const newProducts = readJsonl(files.competitorNewProducts);
  const analysis = analyzeCompetitorData(shops, hotProducts, newProducts);
  if (options.compareHistory === false) {
    analysis.historyComparison = { status: 'disabled' };
  } else {
    const baseline = findPreviousCompetitorSnapshot(options.dataDir || DEFAULT_FLOW_DIR, context.runId, shops.map(shop => shop.shopKey));
    analysis.historyComparison = baseline
      ? compareCompetitorSnapshots(
          { hotProducts, newProducts },
          baseline,
          { baselineRunId: baseline.runId, baselineAt: baseline.updatedAt }
        )
      : { status: 'no_baseline', evidenceNotice: '这是该店铺的首次同行分析快照，下一次运行后可展示榜单样本变化。' };
  }
  writeJson(files.competitorAnalysis, analysis);
  context.run.counts = { ...(context.run.counts || {}), competitorOpportunityKeywords: analysis.opportunityKeywords.length };
  context.run.status = 'competitor_analyzed';
  writeRun(context.runDir, context.run);
  options.onProgress?.({ current: 1, total: 1, message: `生成 ${analysis.opportunityKeywords.length} 个待验真机会词` });
  return { runId: context.runId, runDir: context.runDir, status: context.run.status, analysis };
}

/** Build the final Excel report. */
async function buildCompetitorAnalysisReport(options = {}) {
  const context = getRun({ dataDir: options.dataDir || DEFAULT_FLOW_DIR, runId: options.runId });
  const files = ensureCompetitorFiles(context.run, context.runDir);
  const shops = readJsonl(files.competitorShops);
  const hotProducts = readJsonl(files.competitorHotProducts);
  const newProducts = readJsonl(files.competitorNewProducts);
  const analysis = readJson(files.competitorAnalysis, analyzeCompetitorData(shops, hotProducts, newProducts));
  await writeCompetitorReport({
    file: files.competitorReport,
    shops,
    hotProducts,
    newProducts: analysis.newProducts,
    analysis,
    errors: [
      ...(context.run.competitor?.errors || []),
      ...(context.run.competitor?.enrichmentErrors || [])
    ]
  });
  context.run.status = 'workflow_complete';
  context.run.requiresUserAction = false;
  context.run.blockers = [];
  context.run.counts = { ...(context.run.counts || {}), competitorReportRows: hotProducts.length + newProducts.length };
  writeRun(context.runDir, context.run);
  options.onProgress?.({ current: 1, total: 1, message: '同行分析报告已生成' });
  return { runId: context.runId, runDir: context.runDir, status: context.run.status, file: files.competitorReport, count: hotProducts.length + newProducts.length };
}

module.exports = {
  analyzeCompetitors,
  buildCompetitorAnalysisReport,
  collectCompetitorProducts,
  collectionFailureMessage,
  isTaobaoPlatformBlocker,
  enrichCompetitorProducts,
  ensureCompetitorFiles,
  findPreviousCompetitorSnapshot,
  resolveCompetitorShops
};
