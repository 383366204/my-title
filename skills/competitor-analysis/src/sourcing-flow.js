'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { assertRuntimeRunId } = require('../../pipeline-flow/runtime/store');
const { getRun, writeRun, readJsonl } = require('../../pipeline-flow/src/run-store');
const { verifyImageSources } = require('../../peer-discovery/src/image-sourcing-matcher');
const { createImageSearchProvider } = require('../../peer-discovery/src/image-search-provider');
const { normalizePriceRatio } = require('../../peer-discovery/src/price-comparison');

function stateFile(options) {
  assertRuntimeRunId(options.runId);
  return path.join(options.dataDir || path.join(process.cwd(), 'data/pipeline'), 'runs', options.runId, 'competitor-sourcing.json');
}
function writeState(options, state) {
  const file = stateFile(options), temp = `${file}.${randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temp, JSON.stringify(state, null, 2));
  fs.renameSync(temp, file);
  return state;
}
/** @param {object} options 运行目录。 @returns {object} 当前选货状态。 */
function getCompetitorSourcingState(options) {
  const file = stateFile(options);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {
    stages: [], products: [], selectedItemIds: [], selectionConfirmed: false,
    skip: false, results: [], decisions: [], reviewConfirmed: false, imagePriceRatioThreshold: '1'
  };
}
function result(options, status, message) {
  const context = getRun(options);
  context.run.status = status;
  context.run.requiresUserAction = ['needs_review', 'manual_action_required'].includes(status);
  context.run.blockers = status === 'manual_action_required' ? ['competitor_source_blocked'] : [];
  context.run.manualAction = status === 'manual_action_required' ? { platform: '1688', userMessage: message } : null;
  writeRun(context.runDir, context.run);
  options.onProgress?.({ message });
  return { runId: options.runId, status, stepIncomplete: status !== 'completed' && status !== 'workflow_complete',
    ...(status === 'manual_action_required' ? { platform: '1688', manualAction: context.run.manualAction, actionHint: message } : {}) };
}
function productsFromRun(options) {
  const { run } = getRun(options);
  const details = readJsonl(run.files?.competitorProductDetails || '').filter(p => p.itemId && p.productUrl);
  const products = new Map();
  for (const item of [...readJsonl(run.files?.competitorHotProducts || ''), ...readJsonl(run.files?.competitorNewProducts || '')]) {
    const detail = details.find(d => d.shopKey === item.shopKey && d.sortType === item.sortType && d.title === item.title);
    const p = { ...item, ...detail };
    const id = p.itemId || `unresolved:${p.shopKey}:${p.title}`;
    const old = products.get(id);
    products.set(id, { ...p, itemId: id, productUrl: p.productUrl || p.url || '',
      imageUrl: p.imageUrl || p.mainImageUrl || '', lists: [...new Set([...(old?.lists || []), p.sortType])] });
  }
  return [...products.values()];
}
/** @param {object} options 运行及可注入阶段函数。 @returns {Promise<object>} 合并节点结果。 */
async function runCompetitorCollectionBundle(options) {
  const state = getCompetitorSourcingState(options);
  const api = options.stageFns || require('../index');
  const stages = [['collect', 'collectCompetitorProducts'], ['enrich', 'enrichCompetitorProducts'], ['analyze', 'analyzeCompetitors'], ['report', 'buildCompetitorAnalysisReport']];
  for (const [stage, name] of stages) {
    if (state.stages.includes(stage)) continue;
    if (options.shouldStop?.()) return result(options, 'paused', '已暂停，保留已完成阶段');
    options.onProgress?.({ message: `当前阶段：${({ collect: '采集爆款与新品', enrich: '补全商品链接', analyze: '同行对比分析', report: '生成报告' })[stage]}` });
    const output = await api[name](options);
    if (output.stepIncomplete || ['manual_action_required', 'blocked', 'paused', 'failed', 'cancelled'].includes(output.status)) return output;
    state.stages.push(stage);
    writeState(options, state);
  }
  state.products = productsFromRun(options);
  writeState(options, state);
  return result(options, state.selectionConfirmed ? 'completed' : 'needs_review', state.selectionConfirmed ? '商品选择已确认' : '报告已生成，请选择商品寻找货源或仅完成分析');
}
/** @param {object} options 已采集商品的选择。 @returns {object} 持久化选择。 */
function saveCompetitorSelection(options) {
  const state = getCompetitorSourcingState(options);
  if (!state.stages.includes('report')) throw new Error('采集与报告尚未完成');
  if (state.selectionConfirmed) throw new Error('选择已确认，修改商品请新建运行');
  const ids = options.selectedItemIds;
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length) throw new Error('商品选择格式错误');
  if (options.skip !== true && ids.length === 0) throw new Error('请至少选择一个商品');
  const allowed = new Set(state.products.filter(p => /^\d+$/.test(p.itemId) && p.imageUrl && p.productUrl).map(p => p.itemId));
  if (ids.some(id => !allowed.has(id))) throw new Error('所选商品不在当前结果中，或缺少链接、主图');
  state.imagePriceRatioThreshold = normalizePriceRatio(options.imagePriceRatioThreshold || '1');
  state.skip = options.skip === true;
  state.selectedItemIds = state.skip ? [] : ids;
  state.selectionConfirmed = true;
  return writeState(options, state);
}
/** @param {object} options 图搜器和运行控制。 @returns {Promise<object>} 逐商品图搜结果。 */
async function runCompetitorFindSources(options) {
  const state = getCompetitorSourcingState(options);
  if (!state.selectionConfirmed) return result(options, 'needs_review', '请先确认待寻源商品');
  if (state.skip || state.reviewConfirmed) return result(options, 'workflow_complete', state.skip ? '已选择仅完成分析' : '货源复核已完成');
  const provider = options.provider || createImageSearchProvider({ port: options.port || 9222, onProgress: options.onProgress });
  for (const itemId of state.selectedItemIds) {
    if (state.results.some(r => r.itemId === itemId && !r.error && (r.complete || r.batchReady))) continue;
    if (options.shouldStop?.()) return result(options, 'paused', '寻源已暂停，保留成功结果');
    const source = state.products.find(p => p.itemId === itemId);
    const controller = new AbortController();
    const timer = setInterval(() => { if (options.shouldStop?.()) controller.abort(); }, 250);
    try {
      options.onProgress?.({ current: state.results.filter(r => !r.error).length, total: state.selectedItemIds.length, message: `1688 搜图：${source.title}` });
      const response = await verifyImageSources(source, { provider, signal: controller.signal, imagePriceRatioThreshold: state.imagePriceRatioThreshold });
      state.results = state.results.filter(r => r.itemId !== itemId);
      state.results.push({ itemId, ...response });
      writeState(options, state);
      if (!response.complete && !response.batchReady) return result(options, 'manual_action_required', '1688 图搜结果未完整加载，请检查页面后重试；不能认定为无货源');
    } catch (error) {
      if (controller.signal.aborted) return result(options, 'paused', '寻源已暂停，保留成功结果');
      state.results = state.results.filter(r => r.itemId !== itemId);
      state.results.push({ itemId, error: error.message, code: error.code });
      writeState(options, state);
      return result(options, 'manual_action_required', error.message);
    } finally { clearInterval(timer); }
  }
  return result(options, 'needs_review', '图搜完成，请逐项确认货源或跳过');
}
/** @param {object} options 每个选中商品的货源决定。 @returns {object} 复核状态。 */
function saveCompetitorSourceDecisions(options) {
  const state = getCompetitorSourcingState(options);
  if (!state.selectionConfirmed || state.skip || state.reviewConfirmed) throw new Error('当前阶段不能确认货源');
  if (!Array.isArray(options.decisions) || options.decisions.length !== state.selectedItemIds.length) throw new Error('请为每件商品选择货源或跳过');
  const seen = new Set();
  for (const d of options.decisions) {
    if (!state.selectedItemIds.includes(d.itemId) || seen.has(d.itemId)) throw new Error('商品决定重复或不属于当前选择');
    seen.add(d.itemId);
    if (d.action === 'skip') continue;
    if (d.action !== 'select') throw new Error('无效的复核操作');
    const candidate = state.results.find(r => r.itemId === d.itemId)?.results?.find(c => c.offerId === d.offerId);
    if (!candidate || !/^\d+$/.test(candidate.offerId) || candidate.verdict.level === 'rejected') throw new Error('货源不存在或不符合条件');
    if (candidate.verdict.level !== 'confirmed' && d.riskAccepted !== true) throw new Error('请先人工核对规格、价格和起订量并确认风险');
  }
  state.decisions = options.decisions.map(d => ({ itemId: d.itemId, action: d.action, ...(d.action === 'select' ? { offerId: d.offerId, riskAccepted: d.riskAccepted === true } : {}) }));
  state.reviewConfirmed = true;
  return writeState(options, state);
}
module.exports = { getCompetitorSourcingState, runCompetitorCollectionBundle, saveCompetitorSelection, runCompetitorFindSources, saveCompetitorSourceDecisions };
