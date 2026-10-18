'use strict';

/**
 * Read only product-card fields from the observed Taobao image-search DOM.
 * @param {void} unused No arguments; runs in the page context.
 * @returns {object[]} Raw visible-card evidence.
 */
function readTaobaoWebCards() {
  return Array.from(document.querySelectorAll('a[class*="doubleCardWrapper"]')).map(card => {
    const text = selector => card.querySelector(selector)?.textContent?.trim() || '';
    return {
      url: card.href,
      title: text('[class*="title--"]'),
      imageUrl: card.querySelector('img[class*="mainPic--"]')?.src || '',
      displayPriceText: text('[class*="priceInt--"]') + text('[class*="priceFloat--"]'),
      paymentText: text('[class*="realSales--"]'),
      shopName: text('[class*="shopNameText--"]'),
      shopUrl: card.querySelector('a[class*="shopName--"]')?.href || '',
    };
  });
}

/**
 * Normalize observed cards without treating promotional prices as SKU evidence.
 * @param {object[]} rows Raw DOM records.
 * @param {object} options Observation timestamp and evidence lifetime.
 * @returns {object[]} Unique products with conservative price provenance.
 */
function normalizeTaobaoWebCards(rows, { now = Date.now(), maxAgeMs = 86400000 } = {}) {
  if (!Array.isArray(rows) || !Number.isFinite(now) || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) throw new Error('淘宝卡片证据参数无效');
  const products = new Map();
  for (const row of rows) {
    if (!row || typeof row.title !== 'string' || !row.title.trim()) continue;
    let url;
    try { url = new URL(row.url); } catch { continue; }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) continue;
    if (!['item.taobao.com', 'detail.tmall.com'].includes(url.hostname) || url.pathname !== '/item.htm') continue;
    const itemId = url.searchParams.get('id');
    if (!/^\d+$/.test(itemId || '') || products.has(itemId)) continue;
    let shopUrl = null;
    try {
      const shop = new URL(row.shopUrl);
      if (['https:', 'http:'].includes(shop.protocol) && !shop.username && !shop.password && !shop.port &&
          (shop.hostname === 'store.taobao.com' || /^shop\d+\.taobao\.com$/.test(shop.hostname))) {
        shop.searchParams.delete('spm');
        shopUrl = shop.href;
      }
    } catch { /* 缺少店铺入口保留为空，不能凭店名推断店铺 ID。 */ }
    products.set(itemId, {
      itemId, title: row.title.trim(), url: `https://${url.hostname}/item.htm?id=${itemId}`,
      imageUrl: typeof row.imageUrl === 'string' && /^https:\/\//.test(row.imageUrl) ? row.imageUrl : null,
      shopName: typeof row.shopName === 'string' ? row.shopName.trim() : '', shopUrl,
      displayPriceText: typeof row.displayPriceText === 'string' ? row.displayPriceText : '',
      paymentText: typeof row.paymentText === 'string' ? row.paymentText : '',
      priceText: null, singlePiecePriceVerified: false,
      channel: 'web', evidenceScope: 'image_search_card', observedAt: now, expiresAt: now + maxAgeMs,
    });
  }
  return [...products.values()];
}

module.exports = { readTaobaoWebCards, normalizeTaobaoWebCards };
