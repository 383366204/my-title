const { normalizeKeyword } = require('./seed-store');
const { getCategoryRule } = require('./category-rules');
const { rejectCandidate } = require('./reject-combinations');
const { mergeFacets } = require('./config-loader');

const DEFAULT_FACETS = {
  crowd: ['女', '男士', '儿童', '宝宝', '学生', '情侣', '宝妈', '上班族'],
  material: ['玛瑙', '朱砂', '纯银', '和田玉', '钛钢', '水晶', '珍珠', '陶瓷', '木质', '毛绒', '硅胶', '塑料', '不锈钢'],
  style: ['国风', '小众', '高级感', '复古', '简约', '可爱', 'ins风', '轻奢', '创意'],
  scene: ['送礼', '生日', '端午', '夏季', '通勤', '本命年', '转运', '办公室', '宿舍', '户外'],
  function: ['收纳', '耐咬', '防滑', '便携', '解闷', '磨牙', '装饰', '防尘', '训练', '益智'],
  price_band: ['平价', '性价比', '9块9', '低价', '白菜价', '高档', '轻奢'],
  pain_point: ['新手', '懒人', '租房党', '学生党', '宝妈', '上班族'],
  trend_word: ['2026新款', '爆款', '网红同款', 'ins风', '高级感', '氛围感', '无痕', '解压']
};
const FACETS = mergeFacets(DEFAULT_FACETS);

function hasAny(keyword, words) {
  return words.some(word => keyword.includes(word));
}

function uniqueByKeyword(candidates) {
  const seen = new Set();
  return candidates.filter(item => {
    if (seen.has(item.keyword)) return false;
    seen.add(item.keyword);
    return true;
  });
}

/**
 * Expand one seed into candidate keywords.
 * @param {object|string} seed Seed object or keyword string.
 * @param {object} [options] Options.
 * @param {number} [options.maxPerSeed=30] Max candidates per seed.
 * @returns {Array<object>} Candidate keywords.
 */
function expandSeed(seed, { maxPerSeed = 30 } = {}) {
  const seedKeyword = normalizeKeyword(typeof seed === 'string' ? seed : seed.keyword);
  if (!seedKeyword) return [];
  const category = typeof seed === 'object' ? (seed.category || '') : '';
  const rule = getCategoryRule(seedKeyword, category);

  const candidates = [];
  const add = (keyword, pattern) => {
    const normalized = normalizeKeyword(keyword);
    if (!normalized || normalized === seedKeyword) return;
    const reject = rejectCandidate(normalized);
    if (reject.rejected) return;
    candidates.push({
      keyword: normalized,
      seed: seedKeyword,
      category,
      pattern
    });
  };

  if (rule.patterns.includes('material+seed') && !hasAny(seedKeyword, rule.material)) {
    for (const material of rule.material) add(material + seedKeyword, 'material+seed');
  }
  if (rule.patterns.includes('seed+crowd') && !hasAny(seedKeyword, rule.crowd)) {
    for (const crowd of rule.crowd) add(seedKeyword + crowd, 'seed+crowd');
  }
  if (rule.patterns.includes('crowd+seed') && !hasAny(seedKeyword, rule.crowd)) {
    for (const crowd of rule.crowd) add(crowd + seedKeyword, 'crowd+seed');
  }
  if (rule.patterns.includes('style+seed') && !hasAny(seedKeyword, rule.style)) {
    for (const style of rule.style) add(style + seedKeyword, 'style+seed');
  }
  if (rule.patterns.includes('scene+seed') && !hasAny(seedKeyword, rule.scene)) {
    for (const scene of rule.scene) add(scene + seedKeyword, 'scene+seed');
  }
  if (rule.patterns.includes('function+seed') && !hasAny(seedKeyword, rule.function)) {
    for (const fn of rule.function) add(fn + seedKeyword, 'function+seed');
  }
  if (rule.patterns.includes('price+seed') && !hasAny(seedKeyword, rule.price_band)) {
    for (const price of rule.price_band) add(price + seedKeyword, 'price+seed');
  }
  if (rule.patterns.includes('pain+seed') && !hasAny(seedKeyword, rule.pain_point)) {
    for (const pain of rule.pain_point) add(pain + seedKeyword, 'pain+seed');
  }
  if (rule.patterns.includes('trend+seed') && !hasAny(seedKeyword, rule.trend_word)) {
    for (const trend of rule.trend_word) add(trend + seedKeyword, 'trend+seed');
  }

  // 三段式长尾词更接近真实搜索词，但要限量，避免组合爆炸。
  if (rule.patterns.includes('material+seed+crowd') && !hasAny(seedKeyword, rule.crowd) && !hasAny(seedKeyword, rule.material)) {
    for (const material of rule.material.slice(0, 6)) {
      for (const crowd of rule.crowd.slice(0, 4)) {
        add(material + seedKeyword + crowd, 'material+seed+crowd');
      }
    }
  }
  if (rule.patterns.includes('crowd+function+seed') && !hasAny(seedKeyword, rule.crowd)) {
    for (const crowd of rule.crowd.slice(0, 4)) {
      for (const fn of rule.function.slice(0, 5)) {
        add(crowd + fn + seedKeyword, 'crowd+function+seed');
      }
    }
  }

  return uniqueByKeyword(candidates).slice(0, maxPerSeed);
}

/**
 * Expand many seeds into candidate keywords.
 * @param {Array<object|string>} seeds Seeds.
 * @param {object} [options] Options.
 * @returns {Array<object>} Candidate keywords.
 */
function expandSeeds(seeds, options = {}) {
  const all = [];
  for (const seed of seeds || []) {
    all.push(...expandSeed(seed, options));
  }
  return uniqueByKeyword(all);
}

module.exports = { FACETS, DEFAULT_FACETS, expandSeed, expandSeeds };
