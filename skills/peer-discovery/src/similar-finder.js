'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { parseShopKey, canonicalShopUrl } = require('../../competitor-analysis/src/page-parser');
const { imageSearchSingleRaw } = require('../../title-gen/src/search-taobao-image');
const { normalizeTaobaoWebCards } = require('./taobao-web-cards');
const { isPlatformBlocker } = require('./sourcing-matcher');
const { searchTaobaoWebImage } = require('./taobao-web-image-search');

/**
 * Standardize one candidate similar product from native or web image search results.
 * @param {object} item Raw product item
 * @param {object} sourceProduct Original source product
 * @param {number} rank 1-indexed rank
 * @returns {object|null}
 */
function standardizeSimilarProduct(item, sourceProduct, rank = 1) {
  if (!item) return null;
  const title = String(item.title || '').trim();
  const itemId = String(item.itemId || item.id || '').trim();
  if (!title || !itemId) return null;

  const rawShopUrl = item.shopUrl || (item.shopKey && item.shopKey.startsWith('shop:') ? `https://shop${item.shopKey.slice(5)}.taobao.com/` : '');
  const shopUrl = rawShopUrl ? canonicalShopUrl(rawShopUrl) : null;
  const shopKey = item.shopKey || (shopUrl ? parseShopKey(shopUrl) : null);

  const priceValue = item.price !== undefined && item.price !== null
    ? Number(item.price)
    : item.displayPriceText
      ? Number(parseFloat(String(item.displayPriceText).replace(/[^\d.]/g, '')))
      : null;

  return {
    sourceInputUrl: sourceProduct.inputUrl || '',
    sourceShopKey: sourceProduct.shopKey || null,
    productId: sourceProduct.itemId,
    rank,
    title,
    price: Number.isFinite(priceValue) ? priceValue : null,
    imageUrl: item.imageUrl || item.imgUrl || '',
    shopKey: shopKey || null,
    shopName: String(item.shopName || '').trim(),
    shopUrl,
    itemId,
    productUrl: item.url || item.productUrl || `https://item.taobao.com/item.htm?id=${itemId}`
  };
}

/**
 * Parse products array from native CLI image search output structure.
 * @param {object} rawOutput
 * @returns {object[]}
 */
function parseNativeProducts(rawOutput) {
  if (!rawOutput || typeof rawOutput !== 'object') return [];
  if (Array.isArray(rawOutput.products)) return rawOutput.products;
  const categories = rawOutput?.data?.result?.categories || rawOutput?.result?.categories || [];
  if (Array.isArray(categories)) {
    return categories.flatMap(cat => Array.isArray(cat.products) ? cat.products : []);
  }
  return [];
}

/**
 * Find similar products across Taobao and aggregate candidate shops.
 * @param {object} options
 * @param {object[]} [options.sourceProducts] - Array of source products
 * @param {string} [options.runDir] - Pipeline run directory
 * @param {string} [options.dataDir] - Data root directory
 * @param {string} [options.runId] - Run ID
 * @param {number} [options.maxCandidateShops=30] - Max shops limit
 * @param {string} [options.channel='auto'] - Channel
 * @param {Function} [options.imageSearcher] - Injectable custom image search function
 * @param {Function} [options.onProgress] - Progress callback
 * @param {AbortSignal} [options.signal] - Cancellation signal
 * @returns {Promise<object>} Candidates, similar products and counts
 */
