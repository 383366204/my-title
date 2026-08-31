/**
 * 编组草稿的最小回传负载。
 * 面板只需要回传身份字段和可编辑字段；skuOptions、主图、排行指标等静态数据体积很大
 * （一个多规格商品约 4KB，12 个商品就能超过 Express 默认的 100KB body 上限触发 413），
 * 由服务端用已存盘的商品资料补齐。
 */
const DRAFT_PRODUCT_FIELDS = [
  'itemId',
  'sourceKey',
  'productUrl',
  'role',
  'title',
  'orderAmount',
  'storeName',
  'orderDate',
  'workRequirement',
  'orderNote',
  'selectedSkuId',
  'selectedSkuName',
  'selectedSkuPrice',
  'selectedSkuImageUrl',
  'lowestSkuId',
  'lowestSkuName',
  'lowestSkuPrice',
  'skuSelectionMode'
];

/**
 * Strip a product down to the fields worth sending back to the server.
 * @param {object} product full product object held by the panel
 * @returns {object} minimal draft patch
 */
export function trimDraftProduct(product = {}) {
  const trimmed = {};
  for (const field of DRAFT_PRODUCT_FIELDS) {
    if (product[field] !== undefined) trimmed[field] = product[field];
  }
  return trimmed;
}

/**
 * Trim every product inside the task groups, keeping group-level fields intact.
 * @param {Array<object>} groups task groups
 * @returns {Array<object>} trimmed groups
 */
export function trimDraftGroups(groups = []) {
  return groups.map(group => ({
    ...group,
    mainProduct: trimDraftProduct(group.mainProduct),
    subProducts: (group.subProducts || []).map(trimDraftProduct)
  }));
}

/**
 * Build the order-sheet draft payload sent by save and confirm.
 * @param {object} input current panel state
 * @returns {object} minimal payload
 */
export function toDraftPayload({ revision, dragCount, groups = [], unassignedItems = [] } = {}) {
  return {
    revision,
    dragCount,
    groups: trimDraftGroups(groups),
    unassignedItems: unassignedItems.map(trimDraftProduct)
  };
}
