const { normalizeKeyword } = require('./seed-store');
const { getCategoryRule } = require('./category-rules');
const { rejectCandidate } = require('./reject-combinations');

const FACETS = {
  crowd: ['女', '男士', '儿童', '宝宝', '学生', '情侣', '妈妈', '老人'],
  material: ['玛瑙', '朱砂', '纯银', '和田玉', '钛钢', '水晶', '珍珠', '陶瓷', '木质', '毛绒', '硅胶', '塑料', '不锈钢'],
  style: ['国风', '小众', '高级感', '复古', '简约', '可爱', 'ins风', '轻奢'],
  scene: ['送礼', '生日', '端午', '夏季', '通勤', '本命年', '转运', '办公室', '宿舍'],
  function: ['收纳', '耐咬', '防滑', '便携', '解闷', '磨牙', '装饰', '防尘', '训练']
};

function unique(list) {
  return [...new Set(list.map(normalizeKeyword).filter(Boolean))];
}

function hasAny(keyword, words) {
  return words.some(word => keyword.includes(word));
}

/**
 * Expand one seed into candidate keywords.
 * @param {object|string} seed 种子对象或字符串
 * @param {object} [options] 选项
 * @param {number} [options.maxPerSeed=30] 每个种子最多候选数
 * @returns {Array<object>} 候选词
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
  if (rule.patterns.includes('scene+seed')) {
    for (const scene of rule.scene) add(scene + seedKeyword, 'scene+seed');
  }
  if (rule.patterns.includes('function+seed')) {
    for (const fn of rule.function) add(fn + seedKeyword, 'function+seed');
  }

  // 商品词更适合三段组合，控制数量，避免候选爆炸。
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

  const seen = new Set();
  return candidates
    .filter(item => {
      if (seen.has(item.keyword)) return false;
      seen.add(item.keyword);
      return true;
    })
    .slice(0, maxPerSeed);
}

/**
 * Expand many seeds into candidate keywords.
 * @param {Array<object|string>} seeds 种子列表
 * @param {object} [options] 选项
 * @returns {Array<object>} 候选词
 */
function expandSeeds(seeds, options = {}) {
  const all = [];
  for (const seed of seeds || []) {
    all.push(...expandSeed(seed, options));
  }
  const seen = new Set();
  return all.filter(item => {
    if (seen.has(item.keyword)) return false;
    seen.add(item.keyword);
    return true;
  });
}

module.exports = { FACETS, expandSeed, expandSeeds };
