'use strict';

const { fingerprint } = require('./state-store');
const { parsePrice } = require('./price-comparison');
const { evidenceStatus } = require('./evidence');

/**
 * Read the observed 1688 detail layout without selecting quantities or ordering.
 * @returns {object} Raw product-level and per-specification visible evidence.
 */
function readSourceDetailEvidence() {
  const sku = document.querySelector('.module-od-sku-selection');
  const visible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  return {
    url: location.href,
    statusText: document.body?.innerText.slice(0,1800) || '',
    challengeVisible: Array.from(document.querySelectorAll('iframe[src*="captcha"],iframe[src*="punish"],#nc_1_wrapper')).some(el => visible(el) && el.getBoundingClientRect().height > 0),
    title: document.querySelector('.module-od-title h1')?.textContent?.trim() || '',
    minimumOrderTexts: Array.from(document.querySelectorAll('.module-od-main-price .price-component > p')).filter(visible).map(el => el.textContent.trim()),
    promotionText: document.querySelector('.module-od-promotion-banner')?.innerText || '',
    dimensions: Array.from(sku?.querySelectorAll('.feature-item-label h3') || []).filter(visible).map(el => el.textContent.trim()),
    attributes: Array.from(document.querySelectorAll('.module-od-product-attributes th')).map(el => ({ name: el.textContent.trim(), value: el.nextElementSibling?.textContent?.trim() || '' })),
    rows: Array.from(sku?.querySelectorAll('.expand-view-item') || []).filter(visible).map(row => ({
      specification: row.querySelector('.item-label')?.textContent?.trim() || '',
      priceTexts: Array.from(row.querySelectorAll('.item-price-stock')).map(el => el.textContent.trim()).filter(text => /^[¥￥]/.test(text)),
      stockText: row.querySelector('od-text[i18n="sku-stock"]')?.textContent?.trim() || '',
      imageUrl: row.querySelector('.item-image-icon img')?.src || ''
    }))
  };
}

/**
 * Normalize detail evidence without substituting a promotional/minimum card price.
 * @param {object} raw Observed product detail fields.
 * @param {object} options Expected offer identity, clock and evidence age.
 * @returns {object} Per-specification prices, conservative comparability and reasons.
 */
function normalizeSourceDetailEvidence(raw, { offerId, now = Date.now(), maxAgeMs = 86400000 } = {}) {
  if (!/^\d+$/.test(offerId || '')) throw new Error('货源商品ID无效');
  const url = new URL(raw.url);
  if (url.protocol !== 'https:' || url.hostname !== 'detail.1688.com' || url.pathname !== `/offer/${offerId}.html`) throw new Error('详情页面与目标货源不一致');
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0 || !Number.isSafeInteger(now + maxAgeMs)) throw new Error('详情证据时间无效');
  const dimensions = Array.isArray(raw.dimensions) ? raw.dimensions.filter(value => typeof value === 'string' && value.trim()) : [];
  const tiers = (raw.minimumOrderTexts || []).map(text => String(text).replace(/\s/g, '')).filter(text => text !== '首件预估到手价');
  const minimum = tiers.length === 1 ? tiers[0].match(/^(\d+)(PCS|件|个|条|只)起批(.*)$/i) : null;
  const minimumOrderQuantity = minimum && Number.isSafeInteger(Number(minimum[1])) ? Number(minimum[1]) : null;
  const unit = minimum?.[2]?.toUpperCase() || '';
  const rows = Array.isArray(raw.rows) ? raw.rows : [];
  const labels = rows.map(row => String(row.specification || '').trim());
  const skus = rows.map((row, index) => {
    const specification = labels[index];
    const issues = [];
    if (dimensions.length !== 1) issues.push('specification_dimensions_incomplete');
    if (!specification || labels.filter(label => label === specification).length !== 1) issues.push('specification_identity_ambiguous');
    if (minimumOrderQuantity !== 1) issues.push('single_piece_minimum_unverified');
    if (minimum?.[3]) issues.push('pricing_conditions_unverified');
    if (/\d+\s*(?:件|个|条|只|pcs)\s*(?:装|\/包|\/套)|套装|组合装|整箱|整包/i.test(specification)) issues.push('pack_unit_ambiguous');
    const prices = Array.isArray(row.priceTexts) ? row.priceTexts : [];
    const price = prices.length === 1 ? String(prices[0]).replace(/\s/g, '').match(/^[¥￥](\d+(?:\.\d{1,4})?)$/)?.[1] : null;
    let priceText = price || null;
    try { if (!priceText) throw new Error('missing'); parsePrice(priceText); } catch (_) { priceText = null; issues.push('sku_price_unverified'); }
    const stock = String(row.stockText || '').replace(/\s/g, '').match(/^库存(\d+)(PCS|件|个|条|只)$/i);
    const stockQuantity = stock && Number.isSafeInteger(Number(stock[1])) ? Number(stock[1]) : null;
    if (!stock || stock[2].toUpperCase() !== unit) issues.push('stock_unit_unverified');
    if (stockQuantity === null) issues.push('stock_unknown');
    return {
      specKey: fingerprint({ offerId, dimensions, specification }),
      specification, skuPriceText: priceText, rawPriceTexts: prices.map(String), stockText: String(row.stockText || ''),
      priceText: issues.length ? null : priceText,
      singlePiecePriceVerified: issues.length === 0,
      currency: 'CNY', unit, stockQuantity,
      available: stockQuantity === null ? null : stockQuantity > 0,
      imageUrl: typeof row.imageUrl === 'string' && row.imageUrl.startsWith('https://') ? row.imageUrl : '',
      issues
    };
  });
  return {
    offerId, url: `https://detail.1688.com/offer/${offerId}.html`, title: String(raw.title || ''),
    dimensions, minimumOrderTexts: tiers, minimumOrderQuantity, unit, skus,
    attributes: Array.isArray(raw.attributes) ? raw.attributes : [],
    promotionText: String(raw.promotionText || ''),
    observedAt: now, expiresAt: now + maxAgeMs,
    parserVersion: '1688-visible-sku-v1', evidenceSource: '1688-detail-visible-sku'
  };
}

/**
 * Attach one explicitly chosen specification; choosing never proves semantic sameness.
 * @param {object} candidate Image-search candidate.
 * @param {object} detail Current normalized detail evidence.
 * @param {object} options Selected specKey and shared evidence time policy.
 * @returns {object} Candidate with SKU evidence, retaining unknown specification match.
 */
function attachSourceSpecification(candidate, detail, options = {}) {
  if (candidate.offerId !== detail.offerId) throw new Error('货源详情商品ID不匹配');
  if (evidenceStatus(candidate, options) !== 'current' || evidenceStatus(detail, options) !== 'current') throw new Error('货源证据已过期，请刷新');
  const matches = detail.skus.filter(row => row.specKey === options.specKey);
  if (matches.length !== 1) throw new Error('请选择一个明确的商品规格');
  const sku = matches[0];
  return {
    ...candidate, ...sku,
    specStatus: 'unknown',
    detailRevision: fingerprint(detail),
    observedAt: Math.min(candidate.observedAt, detail.observedAt),
    expiresAt: Math.min(candidate.expiresAt, detail.expiresAt),
    minimumOrderQuantity: detail.minimumOrderQuantity
  };
}

module.exports = { readSourceDetailEvidence, normalizeSourceDetailEvidence, attachSourceSpecification };
