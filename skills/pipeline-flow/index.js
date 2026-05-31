const fs = require('fs');
const path = require('path');
const { mineKeywords } = require('../keyword-mining');
const { generateTitlePipeline } = require('../title-gen');
const { searchAll } = require('../alibaba1688');
const { extractSycmData, DEFAULT_FILTER_CONDITIONS } = require('../sycm-research');

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
    ''
  ];
  rows.forEach((row, index) => {
    lines.push(`## ${index + 1}. ${row.keyword}`);
    lines.push('');
    lines.push(`- URL: ${row.url}`);
    lines.push(`- Title: ${row.title}`);
    lines.push(`- Verify Mode: ${row.verifyMode || (row.sycmScore && row.sycmScore.mode) || '-'}`);
    lines.push(`- Confidence: ${row.confidence || (row.sycmScore && row.sycmScore.confidence) || '-'}`);
    lines.push(`- Usage: ${row.usage || (row.sycmScore && row.sycmScore.usage) || '-'}`);
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

/**
 * Mine candidates and write them into a flow run.
 * @param {object} options Flow options.
 * @returns {object} Step result.
 */
async function flowMine(options = {}) {
  const { runDir, run } = initRun(options);
  const result = mineKeywords({
    count: options.limit || options.mine || 50,
    maxSeeds: options.maxSeeds || 20,
    maxPerSeed: options.maxPerSeed || 30,
    outputMaxPerSeed: options.outputMaxPerSeed || 5,
    outputMaxPerCategory: options.outputMaxPerCategory || 20,
    outputMaxPerPattern: options.outputMaxPerPattern || 20,
    persist: false
  });
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
  const selected = candidates.slice(0, limit);
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
        sycmData: data,
        checkedAt: new Date().toISOString()
      };
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
        status: 'sycm_failed',
        error: error && error.message ? error.message : String(error),
        checkedAt: new Date().toISOString()
      };
      rejected.push(row);
      sycmResults.push({ keyword: candidate.keyword, ok: false, error: row.error });
    }
  }

  appendJsonl(run.files.sycmResults, sycmResults);
  appendJsonl(run.files.verifiedKeywords, verified);
  run.status = verified.length > 0 ? 'verified' : 'verified_empty';
  run.counts.sycmVerified = verified.length;
  run.counts.sycmRejected = rejected.length;
  writeRun(runDir, run);
  return {
    ok: true,
    runId: run.runId,
    status: run.status,
    verified,
    rejected,
    runDir,
    nextCommand: verified.length > 0
      ? buildFlowCommand('generate', run.runId, { limit: options.generate || 10 })
      : buildFlowCommand('inspect', run.runId)
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
        generatedRows.push({
          status: 'generated',
          keyword: item.keyword,
          sycmScore: item.sycmScore,
          sycmData: item.sycmData || [],
          verifyMode: item.verifyMode || '',
          confidence: item.confidence || '',
          usage: item.usage || '',
          fallbackUsed: !!item.fallbackUsed,
          fallbackReason: item.fallbackReason || '',
          product,
          url: productUrl(product),
          title: productTitle(product),
          generatedAt: new Date().toISOString()
        });
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
  run.status = generatedRows.some(row => row.status === 'generated') ? 'generated' : 'generate_failed';
  run.counts.generatedProducts = generatedRows.filter(row => row.status === 'generated').length;
  writeRun(runDir, run);
  return {
    ok: true,
    runId: run.runId,
    status: run.status,
    generated: generatedRows,
    runDir,
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
  const lines = selected.map(row => `${row.url}$$${row.title}`);
  fs.writeFileSync(run.files.distributionBatch, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
  writeDistributionReview(run.files.distributionReview, selected);
  run.status = lines.length > 0 ? 'ready_to_distribute' : 'export_empty';
  run.counts.readyToDistribute = lines.length;
  writeRun(runDir, run);
  return {
    ok: true,
    runId: run.runId,
    status: run.status,
    count: lines.length,
    file: run.files.distributionBatch,
    reviewFile: run.files.distributionReview,
    runDir,
    nextCommand: lines.length > 0 ? '人工检查 distribution-batch.txt 后再调用 1688-distribution' : buildFlowCommand('inspect', run.runId)
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
  if (verify.verified.length === 0) {
    const { run } = getRun({ dataDir: options.dataDir, runId: mine.runId });
    return {
      ok: true,
      runId: mine.runId,
      runDir: mine.runDir,
      counts: run.counts,
      status: run.status,
      files: run.files,
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
  flowDaily
};
