const Alibaba1688Client = require('./alibaba1688-client');
const { scoreLocally } = require('./score-local');

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
    const title = (product.subject || product.title || '').toLowerCase();
    const description = (product.description || '').toLowerCase();
    const combinedText = `${title} ${description}`;

    // 必须匹配所有刚性修饰词
    return rigidModifiers.every(word => combinedText.includes(word));
  });
}

/**
 * 双重搜索：先用核心词搜索，再用蓝海词搜索，合并去重后本地评分过滤
 * @param {string} coreWord - 核心词（第一次搜索）
 * @param {string} blueOceanWord - 蓝海词（第二次搜索）
 * @param {Array<{word: string, rigidity: 'rigid'|'optional'}>} modifiers - 修饰词列表（用于降级过滤）
 * @returns {Promise<Array<object>>} 过滤后的商品列表
 */
async function searchAll(coreWord, blueOceanWord, modifiers = []) {
  const ak = process.env.ALI_1688_AK;
  if (!ak) {
    throw new Error('环境变量 ALI_1688_AK 未设置');
  }

  // 创建 1688 客户端
  const client = new Alibaba1688Client(ak);

  // 生成搜索查询列表（多查询组合）
  const rigidWords = modifiers.filter(m => m.rigidity === 'rigid').map(m => m.word);
  // 去重子串：避免核心词已包含的修饰词
  const dedupedRigids = rigidWords.filter(word => !coreWord.includes(word) && word !== coreWord);
  
  const queries = [coreWord]; // 第1个：核心词本身
  
  // 渐进组合：coreWord + rigid[0], coreWord + rigid[0] + rigid[1], ...（最多4个）
  let currentQuery = coreWord;
  for (let i = 0; i < dedupedRigids.length && queries.length < 4; i++) {
    currentQuery = dedupedRigids[i] + currentQuery; // rigid 前置！如 "猫咪" + "衣服" = "猫咪衣服"
    queries.push(currentQuery);
  }
  
  // 如果 blueOceanWord 不在 queries 中且还有位置，追加
  if (!queries.includes(blueOceanWord) && queries.length < 4) {
    queries.push(blueOceanWord);
  }
  
  // 对 queries 去重
  const uniqueQueries = [...new Set(queries)];

  // 合并并去重（根据 product.id 或 id 字段）
  const productMap = new Map();

  // 依次搜索每个查询并合并结果
  for (const query of uniqueQueries) {
    const products = await client.searchOffers(query);
    if (Array.isArray(products)) {
      for (const product of products) {
        const id = product.id || product.offerId || product.productId;
        if (id && !productMap.has(id)) {
          productMap.set(id, product);
        }
      }
    }
  }

  const mergedProducts = Array.from(productMap.values());

  // 如果没有商品，直接返回空数组
  if (mergedProducts.length === 0) {
    return [];
  }

  const rigidModifiers = modifiers
    .filter(m => m.rigidity === 'rigid')
    .map(m => m.word);

  try {
    const scoredResults = scoreLocally(
      mergedProducts,
      coreWord,
      blueOceanWord,
      rigidModifiers
    );

    const passedProducts = scoredResults
      .filter(r => r.passed)
      .map(r => r.product);

    return passedProducts;
  } catch (error) {
    console.warn('本地评分失败，降级到刚性修饰词过滤:', error.message);
    return filterRelevantProducts(mergedProducts, modifiers);
  }
}

module.exports = { searchAndFilter, filterRelevantProducts, searchAll };
