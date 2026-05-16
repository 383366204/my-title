/**
 * 价格带分析模块
 */

/**
 * 解析各种价格格式
 * @param {string|number} priceStr - 价格字符串或数字
 * @returns {number|null} 解析后的价格数字
 */
function parsePrice(priceStr) {
  if (typeof priceStr === 'number') return isFinite(priceStr) && priceStr > 0 ? priceStr : null;
  if (typeof priceStr !== 'string') return null;
  
  // 处理 "¥12.5", "12.5元", "12.5", "5-20" 等格式
  const cleaned = priceStr.replace(/[¥$,\s]/g, '').replace(/元/g, '');
  
  // 处理范围格式，取中间值
  if (cleaned.includes('-')) {
    const parts = cleaned.split('-').map(p => parseFloat(p)).filter(p => !isNaN(p) && p > 0);
    if (parts.length === 0) return null;
    return parts.reduce((a, b) => a + b, 0) / parts.length;
  }
  
  const num = parseFloat(cleaned);
  return !isNaN(num) && num > 0 ? num : null;
}

/**
 * 计算价格带（P25/P50/P75）
 * @param {Array<{price: string|number}>} products - 商品列表
 * @returns {{P25: number, P50: number, P75: number, count: number, min: number, max: number}|null}
 */
function calcPriceBands(products) {
  if (!Array.isArray(products) || products.length === 0) return null;
  
  const prices = products
    .map(p => parsePrice(p.price))
    .filter(p => p !== null);
  
  if (prices.length < 5) return null;
  
  prices.sort((a, b) => a - b);
  
  const getPercentile = (arr, p) => {
    const idx = (arr.length - 1) * p;
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper) return arr[lower];
    return arr[lower] + (arr[upper] - arr[lower]) * (idx - lower);
  };
  
  return {
    P25: Math.round(getPercentile(prices, 0.25) * 100) / 100,
    P50: Math.round(getPercentile(prices, 0.50) * 100) / 100,
    P75: Math.round(getPercentile(prices, 0.75) * 100) / 100,
    count: prices.length,
    min: prices[0],
    max: prices[prices.length - 1]
  };
}

/**
 * 生成定价建议
 * @param {number} sourcePrice - 1688批发价
 * @param {{P25: number, P50: number, P75: number}} priceBands - 价格带
 * @returns {string} 定价建议文本
 */
function generatePriceAdvice(sourcePrice, priceBands) {
  if (!sourcePrice || !priceBands) return '参考同类商品定价';
  
  const { P25, P50, P75 } = priceBands;
  
  // 基于价格带给出建议
  let markupLow, markupHigh;
  
  if (sourcePrice < P25) {
    // 批发价低于P25，有价格优势
    markupLow = Math.ceil(sourcePrice * 2.5);
    markupHigh = Math.ceil(sourcePrice * 3.5);
    return `1688价${sourcePrice}元（低于市场P25），建议零售${markupLow}-${markupHigh}元，价格有优势`;
  } else if (sourcePrice < P50) {
    markupLow = Math.ceil(sourcePrice * 2.0);
    markupHigh = Math.ceil(sourcePrice * 3.0);
    return `1688价${sourcePrice}元（接近市场P50），建议零售${markupLow}-${markupHigh}元`;
  } else if (sourcePrice < P75) {
    markupLow = Math.ceil(sourcePrice * 1.8);
    markupHigh = Math.ceil(sourcePrice * 2.5);
    return `1688价${sourcePrice}元（高于市场P50），建议零售${markupLow}-${markupHigh}元`;
  } else {
    markupLow = Math.ceil(sourcePrice * 1.5);
    markupHigh = Math.ceil(sourcePrice * 2.0);
    return `1688价${sourcePrice}元（高于市场P75），建议零售${markupLow}-${markupHigh}元，注意控制利润`;
  }
}

module.exports = { parsePrice, calcPriceBands, generatePriceAdvice };
