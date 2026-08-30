'use strict';

const fs = require('fs');
const { extractKeywords } = require('../../title-gen');
const { flowVerify } = require('./keyword-verification-flow');
const { appendJsonl, getRun, readJsonl, setRunStageMetrics, writeRun } = require('./run-store');
const { buildFlowCommand, flowResponse, isGenerationEligibleKeyword } = require('./flow-context');

const MAX_MANUAL_CANDIDATES = 3;
const PLATFORM_BLOCK_STATUSES = new Set(['login_required', 'slider_required', 'sycm_feature_required']);
const GENERIC_CATEGORY_WORDS = new Set(['其他', '通用', '商品', '用品', '百货', '配件']);
const COMMON_PRODUCT_WORD_PATTERN = /(手机壳|保护套|收纳盒|收纳架|置物架|连衣裙|半身裙|T恤|卫衣|外套|衬衫|裤子|拖鞋|凉鞋|运动鞋|项链|手链|耳环|戒指|胸针|发夹|发箍|玩具|猫砂盆|宠物窝|水杯|保温杯|雨伞|背包|手提包|钱包|化妆包|毛巾|浴巾|枕套|床笠|被套|台灯|夜灯|数据线|充电器|耳机|键盘|鼠标)/g;

function normalizeCandidateKeyword(value) {
  return String(value || '')
    .replace(/[\s\-_./|,，、;；:：()（）【】\[\]{}]+/g, '')
    .replace(/^(?:202\d|\d+\u6b3e?)/, '')
    .trim()
    .slice(0, 16);
}

function categoryLeaf(value) {
  const parts = String(value || '').split(/[>\/／|｜]+/).map(part => normalizeCandidateKeyword(part)).filter(Boolean);
  const leaf = parts.at(-1) || '';
  return leaf.length >= 2 && !GENERIC_CATEGORY_WORDS.has(leaf) ? leaf : '';
}

function fallbackCoreWord(row = {}) {
  const categoryWord = categoryLeaf(row.recommendedCategory || row.category || row.product?.category);
  if (categoryWord) return categoryWord;
  const sourceTitle = String(row.sourceTitle || row.title || row.product?.title || '')
    .replace(/(?:厂家直销|厂家批发|跨境专供|一件代发|爆款|新款|202\d年?)/g, '')
    .replace(/[A-Za-z0-9]+/g, ' ');
  const productWords = sourceTitle.match(COMMON_PRODUCT_WORD_PATTERN) || [];
  if (productWords.length > 0) return normalizeCandidateKeyword(productWords.at(-1));
  const chunks = sourceTitle.match(/[\u4e00-\u9fa5]{2,12}/g) || [];
  return normalizeCandidateKeyword(chunks.at(-1) || chunks[0] || '');
}

function pushCandidate(target, keyword, source, coreWord = '') {
  const normalized = normalizeCandidateKeyword(keyword);
  if (normalized.length < 2 || target.some(item => item.keyword === normalized)) return;
  target.push({ keyword: normalized, source, coreWord: normalizeCandidateKeyword(coreWord || normalized) });
}

function manualCandidateLocalScore(source) {
  if (source === 'manual') return 90;
  if (source === 'title_core') return 82;
  if (source === 'title_modifier') return 74;
  return 60;
}

/**
 * 从人工指定词或1688原标题中提取少量可验真的短词。
 * @param {object} row 已获取详情的商品。
 * @param {object} [options] 提取选项。
 * @returns {Promise<{coreWord:string,candidates:Array<object>,extractError:string}>} 候选词结果。
 */
async function extractManualProductKeywords(row, options = {}) {
  const candidates = [];
  const userKeyword = normalizeCandidateKeyword(row.userKeyword || row.keyword);
  if (userKeyword) pushCandidate(candidates, userKeyword, 'manual', userKeyword);

  const sourceTitle = String(row.sourceTitle || row.title || row.product?.title || '').trim();
  let extracted = null;
  let extractError = '';
  try {
    const extractor = options.keywordExtractor || ((title) => extractKeywords('keyword', { data: title }));
    extracted = sourceTitle ? await extractor(sourceTitle, row) : null;
  } catch (error) {
    extractError = error?.message || String(error);
  }

  const coreWord = normalizeCandidateKeyword(extracted?.coreWord) || fallbackCoreWord(row) || userKeyword;
  pushCandidate(candidates, coreWord, 'title_core', coreWord);
  for (const modifier of Array.isArray(extracted?.modifiers) ? extracted.modifiers : []) {
    if (candidates.length >= MAX_MANUAL_CANDIDATES) break;
    const word = normalizeCandidateKeyword(modifier?.word);
    if (!word || word === coreWord) continue;
    pushCandidate(candidates, `${word}${coreWord}`, 'title_modifier', coreWord);
  }
  if (candidates.length === 0) {
    pushCandidate(candidates, categoryLeaf(row.recommendedCategory || row.category), 'category_fallback', coreWord);
  }

  return {
    coreWord: coreWord || candidates[0]?.keyword || '',
    candidates: candidates.slice(0, MAX_MANUAL_CANDIDATES),
    extractError
  };
}

