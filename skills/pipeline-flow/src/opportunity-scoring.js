const { checkBannedWords } = require('../../../core/banned-words');

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function parseMetricNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value || '').replace(/,/g, '');
  if (/万/.test(text)) {
    const match = text.match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) * 10000 : 0;
  }
  const matches = text.match(/-?\d+(?:\.\d+)?/g);
  if (!matches) return 0;
  const nums = matches.map(Number).filter(Number.isFinite);
  return nums.length ? Math.max(...nums) : 0;
}

function firstValue(object, keys) {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null && object[key] !== '') {
      return object[key];
    }
  }
  return '';
}

function getProductTitle(product = {}) {
  return String(firstValue(product, [
    '铺货标题',
    '链接原标题',
    'title',
    'subject',
    'name',
    'generatedTitle',
    '导购标题',
    '閾鸿揣鏍囬',
    '浜у搧鏍囬'
  ]) || '');
}

function getProductUrl(product = {}) {
  return String(firstValue(product, [
    '产品链接',
    'url',
    'link',
    'productUrl',
    'detailUrl',
    'redirectUrl',
    '浜у搧閾炬帴'
  ]) || '');
}

function getProductPrice(product = {}) {
  return parseMetricNumber(firstValue(product, [
    '商品原价',
    'price',
    'priceMin',
    'minPrice',
    'salePrice',
    '商品价格'
  ]));
}

function getProductSales(product = {}) {
  const stats = product.stats || {};
  return parseMetricNumber(firstValue(product, [
    '30天销量',
    'sales30days',
    'last30DaysSales',
    'monthlySales',
    'sales',
    '销量'
  ]) || firstValue(stats, [
    'last30DaysSales',
    'last30DaysDropShippingSales',
    'totalSales',
    'totalOrder'
  ]));
}

function confidenceBonus(confidence) {
  if (confidence === 'high') return 10;
  if (confidence === 'medium') return 5;
  if (confidence === 'trend') return 0;
  return 0;
}

function usageBonus(usage) {
  if (usage === 'title_core') return 8;
  if (usage === 'title_optional') return 3;
  if (usage === 'trend_reference') return -3;
  return 0;
}

function keywordDecision(score, sycmScore) {
  if (sycmScore && sycmScore.passed && sycmScore.mode === 'hot') {
    if (score >= 55) return { decision: 'continue', nextAction: 'search_1688' };
    if (score >= 45) return { decision: 'observe', nextAction: 'manual_review' };
    return { decision: 'reject', nextAction: 'stop' };
  }
  if (score >= 72 && (!sycmScore || sycmScore.passed !== false)) {
    return { decision: 'continue', nextAction: 'search_1688' };
  }
  if (score >= 55) return { decision: 'observe', nextAction: 'manual_review' };
  return { decision: 'reject', nextAction: 'stop' };
}

function pushScoreTerm(list, key, label, value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return;
  list.push({
    key,
    label,
    value: Math.round(numeric * 10) / 10
  });
}

/**
 * Score a keyword opportunity after local mining and optional SYCM verification.
 * @param {object} row Keyword row.
 * @returns {{score:number,decision:string,nextAction:string,reasons:string[],riskFlags:string[],breakdown:object}}
 */
function scoreKeywordOpportunity(row = {}) {
  const keyword = String(row.keyword || '').trim();
  const sycmScore = row.sycmScore || {};
  const reasons = [];
  const riskFlags = [];
  const positive = [];
  const negative = [];
  let score = 0;

  const localScore = clamp(row.localScore || row.score || 0);
  const localContribution = localScore * 0.35;
  score += localContribution;
  pushScoreTerm(positive, 'local_score', '本地挖词质量', localContribution);
  if (localScore >= 75) reasons.push('local_high_intent');
  else if (localScore < 55) riskFlags.push('local_weak');

  if (sycmScore && Object.keys(sycmScore).length) {
    const marketScore = clamp(sycmScore.score || 0);
    const marketContribution = marketScore * 0.45;
    const confidenceContribution = confidenceBonus(sycmScore.confidence || row.confidence);
    const usageContribution = usageBonus(sycmScore.usage || row.usage);
    score += marketContribution;
    score += confidenceContribution;
    score += usageContribution;
    pushScoreTerm(positive, 'sycm_score', '生意参谋指标', marketContribution);
    pushScoreTerm(
      confidenceContribution >= 0 ? positive : negative,
      'confidence',
      '数据置信度',
      confidenceContribution
    );
    pushScoreTerm(
      usageContribution >= 0 ? positive : negative,
      'usage',
      '标题用途',
      usageContribution
    );
    if (sycmScore.passed) reasons.push(`sycm_${sycmScore.mode || row.verifyMode || 'passed'}`);
    else riskFlags.push('sycm_not_passed');
  } else {
    score += 12;
    pushScoreTerm(positive, 'sycm_missing_baseline', '缺少生意参谋时的保守基础分', 12);
    riskFlags.push('sycm_missing');
  }

  if (keyword.length >= 3 && keyword.length <= 12) {
    score += 8;
    pushScoreTerm(positive, 'keyword_length', '关键词长度适中', 8);
  } else {
    riskFlags.push('keyword_length_edge');
  }
  if (row.fallbackUsed) {
    const fallbackPenalty = row.verifyMode === 'hot' ? -5 : -5;
    score += fallbackPenalty;
    pushScoreTerm(negative, 'fallback_penalty', row.verifyMode === 'hot' ? '热搜降级惩罚' : '降级查询惩罚', fallbackPenalty);
    riskFlags.push(`fallback_${row.verifyMode || 'used'}`);
  }

  const banned = checkBannedWords(keyword);
  if (!banned.valid) {
    score = 0;
    pushScoreTerm(negative, 'banned_keyword', '命中违禁词，分数归零', -100);
    riskFlags.push('banned_keyword');
  }

  const finalScore = clamp(Math.round(score));
  const action = keywordDecision(finalScore, sycmScore);
  const continueThreshold = sycmScore && sycmScore.passed && sycmScore.mode === 'hot' ? 55 : 72;
  const threshold = action.decision === 'continue' ? continueThreshold : action.decision === 'observe' ? 45 : continueThreshold;
  return {
    score: finalScore,
    decision: action.decision,
    nextAction: action.nextAction,
    reasons,
    riskFlags,
    breakdown: {
      formula: 'localScore*0.35 + sycmScore*0.45 + confidenceBonus + usageBonus + keywordLengthBonus - fallbackPenalty',
      localScore,
      sycmScore: clamp(sycmScore.score || 0),
      positive,
      negative,
      threshold,
      gapToContinue: Math.max(0, continueThreshold - finalScore)
    }
  };
}

