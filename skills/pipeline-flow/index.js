const fs = require('fs');
const path = require('path');
const { mineKeywords } = require('../keyword-mining');
const { generateTitlePipeline } = require('../title-gen');
const { searchAll } = require('../alibaba1688');
const { extractSycmData, DEFAULT_FILTER_CONDITIONS } = require('../sycm-research');
const { checkBannedWords } = require('../../core/banned-words');
const { scoreKeywordOpportunity, scoreProductOpportunity } = require('./src/opportunity-scoring');
const { appendOpportunity, summarizeOpportunities } = require('./src/opportunity-store');

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
      sycmVerified: 0,
      sycmRejected: 0,
      generatedProducts: 0,
      readyToDistribute: 0
    },
    files: {
      candidates: path.join(resolved.runDir, 'candidates.jsonl'),
      sycmResults: path.join(resolved.runDir, 'sycm-results.jsonl'),
      verifiedKeywords: path.join(resolved.runDir, 'verified-keywords.jsonl'),
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
  run.files.sycmResults = run.files.sycmResults || path.join(runDir, 'sycm-results.jsonl');
  run.files.verifiedKeywords = run.files.verifiedKeywords || path.join(runDir, 'verified-keywords.jsonl');
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
  return product && (product['产品链接'] || product.url || product.link || product.productUrl || '');
}

function productTitle(product) {
  return product && (product['铺货标题'] || product.title || product.generatedTitle || product.name || '');
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
  if (context.seenUrls && context.seenUrls.has(url)) reasons.push('duplicate_url');
  if (context.seenTitles && context.seenTitles.has(title)) reasons.push('duplicate_title');
  if (row.verifyMode === 'hot' && Number(context.hotUsed || 0) >= Number(context.hotExportLimit || DEFAULT_HOT_EXPORT_LIMIT)) {
    reasons.push('hot_export_limit');
  }
  if (row.keywordOpportunity && row.keywordOpportunity.decision && row.keywordOpportunity.decision !== 'continue') {
    reasons.push(`keyword_opportunity_${row.keywordOpportunity.decision}`);
  }
  if (row.productOpportunity && row.productOpportunity.decision && row.productOpportunity.decision !== 'continue') {
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

function writeDistributionReview(file, rows) {
  const lines = [
    '# Distribution Review',
    '',
    '人工铺货前请先检查本报告。热搜趋势词不是严格蓝海词，不要当作高置信蓝海使用。',
    '',
    '## Summary',
    '',
    `- Ready: ${rows.filter(row => row.exportStatus === 'ready').length}`,
    `- Rejected: ${rows.filter(row => row.exportStatus === 'rejected_before_distribution').length}`,
    ''
  ];
  rows.forEach((row, index) => {
    lines.push(`## ${index + 1}. ${row.keyword}`);
    lines.push('');
    lines.push(`- Export Status: ${row.exportStatus || 'ready'}`);
    if (row.exportReasons && row.exportReasons.length) lines.push(`- Blockers: ${row.exportReasons.join(', ')}`);
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
  });
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
}

function buildFlowCommand(step, runId, options = {}) {
  const runPart = runId ? ` --run ${runId}` : '';
  if (step === 'verify') return `node bin/cli.js flow verify${runPart} --limit ${options.limit || 20}`;
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

/**
 * Mine candidates and write them into a flow run.
 * @param {object} options Flow options.
 * @returns {object} Step result.
 */
async function flowMine(options = {}) {
  const { runDir, run } = initRun(options);
  const result = await mineKeywords({
    count: options.limit || options.mine || 50,
    maxSeeds: options.maxSeeds || 20,
    maxPerSeed: options.maxPerSeed || 30,
    outputMaxPerSeed: options.outputMaxPerSeed || 5,
    outputMaxPerCategory: options.outputMaxPerCategory || 20,
    outputMaxPerPattern: options.outputMaxPerPattern || 20,
    outputMaxPerProductCore: options.outputMaxPerProductCore || 3,
    persist: false
  });
  if ((!result.candidates || result.candidates.length === 0) && options.fallbackCandidates !== false) {
    result.candidates = fallbackCandidates(options.limit || options.mine || 10);
    result.stats = {
      ...(result.stats || {}),
      fallbackUsed: true,
      fallbackReason: 'keyword_mining_empty'
    };
  }
  fs.writeFileSync(run.files.candidates, '', 'utf8');
  appendJsonl(run.files.candidates, result.candidates);
  run.status = 'mined';
  run.counts.candidates = result.candidates.length;
  writeRun(runDir, run);
  return {
    ok: true,
    runId: run.runId,
    status: run.status,
    candidates: result.candidates,
    runDir,
    blockers: [],
    allowedCommands: [buildFlowCommand('verify', run.runId, { limit: options.verify || 20 })],
    nextCommand: buildFlowCommand('verify', run.runId, { limit: options.verify || 20 })
  };
}

/**
 * Verify candidates against SYCM in a strict serial queue.
 * @param {object} options Flow options.
 * @returns {Promise<object>} Step result.
 */
async function flowVerify(options = {}) {
  const { runDir, run } = getRun(options);
  const candidates = readJsonl(run.files.candidates);
  const limit = Number(options.limit || options.verify || candidates.length || 0);
  const executableCandidates = candidates.filter(function(item) {
    var action = item && item.nextAction;
    return !action || action === 'sycm_verify' || action === 'direct_product_search';
  });
  const selected = executableCandidates.slice(0, limit);
  const verified = [];
  const rejected = [];
  const sycmResults = [];
  const sycmExtractor = options.sycmExtractor || extractSycmData;

  fs.writeFileSync(run.files.sycmResults, '', 'utf8');
  fs.writeFileSync(run.files.verifiedKeywords, '', 'utf8');

  for (const candidate of selected) {
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
        status: row.status,
        error: row.error,
        manualAction: row.manualAction
      });
      if (error && ['login_required', 'slider_required', 'sycm_feature_required'].includes(error.status)) {
        break;
      }
    }
  }

  appendJsonl(run.files.sycmResults, sycmResults);
  appendJsonl(run.files.verifiedKeywords, verified);
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
    : (verified.length > 0 ? 'verified' : 'verified_empty');
  run.counts.sycmVerified = verified.length;
  run.counts.sycmRejected = rejected.length;
  writeRun(runDir, run);
  const nextCommand = hasManualAction
    ? buildFlowCommand('inspect', run.runId)
    : (verified.length > 0
      ? buildFlowCommand('generate', run.runId, { limit: options.generate || 10 })
      : buildFlowCommand('inspect', run.runId));
  return {
    ok: true,
    runId: run.runId,
    status: run.status,
    verified,
    rejected,
    runDir,
    blockers: hasManualAction
      ? ['sycm_manual_action_required']
      : (verified.length > 0 ? [] : ['no_verified_keywords']),
    allowedCommands: [nextCommand],
    nextCommand: nextCommand
  };
}