/**
 * 将商品级候选词合并为可共享生意参谋查询的关键词队列。
 * @param {object[]} products 商品列表。
 * @returns {object[]} 去重后候选词。
 */
function buildManualCandidateRows(products = []) {
  const grouped = new Map();
  for (const product of products) {
    for (const [rank, item] of (product.candidateKeywords || []).entries()) {
      const keyword = normalizeCandidateKeyword(item?.keyword || item);
      if (!keyword) continue;
      const current = grouped.get(keyword) || {
        keyword,
        selectedKeyword: keyword,
        coreWord: item?.coreWord || product.coreWord || keyword,
        coreProduct: item?.coreWord || product.coreWord || keyword,
        status: 'keyword_approved',
        reviewStatus: 'approved',
        source: item?.source === 'manual' ? 'manual' : 'manual_product_title',
        localScore: manualCandidateLocalScore(item?.source),
        reason: item?.source === 'manual' ? '用户手动输入' : '从1688商品原标题提取',
        nextAction: 'sycm_verify',
        signature: keyword,
        productBindings: [],
        addedAt: new Date().toISOString()
      };
      current.productBindings.push({
        offerId: product.offerId,
        clientId: product.clientId,
        url: product.url,
        rank,
        source: item?.source || 'title_core'
      });
      current.localScore = Math.max(Number(current.localScore || 0), manualCandidateLocalScore(item?.source));
      if (item?.source === 'manual') {
        current.source = 'manual';
        current.reason = '用户手动输入';
      }
      grouped.set(keyword, current);
    }
  }
  return [...grouped.values()];
}

function candidateMatchesProduct(candidate, product) {
  return (candidate?.productBindings || []).some(binding => (
    String(binding.offerId || '') === String(product.offerId || '')
    || (binding.clientId && binding.clientId === product.clientId)
  ));
}

function candidateRankForProduct(candidate, product) {
  return (candidate?.productBindings || []).find(binding => (
    String(binding.offerId || '') === String(product.offerId || '')
    || (binding.clientId && binding.clientId === product.clientId)
  ))?.rank ?? 99;
}

function fallbackAssignment(candidate, product) {
  return {
    ...candidate,
    status: 'keyword_fallback_review',
    verifyMode: 'rule_fallback',
    confidence: 'low',
    usage: 'manual_review',
    fallbackUsed: true,
    fallbackReason: '候选词未通过机会分，仅生成待复核草稿',
    autoFallbackEligible: true,
    keywordOpportunity: {
      score: Number(candidate?.opportunityScore || 0),
      decision: 'review',
      nextAction: 'manual_review',
      level: 'manual_review'
    },
    productBindings: candidate?.productBindings || [{ offerId: product.offerId, clientId: product.clientId, url: product.url, rank: 0 }]
  };
}

/**
 * 验证手工货源的候选词，并把最佳词按 offerId 回绑到每件商品。
 * @param {object} [options] 验真选项。
 * @returns {Promise<object>} 商品级验真结果。
 */
