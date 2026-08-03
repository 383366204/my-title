'use strict';

const { Alibaba1688Client } = require('../../alibaba1688');

/**
 * Resolve a canonical 1688 product URL from supported product shapes.
 * @param {object} product Product record.
 * @returns {string} Product URL.
 */
function productUrl(product) {
  const direct = product && (product['产品链接'] || product.detailUrl || product.productUrl || product.link || product.url || '');
  if (direct && /detail\.1688\.com\/offer\/\d+\.html/.test(String(direct))) return direct;
  const id = product && (product.id || product.offerId || product.productId);
  return id ? `https://detail.1688.com/offer/${id}.html` : direct;
}

/**
 * Resolve a generated or source title from supported product shapes.
 * @param {object} product Product record.
 * @returns {string} Product title.
 */
function productTitle(product) {
  return product && (product['铺货标题'] || product.title || product.subject || product.generatedTitle || product.name || '');
}

/**
 * Resolve a product price from supported product shapes.
 * @param {object} [product] Product record.
 * @returns {string|number} Product price.
 */
function productPrice(product = {}) {
  return product['商品原价'] || product.price || product.priceMin || product.minPrice || '';
}

/**
 * Resolve recent product sales from supported product shapes.
 * @param {object} [product] Product record.
 * @returns {string|number} Recent sales.
 */
function productSales(product = {}) {
  const stats = product.stats || {};
  return product['30天销量'] || product.sales30days || product.monthlySales || stats.last30DaysSales || stats.totalSales || 0;
}

/**
 * Resolve a product image from supported product shapes.
 * @param {object} [product] Product record.
 * @returns {string} Product image URL.
 */
function productImage(product = {}) {
  return product['主图链接'] || product.imageUrl || product.url || product.mainImage || product.image || '';
}

function parsePossibleJson(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) return value;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return value;
  }
}

function findDetailValue(root, keys) {
  const targets = new Set(keys.map(key => String(key).toLowerCase()));
  const queue = [parsePossibleJson(root)];
  const seen = new Set();
  while (queue.length > 0) {
    const current = parsePossibleJson(queue.shift());
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    for (const [key, rawValue] of Object.entries(current)) {
      const value = parsePossibleJson(rawValue);
      if (targets.has(String(key).toLowerCase()) && value != null && typeof value !== 'object' && String(value).trim()) {
        return String(value).trim();
      }
      if (value && typeof value === 'object') queue.push(value);
    }
  }
  return '';
}

/**
 * Normalize a 1688 detail response for a manually supplied product.
 * @param {object|string} raw Raw detail response.
 * @param {object} [input] Original manual input.
 * @returns {object} Normalized product details.
 */
function normalizeManualOfferDetail(raw, input = {}) {
  const root = parsePossibleJson(raw?.model?.bizData ?? raw?.model?.data ?? raw?.data ?? raw);
  const text = typeof root === 'string' ? root : '';
  const fromText = (patterns) => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
    return '';
  };
  const title = findDetailValue(root, ['title', 'subject', 'offerTitle', 'productTitle', 'name'])
    || fromText([/(?:商品标题|标题)[:：]\s*([^\n]+)/i]);
  const category = findDetailValue(root, ['categoryName', 'leafCategoryName', 'category', 'catName', 'categoryListName'])
    || fromText([/(?:商品类目|类目)[:：]\s*([^\n]+)/i]);
  const imageUrl = findDetailValue(root, ['imageUrl', 'mainImage', 'mainPic', 'picUrl', 'image'])
    || fromText([/(https?:\/\/[^\s"']+\.(?:jpg|jpeg|png|webp))/i]);
  const price = findDetailValue(root, ['price', 'offerPrice', 'salePrice', 'priceRange'])
    || fromText([/(?:价格|单价)[:：]\s*([^\n]+)/i]);
  return {
    offerId: input.offerId || '',
    title: title || String(input.title || '').trim(),
    category: category || String(input.category || '').trim(),
    imageUrl,
    price,
    raw: root
  };
}

/**
 * Create the product-detail reader used by manual workflows.
 * @param {object} [options] Fetcher options.
 * @param {Function} [options.detailFetcher] Injected detail reader.
 * @param {string} [options.ali1688Ak] 1688 API key.
 * @returns {Function} Async detail reader.
 */
function createManualDetailFetcher(options = {}) {
  if (typeof options.detailFetcher === 'function') return options.detailFetcher;
  const ak = String(options.ali1688Ak || process.env.ALI_1688_AK || '').trim();
  if (!ak) {
    return async () => {
      const error = new Error('缺少 ALI_1688_AK，无法获取 1688 商品资料');
      error.code = 'ali_1688_ak_missing';
      throw error;
    };
  }
  const client = new Alibaba1688Client(ak);
  return offerId => client.getOfferDetail(offerId);
}

/**
 * Resolve the category recommended by a SYCM response.
 * @param {object} sycmResult SYCM response.
 * @returns {string} Recommended category.
 */
function sycmRecommendedCategory(sycmResult) {
  const categoryAnalysis = sycmResult && sycmResult.categoryAnalysis;
  const recommended = categoryAnalysis && categoryAnalysis.recommendation && categoryAnalysis.recommendation.recommended;
  return recommended && recommended.category ? String(recommended.category).trim() : '';
}

/**
 * Resolve the best available category from a product and pipeline row.
 * @param {object} product Product record.
 * @param {object} [row] Pipeline row.
 * @returns {string} Product category.
 */
function productCategory(product, row = {}) {
  const direct = product && (
    product['铺货类目'] ||
    product['推荐类目'] ||
    product['类目'] ||
    product.category ||
    product.categoryListName ||
    product.categoryName ||
    product.stats?.categoryListName ||
    product.stats?.categoryName
  );
  return String(row.recommendedCategory || direct || '').trim();
}

/**
 * Extract an offer id from a canonical 1688 URL.
 * @param {string} url Product URL.
 * @returns {string} Offer id.
 */
function parseOfferId(url) {
  const match = String(url || '').match(/detail\.1688\.com\/offer\/(\d+)\.html/);
  return match ? match[1] : '';
}

module.exports = {
  createManualDetailFetcher,
  normalizeManualOfferDetail,
  parseOfferId,
  productCategory,
  productImage,
  productPrice,
  productSales,
  productTitle,
  productUrl,
  sycmRecommendedCategory
};
