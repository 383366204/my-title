const fs = require('fs');
const path = require('path');
const { applySeedFeedback, mineKeywords } = require('../keyword-mining');
const { generateTitlePipeline } = require('../title-gen');
const { extractKeywords } = require('../title-gen/src/extract-core');
const { searchAll, Alibaba1688Client, parse1688Url } = require('../alibaba1688');
const { extractSycmData, DEFAULT_FILTER_CONDITIONS } = require('../sycm-research');
const { checkBannedWords } = require('../../core/banned-words');
const { withAgentResponseFields } = require('../../core/agent-response');
const { scoreKeywordOpportunity, scoreProductOpportunity } = require('./src/opportunity-scoring');
const { appendOpportunity, summarizeOpportunities } = require('./src/opportunity-store');
const { getLLMProviderInfo } = require('../../core/llm');

const DEFAULT_FLOW_DIR = path.join(process.cwd(), 'data', 'pipeline');
const DEFAULT_RELAXED_FILTER_CONDITIONS = {
  demandSupplyRatio: 0.5,
  searchPopularity: 0,
  conversionRate: 0,
  buyerCount: 0,
  referencePrice: 0
};
const DEFAULT_HOT_FILTER_CONDITIONS = {
  demandSupplyRatio: 0,
  searchPopularity: 0,
  conversionRate: 0,
  buyerCount: 0,
  referencePrice: 0
};
const DEFAULT_MIN_TITLE_LENGTH = 30;
const DEFAULT_HOT_EXPORT_LIMIT = 2;
const DEFAULT_PRODUCTS_PER_KEYWORD = 12;
const DEFAULT_FALLBACK_CANDIDATES = [
  { keyword: '玛瑙戒指女', category: 'accessories', coreProduct: '戒指', signature: '戒指|玛瑙|女' },
  { keyword: '宠物磨牙玩具', category: 'pet', coreProduct: '玩具', signature: '宠物|磨牙|玩具' },
  { keyword: '端午五彩手绳', category: 'holiday', coreProduct: '手绳', signature: '端午|五彩|手绳' },
  { keyword: '桌面收纳盒', category: 'home', coreProduct: '收纳盒', signature: '桌面|收纳盒' },
  { keyword: '便携猫包', category: 'pet', coreProduct: '猫包', signature: '便携|猫包' }
];
const GENERIC_CATEGORY_TOKENS = new Set([
  '女', '男', '儿童', '宝宝', '新款', '爆款', '礼物', '用品', '商品',
  '饰品', '配饰', '玩具', '家居', '日用', '百货', '其他', '通用'
]);

function flowResponse(payload) {
  return withAgentResponseFields(payload);
}

function pad(num) {
  return String(num).padStart(2, '0');
}

function createRunId(date = new Date()) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + '-' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
}

function stringifyAsciiJson(value, spaces = 0) {
  return JSON.stringify(value, null, spaces).replace(/[^\x00-\x7F]/g, ch => {
    return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
  });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function resolveOpportunityDir(options = {}) {
  return options.opportunityDir || path.join(options.dataDir || DEFAULT_FLOW_DIR, 'opportunities');
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, stringifyAsciiJson(value, 2) + '\n', 'utf8');
}

function appendJsonl(file, rows) {
  ensureDir(path.dirname(file));
  const lines = (Array.isArray(rows) ? rows : [rows])
    .map(row => stringifyAsciiJson(row, 0))
    .join('\n');
  if (lines) fs.appendFileSync(file, lines + '\n', 'utf8');
}

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function readRecentPipelineCandidateKeywords({ dataDir = DEFAULT_FLOW_DIR, ttlDays = 30, excludeRunId = '' } = {}) {
  const runsDir = path.join(dataDir, 'runs');
  if (!fs.existsSync(runsDir)) return [];
  const cutoff = Date.now() - Number(ttlDays || 30) * 86400000;
  const keywords = new Set();
  for (const runId of fs.readdirSync(runsDir)) {
    if (runId === excludeRunId) continue;
    const runDir = path.join(runsDir, runId);
    const run = readJson(path.join(runDir, 'run.json'), {});
    const timestamp = Date.parse(run.updatedAt || run.startedAt || '');
    if (Number.isFinite(timestamp) && timestamp < cutoff) continue;
    for (const row of readJsonl(path.join(runDir, 'candidates.jsonl'))) {
      if (row.keyword) keywords.add(row.keyword);
    }
  }
  return [...keywords];
}

function resolveRunDir({ dataDir = DEFAULT_FLOW_DIR, runId } = {}) {
  const id = runId || createRunId();
  return {
    runId: id,
    dataDir,
    runDir: path.join(dataDir, 'runs', id)
  };
}

function initRun({ dataDir = DEFAULT_FLOW_DIR, runId, options = {} } = {}) {
  const resolved = resolveRunDir({ dataDir, runId });
  ensureDir(resolved.runDir);
  const runFile = path.join(resolved.runDir, 'run.json');
  const existing = readJson(runFile, null);
  const run = existing || {
    runId: resolved.runId,
    status: 'created',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    options,
    counts: {
      candidates: 0,
      keywordReviewApproved: 0,
      keywordReviewRejected: 0,
      sycmVerified: 0,
      sycmRejected: 0,
      selectedProducts: 0,
      generatedProducts: 0,
      readyToDistribute: 0
    },
    files: {
      candidates: path.join(resolved.runDir, 'candidates.jsonl'),
      reviewedCandidates: path.join(resolved.runDir, 'reviewed-candidates.jsonl'),
      sycmResults: path.join(resolved.runDir, 'sycm-results.jsonl'),
      verifiedKeywords: path.join(resolved.runDir, 'verified-keywords.jsonl'),
      selectedProducts: path.join(resolved.runDir, 'selected-products.jsonl'),
      generatedProducts: path.join(resolved.runDir, 'generated-products.jsonl'),
      distributionBatch: path.join(resolved.runDir, 'distribution-batch.txt'),
      distributionReview: path.join(resolved.runDir, 'distribution-review.md')
    }
  };
  ensureRunFiles(run, resolved.runDir);
  writeRun(resolved.runDir, run);
  writeJson(path.join(dataDir, 'latest.json'), {
    runId: resolved.runId,
    runDir: resolved.runDir,
    updatedAt: run.updatedAt
  });
  return { ...resolved, run };
}

function ensureRunFiles(run, runDir) {
  run.files = run.files || {};
  run.files.candidates = run.files.candidates || path.join(runDir, 'candidates.jsonl');
  run.files.reviewedCandidates = run.files.reviewedCandidates || path.join(runDir, 'reviewed-candidates.jsonl');
  run.files.sycmResults = run.files.sycmResults || path.join(runDir, 'sycm-results.jsonl');
  run.files.verifiedKeywords = run.files.verifiedKeywords || path.join(runDir, 'verified-keywords.jsonl');
  run.files.selectedProducts = run.files.selectedProducts || path.join(runDir, 'selected-products.jsonl');
  run.files.generatedProducts = run.files.generatedProducts || path.join(runDir, 'generated-products.jsonl');
  run.files.distributionBatch = run.files.distributionBatch || path.join(runDir, 'distribution-batch.txt');
  run.files.distributionReview = run.files.distributionReview || path.join(runDir, 'distribution-review.md');
}

function writeRun(runDir, run) {
  run.updatedAt = new Date().toISOString();
  writeJson(path.join(runDir, 'run.json'), run);
}

function getRun({ dataDir = DEFAULT_FLOW_DIR, runId } = {}) {
  let targetRunId = runId;
  if (!targetRunId) {
    const latest = readJson(path.join(dataDir, 'latest.json'), null);
    targetRunId = latest && latest.runId;
  }
  if (!targetRunId) throw new Error('未找到 run，请先执行 flow daily 或指定 --run');
  const resolved = resolveRunDir({ dataDir, runId: targetRunId });
  const run = readJson(path.join(resolved.runDir, 'run.json'), null);
  if (!run) throw new Error('run.json 不存在: ' + resolved.runDir);
  ensureRunFiles(run, resolved.runDir);
  return { ...resolved, run };
}

/**
 * 将已经由铺货后台确认成功的运行标记为工作流完成。
 * @param {object} options 完成参数。
 * @param {string} options.runId 工作流运行 ID。
 * @param {object} [options.distributionResult] 铺货结果摘要。
 * @param {string} [options.dataDir] pipeline 数据目录。
 * @returns {object} 更新后的运行记录。
 */
function markRunDistributionComplete({ dataDir = DEFAULT_FLOW_DIR, runId, distributionResult = {} } = {}) {
  const resolved = getRun({ dataDir, runId });
  const run = resolved.run;
  run.status = 'workflow_complete';
  run.requiresUserAction = false;
  run.mustReview = false;
  run.blockers = [];
  run.nextActionCode = 'workflow_complete';
  run.nextCommand = '';
  run.distribution = {
    status: 'completed',
    method: String(distributionResult.method || distributionResult.mode || 'automatic'),
    completedAt: new Date().toISOString(),
    total: Number(distributionResult.total || run.counts?.readyToDistribute || 0),
    confirmed: Number(distributionResult.confirmed || distributionResult.total || 0)
  };
  writeRun(resolved.runDir, run);
  return run;
}

function parseMetricNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const matches = String(value || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/g);
  if (!matches) return 0;
  const nums = matches.map(Number).filter(Number.isFinite);
  return nums.length ? Math.max(...nums) : 0;
}

function chineseTokens(value) {
  return String(value || '')
    .split(/[>\s,，/／、|｜;；:：\-—_]+/)
    .flatMap(part => {
      const text = part.trim();
      if (!text) return [];
      const matches = text.match(/[\u4e00-\u9fa5]{2,}/g) || [];
      return matches.flatMap(token => {
        const chunks = [token];
        for (let i = 0; i < token.length - 1; i += 1) {
          chunks.push(token.slice(i, i + 2));
        }
        return chunks;
      });
    })
    .map(token => token.trim())
    .filter(token => token.length >= 2 && !GENERIC_CATEGORY_TOKENS.has(token));
}

function hasTokenOverlap(a, b) {
  const left = new Set(chineseTokens(a));
  if (left.size === 0) return false;
  return chineseTokens(b).some(token => left.has(token));
}

