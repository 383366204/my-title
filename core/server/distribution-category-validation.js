'use strict';
const { readCategoryState, applyCategoryState } = require('../../skills/pipeline-flow/src/category-state');
const { resolveFinalCategory } = require('../../skills/pipeline-flow/src/category-policy');
const { validateGeneratedRow } = require('../../skills/pipeline-flow/src/export-validator');

function reasonLabel(reason) {
  const labels = { missing_title: '请填写铺货标题', missing_url: '缺少1688货源链接', invalid_1688_url: '1688货源链接无效', missing_category: '请获取或确认生意参谋类目', duplicate_url: '货源链接重复，请移除重复商品', duplicate_title: '标题重复，请修改标题' };
  if (reason.startsWith('title_too_short:')) return `标题字数不足（${reason.split(':')[1]}），请编辑铺货标题`;
  if (reason.startsWith('banned_words:')) return `标题包含违禁词：${reason.slice(13)}，请修改标题`;
  if (reason.startsWith('legacy_keyword_opportunity_')) return '历史关键词尚未通过确认，请返回关键词确认节点处理';
  return labels[reason] || '商品未通过校验，请检查商品信息';
}

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
  const itemErrors = [];
  for (const item of items) {
    const stored = context.generated.find(row => row.url === item.url);
    const row = stored && applyCategoryState(stored, context.state);
    const category = row && resolveFinalCategory(row).category;
    const identity = { url: item.url, title: item.title || stored?.title || '未填写标题的商品', offerId: item.offerId, imageUrl: stored?.imageUrl || '' };
    if (!row || !category || category !== item.category) {
      itemErrors.push({ ...identity, reasons: [!row ? '商品不属于当前清单，请刷新后重新选择' : '生意参谋类目缺失或已变更，请重新确认类目'] });
      continue;
    }
    const validation = validateGeneratedRow({ ...row, title: item.title }, {
      manualMode: true, seenUrls, seenTitles, minTitleLength: context.run.exportPolicy?.minTitleLength
    });
    if (!validation.ok) itemErrors.push({ ...identity, reasons: validation.reasons.map(reasonLabel) });
    seenUrls.add(item.url); seenTitles.add(item.title);
  }
  if (itemErrors.length) throw Object.assign(new Error(`${itemErrors.length} 件商品需要修改：${itemErrors.map(item => `「${item.title}」：${item.reasons.join('；')}`).join('；')}`), { code: 'INVALID_ITEM', itemErrors });
}

module.exports = { validateDistributionCategories };
