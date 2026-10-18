'use strict';

const { tokenizeTitle } = require('../../competitor-analysis/src/analyzer');
const { searchWeb1688 } = require('../../alibaba1688/src/search-web-1688');

// 规格词表：材质、件数、规格等可明确比对的属性
const SPEC_PATTERNS = {
  material: /纯银|925银|不锈钢|钛钢|铜镀金|合金|塑料|硅胶|木质|陶瓷|玻璃|真皮|PU/,
  quantity: /(\d+|一|二|两|三|四|五)\s*(件套|套|件|个|只|条|对|双|把|支|片|块|组|包|盒|箱)/,
  size: /(\d+(?:\.\d+)?)\s*(cm|mm|寸|英寸|厘米|毫米)/
};

// 单位归一化表（全部转为 mm，保留小数精度）
const SIZE_TO_MM = { cm: 10, 厘米: 10, mm: 1, 毫米: 1, 寸: 33.33, 英寸: 25.4 };

// 中文数字转阿拉伯数字
const CN_NUM = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5 };

// 套装类单位（表示多件组合，不能与单件单位等同）
const SET_UNITS = new Set(['件套', '套', '组']);
// 单件类单位
const SINGLE_UNITS = new Set(['件', '个', '只', '条', '把', '支', '片', '块']);
const PACKAGE_UNITS = new Set(['包', '盒', '箱']);
// 配对类单位
const PAIR_UNITS = new Set(['对', '双']);

function normalizeSpec(key, rawMatch) {
  if (key === 'size') {
    const m = rawMatch.match(/(\d+(?:\.\d+)?)\s*(cm|mm|寸|英寸|厘米|毫米)/);
    if (!m) return rawMatch;
    const valueMm = parseFloat(m[1]) * (SIZE_TO_MM[m[2]] || 1);
    return `${parseFloat(valueMm.toPrecision(6))}mm`;
  }
  if (key === 'quantity') {
    const m = rawMatch.match(/(\d+|一|二|两|三|四|五)\s*(件套|套|件|个|只|条|对|双|把|支|片|块|组|包|盒|箱)/);
    if (!m) return rawMatch;
    const num = CN_NUM[m[1]] || parseInt(m[1], 10);
    const unit = m[2];
    const category = SET_UNITS.has(unit) ? 'set' : PAIR_UNITS.has(unit) ? 'pair'
      : PACKAGE_UNITS.has(unit) ? 'package' : SINGLE_UNITS.has(unit) ? 'single' : 'unknown';
    return JSON.stringify({ num, unit, category });
  }
  return rawMatch;
}

function compareQuantity(qa, qb) {
  try {
    const a = JSON.parse(qa);
    const b = JSON.parse(qb);
    if (a.unit !== b.unit || a.category !== b.category) return 'unknown';
    if (a.category === 'package' || ['套', '组'].includes(a.unit)) return 'unknown';
    if (a.num === b.num) return 'consistent';
    return 'inconsistent';
  } catch (_) {
    return 'unknown';
  }
}

/**
 * 检查两个标题的规格一致性。
 * @param {string} titleA
 * @param {string} titleB
 * @returns {'consistent'|'inconsistent'|'unknown'}
 */
function checkSpecConsistency(titleA, titleB) {
  const extractSpecs = (title) => {
    const specs = {};
    for (const [key, pattern] of Object.entries(SPEC_PATTERNS)) {
      const match = String(title || '').match(pattern);
      if (match) specs[key] = normalizeSpec(key, match[0]);
    }
    return specs;
  };
  const specsA = extractSpecs(titleA);
  const specsB = extractSpecs(titleB);
  const allKeys = new Set([...Object.keys(specsA), ...Object.keys(specsB)]);

  let hasConflict = false;
  let hasComparison = false;
  let hasMissing = false;
  let hasQuantityUnknown = false;

  for (const key of allKeys) {
    const a = specsA[key];
    const b = specsB[key];
    if (a && b) {
      if (key === 'quantity') {
        const qResult = compareQuantity(a, b);
        if (qResult === 'unknown') hasQuantityUnknown = true;
        else if (qResult === 'inconsistent') hasConflict = true;
        else hasComparison = true;
      } else {
        hasComparison = true;
        if (a !== b) hasConflict = true;
      }
    } else if (a || b) {
      hasMissing = true;
    }
  }

  if (!hasComparison && !hasMissing && !hasQuantityUnknown) return 'unknown';
  if (hasConflict) return 'inconsistent';
  if (hasMissing || hasQuantityUnknown) return 'unknown';
  return 'consistent';
}

