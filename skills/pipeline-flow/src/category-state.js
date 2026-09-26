'use strict';

const fs = require('fs');
const path = require('path');
const { getRun, readJsonl } = require('./run-store');
const { buildCategoryEvidence, resolveFinalCategory } = require('./category-policy');

/** @param {object} options 运行定位。 @returns {object} 类目草稿与商品源数据。 */
function readCategoryState(options) {
  const { run, runDir } = getRun(options);
  const file = path.join(runDir, 'category-state.json');
  const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 0, rows: {}, job: null };
  const generated = readJsonl(run.files.generatedProducts).filter(row => row.status === 'generated');
  return { run, file, state, generated };
}

/** @param {object} context 类目上下文。 @returns {void} 原子写入草稿。 */
function saveCategoryState(context) {
  context.state.version++;
  const temporary = `${context.file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(context.state, null, 2));
  fs.renameSync(temporary, context.file);
}

/** @param {object} row 商品。 @param {object} state 类目草稿。 @returns {object} 不覆盖源商品的最终类目视图。 */
function applyCategoryState(row, state) {
  const saved = state.rows?.[row.url];
  const keyword = String(row.selectedKeyword || row.keyword || '').trim();
  if (!saved || saved.keyword !== keyword) return row;
  return { ...row, sycmCategoryEvidence: saved.evidence || row.sycmCategoryEvidence,
    categorySelection: Object.hasOwn(saved, 'selection') ? saved.selection : row.categorySelection };
}

/** @param {object} context 类目上下文。 @returns {object} 页面与导出共用的状态快照。 */
function categorySnapshot(context) {
  const { state, generated } = context;
  return { version: state.version, port: Number(context.run.options?.port || 9222), job: state.job, rows: generated.map(row => {
    const saved = state.rows[row.url];
    return { url: row.url, keyword: row.selectedKeyword || row.keyword || '',
      ...resolveFinalCategory(applyCategoryState(row, state)), error: saved?.error || '' };
  }) };
}

/** @param {object} context 运行上下文。 @param {object} input 人工选择。 @returns {void} 只允许选择有参谋证据的候选。 */
function chooseCategory(context, input) {
  const row = context.generated.find(item => item.url === input.url);
  if (!row) throw new Error('商品不在当前运行中');
  const current = applyCategoryState(row, context.state);
  const evidence = current.sycmCategoryEvidence;
  if (evidence?.source !== 'sycm' || !evidence.candidates?.some(item => item.category === input.category)) throw new Error('请选择生意参谋返回的候选类目');
  const keyword = row.selectedKeyword || row.keyword || '';
  context.state.rows[row.url] = { ...context.state.rows[row.url], keyword, evidence,
    selection: { category: input.category, keyword, queryWord: evidence.queryWord, confirmedAt: new Date().toISOString() }, error: '' };
  saveCategoryState(context);
}

/** @param {object} options 运行及依赖。 @returns {Promise<void>} 串行、逐词持久化且可中断的补类目任务。 */
async function queryCategories(options) {
  const extractor = options.extractor || require('../../sycm-research/src/sycm-cdp-extractor').extractSycmData;
  let context = readCategoryState(options);
  const requests = context.state.job.requests;
  for (let index = context.state.job.completed || 0; index < requests.length; index++) {
    context = readCategoryState(options);
    if (context.state.job.status !== 'running') return;
    if (options.shouldStop?.()) {
      context.state.job.status = 'paused';
      saveCategoryState(context);
      return;
    }
    const request = requests[index];
    const keywords = new Map(context.generated.map(row => [row.url, row.selectedKeyword || row.keyword || '']));
    context.state.job.currentWord = request.queryWord;
    context.state.job.inFlight = true;
    saveCategoryState(context);
    options.onProgress?.({ current: index, total: requests.length, message: `获取铺货类目：${request.queryWord}` });
    const shouldStop = () => options.shouldStop?.() || (readCategoryState(options).state.job.status === 'running' ? null : 'pause');
    try {
      const result = await extractor(request.queryWord, { mode: 'hot', maxPages: 1,
        port: Number(context.run.options?.port || 9222), guardCache: false,
        guardMinCooldownMs: 45000, guardMaxCooldownMs: 90000, shouldStop });
      if (!result || result.ok === false) throw new Error(result?.error || '生意参谋未返回有效结果');
      context = readCategoryState(options);
      const evidence = buildCategoryEvidence(result, request.queryWord);
      for (const url of request.urls) {
        const row = context.generated.find(item => item.url === url);
        if (!row || keywords.get(url) !== (row.selectedKeyword || row.keyword || '')) continue;
        const previous = context.state.rows[url];
        context.state.rows[url] = { keyword: row.selectedKeyword || row.keyword || '', evidence,
          selection: previous?.selection,
          error: evidence.candidates.length ? '' : '生意参谋没有返回类目，请调整查询词后重试' };
      }
      context.state.job.completed = index + 1;
      if (options.shouldStop?.()) context.state.job.status = 'paused';
      context.state.job.inFlight = false;
      saveCategoryState(context);
      options.onProgress?.({ current: index + 1, total: requests.length, message: `已查询铺货类目：${request.queryWord}` });
    } catch (error) {
      context = readCategoryState(options);
      context.state.job.status = 'paused';
      context.state.job.error = error.message;
      context.state.job.inFlight = false;
      saveCategoryState(context);
      return;
    }
  }
  context = readCategoryState(options);
  context.state.job.status = 'completed';
  context.state.job.currentWord = '';
  saveCategoryState(context);
}

/** @param {object} options 运行与可注入查询器。 @returns {Promise<void>} 标题完成后仅补类目，不重新评分或筛词。 */
async function prepareDistributionCategories(options) {
  const context = readCategoryState(options);
  const groups = new Map();
  for (const item of context.generated) {
    const row = applyCategoryState(item, context.state);
    const final = resolveFinalCategory(row);
    const keyword = String(row.selectedKeyword || row.keyword || '').trim();
    if (final.category || !keyword || (final.queryWord === keyword && final.candidates.length)) continue;
    if (!groups.has(keyword)) groups.set(keyword, []);
    groups.get(keyword).push(row.url);
  }
  if (!groups.size) return;
  context.state.job = { status: 'running', completed: 0, error: '', requests: [...groups].map(([queryWord, urls]) => ({ queryWord, urls })) };
  saveCategoryState(context);
  await queryCategories(options);
}

module.exports = { readCategoryState, saveCategoryState, applyCategoryState, categorySnapshot, chooseCategory, queryCategories, prepareDistributionCategories };
