'use strict';

const STOP_WORDS = new Set([
  '新品', '新款', '同款', '创意', '可爱', '高颜值', '官方', '旗舰店', '礼物', '包邮',
  '现货', '学生', '女生', '男女', '儿童', '小红书', '网红', '专用', '家用'
]);

function normalizedTitle(value) {
  return String(value || '').toLowerCase().replace(/[\s【】\[\]（）()·,，。！!？?、]/g, '');
}

function tokenizeTitle(value) {
  const title = String(value || '').replace(/[【】\[\]（）()·,，。！!？?、\d]/g, ' ');
  try {
    const jieba = require('nodejieba');
    return jieba.cut(title).map(word => word.trim()).filter(word => /^[\u3400-\u9fffA-Za-z]{2,8}$/.test(word) && !STOP_WORDS.has(word));
  } catch (_error) {
    const compact = title.replace(/\s+/g, '');
    const tokens = [];
    for (let size = 2; size <= 4; size += 1) {
      for (let index = 0; index <= compact.length - size; index += 1) tokens.push(compact.slice(index, index + size));
    }
    return tokens.filter(word => !STOP_WORDS.has(word));
  }
}

function topKeywords(products, limit = 20) {
  const counts = new Map();
  for (const product of products) {
    const unique = new Set(tokenizeTitle(product.title));
    for (const word of unique) counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .slice(0, limit)
    .map(([keyword, productCount]) => ({ keyword, productCount }));
}

function potentialForNewProduct(product, hotTitles, maxPayment) {
  const payment = Math.max(0, Number(product.paymentLowerBound) || 0);
  const paymentSignal = maxPayment > 0 ? Math.log1p(payment) / Math.log1p(maxPayment) : 0;
  const rankSignal = Math.max(0, 1 - (Math.max(1, Number(product.rank) || 1) - 1) / 20);
  const hotOverlap = hotTitles.has(normalizedTitle(product.title));
  const score = Math.round((paymentSignal * 55 + rankSignal * 25 + (hotOverlap ? 20 : 0)) * 10) / 10;
  const level = score >= 70 ? '重点关注' : score >= 45 ? '持续观察' : '新品试款';
  const reasons = [
    `新品排序第 ${product.rank} 位`,
    product.paymentText || '暂无付款信号',
    hotOverlap ? '同时进入销量榜' : ''
  ].filter(Boolean);
  return { score, level, reasons, hotOverlap };
}

function productIdentity(product = {}) {
  return `${product.shopKey || ''}:${product.itemId || normalizedTitle(product.title)}`;
}

/**
 * Compare current sorted-list samples with one prior run.
 * @param {object} current Current hot and new products.
 * @param {object} previous Prior hot and new products.
 * @param {object} [metadata] Baseline metadata.
 * @returns {object} Conservative list-sample changes.
 */
function compareCompetitorSnapshots(current = {}, previous = {}, metadata = {}) {
  const currentHot = current.hotProducts || [];
  const currentNew = current.newProducts || [];
  const previousHot = previous.hotProducts || [];
  const previousNew = previous.newProducts || [];
  const priorHot = new Map(previousHot.map(item => [productIdentity(item), item]));
  const priorNew = new Map(previousNew.map(item => [productIdentity(item), item]));
  const currentHotKeys = new Set(currentHot.map(productIdentity));
  const currentNewKeys = new Set(currentNew.map(productIdentity));
  const paymentChanges = [];
  for (const [sortType, rows, baseline] of [['hot', currentHot, priorHot], ['new', currentNew, priorNew]]) {
    for (const item of rows) {
      const prior = baseline.get(productIdentity(item));
      if (!prior) continue;
      const currentPayment = Number(item.paymentLowerBound) || 0;
      const previousPayment = Number(prior.paymentLowerBound) || 0;
      if (currentPayment === previousPayment) continue;
      paymentChanges.push({
        shopKey: item.shopKey,
        shopName: item.shopName,
        sortType,
        title: item.title,
        previousPaymentLowerBound: previousPayment,
        currentPaymentLowerBound: currentPayment,
        deltaLowerBound: currentPayment - previousPayment,
        productUrl: item.productUrl || ''
      });
    }
  }
  return {
    status: 'compared',
    baselineRunId: metadata.baselineRunId || '',
    baselineAt: metadata.baselineAt || '',
    evidenceNotice: '历史变化仅比较两次采集到的榜单样本；未出现不等于下架，付款变化也只是页面展示下限变化。',
    newlyObservedHot: currentHot.filter(item => !priorHot.has(productIdentity(item))),
    newlyObservedNew: currentNew.filter(item => !priorNew.has(productIdentity(item))),
    noLongerObservedHot: previousHot.filter(item => !currentHotKeys.has(productIdentity(item))),
    noLongerObservedNew: previousNew.filter(item => !currentNewKeys.has(productIdentity(item))),
    paymentChanges
  };
}

/**
 * Build deterministic competitor analysis from collected list rows.
 * @param {object[]} shops Shop profiles.
 * @param {object[]} hotProducts Hot-list rows.
 * @param {object[]} newProducts New-list rows.
 * @returns {object} Analysis document.
 */
function analyzeCompetitorData(shops = [], hotProducts = [], newProducts = []) {
  const allProducts = [...hotProducts, ...newProducts];
  const hotTitles = new Set(hotProducts.map(item => normalizedTitle(item.title)));
  const maxNewPayment = Math.max(0, ...newProducts.map(item => Number(item.paymentLowerBound) || 0));
  const analyzedNew = newProducts.map(product => ({
    ...product,
    potential: potentialForNewProduct(product, hotTitles, maxNewPayment)
  }));
  const shopSummaries = shops.map(shop => {
    const hot = hotProducts.filter(item => item.shopKey === shop.shopKey);
    const fresh = analyzedNew.filter(item => item.shopKey === shop.shopKey);
    return {
      shopKey: shop.shopKey,
      shopName: shop.shopName,
      shopUrl: shop.shopUrl,
      followerText: shop.followerText,
      hotCount: hot.length,
      newCount: fresh.length,
      newWithPaymentCount: fresh.filter(item => Number(item.paymentLowerBound) > 0).length,
      newHotOverlapCount: fresh.filter(item => item.potential.hotOverlap).length,
      representativeHot: hot.slice(0, 3).map(item => item.title),
      categories: shop.categories || []
    };
  });
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    evidenceNotice: '付款人数为淘宝页面展示的累计区间或下限，不等同于30天销量；新品仅代表店铺新品排序，不代表精确上架日期。',
    totals: {
      shops: shops.length,
      hotProducts: hotProducts.length,
      newProducts: newProducts.length,
      newWithPayment: analyzedNew.filter(item => Number(item.paymentLowerBound) > 0).length,
      hotNewOverlap: analyzedNew.filter(item => item.potential.hotOverlap).length
    },
    shopSummaries,
    hotKeywords: topKeywords(hotProducts),
    newKeywords: topKeywords(newProducts),
    opportunityKeywords: topKeywords(allProducts, 30),
    newProducts: analyzedNew
  };
}

module.exports = {
  analyzeCompetitorData,
  compareCompetitorSnapshots,
  normalizedTitle,
  potentialForNewProduct,
  tokenizeTitle,
  topKeywords
};