function productDecision(score, riskFlags) {
  if (riskFlags.includes('invalid_url') || riskFlags.includes('banned_title')) {
    return { level: 'reject', decision: 'reject', nextAction: 'manual_review' };
  }
  if (score >= 78) return { level: 'strong_recommend', decision: 'continue', nextAction: 'generate_title' };
  if (score >= 62) return { level: 'candidate', decision: 'continue', nextAction: 'generate_title' };
  if (score >= 45) return { level: 'manual_review', decision: 'review', nextAction: 'manual_review' };
  return { level: 'reject', decision: 'reject', nextAction: 'stop' };
}

/**
 * Score a 1688 product candidate for distribution readiness.
 * @param {object} product Product row.
 * @param {object} context Keyword/SYCM context.
 * @returns {{score:number,level:string,decision:string,nextAction:string,reasons:string[],riskFlags:string[],metrics:object}}
 */
function scoreProductOpportunity(product = {}, context = {}) {
  const keyword = String(context.keyword || '').trim();
  const title = getProductTitle(product);
  const url = getProductUrl(product);
  const price = getProductPrice(product);
  const sales30days = getProductSales(product);
  const reasons = [];
  const riskFlags = [];
  let score = 20;

  if (url && /detail\.1688\.com\/offer\/\d+\.html/.test(url)) {
    score += 18;
    reasons.push('valid_1688_url');
  } else {
    riskFlags.push('invalid_url');
  }

  if (keyword && title.includes(keyword)) {
    score += 22;
    reasons.push('title_exact_keyword');
  } else if (keyword && keyword.length >= 3 && title.includes(keyword.slice(0, 2))) {
    score += 12;
    reasons.push('title_partial_keyword');
  } else {
    riskFlags.push('title_keyword_weak');
  }

  if (price > 0 && price <= 80) {
    score += 12;
    reasons.push('price_low_to_mid');
  } else if (price > 80 && price <= 200) {
    score += 6;
    reasons.push('price_mid');
  } else {
    riskFlags.push(price > 0 ? 'price_high_or_unclear_margin' : 'price_missing');
  }

  if (sales30days > 0 && sales30days <= 3000) {
    score += 14;
    reasons.push('sales_validated_not_overcrowded');
  } else if (sales30days > 3000) {
    score += 6;
    riskFlags.push('sales_may_be_overcrowded');
  } else {
    score += 3;
    riskFlags.push('sales_missing_or_zero');
  }

  if (product.imageUrl || product.image || product.mainImage || product['主图链接']) score += 6;
  else riskFlags.push('image_missing');
  if (product.shopName || product.companyName || (product.stats && product.stats.companyName)) score += 4;
  if (context.verifyMode === 'hot') {
    score -= 8;
    riskFlags.push('hot_keyword_product');
  }

  const banned = checkBannedWords(title);
  if (!banned.valid) {
    score = Math.min(score, 35);
    riskFlags.push('banned_title');
  }

  const finalScore = clamp(Math.round(score));
  const action = productDecision(finalScore, riskFlags);
  return {
    score: finalScore,
    level: action.level,
    decision: action.decision,
    nextAction: action.nextAction,
    reasons,
    riskFlags,
    metrics: { price, sales30days }
  };
}

module.exports = {
  parseMetricNumber,
  scoreKeywordOpportunity,
  scoreProductOpportunity,
  getProductTitle,
  getProductUrl
};
