const { normalizeKeyword } = require('./seed-store');
const { FACETS } = require('./expand-keywords');
const { normalizeSynonyms, mergeFacets } = require('./config-loader');
const { BASE_PRODUCT_WORDS, findProductWord } = require('./product-words');

const OPTIONAL_FACETS = new Set(['style', 'scene', 'price_band', 'pain_point', 'trend_word']);
const RIGID_FACETS = new Set(['material', 'crowd', 'function']);
const STOP_WORDS = ['新款', '爆款', '网红', '同款', '高级感', '氛围感', '创意'];

function uniqueSorted(words) {
  return [...new Set(words.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function findFacetWords(keyword, facetNames, options = {}) {
  const facets = mergeFacets(FACETS, options);
  const words = [];
  for (const name of facetNames) {
    for (const word of facets[name] || []) {
      const normalized = normalizeSynonyms(word, options);
      if (keyword.includes(normalized)) words.push(normalized);
    }
  }
  return uniqueSorted(words);
}

function findCoreProduct(keyword, options = {}) {
  return findProductWord(keyword, options);
}

function residualTokens(keyword, knownWords) {
  let rest = keyword;
  for (const word of uniqueSorted(knownWords).sort((a, b) => b.length - a.length)) {
    rest = rest.split(word).join(' ');
  }
  for (const word of STOP_WORDS) {
    rest = rest.split(word).join(' ');
  }
  return uniqueSorted((rest.match(/[\u4e00-\u9fa5]{2,}/g) || []).filter(word => word.length <= 4));
}

/**
 * Build a stable direction signature for near-duplicate keyword removal.
 * @param {string} keyword Candidate keyword.
 * @returns {{keyword:string,coreProduct:string,rigid:string[],optional:string[],residual:string[],signature:string,productSignature:string}}
 */
function keywordSignature(keyword, options = {}) {
  const normalized = normalizeSynonyms(normalizeKeyword(keyword), options);
  const coreProduct = findCoreProduct(normalized, options);
  const rigid = findFacetWords(normalized, [...RIGID_FACETS], options);
  const optional = findFacetWords(normalized, [...OPTIONAL_FACETS], options);
  const residual = residualTokens(normalized, [coreProduct, ...rigid, ...optional]);
  const signatureParts = [
    coreProduct || normalized,
    ...rigid,
    ...residual.slice(0, coreProduct ? 2 : 3)
  ];
  return {
    keyword: normalized,
    coreProduct,
    rigid,
    optional,
    residual,
    signature: uniqueSorted(signatureParts).join('|'),
    productSignature: coreProduct || normalized
  };
}

module.exports = {
  PRODUCT_WORDS: BASE_PRODUCT_WORDS,
  keywordSignature,
  findCoreProduct
};
