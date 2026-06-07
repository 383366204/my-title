const { checkBannedWords } = require('../../../core/banned-words');
const { normalizeKeyword } = require('./seed-store');
const { FACETS } = require('./expand-keywords');
const { rejectCandidate } = require('./reject-combinations');
const { PRODUCT_WORDS, keywordSignature } = require('./keyword-signature');

const TOO_BROAD = ['女', '男', '儿童', '新款', '饰品', '用品', '家居', '玩具', '礼物'];

function includesAny(keyword, words) {
  return words.some(word => keyword.includes(word));
}

function scoreFacet(keyword, words, points, flag, flags) {
  if (!includesAny(keyword, words)) return 0;
  flags.push(flag);
  return points;
}

function classifyKeyword(localScore) {
  if (localScore >= 78) return 'high';
  if (localScore >= 62) return 'mid';
  return 'low';
}

function nextActionFor(localScore) {
  if (localScore >= 62) return 'sycm_verify';
  return 'observe';
}

function patternAdjustment(pattern) {
  if (pattern === 'pain+seed') return -12;
  if (pattern === 'price+seed') return -6;
  if (pattern === 'style+seed') return -7;
  if (pattern === 'trend+seed') return -5;
  if (pattern === 'material+seed+crowd') return -18;
  if (pattern === 'crowd+function+seed') return -4;
  if (pattern === 'scene+seed') return 4;
  if (pattern === 'function+seed') return 3;
  if (pattern === 'direct-seed') return 6;
  return 0;
}

/**
 * Locally score a candidate keyword before SYCM verification.
 * @param {string|object} candidate Candidate word or object.
 * @returns {{keyword:string, localScore:number, tier:string, reason:string, nextAction:string, flags:string[], coreProduct:string, signature:string, productSignature:string}}
 */
function scoreKeyword(candidate) {
  const keyword = normalizeKeyword(typeof candidate === 'string' ? candidate : candidate.keyword);
  const pattern = typeof candidate === 'object' ? candidate.pattern : '';
  const flags = [];
  let score = 30;

  if (!keyword) {
    return { keyword: '', localScore: 0, tier: 'reject', reason: '关键词为空', nextAction: 'reject', flags: ['empty'] };
  }

  const banned = checkBannedWords(keyword);
  if (!banned.valid) {
    return {
      keyword,
      localScore: 0,
      tier: 'reject',
      reason: `包含违禁词: ${banned.words.join(',')}`,
      nextAction: 'reject',
      flags: ['banned']
    };
  }

  const rejected = rejectCandidate(keyword);
  if (rejected.rejected) {
    return {
      keyword,
      localScore: 0,
      tier: 'reject',
      reason: rejected.reason,
      nextAction: 'reject',
      flags: ['rejected_combination']
    };
  }

  if (keyword.length >= 3 && keyword.length <= 9) score += 16;
  else if (keyword.length > 9 && keyword.length <= 14) {
    score += 8;
    flags.push('长尾明确');
  } else if (keyword.length > 14) {
    score -= 5;
    flags.push('过长');
  } else {
    score -= 8;
    flags.push('偏短');
  }

  if (includesAny(keyword, PRODUCT_WORDS)) {
    score += 22;
    flags.push('商品形态明确');
  } else {
    score -= 16;
    flags.push('商品形态不明确');
  }

  score += scoreFacet(keyword, FACETS.material, 12, '材质明确', flags);
  score += scoreFacet(keyword, FACETS.crowd, 10, '人群明确', flags);
  score += scoreFacet(keyword, FACETS.scene, 8, '场景明确', flags);
  score += scoreFacet(keyword, FACETS.style, 6, '风格明确', flags);
  score += scoreFacet(keyword, FACETS.function, 9, '功能明确', flags);
  score += scoreFacet(keyword, FACETS.price_band, 5, '价格带明确', flags);
  score += scoreFacet(keyword, FACETS.pain_point, 4, '痛点明确', flags);
  score += scoreFacet(keyword, FACETS.trend_word, 6, '趋势词明确', flags);
  score += patternAdjustment(pattern);

  if (TOO_BROAD.includes(keyword)) {
    score -= 35;
    flags.push('过宽');
  }
  if (flags.includes('商品形态明确') && flags.length >= 3) score += 4;

  const localScore = Math.max(0, Math.min(100, score));
  const tier = classifyKeyword(localScore);
  const sig = keywordSignature(keyword);
  return {
    keyword,
    localScore,
    tier,
    reason: buildReason(flags),
    nextAction: nextActionFor(localScore),
    flags,
    coreProduct: sig.coreProduct,
    signature: sig.signature,
    productSignature: sig.productSignature,
    rigid: sig.rigid,
    optional: sig.optional
  };
}

function buildReason(flags) {
  const hasMaterial = flags.includes('材质明确');
  const hasCrowd = flags.includes('人群明确');
  const hasScene = flags.includes('场景明确');
  const hasFunction = flags.includes('功能明确');
  const hasProduct = flags.includes('商品形态明确');
  const hasPrice = flags.includes('价格带明确');
  const hasPain = flags.includes('痛点明确');
  const hasTrend = flags.includes('趋势词明确');
  if (hasMaterial && hasProduct && hasCrowd) return '材质+商品词+人群组合，适合优先生意参谋验证';
  if (hasPain && hasProduct) return '痛点+商品词组合，可能转化更强，建议优先验证';
  if (hasTrend && hasProduct) return '趋势词+商品词组合，适合验证搜索趋势';
  if (hasPrice && hasProduct) return '价格带+商品词组合，适合验证低价或轻奢供需';
  if (hasFunction && hasProduct) return '功能需求+商品词组合，适合验证需求供给比';
  if (hasScene && hasProduct) return '场景+商品词组合，适合验证季节或礼品需求';
  if (hasProduct) return '商品形态明确，可作为观察候选';
  return flags.length > 0 ? flags.join(' ') : '基础候选词';
}

module.exports = { scoreKeyword, classifyKeyword };
