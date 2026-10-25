'use strict';

/**
 * Read visible image-search cards inside the browser without private app state.
 * @returns {object[]} Raw card evidence, not verified SKU prices.
 */
function readImageSearchCards() {
  return Array.from(document.querySelectorAll('[data-tracker="offer"]')).map(card => ({
    renderKey: card.getAttribute('data-renderkey') || '',
    title: card.querySelector('[class*="titleText--"]')?.textContent?.trim() || '',
    displayPrice: card.querySelector('[class*="priceItem--"]')?.textContent?.trim() || '',
    imageUrl: card.querySelector('img[class*="mainImg--"]')?.src || '',
    imageReady: (() => {
      const image = card.querySelector('img[class*="mainImg--"]');
      if (!image) return false;
      const box = image.getBoundingClientRect();
      // 屏幕外的懒加载图片不应阻塞当前批次；可见图片必须已解码。
      return box.bottom <= 0 || box.top >= window.innerHeight || box.right <= 0 || box.left >= window.innerWidth
        || (image.complete && image.naturalWidth > 0);
    })(),
    shopText: card.querySelector('[class*="offerShopRow--"]')?.innerText || '',
    descriptions: Array.from(card.querySelectorAll('[class*="descText--"]')).map(el => el.textContent.trim()),
    promotionText: card.querySelector('[class*="offerPriceRow--"]')?.innerText || ''
  }));
}

/**
 * Normalize one observed card while preserving uncertainty about SKU and stock.
 * @param {object} raw Browser card evidence.
 * @param {object} options Server timestamp and evidence TTL.
 * @returns {object|null} Candidate, or null when identity/title is missing.
 */
function normalizeImageSearchCard(raw, { now = Date.now(), maxAgeMs = 86400000 } = {}) {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0 || !Number.isSafeInteger(now + maxAgeMs)) {
    throw new Error('无效的图搜证据时间');
  }
  const offerId = String(raw?.renderKey || '').match(/_(\d+)$/)?.[1];
  const title = typeof raw?.title === 'string' ? raw.title.trim() : '';
  if (!offerId || !title) return null;
  const displayPrice = String(raw.displayPrice || '').replace(/\s/g, '');
  const price = displayPrice.match(/^[¥￥](\d+(?:\.\d+)?)$/)?.[1] || null;
  const descriptions = Array.isArray(raw.descriptions) ? raw.descriptions : [];
  const minimumText = descriptions.find(value => typeof value === 'string' && /^\d+件起批$/.test(value));
  const minimum = minimumText ? Number(minimumText.match(/^\d+/)[0]) : null;
  return {
    offerId, title, url: `https://detail.1688.com/offer/${offerId}.html`,
    imageUrl: /^https:\/\//.test(raw.imageUrl || '') ? raw.imageUrl : '',
    shopText: String(raw.shopText || ''), displayPrice, displayPriceText: price,
    minimumOrderQuantity: Number.isSafeInteger(minimum) && minimum > 0 ? minimum : null,
    promotionalPrice: /新人|首单|补贴|券后/.test(raw.promotionText || ''),
    // 列表展示价和图搜排名都不是已验证的单件价格或相似度证据。
    priceText: null, currency: 'CNY', singlePiecePriceVerified: false,
    similarity: null, specStatus: 'unknown', available: null,
    observedAt: now, collectedAt: now, expiresAt: now + maxAgeMs,
    evidenceSource: '1688-web-image-search-card'
  };
}

module.exports = { readImageSearchCards, normalizeImageSearchCard };