/**
 * Generate products and titles for verified keywords.
 * @param {object} options Flow options.
 * @returns {Promise<object>} Step result.
 */
async function flowGenerate(options = {}) {
  const { runDir, run } = getRun(options);
  const verified = readJsonl(run.files.verifiedKeywords);
  const limit = Number(options.limit || options.generate || verified.length || 0);
  const selected = verified.slice(0, limit);
  const generator = options.generator || generateTitlePipeline;
  const generatedRows = [];

  fs.writeFileSync(run.files.generatedProducts, '', 'utf8');

  for (const item of selected) {
    try {
      const result = await generator(item.keyword, {
        maxLength: Number(options.length || 60),
        limit: Number(options.productLimit || 0),
        silent: true,
        sycmData: item.sycmData || [],
        searchProducts: options.searchProducts || (({ coreWord, blueOceanWord, modifiers, semanticGroups }) =>
          searchAll(coreWord, blueOceanWord, modifiers, semanticGroups))
      });
      const products = Array.isArray(result.products) ? result.products : [];
      for (const product of products.slice(0, Number(options.productsPerKeyword || 3))) {
        const row = {
          status: 'generated',
          keyword: item.keyword,
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
          title: productTitle(product),
          generatedAt: new Date().toISOString()
        };
        const productOpportunity = scoreProductOpportunity(product, {
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
  writeRun(runDir, run);
  return {
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
  };
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
      seenTitles
    });
    const exportRow = {
      ...row,
      exportStatus: validation.ok ? 'ready' : 'rejected_before_distribution',
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
  const rejectedRows = reviewed.filter(row => row.exportStatus !== 'ready');
  appendOpportunity('rejected', rejectedRows.map(row => ({
    runId: run.runId,
    keyword: row.keyword,
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
    : 'export_empty';
  run.counts.readyToDistribute = lines.length;
  run.counts.rejectedBeforeDistribution = rejectedRows.length;
  writeRun(runDir, run);
  return {
    ok: true,
    runId: run.runId,
    status: run.status,
    count: lines.length,
    rejected: rejectedRows.length,
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
  };
}

/**
 * Run the first version of the daily flow: mine, verify, generate, export.
 * @param {object} options Flow options.
 * @returns {Promise<object>} Daily flow result.
 */
async function flowDaily(options = {}) {
  const mine = await flowMine({ ...options, limit: options.mine || options.limit || 50 });
  const verify = await flowVerify({ ...options, runId: mine.runId, limit: options.verify || 20 });
  if (verify.verified.length === 0 || verify.blockers.includes('sycm_manual_action_required')) {
    const { run } = getRun({ dataDir: options.dataDir, runId: mine.runId });
    return {
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
        verified: 0,
        rejected: verify.rejected.length,
        generated: 0,
        exported: 0
      }
    };
  }

  const generate = await flowGenerate({ ...options, runId: mine.runId, limit: options.generate || 10 });
  const generatedCount = generate.generated.filter(row => row.status === 'generated').length;
  if (generatedCount === 0) {
    const { run } = getRun({ dataDir: options.dataDir, runId: mine.runId });
    return {
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
        verified: verify.verified.length,
        rejected: verify.rejected.length,
        generated: 0,
        exported: 0
      }
    };
  }

  const exported = await flowExport({ ...options, runId: mine.runId, limit: options.export || 20 });
  const { run } = getRun({ dataDir: options.dataDir, runId: mine.runId });
  return {
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
      verified: verify.verified.length,
      rejected: verify.rejected.length,
      generated: generatedCount,
      exported: exported.count
    }
  };
}

module.exports = {
  DEFAULT_FLOW_DIR,
  createRunId,
  readJsonl,
  scoreSycmRows,
  shouldFallbackToNextTier,
  fetchSycmWithFallback,
  flowMine,
  flowVerify,
  flowGenerate,
  flowExport,
  flowDaily,
  validateGeneratedRow,
  categoryAssessment,
  scoreKeywordOpportunity,
  scoreProductOpportunity,
  summarizeOpportunities
};
