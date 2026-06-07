const Alibaba1688Client = require('./client');
const { scoreLocally } = require('./score-local');
const { searchWeb1688 } = require('./search-web-1688');

/**
 * Build progressive 1688 search queries from core word and rigid modifiers.
 * @param {string} coreWord - Core product word.
 * @param {string} blueOceanWord - Blue-ocean keyword.
 * @param {Array<{word: string, rigidity: 'rigid'|'optional'}>} modifiers - Modifiers.
 * @returns {string[]} Unique search queries.
 */
function buildSearchQueries(coreWord, blueOceanWord, modifiers = []) {
  const rigidWords = modifiers
    .filter(m => m && m.rigidity === 'rigid')
    .map(m => m.word)
    .filter(Boolean);
  const dedupedRigids = rigidWords.filter(word => !coreWord.includes(word) && word !== coreWord);

  const queries = [coreWord];
  let currentQuery = coreWord;
  for (let i = 0; i < dedupedRigids.length && queries.length < 4; i++) {
    currentQuery = currentQuery + dedupedRigids[i];
    queries.push(currentQuery);
  }
  if (blueOceanWord && !queries.includes(blueOceanWord) && queries.length < 4) {
    queries.push(blueOceanWord);
  }
  return [...new Set(queries.filter(Boolean))];
}

/**
 * Merge products by stable id/url.
 * @param {Array<Array<object>>} productLists - Product arrays.
 * @returns {Array<object>} Deduped products.
 */
function mergeProducts(productLists) {
  const productMap = new Map();
  for (const products of productLists) {
    if (!Array.isArray(products)) continue;
    for (const product of products) {
      const id = product.id || product.offerId || product.productId || product.url || product.redirectUrl;
      if (id && !productMap.has(id)) {
        productMap.set(id, product);
      }
    }
  }
  return Array.from(productMap.values());
}

/**
 * Filter products by rigid modifiers.
 * @param {Array<object>} products - Product list.
 * @param {Array<{word: string, rigidity: 'rigid'|'optional'}>} modifiers - Modifiers.
 * @param {Object} [semanticGroups={}] - Synonym groups.
 * @returns {Array<object>} Filtered product list.
 */
function filterRelevantProducts(products, modifiers, semanticGroups = {}) {
  const rigidModifiers = (modifiers || [])
    .filter(m => m && m.rigidity === 'rigid')
    .map(m => String(m.word || '').toLowerCase())
    .filter(Boolean);

  if (rigidModifiers.length === 0) {
    return products;
  }

  return products.filter(product => {
    const title = (product.subject || product.title || '').toLowerCase();
    const description = (product.description || '').toLowerCase();
    const combinedText = `${title} ${description}`;

    return rigidModifiers.every(word => {
      if (combinedText.includes(word)) return true;
      let group = semanticGroups[word] || semanticGroups[word.toLowerCase()];
      if (!group) {
        for (const g of Object.values(semanticGroups)) {
          if (Array.isArray(g) && g.some(s => s === word || s === word.toLowerCase())) {
            group = g;
            break;
          }
        }
      }
      return !!(group && group.some(synonym => combinedText.includes(String(synonym).toLowerCase())));
    });
  });
}

async function searchApiProducts(queries) {
  const ak = process.env.ALI_1688_AK;
  if (!ak) {
    throw new Error('环境变量 ALI_1688_AK 未设置');
  }
  const client = new Alibaba1688Client(ak);
  const searchResults = await Promise.all(
    queries.map(query => client.searchOffers(query))
  );
  return mergeProducts(searchResults);
}

async function searchWebProducts(queries, options = {}) {
  const webQueries = Array.isArray(options.webQueries) && options.webQueries.length
    ? options.webQueries
    : queries.slice(0, Number(options.webQueryLimit || 1));
  const results = [];
  for (const query of webQueries) {
    const result = await searchWeb1688(Object.assign({}, options.webFilters || {}, {
      keyword: query,
      port: options.port || options.webPort || options.cdpPort,
      maxProducts: options.maxProducts || options.webMaxProducts,
      maxPages: options.maxPages || options.webMaxPages,
      maxResolveLinks: options.maxResolveLinks,
      scrollLoad: options.scrollLoad,
      scrollSteps: options.scrollSteps,
      scrollWaitMs: options.scrollWaitMs,
      scrollStableRounds: options.scrollStableRounds,
      waitMs: options.waitMs,
      resolveTimeoutMs: options.resolveTimeoutMs
    }));
    if (result && Array.isArray(result.products)) {
      results.push(result.products);
    }
  }
  return mergeProducts(results);
}

function scoreOrFilterProducts(products, coreWord, blueOceanWord, modifiers, semanticGroups) {
  const rigidModifiers = (modifiers || [])
    .filter(m => m && m.rigidity === 'rigid')
    .map(m => m.word);

  try {
    const scoredResults = scoreLocally(
      products,
      coreWord,
      blueOceanWord,
      rigidModifiers,
      semanticGroups
    );

    return scoredResults
      .filter(r => r.passed)
      .map(r => r.product);
  } catch (error) {
    console.warn('本地评分失败，降级到刚性修饰词过滤:', error.message);
    return filterRelevantProducts(products, modifiers, semanticGroups);
  }
}

/**
 * Search 1688 products and apply local relevance scoring.
 * Default mode is API-only to keep existing title-generation behavior unchanged.
 * @param {string} coreWord - Core product word.
 * @param {string} blueOceanWord - Blue-ocean keyword.
 * @param {Array<{word: string, rigidity: 'rigid'|'optional'}>} modifiers - Modifiers.
 * @param {Object} [semanticGroups={}] - Synonym groups.
 * @param {Object} [options={}] - Search options.
 * @param {'api'|'web'|'hybrid'} [options.mode='api'] - Search mode.
 * @returns {Promise<Array<object>>} Filtered products.
 */
async function searchAll(coreWord, blueOceanWord, modifiers = [], semanticGroups = {}, options = {}) {
  const mode = options.mode || 'api';
  const queries = buildSearchQueries(coreWord, blueOceanWord, modifiers);
  const resultLists = [];

  if (mode === 'api' || mode === 'hybrid') {
    try {
      resultLists.push(await searchApiProducts(queries));
    } catch (error) {
      if (mode === 'api') throw error;
      console.warn('1688 API search failed, fallback to web search:', error.message);
    }
  }

  if (mode === 'web' || mode === 'hybrid') {
    resultLists.push(await searchWebProducts(queries, options));
  }

  const mergedProducts = mergeProducts(resultLists);
  if (mergedProducts.length === 0) {
    return [];
  }
  return scoreOrFilterProducts(mergedProducts, coreWord, blueOceanWord, modifiers, semanticGroups);
}

/**
 * Backward-compatible direct filter helper.
 * @param {Array<object>} products - Products to filter.
 * @param {Array<{word: string, rigidity: 'rigid'|'optional'}>} modifiers - Modifiers.
 * @returns {Array<object>} Filtered products.
 */
function searchAndFilter(products, modifiers) {
  return filterRelevantProducts(products, modifiers || []);
}

module.exports = {
  searchAll,
  searchAndFilter,
  filterRelevantProducts,
  buildSearchQueries,
  mergeProducts
};