async function flowVerifyManualProducts(options = {}) {
  const initial = getRun(options);
  const candidateCount = readJsonl(initial.run.files.reviewedCandidates).length;
  const verifiedResult = await flowVerify({
    ...options,
    manualMode: true,
    limit: Math.max(1, Number(options.verify || candidateCount || 1)),
    autoAllowReviewKeywords: true
  });
  const hasPlatformBlock = verifiedResult.blockers?.includes('sycm_manual_action_required')
    || verifiedResult.rejected?.some(row => PLATFORM_BLOCK_STATUSES.has(row.status));
  if (hasPlatformBlock) return verifiedResult;

  const { runDir, run } = getRun(options);
  const products = readJsonl(run.files.selectedProducts).filter(row => row.status === 'selected');
  const candidateRows = readJsonl(run.files.reviewedCandidates);
  const verifiedRows = Array.isArray(verifiedResult.verified) ? verifiedResult.verified : [];
  const rejectedRows = Array.isArray(verifiedResult.rejected) ? verifiedResult.rejected : [];
  const assignedProducts = [];
  const assignments = [];

  for (const product of products) {
    const matchingVerified = verifiedRows
      .filter(candidate => candidateMatchesProduct(candidate, product))
      .sort((left, right) => {
        const eligibleDelta = Number(isGenerationEligibleKeyword(right)) - Number(isGenerationEligibleKeyword(left));
        if (eligibleDelta) return eligibleDelta;
        const scoreDelta = Number(right.opportunityScore || 0) - Number(left.opportunityScore || 0);
        return scoreDelta || candidateRankForProduct(left, product) - candidateRankForProduct(right, product);
      });
    const fallbackCandidate = candidateRows
      .filter(candidate => candidateMatchesProduct(candidate, product))
      .sort((left, right) => candidateRankForProduct(left, product) - candidateRankForProduct(right, product))[0];
    const chosen = matchingVerified[0] || (fallbackCandidate ? fallbackAssignment(fallbackCandidate, product) : null);
    if (!chosen) {
      assignedProducts.push({ ...product, keywordStatus: 'missing', keywordError: '未提取到可用候选词' });
      continue;
    }

    const directCategory = product.recommendedCategory || product.category || product.product?.category || '';
    const assignment = {
      ...chosen,
      offerId: product.offerId,
      clientId: product.clientId,
      url: product.url,
      sourceTitle: product.sourceTitle || product.title || '',
      recommendedCategory: directCategory || chosen.recommendedCategory || '',
      categorySource: directCategory ? '1688' : (chosen.categorySource || ''),
      sycmRecommendedCategory: chosen.recommendedCategory || '',
      keywordStatus: chosen.fallbackUsed ? 'review_required' : 'verified',
      candidateResults: [...matchingVerified, ...rejectedRows.filter(candidate => candidateMatchesProduct(candidate, product))]
    };
    assignments.push(assignment);
    assignedProducts.push({
      ...product,
      keyword: chosen.keyword,
      selectedKeyword: chosen.keyword,
      keywordSource: chosen.source === 'manual' ? 'manual' : (chosen.fallbackUsed ? 'fallback' : 'sycm'),
      keywordStatus: assignment.keywordStatus,
      keywordConfidence: chosen.confidence || (chosen.fallbackUsed ? 'low' : ''),
      keywordOpportunity: chosen.keywordOpportunity,
      sycmScore: chosen.sycmScore,
      sycmData: chosen.sycmData || [],
      verifyMode: chosen.verifyMode || '',
      confidence: chosen.confidence || '',
      usage: chosen.usage || '',
      fallbackUsed: !!chosen.fallbackUsed,
      fallbackReason: chosen.fallbackReason || '',
      recommendedCategory: assignment.recommendedCategory,
      categorySource: assignment.categorySource,
      sycmRecommendedCategory: assignment.sycmRecommendedCategory
    });
  }

  fs.writeFileSync(run.files.selectedProducts, '', 'utf8');
  appendJsonl(run.files.selectedProducts, assignedProducts);
  fs.writeFileSync(run.files.verifiedKeywords, '', 'utf8');
  appendJsonl(run.files.verifiedKeywords, assignments);
  const missing = assignedProducts.filter(row => row.keywordStatus === 'missing').length;
  const fallbackCount = assignments.filter(row => row.fallbackUsed).length;
  run.status = assignments.length > 0 ? 'verified' : 'verified_empty';
  run.counts.sycmVerified = assignments.length - fallbackCount;
  run.counts.sycmGenerationEligible = assignments.length;
  run.counts.sycmOpportunityReview = fallbackCount;
  run.counts.sycmVerifiedProducts = assignments.length - fallbackCount;
  run.counts.manualKeywordFallback = fallbackCount;
  run.counts.manualKeywordMissing = missing;
  setRunStageMetrics(run, 'verify', {
    input: products.length,
    passed: assignments.length - fallbackCount,
    review: fallbackCount,
    rejected: missing
  }, missing > 0 ? { manual_keyword_missing: missing } : {});
  writeRun(runDir, run);
  const nextCommand = assignments.length > 0
    ? buildFlowCommand('generate', run.runId, { limit: options.generate || products.length })
    : buildFlowCommand('inspect', run.runId);
  return flowResponse({
    ok: assignments.length > 0,
    runId: run.runId,
    status: run.status,
    verified: assignments,
    rejected: rejectedRows,
    runDir,
    blockers: assignments.length > 0 ? [] : ['no_verified_keywords'],
    allowedCommands: [nextCommand],
    nextCommand,
    userMessage: fallbackCount > 0
      ? `已为 ${assignments.length} 个商品选定关键词，其中 ${fallbackCount} 个需在铺货前人工复核。`
      : `已为 ${assignments.length} 个商品选定验真关键词。`
  });
}

module.exports = {
  buildManualCandidateRows,
  extractManualProductKeywords,
  flowVerifyManualProducts
};
