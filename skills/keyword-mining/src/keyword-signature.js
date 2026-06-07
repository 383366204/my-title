const { normalizeKeyword } = require('./seed-store');
const { FACETS } = require('./expand-keywords');

const PRODUCT_WORDS = [
  '狗咬胶', '逗猫棒', '收纳盒', '置物架', '喜糖盒', '多肉盆栽', '肥皂盒',
  '睫毛夹', '手机壳', '钥匙扣', '小夜灯', '修正带',
  '戒指', '项链', '手链', '手绳', '耳环', '耳钉', '发夹', '头绳',
  '玩具', '挂绳', '香包', '水枪', '飞盘', '冰袖'
].sort((a, b) => b.length - a.length);

const OPTIONAL_FACETS = new Set(['style', 'scene', 'price_band', 'pain_point', 'trend_word']);
const RIGID_FACETS = new Set(['material', 'crowd', 'function']);
const STOP_WORDS = ['新款', '爆款', '网红', '同款', '高级感', '氛围感', '创意'];

function uniqueSorted(words) {
  return [...new Set(words.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function findFacetWords(keyword, facetNames) {
  const words = [];
  for (const name of facetNames) {
    for (const word of FACETS[name] || []) {
      if (keyword.includes(word)) words.push(word);
    }
  }
  return uniqueSorted(words);
}

function findCoreProduct(keyword) {
  return PRODUCT_WORDS.find(word => keyword.includes(word)) || '';
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
function keywordSignature(keyword) {
  const normalized = normalizeKeyword(keyword);
  const coreProduct = findCoreProduct(normalized);
  const rigid = findFacetWords(normalized, [...RIGID_FACETS]);
  const optional = findFacetWords(normalized, [...OPTIONAL_FACETS]);
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
  PRODUCT_WORDS,
  keywordSignature
};
