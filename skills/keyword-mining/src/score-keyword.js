const { checkBannedWords } = require('../../../core/banned-words');
const { normalizeKeyword } = require('./seed-store');
const { FACETS } = require('./expand-keywords');
const { rejectCandidate } = require('./reject-combinations');

const PRODUCT_WORDS = ['戒指', '项链', '手链', '耳环', '发夹', '头绳', '玩具', '逗猫棒', '手机壳', '挂绳', '钥匙扣', '收纳盒', '置物架', '香包', '小夜灯', '手绳'];
const TOO_BROAD = ['女', '男', '儿童', '新款', '饰品', '用品', '家居', '玩具'];

function includesAny(keyword, words) {
  return words.some(word => keyword.includes(word));
}

/**
 * Locally score a candidate keyword before SYCM verification.
 * @param {string|object} candidate 候选词或候选对象
 * @returns {{keyword:string, localScore:number, reason:string, nextAction:string, flags:string[]}}
 */
function scoreKeyword(candidate) {
  const keyword = normalizeKeyword(typeof candidate === 'string' ? candidate : candidate.keyword);
  const flags = [];
  let score = 30;

  if (!keyword) {
    return { keyword: '', localScore: 0, reason: '关键词为空', nextAction: 'reject', flags: ['empty'] };
  }

  const banned = checkBannedWords(keyword);
  if (!banned.valid) {
    return {
      keyword,
      localScore: 0,
      reason: `包含违禁词 ${banned.words.join(',')}`,
      nextAction: 'reject',
      flags: ['banned']
    };
  }

  const rejected = rejectCandidate(keyword);
  if (rejected.rejected) {
    return {
      keyword,
      localScore: 0,
      reason: rejected.reason,
      nextAction: 'reject',
      flags: ['rejected_combination']
    };
  }

  if (keyword.length >= 3 && keyword.length <= 8) score += 15;
  else if (keyword.length > 8) {
    score += 4;
    flags.push('偏长');
  } else {
    flags.push('偏短');
  }

  if (includesAny(keyword, PRODUCT_WORDS)) {
    score += 20;
    flags.push('商品形态明确');
  } else {
    score -= 15;
    flags.push('商品形态不明确');
  }

  if (includesAny(keyword, FACETS.material)) {
    score += 12;
    flags.push('材质明确');
  }
  if (includesAny(keyword, FACETS.crowd)) {
    score += 10;
    flags.push('人群明确');
  }
  if (includesAny(keyword, FACETS.scene)) {
    score += 8;
    flags.push('场景明确');
  }
  if (includesAny(keyword, FACETS.style)) {
    score += 6;
    flags.push('风格明确');
  }
  if (includesAny(keyword, FACETS.function)) {
    score += 8;
    flags.push('功能明确');
  }

  if (TOO_BROAD.includes(keyword)) {
    score -= 30;
    flags.push('过宽');
  }

  const localScore = Math.max(0, Math.min(100, score));
  const reason = buildReason(flags);
  return {
    keyword,
    localScore,
    reason,
    nextAction: localScore >= 65 ? 'sycm_verify' : 'observe',
    flags
  };
}

function buildReason(flags) {
  const hasMaterial = flags.includes('材质明确');
  const hasCrowd = flags.includes('人群明确');
  const hasScene = flags.includes('场景明确');
  const hasFunction = flags.includes('功能明确');
  const hasProduct = flags.includes('商品形态明确');
  if (hasMaterial && hasProduct && hasCrowd) return '材质+商品词+人群组合，适合先查生意参谋搜索人气和在线商品数';
  if (hasFunction && hasProduct) return '功能需求+商品词组合，适合验证需求供给比';
  if (hasScene && hasProduct) return '场景+商品词组合，适合验证季节或礼品需求';
  if (hasProduct) return '商品形态明确，可作为观察候选';
  return flags.length > 0 ? flags.join(' ') : '基础候选词';
}

module.exports = { scoreKeyword };