/**
 * 计算两个标题的分词相似度（Jaccard 系数）。
 * @param {string} titleA
 * @param {string} titleB
 * @returns {number} 0-1
 */
function titleSimilarity(titleA, titleB) {
  const tokensA = new Set(tokenizeTitle(titleA));
  const tokensB = new Set(tokenizeTitle(titleB));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) if (tokensB.has(t)) intersection++;
  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function isPlatformBlocker(err) {
  if (!err) return false;
  const msg = err.message || '';
  const code = err.code || err.status || '';
  return code === 'PLATFORM_ACCESS_BLOCKED' ||
    code === 'PLATFORM_ACCESS_LOCK_TIMEOUT' ||
    code === 'login_required' ||
    code === 'captcha_required' ||
    code === 'rate_limited' ||
    err.name === 'PlatformAccessError' ||
    /请完成安全验证|登录失效|请先登录|访问受限|操作过于频繁|会话排队超时/.test(msg);
}

/**
 * 判定单个商品是否有同款低价货源（文字搜索分支，<=判定）。
 * @param {object} product - 达标商品 { title, taobaoPrice, price, productUrl }
 * @param {object} [options]
 * @param {number} [options.similarityThreshold=0.45]
 * @param {number} [options.priceRatioThreshold=0.7]
 * @param {number} [options.port=9222]
 * @param {Function} [options.searcher] 可注入的搜索器
 * @returns {Promise<object>} sourcing result
 */
