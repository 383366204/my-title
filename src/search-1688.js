const Alibaba1688Client = require('./alibaba1688-client');

/**
 * 搜索 1688 商品并根据刚性修饰词过滤
 * @param {string} coreWord - 核心词
 * @param {Array<{word: string, rigidity: 'rigid'|'optional'}>} modifiers - 修饰词列表
 * @returns {Promise<Array<object>>} 过滤后的商品列表
 */
async function searchAndFilter(coreWord, modifiers) {
  const ak = process.env.ALI_1688_AK;
  if (!ak) {
    throw new Error('环境变量 ALI_1688_AK 未设置');
  }

  const client = new Alibaba1688Client(ak);
  const products = await client.searchOffers(coreWord);

  if (!Array.isArray(products) || products.length === 0) {
    return [];
  }

  // 只过滤刚性修饰词，可选修饰词不参与过滤
  return filterRelevantProducts(products, modifiers);
}

/**
 * 根据刚性修饰词过滤产品
 * @param {Array<object>} products - 商品列表
 * @param {Array<{word: string, rigidity: 'rigid'|'optional'}>} modifiers - 修饰词列表
 * @returns {Array<object>} 过滤后的商品列表
 */
function filterRelevantProducts(products, modifiers) {
  const rigidModifiers = modifiers
    .filter(m => m.rigidity === 'rigid')
    .map(m => m.word.toLowerCase());

  // 如果没有刚性修饰词，保留所有商品
  if (rigidModifiers.length === 0) {
    return products;
  }

  return products.filter(product => {
    const title = (product.subject || '').toLowerCase();
    const description = (product.description || '').toLowerCase();
    const combinedText = `${title} ${description}`;

    // 至少匹配一个刚性修饰词
    return rigidModifiers.some(word => combinedText.includes(word));
  });
}

module.exports = { searchAndFilter, filterRelevantProducts };
