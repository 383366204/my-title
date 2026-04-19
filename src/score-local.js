/**
 * 本地评分算法
 * 根据核心词、修饰词、蓝海词对产品进行本地评分，用于快速过滤
 */

/**
 * 对产品列表进行本地评分
 * @param {Array<{title: string, sales30days?: number, goodRate?: number}>} products - 产品列表
 * @param {string} coreWord - 核心词
 * @param {string} blueOceanWord - 蓝海词
 * @param {string[]} modifiers - 刚性修饰词数组
 * @returns {Array<{product: object, score: number, passed: boolean}>}
 */
function scoreLocally(products, coreWord, blueOceanWord, modifiers) {
  return products.map(product => {
    let score = 0;
    const title = product.title || '';

    // 核心词匹配: +30分
    if (title.includes(coreWord)) {
      score += 30;
    }

    // 刚性修饰词匹配: 每个+10分
    modifiers.forEach(modifier => {
      if (title.includes(modifier)) {
        score += 10;
      }
    });

    // 蓝海词匹配: +20分
    if (blueOceanWord && title.includes(blueOceanWord)) {
      score += 20;
    }

    // 30天销量>100: +15分
    if (product.sales30days && product.sales30days > 100) {
      score += 15;
    }

    // 好评率>95%: +5分
    if (product.goodRate && product.goodRate > 95) {
      score += 5;
    }

    // 阈值>=40通过
    const passed = score >= 40;

    return { product, score, passed };
  });
}

module.exports = { scoreLocally };