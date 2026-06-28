const { normalizeKeyword } = require('./seed-store');
const { configuredProductWords, mergeFacets, normalizeSynonyms } = require('./config-loader');

const DEFAULT_PRODUCT_WORDS = [
  '手机壳', '灯笼', '收纳盒', '置物架', '钥匙扣', '小夜灯',
  '戒指', '项链', '手链', '手绳', '耳环', '耳钉', '吊坠', '发夹', '头绳',
  '玩具', '香包', '水枪', '飞盘', '冰袖', '弹力带', '防晒面罩', '泡沫轴', '瑜伽垫',
  '雨伞', '遮阳帽'
];

const DEFAULT_FACETS = {
  crowd: ['女', '男士', '儿童', '宝宝', '学生', '情侣', '宝妈', '上班族', '租房党', '学生党'],
  material: ['玛瑙', '朱砂', '纯银', '和田玉', '钛钢', '水晶', '珍珠', '陶瓷', '木质', '毛绒', '硅胶', '塑料', '不锈钢'],
  style: ['国风', '小众', '高级感', '复古', '简约', '可爱', 'ins风', '轻奢', '创意'],
  scene: ['送礼', '生日', '端午', '中秋', '开学', '夏季', '通勤', '本命年', '转运', '办公室', '宿舍', '户外'],
  function: ['收纳', '耐咬', '防滑', '便携', '解闷', '磨牙', '装饰', '防尘', '训练', '益智'],
  price_band: ['平价', '性价比', '9块9', '低价', '白菜价', '高档', '轻奢'],
  pain_point: ['新手', '懒人', '租房党', '学生党', '宝妈', '上班族'],
  trend_word: ['2026新款', '爆款', '网红同款', 'ins风', '高级感', '氛围感', '无痕', '解压']
};

const ABSTRACT_MARKERS = ['好物', '礼物', '神器', '用品', '百货', '小物', '周边'];
const EVENT_MARKERS = ['中秋', '端午', '父亲节', '母亲节', '七夕', '开学', '春节', '圣诞', '万圣节'];
const FACET_NAMES = Object.keys(DEFAULT_FACETS);

function includesAny(keyword, words) {
  return (words || []).some(word => keyword.includes(normalizeSynonyms(word)));
}

function findCoreProduct(keyword, options = {}) {
  return configuredProductWords(DEFAULT_PRODUCT_WORDS, { ...options, maxSeeds: 0 })
    .find(word => keyword.includes(normalizeSynonyms(word))) || '';
}

function findFacetHits(keyword, options = {}) {
  const facets = mergeFacets(DEFAULT_FACETS, options);
  const hits = {};
  for (const name of FACET_NAMES) {
    hits[name] = (facets[name] || []).filter(word => keyword.includes(normalizeSynonyms(word)));
  }
  return hits;
}

function flattenFacetHits(facetHits) {
  return Object.values(facetHits).flat().filter(Boolean);
}

/**
 * Classify a seed keyword before expansion.
 * @param {object|string} seed Seed object or keyword string.
 * @param {object} [options] Options.
 * @returns {{keyword:string,category:string,role:string,coreProduct:string,facetHits:object,facetWords:string[],reason:string}}
 */
function classifySeed(seed, options = {}) {
  const keyword = normalizeSynonyms(normalizeKeyword(typeof seed === 'string' ? seed : seed.keyword), options);
  const category = typeof seed === 'object' ? (seed.category || '') : '';
  const facetHits = findFacetHits(keyword, options);
  const facetWords = flattenFacetHits(facetHits);
  const hasAbstractMarker = includesAny(keyword, ABSTRACT_MARKERS);
  const hasEventMarker = includesAny(`${category}${keyword}`, EVENT_MARKERS);
  const coreProduct = hasAbstractMarker ? '' : findCoreProduct(keyword, options);

  if (!keyword) {
    return { keyword: '', category, role: 'empty', coreProduct: '', facetHits, facetWords: [], reason: '关键词为空' };
  }

  if (hasAbstractMarker) {
    return { keyword, category, role: 'abstract', coreProduct, facetHits, facetWords, reason: '泛场景词，不能直接当商品词扩展' };
  }

  if (!coreProduct && hasEventMarker) {
    return { keyword, category, role: 'event', coreProduct, facetHits, facetWords, reason: '节日或时令场景词，需先落到具体商品' };
  }

  if (!coreProduct) {
    return { keyword, category, role: 'unknown', coreProduct, facetHits, facetWords, reason: '未识别到具体商品形态' };
  }

  const bareProduct = keyword === coreProduct;
  if (!bareProduct || facetWords.length > 0 || hasEventMarker) {
    return { keyword, category, role: 'qualified_product', coreProduct, facetHits, facetWords, reason: '已带修饰或场景的商品词' };
  }

  return { keyword, category, role: 'product', coreProduct, facetHits, facetWords, reason: '具体商品词' };
}

module.exports = { classifySeed, DEFAULT_PRODUCT_WORDS, DEFAULT_FACETS };
