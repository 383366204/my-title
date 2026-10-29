'use strict';

/**
 * Accumulate ordered, unique products without promoting a stalled page to complete.
 * @param {number} limit Requested number of products.
 * @returns {object} add(snapshot) returns current evidence and stopping decision.
 */
function createShopBatchAccumulator(limit) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('采集数量必须为正整数');
  const products = new Map();
  let shopKey, sort;
  return {
    add(snapshot) {
      if (!snapshot?.shopKey || !Array.isArray(snapshot.products)) throw new Error('店铺快照无效');
      if (shopKey && (shopKey !== snapshot.shopKey || sort !== snapshot.sort)) throw new Error('滚动采集店铺或排序发生变化');
      shopKey = snapshot.shopKey;
      sort = snapshot.sort;
      const before = products.size;
      for (const product of snapshot.products) {
        if (!product.itemId) throw new Error('商品缺少身份');
        // 保留首次观察时间，后续滚动不能延长旧证据有效期。
        if (!products.has(product.itemId) && products.size < limit) products.set(product.itemId, product);
      }
      const rows = [...products.values()];
      return {
        ...snapshot, products: rows, totalCollected: rows.length,
        observedAt: Math.min(snapshot.observedAt, ...rows.map(p => p.observedAt)),
        expiresAt: Math.min(snapshot.expiresAt, ...rows.map(p => p.expiresAt)),
        completeness: 'uncertain', collectionCompleteness: 'uncertain',
        added: products.size - before, stopReason: products.size >= limit ? 'limit_reached' : null,
      };
    },
  };
}

module.exports = { createShopBatchAccumulator };