function scoreSycmRows(rows, { mode = 'blue' } = {}) {
  const usableRows = Array.isArray(rows) ? rows : [];
  if (usableRows.length === 0) {
    return { passed: false, score: 0, reason: '生意参谋无数据' };
  }

  const best = usableRows.reduce((max, row) => {
    const demandSupplyRatio = parseMetricNumber(row.demandSupplyRatio);
    const searchPopularity = parseMetricNumber(row.searchPopularity);
    const clickRate = parseMetricNumber(row.clickRate);
    const conversionRate = parseMetricNumber(row.conversionRate);
    const score = Math.round(
      Math.min(40, demandSupplyRatio * 8) +
      Math.min(25, searchPopularity / 20) +
      Math.min(20, clickRate / 4) +
      Math.min(15, conversionRate * 3)
    );
    return score > max.score ? { row, score, demandSupplyRatio, searchPopularity, clickRate, conversionRate } : max;
  }, { row: null, score: 0, demandSupplyRatio: 0, searchPopularity: 0, clickRate: 0, conversionRate: 0 });

  const hasHeat = best.searchPopularity > 0 || best.clickRate > 0 || best.conversionRate > 0;
  const passed = mode === 'hot'
    ? hasHeat
    : mode === 'blue_relaxed'
      ? best.demandSupplyRatio >= 0.5 && hasHeat
      : best.demandSupplyRatio >= 1 && hasHeat;
  const confidence = mode === 'hot' ? 'trend' : mode === 'blue_relaxed' ? 'medium' : 'high';
  const usage = mode === 'hot' ? 'trend_reference' : mode === 'blue_relaxed' ? 'title_optional' : 'title_core';
  return {
    passed,
    score: best.score,
    bestKeyword: best.row && best.row.keyword,
    mode,
    confidence,
    usage,
    reason: passed
      ? (mode === 'hot'
        ? `热搜降级通过，搜索人气${best.searchPopularity}，点击率${best.clickRate}`
        : mode === 'blue_relaxed'
          ? `放宽蓝海通过，供需比${best.demandSupplyRatio}，搜索人气${best.searchPopularity}，点击率${best.clickRate}`
          : `供需比${best.demandSupplyRatio}，搜索人气${best.searchPopularity}，点击率${best.clickRate}`)
      : '指标不足，暂不进入标题生成'
  };
}

function shouldFallbackToNextTier({ data, sycmScore, minBlueRows = 1 } = {}) {
  const count = Array.isArray(data) ? data.length : 0;
  if (count < minBlueRows) return true;
  return !(sycmScore && sycmScore.passed);
}

async function fetchSycmWithFallback(keyword, options = {}) {
  const sycmExtractor = options.sycmExtractor || extractSycmData;
  const baseOptions = {
    port: Number(options.port || process.env.SYCM_DEBUG_PORT || 9222),
    maxPages: Number(options.pages || process.env.SYCM_MAX_PAGES || 1),
    loginMode: options.loginMode || process.env.SYCM_LOGIN_MODE || 'manual',
    pageFilters: { compareType: options.compare || 'cycle', timePeriod: options.period || '7d' }
  };
  const primaryMode = options.mode || 'blue';
  const primary = await sycmExtractor(keyword, {
    ...baseOptions,
    mode: primaryMode,
    filterConditions: primaryMode === 'blue' ? DEFAULT_FILTER_CONDITIONS : null
  });
  const primaryData = primary && Array.isArray(primary.data) ? primary.data : [];
  const primaryScore = scoreSycmRows(primaryData, { mode: primaryMode });
  const fallbackEnabled = options.fallbackHot !== false && primaryMode === 'blue';
  const minBlueRows = Number(options.minBlueRows || 1);

  if (!fallbackEnabled || !shouldFallbackToNextTier({ data: primaryData, sycmScore: primaryScore, minBlueRows })) {
    return {
      result: primary,
      data: primaryData,
      sycmScore: primaryScore,
      verifyMode: primaryMode,
      fallbackUsed: false,
      attempts: [{ mode: primaryMode, totalCount: primaryData.length, passed: primaryScore.passed }]
    };
  }

  const relaxed = await sycmExtractor(keyword, {
    ...baseOptions,
    mode: 'blue',
    filterConditions: options.relaxedFilterConditions || DEFAULT_RELAXED_FILTER_CONDITIONS
  });
  const relaxedData = relaxed && Array.isArray(relaxed.data) ? relaxed.data : [];
  const relaxedScore = scoreSycmRows(relaxedData, { mode: 'blue_relaxed' });
  const primaryFallbackReason = primaryData.length < minBlueRows ? 'blue_rows_insufficient' : 'blue_score_not_passed';

  if (!shouldFallbackToNextTier({ data: relaxedData, sycmScore: relaxedScore, minBlueRows })) {
    return {
      result: relaxed,
      data: relaxedData,
      sycmScore: relaxedScore,
      verifyMode: 'blue_relaxed',
      fallbackUsed: true,
      fallbackReason: primaryFallbackReason,
      primary: {
        data: primaryData,
        sycmScore: primaryScore
      },
      attempts: [
        { mode: primaryMode, totalCount: primaryData.length, passed: primaryScore.passed },
        { mode: 'blue_relaxed', totalCount: relaxedData.length, passed: relaxedScore.passed }
      ]
    };
  }

  const fallback = await sycmExtractor(keyword, {
    ...baseOptions,
    mode: 'hot',
    filterConditions: options.hotFilterConditions || DEFAULT_HOT_FILTER_CONDITIONS
  });
  const fallbackData = fallback && Array.isArray(fallback.data) ? fallback.data : [];
  const fallbackScore = scoreSycmRows(fallbackData, { mode: 'hot' });
  return {
    result: fallback,
    data: fallbackData,
    sycmScore: fallbackScore,
    verifyMode: 'hot',
    fallbackUsed: true,
    fallbackReason: relaxedData.length < minBlueRows ? 'blue_relaxed_rows_insufficient' : 'blue_relaxed_score_not_passed',
    primary: {
      data: primaryData,
      sycmScore: primaryScore
    },
    attempts: [
      { mode: primaryMode, totalCount: primaryData.length, passed: primaryScore.passed },
      { mode: 'blue_relaxed', totalCount: relaxedData.length, passed: relaxedScore.passed },
      { mode: 'hot', totalCount: fallbackData.length, passed: fallbackScore.passed }
    ]
  };
}

function productUrl(product) {
  const direct = product && (product['产品链接'] || product.detailUrl || product.productUrl || product.link || product.url || '');
  if (direct && /detail\.1688\.com\/offer\/\d+\.html/.test(String(direct))) return direct;
  const id = product && (product.id || product.offerId || product.productId);
  return id ? `https://detail.1688.com/offer/${id}.html` : direct;
}

function productTitle(product) {
  return product && (product['铺货标题'] || product.title || product.subject || product.generatedTitle || product.name || '');
}

function parsePossibleJson(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) return value;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return value;
  }
}

function findDetailValue(root, keys) {
  const targets = new Set(keys.map(key => String(key).toLowerCase()));
  const queue = [parsePossibleJson(root)];
  const seen = new Set();
  while (queue.length > 0) {
    const current = parsePossibleJson(queue.shift());
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    for (const [key, rawValue] of Object.entries(current)) {
      const value = parsePossibleJson(rawValue);
      if (targets.has(String(key).toLowerCase()) && value != null && typeof value !== 'object' && String(value).trim()) {
        return String(value).trim();
      }
      if (value && typeof value === 'object') queue.push(value);
    }
  }
  return '';
}