async function matchSourcing(product, options = {}) {
  const similarityThreshold = options.similarityThreshold ?? 0.45;
  const priceRatioThreshold = options.priceRatioThreshold ?? 0.7;
  const port = options.port ?? 9222;
  const searchMaxProducts = options.searchMaxProducts ?? 10;
  const searchMaxPages = options.searchMaxPages ?? 1;

  const title = String(product.title || '').trim();
  const tokens = tokenizeTitle(title);
  const keyword = tokens.slice(0, 3).join(' ');
  if (!keyword) return { level: 'inconclusive', reason: 'empty_keyword' };

  let searchResult;
  try {
    if (typeof options.searcher === 'function') {
      searchResult = await options.searcher({ keyword, port, maxProducts: searchMaxProducts, maxPages: searchMaxPages });
    } else {
      searchResult = await searchWeb1688({
        keyword, port, maxProducts: searchMaxProducts, maxPages: searchMaxPages
      });
    }
  } catch (err) {
    if (isPlatformBlocker(err)) {
      err.platform = '1688';
      err.platformStatus = err.status || err.code || 'unknown';
      err.actionHint = err.message || '1688 平台需要处理';
      throw err;
    }
    return { level: 'inconclusive', reason: 'search_failed', error: err.message };
  }

  if (!searchResult?.ok) {
    if (searchResult?.status === 'captcha_required' || searchResult?.status === 'login_required') {
      const err = new Error(searchResult.message || '1688 平台需要登录或验证');
      err.code = searchResult.status;
      err.platform = '1688';
      err.platformStatus = searchResult.status;
      err.actionHint = searchResult.status === 'captcha_required'
        ? '请在 Chrome 中完成 1688 验证码后重试'
        : '请在 Chrome 中登录 1688 后重试';
      throw err;
    }
    return { level: 'inconclusive', reason: 'search_not_ok', detail: searchResult?.message };
  }

  if (!Array.isArray(searchResult.products) || !searchResult.products.length) {
    return { level: 'inconclusive', reason: 'no_1688_result' };
  }

  const taobaoPrice = Number(product.taobaoPrice ?? product.price);
  if (!taobaoPrice || taobaoPrice <= 0) {
    return { level: 'inconclusive', reason: 'missing_taobao_price' };
  }

  const candidates = searchResult.products.map(ali => {
    const sim = titleSimilarity(title, ali.title);
    const minOrderQty = ali.minOrderQuantity ?? null;
    const isTieredPrice = Array.isArray(ali.priceBand?.prices) && ali.priceBand.prices.length > 1;

    let comparablePrice = null;
    if (ali.singlePiecePrice != null && ali.singlePiecePrice > 0) {
      comparablePrice = ali.singlePiecePrice;
    } else if (minOrderQty === 1 && !isTieredPrice) {
      comparablePrice = ali.priceBand?.minPrice ?? ali.price;
    }

    const ratio = comparablePrice ? comparablePrice / taobaoPrice : Infinity;
    const specStatus = checkSpecConsistency(title, ali.title);
    return {
      ali,
      sim,
      comparablePrice,
      rawMinPrice: ali.priceBand?.minPrice ?? ali.price,
      ratio,
      minOrderQty,
      isTieredPrice,
      specStatus
    };
  });

  // 1. confirmed 判定: 相似度达标 + 有效单件比较价格存在 + 价格比 <= 阈值 + 规格明确一致
  const confirmed = candidates
    .filter(c => c.sim >= similarityThreshold && c.comparablePrice != null && c.ratio <= priceRatioThreshold && c.specStatus === 'consistent')
    .sort((a, b) => b.sim - a.sim)[0];

  if (confirmed) {
    return {
      level: 'confirmed',
      reason: 'matched',
      aliUrl: confirmed.ali.url || confirmed.ali.redirectUrl,
      aliTitle: confirmed.ali.title,
      aliComparablePrice: confirmed.comparablePrice,
      aliRawMinPrice: confirmed.rawMinPrice,
      aliMinOrderQty: confirmed.minOrderQty,
      similarity: confirmed.sim,
      priceRatio: confirmed.ratio
    };
  }

  // 2. suspected 判定:
  const suspected = candidates
    .filter(c => {
      if (c.sim < similarityThreshold) return false;
      if (c.specStatus === 'inconsistent') return false;
      if (c.comparablePrice != null && c.ratio > priceRatioThreshold) return false;
      return c.comparablePrice == null || c.specStatus === 'unknown';
    })
    .sort((a, b) => Number(b.comparablePrice != null) - Number(a.comparablePrice != null) || b.sim - a.sim)[0];

  if (suspected) {
    const reason = suspected.comparablePrice == null
      ? (suspected.minOrderQty == null ? 'min_order_qty_unknown' : suspected.isTieredPrice ? 'tiered_price_not_comparable' : 'no_single_piece_price')
      : 'spec_unknown';
    return {
      level: suspected.comparablePrice == null ? 'inconclusive' : 'suspected',
      reason,
      aliUrl: suspected.ali.url || suspected.ali.redirectUrl,
      aliTitle: suspected.ali.title,
      aliRawMinPrice: suspected.rawMinPrice,
      aliMinOrderQty: suspected.minOrderQty,
      similarity: suspected.sim,
      priceRatio: suspected.comparablePrice ? suspected.ratio : null,
      specStatus: suspected.specStatus,
      note: suspected.comparablePrice == null
        ? (suspected.minOrderQty == null ? '1688起订量未知，无法确认单件价格'
          : suspected.isTieredPrice ? '1688为阶梯价，无法确定单件采购价格'
          : `1688起订量${suspected.minOrderQty}件，无明确单件价格`)
        : '规格一致性未知（非明确不一致），标记疑似待人工确认'
    };
  }

  // 3. rejected 判定:
  const bestSim = Math.max(...candidates.map(c => c.sim));
  if (bestSim < similarityThreshold) {
    return { level: 'rejected', reason: 'low_similarity', bestSimilarity: bestSim };
  }

  const simPassedCandidates = candidates.filter(c => c.sim >= similarityThreshold);
  const inconsistentSpecs = simPassedCandidates.filter(c => c.specStatus === 'inconsistent');
  const comparableAndExpensive = simPassedCandidates.filter(c => c.comparablePrice != null && c.ratio > priceRatioThreshold);

  if (inconsistentSpecs.length > 0 && inconsistentSpecs.length === simPassedCandidates.length) {
    return {
      level: 'rejected',
      reason: 'spec_mismatch',
      detail: `所有 ${inconsistentSpecs.length} 个相似候选规格明确不一致`
    };
  }

  if (inconsistentSpecs.length > 0 && comparableAndExpensive.length > 0) {
    return {
      level: 'rejected',
      reason: 'spec_mismatch_and_price_too_high',
      specMismatchCount: inconsistentSpecs.length,
      bestPriceRatio: Math.min(...comparableAndExpensive.map(c => c.ratio))
    };
  }

  if (comparableAndExpensive.length > 0) {
    return {
      level: 'rejected',
      reason: 'price_too_high',
      bestPriceRatio: Math.min(...comparableAndExpensive.map(c => c.ratio))
    };
  }

  return { level: 'inconclusive', reason: 'unexpected_fallthrough' };
}

module.exports = {
  matchSourcing,
  titleSimilarity,
  checkSpecConsistency,
  normalizeSpec,
  compareQuantity,
  isPlatformBlocker
};
