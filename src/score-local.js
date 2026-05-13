/**
 * 本地评分算法
 * 根据核心词、修饰词、蓝海词对产品进行本地评分，用于快速过滤
 */

/**
 * 对产品列表进行本地评分
 * @param {Array<{title: string, stats?: {last30DaysSales?: number, goodRates?: number}}>} products - 产品列表
 * @param {string} coreWord - 核心词
 * @param {string} blueOceanWord - 蓝海词
 * @param {string[]} modifiers - 刚性修饰词数组
 * @param {Object} [semanticGroups={}] - 语义族映射 {修饰词: [同义词数组]}
 * @returns {Array<{product: object, score: number, passed: boolean}>} 评分结果，支持精确匹配和语义族匹配
 */
function scoreLocally(products, coreWord, blueOceanWord, modifiers, semanticGroups = {}) {
  return products.map(product => {
    let score = 0;
    const title = product.title || '';

    // 核心词匹配: +30分
    if (title.includes(coreWord)) {
      score += 30;
    }

    let rigidAllMatched = true;
    if (modifiers.length > 0) {
      modifiers.forEach(modifier => {
        const exactHit = title.includes(modifier);
        const group = semanticGroups[modifier] || semanticGroups[modifier.toLowerCase()];
        const synonymHit = group && group.some(function(s) { return title.includes(s) || title.includes(s.toLowerCase()); });
        if (exactHit || synonymHit) {
          score += 10;
        } else {
          rigidAllMatched = false;
        }
      });
    }

    // 蓝海词匹配: +20分
    if (blueOceanWord && title.includes(blueOceanWord)) {
      score += 20;
    }

    // 30天销量>100: +15分
    const last30DaysSales = (product.stats && product.stats.last30DaysSales) || 0;
    if (last30DaysSales > 100) {
      score += 15;
    }

    // 好评率>95%: +5分
    const goodRates = (product.stats && product.stats.goodRates) || 0;
    if (goodRates > 95) {
      score += 5;
    }

    let passed;
    if (modifiers.length === 0) {
      passed = true;
    } else {
      passed = score >= 30 && rigidAllMatched;
    }

    return { product, score, passed };
  });
}

module.exports = { scoreLocally };