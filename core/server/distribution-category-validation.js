'use strict';
const { readCategoryState, applyCategoryState } = require('../../skills/pipeline-flow/src/category-state');
const { resolveFinalCategory } = require('../../skills/pipeline-flow/src/category-policy');
const { validateGeneratedRow } = require('../../skills/pipeline-flow/src/export-validator');

/** @param {string} runId 工作流。 @param {object[]} items 提交快照。 @param {object} options 存储定位。 @returns {void} 校验来自工作流的实际铺货清单。 */
function validateDistributionCategories(runId, items, options = {}) {
  if (!runId) throw Object.assign(new Error('自动铺货缺少工作流运行 ID'), { code: 'INVALID_ITEM' });
  let context;
  try { context = readCategoryState({ ...options, runId }); }
  catch (error) { throw Object.assign(error, { code: 'INVALID_ITEM' }); }
  if (context.state.job?.status === 'running' || context.state.job?.inFlight) {
    throw Object.assign(new Error('正在获取类目，请等待当前查询结束后确认铺货'), { code: 'INVALID_ITEM' });
  }
  const seenUrls = new Set();
  const seenTitles = new Set();
  for (const item of items) {
    const stored = context.generated.find(row => row.url === item.url);
    const row = stored && applyCategoryState(stored, context.state);
    const category = row && resolveFinalCategory(row).category;
    if (!row || !category || category !== item.category) {
      throw Object.assign(new Error(`商品 ${item.offerId || item.url} 的生意参谋类目缺失或已变更，请刷新并确认清单`), { code: 'INVALID_ITEM' });
    }
    const validation = validateGeneratedRow({ ...row, title: item.title }, {
      manualMode: true, seenUrls, seenTitles, minTitleLength: context.run.exportPolicy?.minTitleLength
    });
    if (!validation.ok) throw Object.assign(new Error(`商品 ${item.offerId || item.url} 未通过铺货校验：${validation.reasons.join('、')}`), { code: 'INVALID_ITEM' });
    seenUrls.add(item.url); seenTitles.add(item.title);
  }
}

module.exports = { validateDistributionCategories };
