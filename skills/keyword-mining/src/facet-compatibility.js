const { normalizeKeyword } = require('./seed-store');
const { normalizeSynonyms } = require('./config-loader');

const NATURALLY_PORTABLE_PRODUCTS = ['手机壳', '钥匙扣', '发夹', '头绳', '耳钉', '手绳', '吊坠'];
const GENERIC_FUNCTIONS = ['便携', '收纳', '实用', '装饰'];
const FUNCTION_SENSITIVE_PRODUCTS = ['礼盒', '包装', '灯笼', '情侣装'];
const EVENT_WORDS = ['中秋', '端午', '父亲节', '母亲节', '七夕', '春节', '圣诞', '开学'];
const CROWD_WORDS = ['情侣', '女', '男士', '儿童', '宝宝', '学生'];

function hasAny(value, words) {
  const normalized = normalizeSynonyms(normalizeKeyword(value));
  return (words || []).some(word => normalized.includes(normalizeSynonyms(word)));
}

function allow(reason = '') {
  return { allowed: true, reason, flags: [] };
}

function block(reason, flags = []) {
  return { allowed: false, reason, flags };
}

/**
 * Check whether a generated modifier can be attached to a seed.
 * @param {object} input Compatibility input.
 * @param {object} input.seedInfo Seed classification result.
 * @param {string} input.pattern Expansion pattern.
 * @param {string} input.modifier Modifier word being attached.
 * @param {string} input.keyword Full generated keyword.
 * @returns {{allowed:boolean,reason:string,flags:string[]}}
 */
function checkExpansionCompatibility({ seedInfo, pattern, modifier, keyword }) {
  const role = seedInfo && seedInfo.role ? seedInfo.role : 'unknown';
  const coreProduct = seedInfo && seedInfo.coreProduct ? seedInfo.coreProduct : '';
  const seedKeyword = seedInfo && seedInfo.keyword ? seedInfo.keyword : '';
  const normalizedModifier = normalizeSynonyms(normalizeKeyword(modifier));

  if (role === 'empty') return block('种子词为空', ['empty_seed']);

  if ((role === 'abstract' || role === 'unknown') && pattern !== 'direct-seed') {
    return block(`${seedInfo.reason}，跳过机械扩展`, [`${role}_seed`]);
  }

  if (role === 'event' && pattern !== 'direct-seed') {
    return block('节日场景词需先补具体商品，跳过机械扩展', ['event_seed']);
  }

  if (pattern === 'scene+seed' && (hasAny(seedKeyword, EVENT_WORDS) || hasAny(modifier, EVENT_WORDS))) {
    return block('已包含节日场景，不再前置场景词', ['duplicate_event_scene']);
  }

  if (pattern === 'scene+seed' && role === 'qualified_product' && hasAny(normalizedModifier, ['送礼', '生日', '通勤', '夏季'])) {
    return block('大场景词不适合直接前置已修饰商品词', ['awkward_scene_prefix']);
  }

  if ((pattern === 'seed+crowd' || pattern === 'crowd+seed') && hasAny(seedKeyword, CROWD_WORDS)) {
    return block('种子词已包含人群，不再追加人群词', ['duplicate_crowd']);
  }

  if ((pattern === 'seed+crowd' || pattern === 'crowd+seed') && hasAny(seedKeyword, FUNCTION_SENSITIVE_PRODUCTS)) {
    return block('礼盒节日类商品不直接追加泛人群词', ['crowd_sensitive_product']);
  }

  if (pattern === 'pain+seed' && (role === 'qualified_product' || hasAny(seedKeyword, FUNCTION_SENSITIVE_PRODUCTS) || hasAny(seedKeyword, EVENT_WORDS))) {
    return block('痛点人群词不直接前置已修饰或节日商品词', ['pain_qualified_seed']);
  }

  if (pattern === 'trend+seed' && hasAny(seedKeyword, EVENT_WORDS)) {
    return block('趋势词不直接前置节日商品词', ['trend_event_seed']);
  }

  if (pattern === 'function+seed' && hasAny(coreProduct, NATURALLY_PORTABLE_PRODUCTS) && hasAny(normalizedModifier, GENERIC_FUNCTIONS)) {
    return block('天然小件商品不前置通用功能词', ['generic_function']);
  }

  if (pattern === 'function+seed' && (hasAny(seedKeyword, FUNCTION_SENSITIVE_PRODUCTS) || /[春夏秋冬]$/.test(seedKeyword)) && hasAny(normalizedModifier, GENERIC_FUNCTIONS)) {
    return block('礼盒节日或季节商品不前置通用功能词', ['generic_function_sensitive_product']);
  }

  if (pattern === 'function+seed' && hasAny(seedKeyword, ['好物', '礼物', '神器'])) {
    return block('泛场景词不适合直接拼接功能词', ['function_abstract_seed']);
  }

  if (keyword && seedKeyword && keyword.length - seedKeyword.length > 6 && pattern !== 'material+seed+crowd') {
    return block('修饰词过长，疑似机械拼接', ['modifier_too_long']);
  }

  return allow('兼容');
}

module.exports = {
  checkExpansionCompatibility,
  NATURALLY_PORTABLE_PRODUCTS,
  GENERIC_FUNCTIONS
};