function normalizeManualOfferDetail(raw, input = {}) {
  const root = parsePossibleJson(raw?.model?.bizData ?? raw?.model?.data ?? raw?.data ?? raw);
  const text = typeof root === 'string' ? root : '';
  const fromText = (patterns) => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
    return '';
  };
  const title = findDetailValue(root, ['title', 'subject', 'offerTitle', 'productTitle', 'name'])
    || fromText([/(?:商品标题|标题)[:：]\s*([^\n]+)/i]);
  const category = findDetailValue(root, ['categoryName', 'leafCategoryName', 'category', 'catName', 'categoryListName'])
    || fromText([/(?:商品类目|类目)[:：]\s*([^\n]+)/i]);
  const imageUrl = findDetailValue(root, ['imageUrl', 'mainImage', 'mainPic', 'picUrl', 'image'])
    || fromText([/(https?:\/\/[^\s"']+\.(?:jpg|jpeg|png|webp))/i]);
  const price = findDetailValue(root, ['price', 'offerPrice', 'salePrice', 'priceRange'])
    || fromText([/(?:价格|单价)[:：]\s*([^\n]+)/i]);
  return {
    offerId: input.offerId || '',
    title: title || String(input.title || '').trim(),
    category: category || String(input.category || '').trim(),
    imageUrl,
    price,
    raw: root
  };
}

function createManualDetailFetcher(options = {}) {
  if (typeof options.detailFetcher === 'function') return options.detailFetcher;
  const ak = String(options.ali1688Ak || process.env.ALI_1688_AK || '').trim();
  if (!ak) {
    return async () => {
      const error = new Error('缺少 ALI_1688_AK，无法获取 1688 商品资料');
      error.code = 'ali_1688_ak_missing';
      throw error;
    };
  }
  const client = new Alibaba1688Client(ak);
  return offerId => client.getOfferDetail(offerId);
}

function sycmRecommendedCategory(sycmResult) {
  const categoryAnalysis = sycmResult && sycmResult.categoryAnalysis;
  const recommended = categoryAnalysis && categoryAnalysis.recommendation && categoryAnalysis.recommendation.recommended;
  return recommended && recommended.category ? String(recommended.category).trim() : '';
}

function productCategory(product, row = {}) {
  const direct = product && (
    product['铺货类目'] ||
    product['推荐类目'] ||
    product['类目'] ||
    product.category ||
    product.categoryListName ||
    product.categoryName
  );
  return String(row.recommendedCategory || direct || '').trim();
}

function categoryAssessment(row) {
  const recommendedCategory = String(row.recommendedCategory || '').trim();
  const directCategory = productCategory(row.product, { recommendedCategory: '' });
  if (recommendedCategory && directCategory) {
    const matched = hasTokenOverlap(recommendedCategory, directCategory);
    return {
      confidence: matched ? 'high' : 'low',
      recommendedCategory,
      productCategory: directCategory,
      reason: matched ? '生意参谋类目与商品类目有交集' : '生意参谋类目与商品类目疑似冲突'
    };
  }
  if (recommendedCategory) {
    return {
      confidence: 'medium',
      recommendedCategory,
      productCategory: '',
      reason: '仅有生意参谋推荐类目，商品类目缺失'
    };
  }
  if (directCategory) {
    return {
      confidence: 'medium',
      recommendedCategory: '',
      productCategory: directCategory,
      reason: '仅有商品类目，生意参谋推荐类目缺失'
    };
  }
  return {
    confidence: 'unknown',
    recommendedCategory: '',
    productCategory: '',
    reason: '未获得类目数据'
  };
}

function parseOfferId(url) {
  const match = String(url || '').match(/detail\.1688\.com\/offer\/(\d+)\.html/);
  return match ? match[1] : '';
}

function validateGeneratedRow(row, context = {}) {
  const reasons = [];
  const title = String(row.title || '').trim();
  const url = String(row.url || '').trim();
  const minTitleLength = Number(context.minTitleLength || DEFAULT_MIN_TITLE_LENGTH);
  const category = categoryAssessment(row);

  if (!url) reasons.push('missing_url');
  if (url && !parseOfferId(url)) reasons.push('invalid_1688_url');
  if (!title) reasons.push('missing_title');
  if (title && title.length < minTitleLength) reasons.push(`title_too_short:${title.length}<${minTitleLength}`);
  if (row.keyword && title && !title.includes(row.keyword)) reasons.push('title_missing_keyword');

  const banned = checkBannedWords(title);
  if (!banned.valid) reasons.push(`banned_words:${banned.words.join(',')}`);
  if (category.confidence === 'low') reasons.push('category_conflict');
  if (category.confidence === 'unknown') reasons.push('missing_category');
  if (context.seenUrls && context.seenUrls.has(url)) reasons.push('duplicate_url');
  if (context.seenTitles && context.seenTitles.has(title)) reasons.push('duplicate_title');
  if (row.verifyMode === 'hot' && Number(context.hotUsed || 0) >= Number(context.hotExportLimit || DEFAULT_HOT_EXPORT_LIMIT)) {
    reasons.push('hot_export_limit');
  }
  if (row.keywordOpportunity && row.keywordOpportunity.decision && row.keywordOpportunity.decision !== 'continue') {
    reasons.push(`legacy_keyword_opportunity_${row.keywordOpportunity.decision}`);
  }
  const humanSelected = context.manualMode === true || row.manualSelectionStatus === 'approved';
  if (!humanSelected && row.productOpportunity && row.productOpportunity.decision && row.productOpportunity.decision !== 'continue') {
    reasons.push(`product_opportunity_${row.productOpportunity.level || row.productOpportunity.decision}`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    categoryConfidence: category.confidence,
    categoryReason: category.reason,
    recommendedCategory: category.recommendedCategory,
    productCategory: category.productCategory
  };
}

function isReviewableExportReason(reason) {
  const value = String(reason || '');
  return /^product_opportunity_manual_review/.test(value)
    || /^keyword_opportunity_(observe|review)/.test(value)
    || /^legacy_keyword_opportunity_(observe|review)/.test(value);
}

function classifyExportStatus(validation) {
  const reasons = validation && Array.isArray(validation.reasons) ? validation.reasons : [];
  if (validation && validation.ok) return 'ready';
  if (reasons.length > 0 && reasons.every(isReviewableExportReason)) return 'review_candidate';
  return 'rejected_before_distribution';
}

function distributionLine(row) {
  const category = productCategory(row.product, row);
  return category ? `${row.url}$$${row.title}$$${category}` : `${row.url}$$${row.title}`;
}

function reviewLabel(row) {
  const usage = row.usage || (row.sycmScore && row.sycmScore.usage) || '';
  if (usage === 'title_core') return '严格蓝海，可作为标题核心词';
  if (usage === 'title_optional') return '放宽蓝海，可作为标题辅助词';
  if (usage === 'trend_reference') return '热搜趋势，仅作趋势参考，建议小量测试或人工复核';
  return '未标记';
}

function isGenerationEligibleKeyword(row = {}) {
  const decision = row.keywordOpportunity && row.keywordOpportunity.decision;
  return !decision || decision === 'continue' || row.autoFallbackEligible === true;
}

function writeDistributionReview(file, rows) {
  const readyRows = rows.filter(row => row.exportStatus === 'ready');
  const reviewRows = rows.filter(row => row.exportStatus === 'review_candidate');
  const rejectedRows = rows.filter(row => row.exportStatus === 'rejected_before_distribution');
  const lines = [
    '# Distribution Review',
    '',
    '人工铺货前请先检查本报告。Recommended Submit 会写入 distribution-batch.txt；Manual Review Candidates 不会自动铺货，需要人工决定是否补进批次。',
    '',
    '## Summary',
    '',
    `- Recommended Submit: ${readyRows.length}`,
    `- Review Candidates: ${reviewRows.length}`,
    `- Hard Rejected: ${rejectedRows.length}`,
    ''
  ];
  const appendRow = (row, index) => {
    lines.push(`### ${index + 1}. ${row.keyword}`);
    lines.push('');
    lines.push(`- Export Status: ${row.exportStatus || 'ready'}`);
    if (row.exportReasons && row.exportReasons.length) lines.push(`- Review Reasons: ${row.exportReasons.join(', ')}`);
    lines.push(`- URL: ${row.url}`);
    lines.push(`- Title: ${row.title}`);
    lines.push(`- Category: ${productCategory(row.product, row) || '-'}`);
    lines.push(`- Category Confidence: ${row.categoryConfidence || '-'}`);
    if (row.categoryReason) lines.push(`- Category Reason: ${row.categoryReason}`);
    lines.push(`- Verify Mode: ${row.verifyMode || (row.sycmScore && row.sycmScore.mode) || '-'}`);
    lines.push(`- Confidence: ${row.confidence || (row.sycmScore && row.sycmScore.confidence) || '-'}`);
    lines.push(`- Usage: ${row.usage || (row.sycmScore && row.sycmScore.usage) || '-'}`);
    if (row.keywordOpportunity) {
      lines.push(`- Keyword Opportunity: ${row.keywordOpportunity.score} / ${row.keywordOpportunity.decision} / ${row.keywordOpportunity.nextAction}`);
    }
    if (row.productOpportunity) {
      lines.push(`- Product Opportunity: ${row.productOpportunity.score} / ${row.productOpportunity.level} / ${row.productOpportunity.nextAction}`);
      if (row.productOpportunity.riskFlags && row.productOpportunity.riskFlags.length) {
        lines.push(`- Product Risk Flags: ${row.productOpportunity.riskFlags.join(', ')}`);
      }
    }
    lines.push(`- Decision: ${reviewLabel(row)}`);
    if ((row.usage || (row.sycmScore && row.sycmScore.usage)) === 'trend_reference') {
      lines.push('- Risk: 该词不是严格蓝海词，只能证明有热搜趋势，铺货前必须人工确认。');
    }
    lines.push(`- Fallback: ${row.fallbackUsed ? 'yes' : 'no'}${row.fallbackReason ? ` (${row.fallbackReason})` : ''}`);
    lines.push(`- SYCM Reason: ${row.sycmScore && row.sycmScore.reason ? row.sycmScore.reason : '-'}`);
    lines.push('');
  };
  lines.push('## Recommended Submit');
  lines.push('');
  if (readyRows.length === 0) lines.push('No rows.');
  readyRows.forEach(appendRow);
  lines.push('## Manual Review Candidates');
  lines.push('');
  if (reviewRows.length === 0) lines.push('No rows.');
  reviewRows.forEach(appendRow);
  lines.push('## Hard Rejected');
  lines.push('');
  if (rejectedRows.length === 0) lines.push('No rows.');
  rejectedRows.forEach(appendRow);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
}

function buildFlowCommand(step, runId, options = {}) {
  const runPart = runId ? ` --run ${runId}` : '';
  if (step === 'review') return `node bin/cli.js flow review${runPart}${options.approveAll ? ' --approve-all' : ''}`;
  if (step === 'verify') return `node bin/cli.js flow verify${runPart} --limit ${options.limit || 20}`;
  if (step === 'select') return `node bin/cli.js flow select${runPart} --limit ${options.limit || 10}`;
  if (step === 'generate') return `node bin/cli.js flow generate${runPart} --limit ${options.limit || 10}`;
  if (step === 'export') return `node bin/cli.js flow export${runPart} --limit ${options.limit || 20}`;
  if (step === 'inspect') return `node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync('data/pipeline/runs/${runId}/run.json','utf8'));console.log(JSON.stringify(r,null,2))"`;
  return '';
}

function fallbackCandidates(limit = 10) {
  const date = new Date().toISOString().slice(0, 10);
  return DEFAULT_FALLBACK_CANDIDATES.slice(0, Number(limit || 10)).map(item => ({
    date,
    keyword: item.keyword,
    seed: 'pipeline-fallback',
    category: item.category,
    pattern: 'fallback-concrete',
    localScore: 70,
    tier: 'mid',
    reason: 'fallback concrete product keyword; must pass SYCM before product search',
    nextAction: 'sycm_verify',
    flags: ['fallback_candidate'],
    coreProduct: item.coreProduct,
    signature: item.signature,
    productSignature: item.coreProduct,
    rigid: [],
    optional: [],
    nextCommands: {
      sycm: `node bin/cli.js sycm "${item.keyword}" --mode hot --json`,
      hotCheck: `node bin/cli.js sycm "${item.keyword}" --mode hot --json`,
      blueExplore: `node bin/cli.js sycm "${item.keyword}" --mode blue --json`,
      titleGenerate: `node bin/cli.js "${item.keyword}" --json`
    }
  }));
}

function exactKeywordCandidate(keyword) {
  const value = String(keyword || '').trim();
  if (!value) throw new Error('keyword is required');
  return {
    date: new Date().toISOString().slice(0, 10),
    keyword: value,
    seed: 'user-exact-keyword',
    category: '',
    pattern: 'user-exact-keyword',
    localScore: 85,
    tier: 'direct',
    reason: 'user requested exact keyword; do not rewrite before SYCM or product search',
    nextAction: 'sycm_verify',
    flags: ['user_exact_keyword'],
    coreProduct: value,
    signature: value,
    productSignature: value,
    rigid: [value],
    optional: [],
    nextCommands: {
      sycm: `node bin/cli.js sycm "${value}" --mode blue --json`,
      hotCheck: `node bin/cli.js sycm "${value}" --mode hot --json`,
      blueExplore: `node bin/cli.js sycm "${value}" --mode blue --json`,
      titleGenerate: `node bin/cli.js "${value}" --json`
    }
  };
}

function normalizeExternalCandidate(candidate = {}) {
  const keyword = String(candidate.keyword || candidate.word || '').trim();
  if (!keyword) return null;
  return {
    keyword,
    seed: candidate.seed || candidate.sourceKeyword || 'web-discovery',
    category: candidate.category || '',
    pattern: candidate.pattern || 'web-discovery',
    source: candidate.source || 'web',
    localScore: Number(candidate.localScore || candidate.score || 0),
    tier: candidate.tier || 'mid',
    reason: candidate.reason || candidate.gateReason || 'Web 辅助发现加入当前流程',
    nextAction: candidate.nextAction || 'sycm_verify',
    flags: Array.isArray(candidate.flags) ? candidate.flags : ['web_discovery'],
    coreProduct: candidate.coreProduct || '',
    signature: candidate.signature || keyword,
    productSignature: candidate.productSignature || candidate.coreProduct || '',
    rigid: Array.isArray(candidate.rigid) ? candidate.rigid : [],
    optional: Array.isArray(candidate.optional) ? candidate.optional : [],
    sycmData: candidate.sycmData || null,
    addedAt: new Date().toISOString()
  };
}

/**
 * Append externally discovered keyword candidates into an existing flow run.
 * @param {object} options Append options.
 * @param {string} options.runId Existing run id.
 * @param {Array<object>} options.candidates Candidate rows.
 * @returns {Promise<object>} Append result.
 */
async function appendRunCandidates(options = {}) {
  const { runDir, run } = getRun(options);
  const incoming = Array.isArray(options.candidates) ? options.candidates : [];
  const existing = readJsonl(run.files.candidates);
  const seen = new Set(existing.map(row => row.signature || row.keyword).filter(Boolean));
  const added = [];

  for (const raw of incoming) {
    const candidate = normalizeExternalCandidate(raw);
    if (!candidate) continue;
    const key = candidate.signature || candidate.keyword;
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(candidate);
  }

  if (added.length > 0) {
    appendJsonl(run.files.candidates, added);
  }

  if (!run.status || run.status === 'created') {
    run.status = 'mined';
  }
  run.counts = run.counts || {};
  run.counts.candidates = existing.length + added.length;
  writeRun(runDir, run);

  return flowResponse({
    ok: true,
    runId: run.runId,
    status: run.status,
    added: added.length,
    skipped: incoming.length - added.length,
    candidates: added,
    runDir,
    nextCommand: buildFlowCommand('verify', run.runId, { limit: options.verify || 20 }),
    allowedCommands: [buildFlowCommand('verify', run.runId, { limit: options.verify || 20 })]
  });
}

/**
 * Create a run from manually entered keywords.
 * @param {object} options Manual workflow options.
 * @returns {object} Initialized run result.
 */
function flowManualStart(options = {}) {
  const inputItems = Array.isArray(options.items) ? options.items : [];
  if (inputItems.length === 0) throw new Error('至少输入一个关键词和 1688 商品链接');
  const normalizedItems = inputItems.map((item, index) => {
    const inputUrl = String(item?.url || '');
    let inputHostname = '';
    try {
      inputHostname = new URL(inputUrl).hostname;
    } catch (_error) {
      inputHostname = '';
    }
    const validHostname = inputHostname === '1688.com' || inputHostname.endsWith('.1688.com');
    const parsed = validHostname ? parse1688Url(inputUrl) : null;
    const keyword = String(item?.keyword || options.defaultKeyword || '').trim();
    if (!parsed) throw new Error(`第 ${index + 1} 个 1688 商品链接无效`);
    if (!keyword) throw new Error(`第 ${index + 1} 个商品缺少关键词`);
    return {
      clientId: String(item?.clientId || `manual-${parsed.offerId}`),
      keyword,
      selectedKeyword: keyword,
      offerId: parsed.offerId,
      url: `https://detail.1688.com/offer/${parsed.offerId}.html`,
      title: String(item?.title || '').trim(),
      category: String(item?.category || '').trim()
    };
  });
  const keywords = [...new Set(normalizedItems.map(item => item.keyword))];
  const { runDir, run } = initRun({
    ...options,
    options: { ...(options.options || {}), mode: 'manual', workflowVersion: 2 }
  });
  const candidates = keywords.map(keyword => ({
    keyword,
    selectedKeyword: keyword,
    status: 'keyword_approved',
    source: 'manual',
    reason: '用户手动输入',
    reviewStatus: 'approved',
    nextAction: 'fetch_product_details',
    signature: keyword,
    addedAt: new Date().toISOString()
  }));
  fs.writeFileSync(run.files.candidates, '', 'utf8');
  appendJsonl(run.files.candidates, candidates);
  fs.writeFileSync(run.files.reviewedCandidates, '', 'utf8');
  appendJsonl(run.files.reviewedCandidates, candidates);
  fs.writeFileSync(run.files.selectedProducts, '', 'utf8');
  appendJsonl(run.files.selectedProducts, normalizedItems.map(item => ({
    ...item,
    status: 'manual_input_pending',
    source: 'manual_url',
    product: {
      offerId: item.offerId,
      url: item.url,
      detailUrl: item.url,
      title: item.title,
      subject: item.title,
      category: item.category,
      '产品链接': item.url,
      '链接原标题': item.title,
      '类目': item.category
    },
    inputAt: new Date().toISOString()
  })));
  run.status = 'manual_products_received';
  run.counts.candidates = candidates.length;
  run.counts.keywordReviewApproved = candidates.length;
  run.counts.keywordReviewPending = 0;
  run.counts.manualInputProducts = normalizedItems.length;
  writeRun(runDir, run);
  return flowResponse({
    ok: true,
    runId: run.runId,
    status: run.status,
    candidates,
    items: normalizedItems,
    runDir,
    blockers: [],
    nextActionCode: 'fetch_product_details',
    userMessage: `已录入 ${normalizedItems.length} 个商品，开始获取商品资料。`
  });
}

/**
 * Fetch product details for manually supplied 1688 URLs without running keyword search.
 * @param {object} options Manual product enrichment options.
 * @returns {Promise<object>} Enriched product result.
 */
async function flowEnrichManualProducts(options = {}) {
  const { runDir, run } = getRun(options);
  const rows = readJsonl(run.files.selectedProducts)
    .filter(row => ['manual_input_pending', 'enrich_failed', 'selected'].includes(row.status));
  const fetchDetail = createManualDetailFetcher(options);
  const enriched = [];
  for (const [index, row] of rows.entries()) {
    if (row.status === 'selected' && row.enrichStatus === 'completed' && options.retryCompleted !== true) {
      enriched.push(row);
      options.onProgress?.({
        current: index + 1,
        total: rows.length,
        message: `已保留 ${index + 1} / ${rows.length} 个商品资料`
      });
      continue;
    }
    options.onProgress?.({
      current: index,
      total: rows.length,
      message: `正在获取第 ${index + 1} / ${rows.length} 个商品资料`
    });
    try {
      const raw = await fetchDetail(row.offerId, row);
      const detail = normalizeManualOfferDetail(raw, row);
      if (!detail.title) throw new Error('1688 返回结果中没有商品标题');
      const product = {
        ...(row.product || {}),
        offerId: row.offerId,
        id: row.offerId,
        url: row.url,
        detailUrl: row.url,
        title: detail.title,
        subject: detail.title,
        category: detail.category,
        imageUrl: detail.imageUrl,
        price: detail.price,
        '产品链接': row.url,
        '链接原标题': detail.title,
        '主图链接': detail.imageUrl,
        '商品原价': detail.price,
        '类目': detail.category
      };
      enriched.push({
        ...row,
        status: 'selected',
        title: detail.title,
        sourceTitle: detail.title,
        recommendedCategory: detail.category,
        imageUrl: detail.imageUrl,
        price: detail.price,
        product,
        manualSelectionStatus: 'approved',
        enrichStatus: 'completed',
        enrichedAt: new Date().toISOString(),
        enrichError: ''
      });
    } catch (error) {
      enriched.push({
        ...row,
        status: 'enrich_failed',
        enrichStatus: 'failed',
        enrichError: error?.message || String(error),
        enrichErrorCode: error?.code || '',
        enrichedAt: new Date().toISOString()
      });
    }
    options.onProgress?.({
      current: index + 1,
      total: rows.length,
      message: `已处理 ${index + 1} / ${rows.length} 个商品`
    });
  }
  fs.writeFileSync(run.files.selectedProducts, '', 'utf8');
  appendJsonl(run.files.selectedProducts, enriched);
  const selected = enriched.filter(row => row.status === 'selected');
  const failed = enriched.filter(row => row.status === 'enrich_failed');
  run.status = selected.length > 0 ? 'products_selected' : 'select_failed';
  run.counts.selectedProducts = selected.length;
  run.counts.productEnrichFailed = failed.length;
  writeRun(runDir, run);
  return flowResponse({
    ok: selected.length > 0,
    runId: run.runId,
    status: run.status,
    selected,
    failed,
    runDir,
    blockers: selected.length > 0 ? [] : ['product_detail_fetch_failed'],
    userMessage: failed.length > 0
      ? `成功获取 ${selected.length} 个商品资料，${failed.length} 个失败。`
      : `成功获取 ${selected.length} 个商品资料。`
  });
}

/**
 * Persist manual product choices and optional hand-entered products.
 * @param {object} options Product review options.
 * @returns {object} Reviewed product result.
 */
function flowReviewProducts(options = {}) {
  const { runDir, run } = getRun(options);
  const rows = readJsonl(run.files.selectedProducts);
  const approvedIds = new Set((options.approvedProductIds || []).map(item => String(item || '').trim()).filter(Boolean));
  const manualProducts = Array.isArray(options.manualProducts) ? options.manualProducts : [];
  const identity = row => String(row.url || row.productUrl || row.product?.['产品链接'] || row.product?.url || row.offerId || '').trim();
  if (approvedIds.size === 0 && manualProducts.length === 0 && options.approveAll !== true) {
    run.status = 'awaiting_product_review';
    run.counts.productReviewPending = rows.length;
    writeRun(runDir, run);
    return flowResponse({ ok: true, runId: run.runId, status: run.status, products: rows, blockers: ['product_review_required'], runDir });
  }
  const selected = rows
    .filter(row => row.status === 'selected' && (options.approveAll === true || approvedIds.has(identity(row))))
    .map(row => ({ ...row, manualSelectionStatus: 'approved', selectedAt: new Date().toISOString() }));
  for (const raw of manualProducts) {
    const url = String(raw.url || raw.productUrl || '').trim();
    const title = String(raw.title || raw.sourceTitle || '').trim();
    const category = String(raw.category || raw.recommendedCategory || '').trim();
    if (!url) continue;
    selected.push({
      status: 'selected',
      keyword: String(raw.keyword || options.keyword || '').trim(),
      selectedKeyword: String(raw.keyword || options.keyword || '').trim(),
      url,
      title,
      sourceTitle: title,
      recommendedCategory: category,
      product: { ...raw, url, title, subject: title, category },
      manualSelectionStatus: 'approved',
      selectedAt: new Date().toISOString()
    });
  }
  const unique = [...new Map(selected.map(row => [identity(row) || `${row.keyword}:${row.title}`, row])).values()];
  fs.writeFileSync(run.files.selectedProducts, '', 'utf8');
  appendJsonl(run.files.selectedProducts, unique);
  run.status = unique.length > 0 ? 'products_selected' : 'select_failed';
  run.counts.selectedProducts = unique.length;
  run.counts.productReviewPending = 0;
  writeRun(runDir, run);
  return flowResponse({ ok: unique.length > 0, runId: run.runId, status: run.status, selected: unique, runDir, blockers: unique.length > 0 ? [] : ['no_selected_products'] });
}

/**
 * Mine candidates and write them into a flow run.
 * @param {object} options Flow options.
 * @returns {object} Step result.
 */
async function flowMine(options = {}) {
  const { runDir, run } = initRun(options);
  const historyExcludeKeywords = options.excludeSeen === true
    ? readRecentPipelineCandidateKeywords({
      dataDir: options.dataDir || DEFAULT_FLOW_DIR,
      ttlDays: options.seenTtlDays || 30,
      excludeRunId: run.runId
    })
    : [];
  const result = await mineKeywords({
    count: options.limit || options.mine || 50,
    maxSeeds: options.maxSeeds || 20,
    maxObservingSeeds: options.maxObservingSeeds || 3,
    maxPerSeed: options.maxPerSeed || 30,
    outputMaxPerSeed: options.outputMaxPerSeed || 5,
    outputMaxPerCategory: options.outputMaxPerCategory || 20,
    outputMaxPerPattern: options.outputMaxPerPattern || 20,
    outputMaxPerProductCore: options.outputMaxPerProductCore || 3,
    dataDir: options.keywordDataDir || path.join(process.cwd(), 'data', 'keyword-mining'),
    source: options.source || 'local',
    rootMode: options.rootMode || 'auto',
    rootLimit: options.rootLimit || 5,
    rootCooldownDays: options.rootCooldownDays || 7,
    persist: false,
    excludeSeen: options.excludeSeen === true,
    excludeKeywords: [
      ...historyExcludeKeywords,
      ...(Array.isArray(options.excludeKeywords) ? options.excludeKeywords : [])
    ],
    recordSeen: options.recordSeen === true,
    recordSeedFeedback: options.recordSeedFeedback === true,
    autoReplenishSeeds: options.autoReplenishSeeds === true,
    maxNewSeeds: options.maxNewSeeds || 3,
    seenTtlDays: options.seenTtlDays || 30,
    onProgress: options.onProgress
  });
  if ((!result.candidates || result.candidates.length === 0) && options.fallbackCandidates !== false) {
    const normalizedExcluded = new Set([
      ...historyExcludeKeywords,
      ...(Array.isArray(options.excludeKeywords) ? options.excludeKeywords : [])
    ].map(keyword => String(keyword || '').replace(/\s+/g, '').toLowerCase()).filter(Boolean));
    result.candidates = fallbackCandidates(DEFAULT_FALLBACK_CANDIDATES.length)
      .filter(row => !normalizedExcluded.has(String(row.keyword || '').replace(/\s+/g, '').toLowerCase()))
      .slice(0, Number(options.limit || options.mine || 10));
    result.stats = {
      ...(result.stats || {}),
      fallbackUsed: true,
      fallbackReason: result.candidates.length > 0 ? 'keyword_mining_empty' : 'keyword_mining_and_fallback_exhausted'
    };
  }
  fs.writeFileSync(run.files.candidates, '', 'utf8');
  appendJsonl(run.files.candidates, result.candidates);
  run.status = 'mined';
  run.counts.candidates = result.candidates.length;
  writeRun(runDir, run);
  return flowResponse({
    ok: true,
    runId: run.runId,
    status: run.status,
    candidates: result.candidates,
    runDir,
    blockers: [],
    allowedCommands: [buildFlowCommand('review', run.runId)],
    nextCommand: buildFlowCommand('review', run.runId)
  });
}

function normalizeKeywordReviewDecision(row = {}, decision = 'approved', reason = '') {
  return {
    ...row,
    reviewStatus: decision === 'approved' ? 'approved' : 'rejected',
    status: decision === 'approved' ? 'keyword_approved' : 'keyword_rejected',
    reviewReason: reason,
    reviewedAt: new Date().toISOString()
  };
}

/**
 * Persist human keyword screening results before SYCM verification.
 * @param {object} options Review options.
 * @returns {object} Step result.
 */
function flowReviewCandidates(options = {}) {
  const { runDir, run } = getRun(options);
  const candidates = readJsonl(run.files.candidates);
  const manualKeywords = [...new Set((Array.isArray(options.manualKeywords) ? options.manualKeywords : [])
    .map(item => String(item || '').trim())
    .filter(Boolean))];
  const existingKeywords = new Set(candidates.map(row => String(row.keyword || '').trim()).filter(Boolean));
  const manualCandidates = manualKeywords
    .filter(keyword => !existingKeywords.has(keyword))
    .map(keyword => ({
      keyword,
      selectedKeyword: keyword,
      status: 'candidate',
      source: 'manual',
      reason: '用户手动添加',
      signature: keyword,
      addedAt: new Date().toISOString()
    }));
  const allCandidates = [...candidates, ...manualCandidates];
  if (manualCandidates.length > 0) {
    appendJsonl(run.files.candidates, manualCandidates);
    run.counts.candidates = allCandidates.length;
  }
  const approvedSet = new Set((options.approvedKeywords || []).map(item => String(item || '').trim()).filter(Boolean));
  const rejectedSet = new Set((options.rejectedKeywords || []).map(item => String(item || '').trim()).filter(Boolean));
  const hasExplicitDecision = approvedSet.size > 0 || rejectedSet.size > 0 || manualKeywords.length > 0 || options.approveAll === true;

  if (!hasExplicitDecision) {
    run.status = 'awaiting_keyword_review';
    run.counts.keywordReviewPending = allCandidates.length;
    writeRun(runDir, run);
    return flowResponse({
      ok: true,
      runId: run.runId,
      status: run.status,
      candidates: allCandidates,
      reviewed: [],
      runDir,
      blockers: ['keyword_review_required'],
      allowedCommands: [buildFlowCommand('review', run.runId, { approveAll: true })],
      nextCommand: buildFlowCommand('review', run.runId, { approveAll: true })
    });
  }

  const reviewed = allCandidates.map(row => {
    const keyword = String(row.keyword || '').trim();
    const rejected = rejectedSet.has(keyword);
    const approved = options.approveAll === true || approvedSet.has(keyword) || (!rejected && approvedSet.size === 0);
    return normalizeKeywordReviewDecision(
      row,
      approved && !rejected ? 'approved' : 'rejected',
      rejected ? '人工筛除' : '人工确认通过'
    );
  });
  const approvedRows = reviewed.filter(row => row.reviewStatus === 'approved');
  const rejectedRows = reviewed.filter(row => row.reviewStatus === 'rejected');
  fs.writeFileSync(run.files.reviewedCandidates, '', 'utf8');
  appendJsonl(run.files.reviewedCandidates, reviewed);
  run.status = approvedRows.length > 0 ? 'keywords_reviewed' : 'keyword_review_empty';
  run.counts.keywordReviewApproved = approvedRows.length;
  run.counts.keywordReviewRejected = rejectedRows.length;
  run.counts.keywordReviewPending = 0;
  writeRun(runDir, run);
  return flowResponse({
    ok: true,
    runId: run.runId,
    status: run.status,
    reviewed,
    approved: approvedRows,
    rejected: rejectedRows,
    runDir,
    blockers: approvedRows.length > 0 ? [] : ['no_keyword_review_approved'],
    allowedCommands: [approvedRows.length > 0
      ? buildFlowCommand('verify', run.runId, { limit: options.verify || 20 })
      : buildFlowCommand('review', run.runId)],
    nextCommand: approvedRows.length > 0
      ? buildFlowCommand('verify', run.runId, { limit: options.verify || 20 })
      : buildFlowCommand('review', run.runId)
  });
}

/**
 * Verify candidates against SYCM in a strict serial queue.
 * @param {object} options Flow options.
 * @returns {Promise<object>} Step result.
 */
async function flowVerify(options = {}) {
  const { runDir, run } = getRun(options);
  const reviewedCandidates = readJsonl(run.files.reviewedCandidates);
  const approvedReviewedCandidates = reviewedCandidates.filter(row => row.reviewStatus === 'approved' || row.status === 'keyword_approved');
  const candidates = approvedReviewedCandidates.length > 0 ? approvedReviewedCandidates : readJsonl(run.files.candidates);
  const limit = Number(options.limit || options.verify || candidates.length || 0);
  const executableCandidates = candidates.filter(function(item) {
    var action = item && item.nextAction;
    return !action || action === 'sycm_verify' || action === 'direct_product_search';
  });
  const selected = executableCandidates.slice(0, limit);
  const reserveLimit = options.autoExpandVerify === true
    ? Math.max(0, Number(options.verifyReserve || 8))
    : 0;
  const reserveCandidates = executableCandidates.slice(limit, limit + reserveLimit);
  const verified = [];
  const rejected = [];
  const sycmResults = [];
  const sycmExtractor = options.sycmExtractor || extractSycmData;

  fs.writeFileSync(run.files.sycmResults, '', 'utf8');
  fs.writeFileSync(run.files.verifiedKeywords, '', 'utf8');

  const verifyCandidate = async (candidate, phase = 'primary') => {
    try {
      const sycmAttempt = await fetchSycmWithFallback(candidate.keyword, {
        ...options,
        sycmExtractor
      });
      const data = sycmAttempt.data;
      const sycmScore = sycmAttempt.sycmScore;
      const row = {
        ...candidate,
        status: sycmScore.passed ? 'verified' : 'rejected_low_score',
        sycmScore,
        verifyMode: sycmAttempt.verifyMode,
        confidence: sycmScore.confidence,
        usage: sycmScore.usage,
        fallbackUsed: sycmAttempt.fallbackUsed,
        fallbackReason: sycmAttempt.fallbackReason || '',
        recommendedCategory: sycmRecommendedCategory(sycmAttempt.result),
        sycmData: data,
        checkedAt: new Date().toISOString()
      };
      const keywordOpportunity = scoreKeywordOpportunity(row);
      row.keywordOpportunity = keywordOpportunity;
      row.opportunityScore = keywordOpportunity.score;
      row.decision = keywordOpportunity.decision;
      row.nextAction = keywordOpportunity.nextAction;
      sycmResults.push({
        keyword: candidate.keyword,
        ok: true,
        phase,
        mode: sycmAttempt.verifyMode,
        fallbackUsed: sycmAttempt.fallbackUsed,
        fallbackReason: sycmAttempt.fallbackReason || '',
        attempts: sycmAttempt.attempts,
        totalCount: data.length,
        sycmScore,
        data
      });
      if (sycmScore.passed) verified.push(row);
      else rejected.push(row);
    } catch (error) {
      const row = {
        ...candidate,
        status: error && error.status ? error.status : 'sycm_failed',
        error: error && error.message ? error.message : String(error),
        manualAction: error && error.details ? error.details : null,
        checkedAt: new Date().toISOString()
      };
      rejected.push(row);
      sycmResults.push({
        keyword: candidate.keyword,
        ok: false,
        phase,
        status: row.status,
        error: row.error,
        manualAction: row.manualAction
      });
      if (error && ['login_required', 'slider_required', 'sycm_feature_required'].includes(error.status)) {
        return false;
      }
    }
    return true;
  };

  for (let index = 0; index < selected.length; index += 1) {
    const canContinue = await verifyCandidate(selected[index]);
    options.onProgress?.({
      current: index + 1,
      total: selected.length + reserveCandidates.length,
      message: `生意参谋验真 ${index + 1}/${selected.length}`
    });
    if (!canContinue) break;
  }

  const strictEligibleAfterPrimary = verified.filter(row => {
    const decision = row.keywordOpportunity && row.keywordOpportunity.decision;
    return !decision || decision === 'continue';
  });
  const hasManualActionAfterPrimary = rejected.some(row => (
    ['login_required', 'slider_required', 'sycm_feature_required'].includes(row.status)
  ));

  // 每日流程先验证主候选池。严格机会词为零时才补验备用词，避免无节制提高平台请求频率。
  if (strictEligibleAfterPrimary.length === 0 && !hasManualActionAfterPrimary) {
    for (let index = 0; index < reserveCandidates.length; index += 1) {
      const canContinue = await verifyCandidate(reserveCandidates[index], 'reserve');
      options.onProgress?.({
        current: selected.length + index + 1,
        total: selected.length + reserveCandidates.length,
        message: `补充候选词验真 ${index + 1}/${reserveCandidates.length}`
      });
      if (!canContinue) break;
    }
  }

  appendJsonl(run.files.sycmResults, sycmResults);
  const strictGenerationEligible = verified.filter(row => {
    const decision = row.keywordOpportunity && row.keywordOpportunity.decision;
    return !decision || decision === 'continue';
  });
  const autoFallbackRows = strictGenerationEligible.length === 0 && options.autoAllowReviewKeywords === true
    ? verified
      .filter(row => row.keywordOpportunity?.decision === 'observe')
      .sort((left, right) => Number(right.opportunityScore || 0) - Number(left.opportunityScore || 0))
      .slice(0, Math.max(1, Number(options.reviewKeywordLimit || 2)))
    : [];
  for (const row of autoFallbackRows) {
    row.autoFallbackEligible = true;
    row.autoFallbackReason = '严格机会词为空，已作为可复核备用词继续选品和标题生成';
  }
  appendJsonl(run.files.verifiedKeywords, verified);
  const generationEligible = verified.filter(isGenerationEligibleKeyword);
  const opportunityReview = verified.filter(row => {
    const decision = row.keywordOpportunity && row.keywordOpportunity.decision;
    return decision && decision !== 'continue';
  });
  if (options.recordSeedFeedback === true && verified.length > 0) {
    const outcomes = new Map();
    for (const row of verified) {
      const root = row.root || row.seed || row.coreProduct || '';
      if (!root) continue;
      const current = outcomes.get(root) || { root, verified: 0, generationEligible: 0 };
      current.verified += 1;
      if (isGenerationEligibleKeyword(row)) current.generationEligible += 1;
      outcomes.set(root, current);
    }
    applySeedFeedback([...outcomes.values()], {
      dataDir: options.keywordDataDir || path.join(process.cwd(), 'data', 'keyword-mining'),
      eventType: 'verification-outcome'
    });
  }
  const manualStatuses = ['login_required', 'slider_required', 'sycm_feature_required'];
  const hasManualAction = rejected.some(function(row) {
    return manualStatuses.includes(row.status);
  });
  appendOpportunity('keywords', verified.map(row => ({
    runId: run.runId,
    keyword: row.keyword,
    signature: row.signature,
    coreProduct: row.coreProduct,
    status: row.status,
    opportunityScore: row.opportunityScore,
    decision: row.decision,
    nextAction: row.nextAction,
    verifyMode: row.verifyMode,
    confidence: row.confidence,
    usage: row.usage,
    fallbackUsed: row.fallbackUsed,
    sycmScore: row.sycmScore
  })), { runId: run.runId, dataDir: resolveOpportunityDir(options) });
  appendOpportunity('rejected', rejected.map(row => ({
    runId: run.runId,
    keyword: row.keyword,
    signature: row.signature,
    status: row.status,
    opportunityScore: row.opportunityScore || 0,
    decision: row.decision || 'reject',
    nextAction: row.nextAction || 'stop',
    reason: row.error || (row.sycmScore && row.sycmScore.reason) || ''
  })), { runId: run.runId, dataDir: resolveOpportunityDir(options) });
  run.status = hasManualAction
    ? (verified.length > 0 ? 'verified_partial_manual_required' : 'manual_action_required')
    : (verified.length > 0
      ? (generationEligible.length > 0 ? 'verified' : 'verified_no_generation_eligible')
      : 'verified_empty');
  run.counts.sycmVerified = verified.length;
  run.counts.sycmGenerationEligible = generationEligible.length;
  run.counts.sycmOpportunityReview = opportunityReview.length;
  run.counts.sycmReserveChecked = sycmResults.filter(row => row.phase === 'reserve').length;
  run.counts.sycmAutoFallbackEligible = autoFallbackRows.length;
  run.counts.sycmRejected = rejected.length;
  writeRun(runDir, run);
  const nextCommand = hasManualAction
    ? buildFlowCommand('inspect', run.runId)
    : (generationEligible.length > 0
      ? buildFlowCommand('select', run.runId, { limit: options.select || options.generate || 10 })
      : buildFlowCommand('inspect', run.runId));
  return flowResponse({
    ok: true,
    runId: run.runId,
    status: run.status,
    verified,
    rejected,
    runDir,
    blockers: hasManualAction
      ? ['sycm_manual_action_required']
      : (verified.length > 0
        ? (generationEligible.length > 0 ? [] : ['no_generation_eligible_keywords'])
        : ['no_verified_keywords']),
    allowedCommands: [nextCommand],
    nextCommand: nextCommand
  });
}

function productPrice(product = {}) {
  return product['商品原价'] || product.price || product.priceMin || product.minPrice || '';
}

function productSales(product = {}) {
  const stats = product.stats || {};
  return product['30天销量'] || product.sales30days || product.monthlySales || stats.last30DaysSales || stats.totalSales || 0;
}

function productImage(product = {}) {
  return product['主图链接'] || product.imageUrl || product.url || product.mainImage || product.image || '';
}

/**
 * Select and score 1688 product sources for SYCM-verified keywords.
 * @param {object} options Flow options.
 * @returns {Promise<object>} Step result.
 */
async function flowSelectProducts(options = {}) {
  const { runDir, run } = getRun(options);
  const verified = options.manualMode
    ? readJsonl(run.files.reviewedCandidates).filter(row => row.reviewStatus === 'approved' || row.status === 'keyword_approved')
    : readJsonl(run.files.verifiedKeywords);
  const eligible = options.includeReviewKeywords
    ? verified
    : verified.filter(isGenerationEligibleKeyword);
  const limit = Number(options.limit || options.select || options.generate || eligible.length || 0);
  const selectedKeywords = eligible.slice(0, limit);
  const productsPerKeyword = Number(options.productsPerKeyword || DEFAULT_PRODUCTS_PER_KEYWORD);
  const selectedRows = [];

  fs.writeFileSync(run.files.selectedProducts, '', 'utf8');

  for (const item of selectedKeywords) {
    try {
      const extracted = await extractKeywords('keyword', { data: item.keyword });
      const coreWord = extracted.coreWord || item.coreProduct || item.keyword;
      const modifiers = Array.isArray(extracted.modifiers) ? extracted.modifiers : [];
      const semanticGroups = extracted.semanticGroups || {};
      const products = await (options.searchProducts || searchAll)(
        coreWord,
        item.keyword,
        modifiers,
        semanticGroups,
        options.searchOptions || {}
      );
      for (const product of (Array.isArray(products) ? products : []).slice(0, productsPerKeyword)) {
        const opportunity = scoreProductOpportunity(product, {
          keyword: item.keyword,
          verifyMode: item.verifyMode,
          confidence: item.confidence,
          usage: item.usage,
          sycmScore: item.sycmScore
        });
        selectedRows.push({
          status: 'selected',
          keyword: item.keyword,
          selectedKeyword: item.keyword,
          seed: item.seed || '',
          root: item.root || item.seed || item.coreProduct || '',
          familyKey: item.familyKey || item.coreProduct || '',
          coreWord,
          modifiers,
          keywordOpportunity: item.keywordOpportunity,
          sycmScore: item.sycmScore,
          sycmData: item.sycmData || [],
          recommendedCategory: item.recommendedCategory || '',
          verifyMode: item.verifyMode || '',
          confidence: item.confidence || '',
          usage: item.usage || '',
          fallbackUsed: !!item.fallbackUsed,
          fallbackReason: item.fallbackReason || '',
          product,
          url: productUrl(product),
          sourceTitle: productTitle(product),
          title: productTitle(product),
          price: productPrice(product),
          sales30days: productSales(product),
          imageUrl: productImage(product),
          productOpportunity: opportunity,
          opportunityScore: opportunity.score,
          decision: opportunity.decision,
          nextAction: opportunity.nextAction,
          selectedAt: new Date().toISOString()
        });
      }
    } catch (error) {
      selectedRows.push({
        status: 'select_failed',
        keyword: item.keyword,
        selectedKeyword: item.keyword,
        error: error && error.message ? error.message : String(error),
        selectedAt: new Date().toISOString()
      });
    }
  }

  appendJsonl(run.files.selectedProducts, selectedRows);
  const selectedCount = selectedRows.filter(row => row.status === 'selected').length;
  if (options.recordSeedFeedback === true && selectedCount > 0) {
    const selectedByRoot = new Map();
    for (const row of selectedRows.filter(item => item.status === 'selected')) {
      const root = row.root || row.seed || '';
      if (!root) continue;
      selectedByRoot.set(root, (selectedByRoot.get(root) || 0) + 1);
    }
    applySeedFeedback([...selectedByRoot].map(([root, selectedProducts]) => ({ root, selectedProducts })), {
      dataDir: options.keywordDataDir || path.join(process.cwd(), 'data', 'keyword-mining'),
      eventType: 'product-selection-outcome'
    });
  }
  run.status = selectedCount > 0 ? 'products_selected' : 'select_failed';
  run.counts.selectedProducts = selectedCount;
  writeRun(runDir, run);
  return flowResponse({
    ok: true,
    runId: run.runId,
    status: run.status,
    selected: selectedRows,
    runDir,
    blockers: selectedCount > 0 ? [] : ['no_selected_products'],
    allowedCommands: [selectedCount > 0
      ? buildFlowCommand('generate', run.runId, { limit: options.generate || 10 })
      : buildFlowCommand('inspect', run.runId)],
    nextCommand: selectedCount > 0
      ? buildFlowCommand('generate', run.runId, { limit: options.generate || 10 })
      : buildFlowCommand('inspect', run.runId)
  });
}

/**
 * Generate products and titles for verified keywords.
 * @param {object} options Flow options.
 * @returns {Promise<object>} Step result.
 */
async function flowGenerate(options = {}) {
  const { runDir, run } = getRun(options);
  const verified = options.manualMode
    ? readJsonl(run.files.reviewedCandidates).filter(row => row.reviewStatus === 'approved' || row.status === 'keyword_approved')
    : readJsonl(run.files.verifiedKeywords);
  const selectedProducts = readJsonl(run.files.selectedProducts)
    .filter(row => row.status === 'selected' && row.product);
  const eligible = selectedProducts.length > 0
    ? Array.from(new Map(selectedProducts.map(row => [row.keyword, row])).values())
    : (options.includeReviewKeywords
      ? verified
      : verified.filter(isGenerationEligibleKeyword));
  const limit = Number(options.limit || options.generate || eligible.length || 0);
  const selected = eligible.slice(0, limit);
  const generator = options.generator || generateTitlePipeline;
  const llmInfo = getLLMProviderInfo({ provider: options.llmProvider });
  const configuredTitleRunTimeoutMs = Number(options.titleRunTimeoutMs);
  const titleRunTimeoutMs = Number.isFinite(configuredTitleRunTimeoutMs) && configuredTitleRunTimeoutMs > 0
    ? Math.max(30000, configuredTitleRunTimeoutMs)
    : llmInfo.recommendedRunTimeoutMs;
  const generatedRows = [];

  fs.writeFileSync(run.files.generatedProducts, '', 'utf8');

  for (const item of selected) {
    try {
      const productRowsForKeyword = selectedProducts.filter(row => row.keyword === item.keyword);
      const externalProducts = productRowsForKeyword.map(row => row.product);
      const result = await generator(item.keyword, {
        maxLength: Number(options.length || 60),
        limit: Number(options.productLimit || 0),
        silent: true,
        sycmData: item.sycmData || [],
        products: externalProducts,
        coreWord: item.coreWord || '',
        modifiers: item.modifiers || null,
        productLimit: externalProducts.length || undefined,
        runTimeoutMs: titleRunTimeoutMs,
        searchProducts: options.searchProducts || (({ coreWord, blueOceanWord, modifiers, semanticGroups }) =>
          searchAll(coreWord, blueOceanWord, modifiers, semanticGroups))
      });
      const products = Array.isArray(result.products) ? result.products : [];
      for (const product of products.slice(0, Number(options.productsPerKeyword || DEFAULT_PRODUCTS_PER_KEYWORD))) {
        const url = productUrl(product);
        const selectedProduct = productRowsForKeyword.find(row => row.url && row.url === url) || {};
        const mergedProduct = selectedProduct.product
          ? { ...selectedProduct.product, ...product }
          : product;
        const row = {
          status: 'generated',
          keyword: item.keyword,
          selectedKeyword: item.keyword,
          seed: item.seed || selectedProduct.seed || '',
          root: item.root || selectedProduct.root || item.seed || item.coreProduct || '',
          familyKey: item.familyKey || selectedProduct.familyKey || item.coreProduct || '',
          keywordOpportunity: item.keywordOpportunity || selectedProduct.keywordOpportunity,
          sycmScore: item.sycmScore || selectedProduct.sycmScore,
          sycmData: item.sycmData || [],
          recommendedCategory: options.manualMode
            ? (selectedProduct.recommendedCategory || item.recommendedCategory || '')
            : (item.recommendedCategory || selectedProduct.recommendedCategory || ''),
          verifyMode: item.verifyMode || selectedProduct.verifyMode || '',
          confidence: item.confidence || selectedProduct.confidence || '',
          usage: item.usage || selectedProduct.usage || '',
          fallbackUsed: !!item.fallbackUsed,
          fallbackReason: item.fallbackReason || selectedProduct.fallbackReason || '',
          selectedProduct,
          manualSelectionStatus: selectedProduct.manualSelectionStatus || '',
          product: mergedProduct,
          url,
          title: productTitle(mergedProduct),
          generatedAt: new Date().toISOString()
        };
        const productOpportunity = selectedProduct.productOpportunity || scoreProductOpportunity(mergedProduct, {
          keyword: item.keyword,
          verifyMode: item.verifyMode,
          confidence: item.confidence,
          usage: item.usage,
          sycmScore: item.sycmScore
        });
        row.productOpportunity = productOpportunity;
        row.opportunityScore = productOpportunity.score;
        row.decision = productOpportunity.decision;
        row.nextAction = productOpportunity.nextAction;
        generatedRows.push(row);
      }
    } catch (error) {
      generatedRows.push({
        status: 'generate_failed',
        keyword: item.keyword,
        error: error && error.message ? error.message : String(error),
        code: error && error.code ? error.code : '',
        source: error && error.source ? error.source : '',
        retryWith: error && error.retryWith ? error.retryWith : null,
        llmProvider: llmInfo.provider,
        llmProviderLabel: llmInfo.label,
        llmModel: llmInfo.model,
        generatedAt: new Date().toISOString()
      });
    }
  }

  appendJsonl(run.files.generatedProducts, generatedRows);
  appendOpportunity('products', generatedRows
    .filter(row => row.status === 'generated')
    .map(row => ({
      runId: run.runId,
      keyword: row.keyword,
      selectedKeyword: row.selectedKeyword || row.keyword,
      url: row.url,
      title: row.title,
      recommendedCategory: row.recommendedCategory,
      opportunityScore: row.opportunityScore,
      decision: row.decision,
      nextAction: row.nextAction,
      level: row.productOpportunity && row.productOpportunity.level,
      productOpportunity: row.productOpportunity,
      keywordOpportunity: row.keywordOpportunity
    })), { runId: run.runId, dataDir: resolveOpportunityDir(options) });
  run.status = generatedRows.some(row => row.status === 'generated') ? 'generated' : 'generate_failed';
  run.counts.generatedProducts = generatedRows.filter(row => row.status === 'generated').length;
  if (options.recordSeedFeedback === true && run.counts.generatedProducts > 0) {
    const generatedByRoot = new Map();
    for (const row of generatedRows.filter(item => item.status === 'generated')) {
      const root = row.root || row.seed || '';
      if (!root) continue;
      generatedByRoot.set(root, (generatedByRoot.get(root) || 0) + 1);
    }
    applySeedFeedback([...generatedByRoot].map(([root, generatedTitles]) => ({ root, generatedTitles })), {
      dataDir: options.keywordDataDir || path.join(process.cwd(), 'data', 'keyword-mining'),
      eventType: 'title-generation-outcome'
    });
  }
  writeRun(runDir, run);
  return flowResponse({
    ok: true,
    runId: run.runId,
    status: run.status,
    generated: generatedRows,
    runDir,
    blockers: run.counts.generatedProducts > 0 ? [] : ['no_generated_products'],
    allowedCommands: [run.counts.generatedProducts > 0
      ? buildFlowCommand('export', run.runId, { limit: options.export || 20 })
      : buildFlowCommand('inspect', run.runId)],
    nextCommand: run.counts.generatedProducts > 0
      ? buildFlowCommand('export', run.runId, { limit: options.export || 20 })
      : buildFlowCommand('inspect', run.runId)
  });
}

/**
 * Export generated products into distribution batch format.
 * @param {object} options Flow options.
 * @returns {object} Step result.
 */
async function flowExport(options = {}) {
  const { runDir, run } = getRun(options);
  const rows = readJsonl(run.files.generatedProducts)
    .filter(row => row.status === 'generated' && row.url && row.title);
  const limit = Number(options.limit || options.export || rows.length || 0);
  const selected = rows.slice(0, limit);
  const seenUrls = new Set();
  const seenTitles = new Set();
  const hotExportLimit = Number(options.hotExportLimit || DEFAULT_HOT_EXPORT_LIMIT);
  let hotUsed = 0;
  const reviewed = selected.map(row => {
    const validation = validateGeneratedRow(row, {
      minTitleLength: options.minTitleLength || DEFAULT_MIN_TITLE_LENGTH,
      hotExportLimit,
      hotUsed,
      seenUrls,
      seenTitles,
      manualMode: options.manualMode === true || run.options?.mode === 'manual'
    });
    const exportRow = {
      ...row,
      exportStatus: classifyExportStatus(validation),
      exportReasons: validation.reasons,
      categoryConfidence: validation.categoryConfidence,
      categoryReason: validation.categoryReason,
      recommendedCategory: row.recommendedCategory || validation.recommendedCategory,
      productCategory: validation.productCategory
    };
    if (validation.ok) {
      seenUrls.add(row.url);
      seenTitles.add(row.title);
      if (row.verifyMode === 'hot') hotUsed += 1;
    }
    return exportRow;
  });
  const readyRows = reviewed.filter(row => row.exportStatus === 'ready');
  const reviewRows = reviewed.filter(row => row.exportStatus === 'review_candidate');
  const rejectedRows = reviewed.filter(row => row.exportStatus !== 'ready');
  const hardRejectedRows = reviewed.filter(row => row.exportStatus === 'rejected_before_distribution');
  appendOpportunity('rejected', rejectedRows.map(row => ({
    runId: run.runId,
    keyword: row.keyword,
    selectedKeyword: row.selectedKeyword || row.keyword,
    url: row.url,
    title: row.title,
    status: row.exportStatus,
    opportunityScore: row.opportunityScore || 0,
    decision: row.decision || 'reject',
    nextAction: 'manual_review',
    reason: (row.exportReasons || []).join(',')
  })), { runId: run.runId, dataDir: resolveOpportunityDir(options) });
  const lines = readyRows.map(row => distributionLine(row));
  fs.writeFileSync(run.files.distributionBatch, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
  writeDistributionReview(run.files.distributionReview, reviewed);
  run.status = lines.length > 0
    ? (rejectedRows.length > 0 ? 'needs_review' : 'ready_to_distribute')
    : (reviewed.length > 0 ? 'needs_review' : 'export_empty');
  run.counts.readyToDistribute = lines.length;
  run.counts.reviewCandidates = reviewRows.length;
  run.counts.rejectedBeforeDistribution = hardRejectedRows.length;
  writeRun(runDir, run);
  return flowResponse({
    ok: true,
    runId: run.runId,
    status: run.status,
    count: lines.length,
    reviewCandidates: reviewRows.length,
    rejected: hardRejectedRows.length,
    canSubmit: lines.length > 0 && rejectedRows.length === 0,
    mustReview: rejectedRows.length > 0,
    blockers: rejectedRows.length > 0 ? ['review_rejected_rows'] : [],
    file: run.files.distributionBatch,
    reviewFile: run.files.distributionReview,
    runDir,
    allowedCommands: lines.length > 0
      ? [`node bin/cli.js distribute --input-file "${run.files.distributionBatch}" --dry-run --json`]
      : [buildFlowCommand('inspect', run.runId)],
    nextCommand: lines.length > 0
      ? `人工检查 distribution-batch.txt 后调用 1688-distribution: node bin/cli.js distribute --input-file "${run.files.distributionBatch}" --dry-run --json`
      : buildFlowCommand('inspect', run.runId)
  });
}

/**
 * Prepare a run for one exact keyword without mining or rewriting.
 * @param {object} options Flow options.
 * @returns {Promise<object>} Prepared run result.
 */
async function flowKeywordStart(options = {}) {
  const keyword = String(options.keyword || '').trim();
  if (!keyword) throw new Error('keyword is required');
  const { runDir, run } = initRun({
    ...options,
    options: {
      ...(options.options || {}),
      exactKeyword: keyword,
      mode: 'keyword'
    }
  });
  const candidate = exactKeywordCandidate(keyword);
  fs.writeFileSync(run.files.candidates, '', 'utf8');
  appendJsonl(run.files.candidates, [candidate]);
  run.status = 'mined';
  run.counts.candidates = 1;
  writeRun(runDir, run);
  return flowResponse({
    ok: true,
    runId: run.runId,
    runDir,
    exactKeyword: keyword,
    status: run.status,
    candidates: [candidate],
    blockers: [],
    allowedCommands: [buildFlowCommand('verify', run.runId, { limit: 1 })],
    nextCommand: buildFlowCommand('verify', run.runId, { limit: 1 })
  });
}

/**
 * Run the flow for one user-provided keyword without keyword mining or rewriting.
 * @param {object} options Flow options.
 * @returns {Promise<object>} Exact keyword flow result.
 */
async function flowKeyword(options = {}) {
  const keyword = String(options.keyword || '').trim();
  if (!keyword) throw new Error('keyword is required');
  const prepared = await flowKeywordStart(options);
  const runDir = prepared.runDir;
  const runId = prepared.runId;

  const verify = await flowVerify({ ...options, runId, limit: 1 });
  if (verify.verified.length === 0 || verify.blockers.includes('sycm_manual_action_required')) {
    const latest = getRun({ dataDir: options.dataDir, runId });
    return flowResponse({
      ok: true,
      runId,
      runDir,
      exactKeyword: keyword,
      counts: latest.run.counts,
      status: latest.run.status,
      files: latest.run.files,
      blockers: verify.blockers.length ? verify.blockers : ['no_verified_keywords'],
      allowedCommands: [verify.nextCommand],
      nextCommand: verify.nextCommand,
      steps: {
        mined: 1,
        verified: 0,
        rejected: verify.rejected.length,
        generated: 0,
        exported: 0
      }
    });
  }

  const select = await flowSelectProducts({
    ...options,
    runId,
    limit: 1,
    productsPerKeyword: options.productsPerKeyword || DEFAULT_PRODUCTS_PER_KEYWORD
  });
  const selectedCount = select.selected.filter(row => row.status === 'selected').length;
  if (selectedCount === 0) {
    const latest = getRun({ dataDir: options.dataDir, runId });
    return flowResponse({
      ok: true,
      runId,
      runDir,
      exactKeyword: keyword,
      counts: latest.run.counts,
      status: latest.run.status,
      files: latest.run.files,
      blockers: ['no_selected_products'],
      allowedCommands: [select.nextCommand],
      nextCommand: select.nextCommand,
      steps: {
        mined: 1,
        verified: verify.verified.length,
        selected: 0,
        rejected: verify.rejected.length,
        generated: 0,
        exported: 0
      }
    });
  }

  const generate = await flowGenerate({
    ...options,
    runId,
    limit: 1,
    productsPerKeyword: options.productsPerKeyword || DEFAULT_PRODUCTS_PER_KEYWORD
  });
  const generatedCount = generate.generated.filter(row => row.status === 'generated').length;
  if (generatedCount === 0) {
    const latest = getRun({ dataDir: options.dataDir, runId });
    return flowResponse({
      ok: true,
      runId,
      runDir,
      exactKeyword: keyword,
      counts: latest.run.counts,
      status: latest.run.status,
      files: latest.run.files,
      blockers: ['no_generated_products'],
      allowedCommands: [generate.nextCommand],
      nextCommand: generate.nextCommand,
      steps: {
        mined: 1,
        verified: verify.verified.length,
        selected: selectedCount,
        rejected: verify.rejected.length,
        generated: 0,
        exported: 0
      }
    });
  }

  const exported = await flowExport({ ...options, runId, limit: options.export || 20 });
  const latest = getRun({ dataDir: options.dataDir, runId });
  return flowResponse({
    ok: true,
    runId,
    runDir,
    exactKeyword: keyword,
    counts: latest.run.counts,
    status: latest.run.status,
    files: latest.run.files,
    canSubmit: exported.canSubmit,
    mustReview: exported.mustReview,
    blockers: exported.blockers,
    allowedCommands: exported.allowedCommands,
    nextCommand: exported.nextCommand,
    steps: {
      mined: 1,
      verified: verify.verified.length,
      selected: selectedCount,
      rejected: verify.rejected.length,
      generated: generatedCount,
      exported: exported.count
    }
  });
}

/**
 * Run the first version of the daily flow: mine, review keywords, verify, select products, generate, export.
 * @param {object} options Flow options.
 * @returns {Promise<object>} Daily flow result.
 */
async function flowDaily(options = {}) {
  const mine = await flowMine({
    ...options,
    limit: options.mine || options.limit || 50,
    excludeSeen: options.excludeSeen !== false,
    recordSeen: options.recordSeen !== false
  });
  const keywordReview = flowReviewCandidates({
    ...options,
    runId: mine.runId,
    approveAll: options.reviewMode === 'auto' || options.approveAll === true
  });
  if (keywordReview.status === 'awaiting_keyword_review' || keywordReview.status === 'keyword_review_empty') {
    const { run } = getRun({ dataDir: options.dataDir, runId: mine.runId });
    return flowResponse({
      ok: true,
      runId: mine.runId,
      runDir: mine.runDir,
      counts: run.counts,
      status: run.status,
      files: run.files,
      blockers: keywordReview.blockers,
      allowedCommands: keywordReview.allowedCommands,
      nextCommand: keywordReview.nextCommand,
      steps: {
        mined: mine.candidates.length,
        reviewed: keywordReview.approved ? keywordReview.approved.length : 0,
        verified: 0,
        rejected: 0,
        selected: 0,
        generated: 0,
        exported: 0
      }
    });
  }
  const verify = await flowVerify({ ...options, runId: mine.runId, limit: options.verify || 20 });
  if (verify.verified.length === 0 || verify.blockers.includes('sycm_manual_action_required')) {
    const { run } = getRun({ dataDir: options.dataDir, runId: mine.runId });
    return flowResponse({
      ok: true,
      runId: mine.runId,
      runDir: mine.runDir,
      counts: run.counts,
      status: run.status,
      files: run.files,
      blockers: verify.blockers.length ? verify.blockers : ['no_verified_keywords'],
      allowedCommands: [verify.nextCommand],
      nextCommand: verify.nextCommand,
      steps: {
        mined: mine.candidates.length,
        reviewed: keywordReview.approved.length,
        verified: 0,
        rejected: verify.rejected.length,
        selected: 0,
        generated: 0,
        exported: 0
      }
    });
  }

  const select = await flowSelectProducts({
    ...options,
    runId: mine.runId,
    limit: options.select || options.generate || 10,
    productsPerKeyword: options.productsPerKeyword || DEFAULT_PRODUCTS_PER_KEYWORD
  });
  const selectedCount = select.selected.filter(row => row.status === 'selected').length;
  if (selectedCount === 0) {
    const { run } = getRun({ dataDir: options.dataDir, runId: mine.runId });
    return flowResponse({
      ok: true,
      runId: mine.runId,
      runDir: mine.runDir,
      counts: run.counts,
      status: run.status,
      files: run.files,
      blockers: ['no_selected_products'],
      allowedCommands: [select.nextCommand],
      nextCommand: select.nextCommand,
      steps: {
        mined: mine.candidates.length,
        reviewed: keywordReview.approved.length,
        verified: verify.verified.length,
        selected: 0,
        rejected: verify.rejected.length,
        generated: 0,
        exported: 0
      }
    });
  }

  const generate = await flowGenerate({ ...options, runId: mine.runId, limit: options.generate || 10 });
  const generatedCount = generate.generated.filter(row => row.status === 'generated').length;
  if (generatedCount === 0) {
    const { run } = getRun({ dataDir: options.dataDir, runId: mine.runId });
    return flowResponse({
      ok: true,
      runId: mine.runId,
      runDir: mine.runDir,
      counts: run.counts,
      status: run.status,
      files: run.files,
      blockers: ['no_generated_products'],
      allowedCommands: [generate.nextCommand],
      nextCommand: generate.nextCommand,
      steps: {
        mined: mine.candidates.length,
        reviewed: keywordReview.approved.length,
        verified: verify.verified.length,
        selected: selectedCount,
        rejected: verify.rejected.length,
        generated: 0,
        exported: 0
      }
    });
  }

  const exported = await flowExport({ ...options, runId: mine.runId, limit: options.export || 20 });
  const { run } = getRun({ dataDir: options.dataDir, runId: mine.runId });
  return flowResponse({
    ok: true,
    runId: mine.runId,
    runDir: mine.runDir,
    counts: run.counts,
    status: run.status,
    files: run.files,
    canSubmit: exported.canSubmit,
    mustReview: exported.mustReview,
    blockers: exported.blockers,
    allowedCommands: exported.allowedCommands,
    nextCommand: exported.nextCommand,
    steps: {
      mined: mine.candidates.length,
      reviewed: keywordReview.approved.length,
      verified: verify.verified.length,
      selected: selectedCount,
      rejected: verify.rejected.length,
      generated: generatedCount,
      exported: exported.count
    }
  });
}

function createWorkflowRunner(deps = {}) {
  return {
    async run(input = {}) {
      const sycm = deps.sycm || (async (payload) => {
        const result = await flowKeyword({
          ...payload,
          keyword: payload.keyword,
          productsPerKeyword: payload.productsPerKeyword || DEFAULT_PRODUCTS_PER_KEYWORD,
          export: payload.export || 20
        });
        return {
          ok: result.ok !== false,
          status: result.status,
          runId: result.runId,
          runDir: result.runDir,
          files: result.files,
          canSubmit: result.canSubmit,
          mustReview: result.mustReview,
          blockers: result.blockers || [],
          data: result
        };
      });
      const selectProducts = deps.selectProducts || (async (payload) => {
        const data = payload.sycm && payload.sycm.data ? payload.sycm.data : payload.sycm;
        return {
          ok: data && data.ok !== false,
          status: data && data.status,
          products: data && data.files && data.files.distributionBatch ? [{ file: data.files.distributionBatch }] : [],
          data
        };
      });
      const prepareDistribution = deps.prepareDistribution || (async (payload) => {
        const data = payload.sycm && payload.sycm.data ? payload.sycm.data : payload.sycm;
        return {
          ok: data && data.ok !== false && data.canSubmit === true,
          status: data && data.status,
          canSubmit: data && data.canSubmit === true,
          file: data && data.files && data.files.distributionBatch,
          runId: data && data.runId,
          runDir: data && data.runDir,
          blockers: data && Array.isArray(data.blockers) ? data.blockers : [],
          data
        };
      });

      const sycmResult = await sycm(input);
      if (!sycmResult || sycmResult.ok === false) {
        return flowResponse({
          ok: false,
          status: sycmResult && sycmResult.status ? sycmResult.status : 'sycm_failed',
          blockers: sycmResult && Array.isArray(sycmResult.blockers) ? sycmResult.blockers : ['sycm_failed'],
          data: sycmResult
        });
      }

      const selectionResult = await selectProducts({ ...input, sycm: sycmResult });
      if (!selectionResult || selectionResult.ok === false) {
        return flowResponse({
          ok: false,
          status: selectionResult && selectionResult.status ? selectionResult.status : 'product_selection_failed',
          blockers: selectionResult && Array.isArray(selectionResult.blockers) ? selectionResult.blockers : ['product_selection_failed'],
          data: { sycm: sycmResult, selection: selectionResult }
        });
      }

      const distributionResult = await prepareDistribution({
        ...input,
        sycm: sycmResult,
        products: selectionResult.products || []
      });
      if (!distributionResult || distributionResult.ok === false || distributionResult.canSubmit !== true) {
        return flowResponse({
          ok: false,
          status: distributionResult && distributionResult.status ? distributionResult.status : 'distribution_not_ready',
          blockers: distributionResult && Array.isArray(distributionResult.blockers) && distributionResult.blockers.length
            ? distributionResult.blockers
            : ['distribution_not_ready'],
          data: { sycm: sycmResult, selection: selectionResult, distribution: distributionResult }
        });
      }

      return flowResponse({
        ok: true,
        status: 'awaiting_user_confirmation',
        requiresUserAction: true,
        nextActionCode: 'confirm_before_submit',
        keyword: input.keyword,
        runId: distributionResult.runId || sycmResult.runId || '',
        runDir: distributionResult.runDir || sycmResult.runDir || '',
        file: distributionResult.file || '',
        data: {
          sycm: sycmResult,
          selection: selectionResult,
          distribution: distributionResult
        },
        allowedCommands: ['node bin/cli.js workflow resume --confirm-submit --json'],
        nextCommand: 'node bin/cli.js workflow resume --confirm-submit --json',
        userMessage: '选品和铺货清单已准备好。请人工确认商品和店铺后，才允许继续提交。'
      });
    }
  };
}

module.exports = {
  DEFAULT_FLOW_DIR,
  createRunId,
  readJsonl,
  getRun,
  markRunDistributionComplete,
  scoreSycmRows,
  shouldFallbackToNextTier,
  fetchSycmWithFallback,
  appendRunCandidates,
  flowManualStart,
  flowEnrichManualProducts,
  flowReviewProducts,
  flowMine,
  flowReviewCandidates,
  flowVerify,
  flowSelectProducts,
  flowGenerate,
  flowExport,
  flowKeywordStart,
  flowKeyword,
  flowDaily,
  createWorkflowRunner,
  validateGeneratedRow,
  categoryAssessment,
  scoreKeywordOpportunity,
  scoreProductOpportunity,
  summarizeOpportunities
};
