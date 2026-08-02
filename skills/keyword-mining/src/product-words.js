const { configuredProductWords, normalizeSynonyms } = require('./config-loader');

// 商品词只在这里维护，分类、签名和词根提取必须使用同一份目录。
const BASE_PRODUCT_WORDS = [
  '月饼包装盒', '床帘蚊帐', '厨房置物架', '防晒面罩', '儿童益智玩具',
  '宠物玩具', '儿童玩具', '水枪玩具', '狗狗玩具', '情侣装',
  '汽车冰垫', '办公室冰垫', '挂脖风扇', '手持小风扇', '婴儿凉席',
  '气垫梳', '干发帽', '化妆镜', '封口夹', '调料盒',
  '雨衣', '防水鞋套', '除湿袋', '门缝密封条', '书包', '笔袋', '文具盒',
  '收纳袋', '洗漱包', '行李牌', '折叠凳', '握力器', '保鲜盒',
  '浴室置物架', '洗脸巾', '耳塞', '桌面收纳盒', '台灯', '花盆',
  '逗猫棒', '手机挂绳', '车载收纳', '儿童发饰', '驱蚊手环',
  '多肉盆栽', '喜糖盒', '肥皂盒', '睫毛夹', '修正带',
  '瑜伽垫', '瑜伽球', '弹力带', '泡沫轴', '遮阳帽',
  '收纳盒', '置物架', '手机壳', '钥匙扣', '小夜灯', '床帘', '蚊帐',
  '小风扇', '冰垫', '凉席', '雨伞', '冰袖',
  '防晒面罩', '飞盘', '水枪', '香囊', '香包', '五彩绳',
  '戒指', '项链', '手链', '手绳', '耳环', '耳钉', '吊坠',
  '发夹', '头绳', '挂绳', '发饰', '灯笼'
];

const PRODUCT_FAMILIES = {
  '床帘蚊帐': '床帘',
  '汽车冰垫': '冰垫',
  '办公室冰垫': '冰垫',
  '手持小风扇': '小风扇',
  '挂脖风扇': '小风扇'
};

/**
 * Return the canonical product-word directory.
 * @param {object} [options] Keyword config options.
 * @returns {string[]} Product words ordered longest first.
 */
function productWords(options = {}) {
  return [...new Set(configuredProductWords(BASE_PRODUCT_WORDS, { ...options, maxSeeds: 0 })
    .map(word => normalizeSynonyms(word, options))
    .filter(Boolean))]
    .sort((a, b) => b.length - a.length);
}

/**
 * Find the most specific product contained in a keyword.
 * @param {string} keyword Normalized keyword.
 * @param {object} [options] Keyword config options.
 * @returns {string} Canonical product word.
 */
function findProductWord(keyword, options = {}) {
  const value = String(keyword || '');
  return productWords(options).find(word => value.includes(word)) || '';
}

/**
 * Collapse product variants into a stable seed family for semantic dedupe.
 * @param {string} coreProduct Recognized product word.
 * @param {object} [options] Keyword config options.
 * @returns {string} Canonical family key.
 */
function productFamily(coreProduct, options = {}) {
  const normalized = normalizeSynonyms(coreProduct, options);
  const normalizedFamilies = Object.entries(PRODUCT_FAMILIES).reduce((families, [variant, family]) => {
    families[normalizeSynonyms(variant, options)] = normalizeSynonyms(family, options);
    return families;
  }, {});
  return normalizedFamilies[normalized] || normalized;
}

module.exports = { BASE_PRODUCT_WORDS, PRODUCT_FAMILIES, productWords, findProductWord, productFamily };
