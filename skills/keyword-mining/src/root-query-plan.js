'use strict';

const { normalizeResearchRoot } = require('./root-research-store');

/**
 * 只组合原词中已有的属性与商品名词，不做任意字符截断。
 * @param {object} root 商品化结果。
 * @returns {object[]} 原词及有语义依据的查询变体。
 */
function rootQueryVariants(root) {
  const original = String(root.rootKeyword || '').trim();
  const rows = [{ keyword: original, dimension: 'original' }];
  const core = String(root.queryCore || '').trim();
  if (core.length >= 2 && original.includes(core)) {
    for (const dimension of ['material', 'scene', 'function', 'audience']) {
      const values = root.queryAttributes?.[dimension];
      for (const value of Array.isArray(values) ? values : []) {
        const attribute = typeof value === 'string' ? value.trim() : '';
        if (!attribute || attribute === core || !original.includes(attribute)) continue;
        const keyword = `${attribute}${core}`;
        if (keyword.length <= original.length) rows.push({ keyword, dimension });
      }
    }
  }
  const unique = new Map();
  for (const row of rows) {
    const key = normalizeResearchRoot(row.keyword);
    if (key && !unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()];
}

/**
 * 不同灵感共享实际查询任务，但保留所有来源。
 * @param {object[]} roots 入选商品词。
 * @returns {object[]} 串行热词、蓝海词任务。
 */
function buildRootQueryPlan(roots) {
  const tasks = new Map();
  for (const root of roots) {
    for (const variant of rootQueryVariants(root)) {
      for (const mode of ['hot', 'blue']) {
        const key = JSON.stringify([normalizeResearchRoot(variant.keyword), mode]);
        const source = { originalKeyword: root.rootKeyword, inspirationId: root.inspirationId || '', dimension: variant.dimension };
        if (tasks.has(key)) tasks.get(key).querySources.push(source);
        else tasks.set(key, { ...root, root: variant.keyword, originalKeyword: root.rootKeyword,
          queryMode: mode, querySources: [source], queryPlanVersion: 1 });
      }
    }
  }
  return [...tasks.values()];
}

module.exports = { rootQueryVariants, buildRootQueryPlan };
