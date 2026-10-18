'use strict';

const { normalizeTaobaoWebCards } = require('./taobao-web-cards');

/**
 * Read the observed web shop layout without account or private navigation data.
 * @param {void} unused Runs inside the shop page.
 * @returns {object} Current sorting and loaded product records.
 */
function readTaobaoWebShop() {
  return {
    url: location.href,
    sortLabel: document.querySelector('[class*="leftTags--"] [class*="activeTag--"]')?.textContent?.trim() || '',
    products: Array.from(document.querySelectorAll('a.shop-item-card')).map(card => {
      const text = selector => card.querySelector(selector)?.textContent?.trim() || '';
      return {
        url: card.href, title: text('[class*="title--"]'),
        imageUrl: card.querySelector('img[class*="img--"]')?.src || '',
        displayPriceText: text('[class*="priceBlock--"] [class*="int--"]') + text('[class*="priceBlock--"] [class*="float--"]'),
        priceLabel: text('[class*="priceBlock--"] [class*="desc--"]'),
        paymentText: text('[class*="sales--"]'),
      };
    }),
  };
}

/**
 * Validate shop sorting and preserve incomplete collection provenance.
 * @param {object} raw Observed shop page snapshot.
 * @param {object} options Stable shop identity, requested sort and timestamps.
 * @returns {object} Raw collection snapshot, never a full-shop verdict.
 */
function normalizeTaobaoWebShop(raw, { shopKey, sort = 'hot', now = Date.now(), maxAgeMs = 86400000 } = {}) {
  if (typeof shopKey !== 'string' || !shopKey.trim()) throw new Error('缺少稳定店铺标识');
  if (!['hot', 'new'].includes(sort)) throw new Error('店铺排序方式无效');
  if (raw?.sortLabel !== (sort === 'hot' ? '销量' : '新品')) {
    throw Object.assign(new Error('店铺排序尚未确认，请重试当前节点'), { code: 'SHOP_SORT_UNVERIFIED' });
  }
  if (!Array.isArray(raw.products) || !raw.products.length) {
    throw Object.assign(new Error('未读取到店铺商品，不能判定为空店'), { code: 'SHOP_PRODUCTS_UNVERIFIED' });
  }
  const products = normalizeTaobaoWebCards(raw.products, { now, maxAgeMs });
  if (!products.length) throw new Error('店铺商品缺少有效身份信息');
  const rawById = new Map();
  for (const row of raw.products) {
    try {
      const id = new URL(row.url).searchParams.get('id');
      if (!rawById.has(id)) rawById.set(id, row);
    } catch { /* 无效链接已由卡片规范化器排除。 */ }
  }
  return {
    shopKey, channel: 'web', sort, observedAt: now, expiresAt: now + maxAgeMs,
    completeness: 'uncertain', totalCollected: products.length,
    products: products.map(product => ({ ...product, shopKey, evidenceScope: 'shop_loaded_cards',
      priceLabel: typeof rawById.get(product.itemId)?.priceLabel === 'string' ? rawById.get(product.itemId).priceLabel : '',
    })),
  };
}

module.exports = { readTaobaoWebShop, normalizeTaobaoWebShop };