async function findSimilarProducts(options = {}) {
  const { signal, onProgress } = options;
  signal?.throwIfAborted();

  const maxCandidateShops = options.maxCandidateShops ?? 30;
  const runDir = options.runDir || (options.dataDir && options.runId ? path.join(options.dataDir, 'pipeline', 'runs', options.runId) : null);

  let sourceProducts = options.sourceProducts;
  if (!Array.isArray(sourceProducts) && runDir) {
    try {
      const content = await fs.readFile(path.join(runDir, 'source-products.jsonl'), 'utf8');
      sourceProducts = content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch (_) {
      sourceProducts = [];
    }
  }
  sourceProducts = sourceProducts || [];

  if (!sourceProducts.length) {
    return {
      ok: false,
      candidates: [],
      similarProducts: [],
      similarCount: 0,
      errors: [{ code: 'NO_SOURCE_PRODUCTS', message: '缺少源商品数据，无法执行同款搜索' }]
    };
  }

  const allSimilarProducts = [];
  const candidateShopsMap = new Map();
  const errors = [];
  // 统计真正完成的图搜次数（含返回 0 条），用于区分"无同款"与"全部失败"
  const channel = options.channel || options.params?.resolvedTaobaoChannel || (options.params?.taobaoChannel === 'web' ? 'web' : 'native');

  let searchesCompleted = 0;
  let searchesFailed = 0;

  for (const [index, source] of sourceProducts.entries()) {
    signal?.throwIfAborted();
    onProgress?.({
      current: index + 1,
      total: sourceProducts.length,
      message: `正在图搜同款: [${source.itemId}] ${source.title.slice(0, 15)}...`
    });

    if (!source.mainImageUrl) {
      errors.push({ itemId: source.itemId, code: 'NO_IMAGE_URL', message: '源商品缺少主图链接，跳过' });
      continue;
    }

    try {
      let rawItems = [];
      if (typeof options.imageSearcher === 'function') {
        const res = await options.imageSearcher(source, { signal });
        rawItems = Array.isArray(res) ? res : (res?.products || parseNativeProducts(res));
      } else if (channel === 'web') {
        const response = await (options.webImageSearcher || searchTaobaoWebImage)(source, { port: options.port, signal, onProgress, guardOptions: options.guardOptions });
        rawItems = response.products;
      } else {
        // 默认 Native CLI 图搜
        const rawOutput = await imageSearchSingleRaw(source.mainImageUrl, source.itemId, { signal, timeout: 30000 });
        rawItems = parseNativeProducts(rawOutput);
      }
      searchesCompleted++;

      if (!rawItems.length) {
        errors.push({ itemId: source.itemId, code: 'NO_SIMILAR_FOUND', message: '图搜未返回同款商品' });
        continue;
      }

      let rank = 1;
      for (const raw of rawItems) {
        const item = standardizeSimilarProduct(raw, source, rank++);
        if (!item) continue;

        // 关键门禁：排除源商品自身的店铺
        if (source.shopKey && item.shopKey === source.shopKey) continue;

        allSimilarProducts.push(item);

        // 如果包含有效店铺入口，聚合成候选店铺
        if (item.shopKey && item.shopUrl) {
          if (!candidateShopsMap.has(item.shopKey)) {
            candidateShopsMap.set(item.shopKey, {
              shopKey: item.shopKey,
              shopName: item.shopName || '',
              shopUrl: item.shopUrl,
              sourceCount: 0,
              similarProductCount: 0,
              representativeProducts: [],
              _sourceSet: new Set()
            });
          }
          const shop = candidateShopsMap.get(item.shopKey);
          shop.similarProductCount++;
          if (!shop._sourceSet.has(source.itemId)) {
            shop._sourceSet.add(source.itemId);
            shop.sourceCount++;
          }
          if (shop.representativeProducts.length < 5 && !shop.representativeProducts.includes(item.itemId)) {
            shop.representativeProducts.push(item.itemId);
          }
        }
      }
    } catch (err) {
      // 平台阻塞与取消必须向上传递，由 step 适配器转为 blocked / paused
      if (err?.name === 'AbortError' || signal?.aborted || isPlatformBlocker(err)) throw err;
      searchesFailed++;
      errors.push({ itemId: source.itemId, code: err.code || 'SIMILAR_SEARCH_FAILED', message: err.message });
    }
  }

  // 所有图搜都失败时不能伪装成"没有候选店铺"
  if (searchesFailed > 0 && searchesCompleted === 0) {
    const error = new Error(`图搜全部失败（${searchesFailed} 个源商品），无法判断是否存在同款：${errors.map(e => e.message).slice(0, 3).join('；')}`);
    error.code = 'IMAGE_SEARCH_ALL_FAILED';
    error.errors = errors;
    throw error;
  }

  // 按关联源商品数倒序、同款总数倒序排序，截断到 maxCandidateShops
  const sortedCandidates = [...candidateShopsMap.values()]
    .sort((a, b) => b.sourceCount - a.sourceCount || b.similarProductCount - a.similarProductCount)
    .slice(0, maxCandidateShops)
    .map(shop => {
      const { _sourceSet, ...rest } = shop;
      return rest;
    });

  // 落盘 similar-products.jsonl 与 candidate-shops.jsonl
  if (runDir) {
    await fs.mkdir(runDir, { recursive: true });
    const similarLines = allSimilarProducts.map(p => JSON.stringify(p)).join('\n') + (allSimilarProducts.length ? '\n' : '');
    await fs.writeFile(path.join(runDir, 'similar-products.jsonl'), similarLines, 'utf8');

    const candidateLines = sortedCandidates.map(s => JSON.stringify(s)).join('\n') + (sortedCandidates.length ? '\n' : '');
    await fs.writeFile(path.join(runDir, 'candidate-shops.jsonl'), candidateLines, 'utf8');
  }

  const ok = sortedCandidates.length > 0;
  return {
    ok,
    candidates: sortedCandidates,
    similarProducts: allSimilarProducts,
    similarCount: allSimilarProducts.length,
    candidateCount: sortedCandidates.length,
    errors
  };
}

module.exports = {
  findSimilarProducts,
  standardizeSimilarProduct,
  parseNativeProducts
};
