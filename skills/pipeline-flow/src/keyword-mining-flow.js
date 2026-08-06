'use strict';

const fs = require('fs');
const path = require('path');
const { mineKeywords } = require('../../keyword-mining');
const { buildPipelineDiversityHistory } = require('./diversity-history');
const {
  DEFAULT_FLOW_DIR,
  appendJsonl,
  getRun,
  initRun,
  readJsonl,
  readRecentPipelineCandidateKeywords,
  setRunStageMetrics,
  writeRun
} = require('./run-store');
const {
  DEFAULT_FALLBACK_CANDIDATES,
  fallbackCandidates,
  normalizeExternalCandidate
} = require('./candidate-helpers');
const { buildFlowCommand, flowResponse } = require('./flow-context');

/**
 * Append externally discovered keyword candidates into an existing flow run.
 * @param {object} [options] Append options.
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

  if (added.length > 0) appendJsonl(run.files.candidates, added);
  if (!run.status || run.status === 'created') run.status = 'mined';
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
 * Mine candidates and write them into a flow run.
 * @param {object} [options] Flow options.
 * @returns {Promise<object>} Step result.
 */
async function flowMine(options = {}) {
  const { runDir, run } = initRun(options);
  const discoveryAttempt = Math.max(1, Number(run.discovery?.attempt || 0) + 1);
  const diversityHistory = options.diversityHistory || buildPipelineDiversityHistory({
    dataDir: options.dataDir || DEFAULT_FLOW_DIR,
    excludeRunId: run.runId,
    ttlDays: options.diversityHistoryDays || 90
  });
  const historyExcludeKeywords = options.excludeSeen === true
    ? readRecentPipelineCandidateKeywords({
        dataDir: options.dataDir || DEFAULT_FLOW_DIR,
        ttlDays: options.seenTtlDays || 30,
        excludeRunId: run.runId
      })
    : [];
  const discoveryMode = ['inspiration', 'seed', 'hybrid'].includes(String(options.discoveryMode || '').trim())
    ? String(options.discoveryMode).trim()
    : '';
  const miningSource = discoveryMode === 'inspiration' || discoveryMode === 'hybrid'
    ? 'inspiration'
    : options.source || 'local';
  const miningOptions = {
    count: options.limit || options.mine || 50,
    maxSeeds: options.maxSeeds || 20,
    maxObservingSeeds: options.maxObservingSeeds || 3,
    maxObservingPoolSize: options.maxObservingPoolSize ?? 24,
    maxPerSeed: options.maxPerSeed || 30,
    outputMaxPerSeed: options.outputMaxPerSeed || 5,
    outputMaxPerCategory: options.outputMaxPerCategory || 20,
    outputMaxPerPattern: options.outputMaxPerPattern || 20,
    outputMaxPerProductCore: options.outputMaxPerProductCore || 3,
    dataDir: options.keywordDataDir || path.join(process.cwd(), 'data', 'keyword-mining'),
    source: miningSource,
    rootMode: options.rootMode || 'auto',
    rootLimit: options.rootLimit || 5,
    rootCooldownDays: options.rootCooldownDays ?? 7,
    familyCooldownDays: options.familyCooldownDays ?? 7,
    persist: false,
    excludeSeen: options.excludeSeen === true,
    excludeKeywords: [
      ...historyExcludeKeywords,
      ...(Array.isArray(options.excludeKeywords) ? options.excludeKeywords : [])
    ],
    recordSeen: options.recordSeen === true,
    recordSeedFeedback: options.recordSeedFeedback === true,
    autoReplenishSeeds: options.autoReplenishSeeds === true,
    maxNewSeeds: options.maxNewSeeds ?? 3,
    seenTtlDays: options.seenTtlDays || 30,
    mode: options.diversityMode || options.mode || 'balanced',
    diversityHistory,
    allowHistoryFallback: options.allowHistoryFallback === true,
    sycmExtractor: options.sycmExtractor,
    sycmMaxPages: options.inspirationSycmPages ?? options.sycmMaxPages ?? 1,
    sycmPort: options.port || 9222,
    date: options.date,
    runAttempt: options.runAttempt ?? `${run.runId}:${discoveryAttempt}`,
    newsItems: options.newsItems || [],
    newsFeedUrls: options.newsFeedUrls,
    dictionaryWords: options.dictionaryWords,
    trendItems: options.trendItems || [],
    inspirationUseLLM: options.inspirationUseLLM !== false,
    onProgress: options.onProgress
  };
  let result = await mineKeywords(miningOptions);
  if (discoveryMode === 'hybrid' && (!result.candidates || result.candidates.length === 0)) {
    const inspiration = result.inspiration;
    result = await mineKeywords({
      ...miningOptions,
      source: options.seedSource || (options.source && options.source !== 'inspiration' ? options.source : 'sycm_hot')
    });
    result.inspiration = inspiration;
    result.stats = {
      ...(result.stats || {}),
      fallbackUsed: true,
      fallbackReason: 'inspiration_candidates_empty',
      fallbackMode: 'seed'
    };
  }
  fs.writeFileSync(run.files.inspirations, '', 'utf8');
  fs.writeFileSync(run.files.rootCandidates, '', 'utf8');
  if (result.inspiration) {
    appendJsonl(run.files.inspirations, result.inspiration.inspirations || []);
    appendJsonl(run.files.rootCandidates, result.inspiration.roots || []);
  }
  const allowStaticFallback = miningSource === 'inspiration'
    ? options.fallbackCandidates === true
    : options.fallbackCandidates !== false;
  if ((!result.candidates || result.candidates.length === 0) && allowStaticFallback) {
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
  run.counts.inspirations = Number(result.inspiration?.stats?.inspirationCount || 0);
  run.counts.inspirationRejected = Number(result.inspiration?.stats?.inspirationRejected || 0);
  run.counts.productizedRoots = Number(result.inspiration?.stats?.productizedCount || 0);
  run.counts.selectedRoots = Number(result.inspiration?.stats?.selectedRootCount || 0);
  run.discovery = result.inspiration ? {
    mode: 'inspiration',
    attempt: discoveryAttempt,
    stats: result.inspiration.stats,
    files: {
      inspirations: run.files.inspirations,
      rootCandidates: run.files.rootCandidates
    }
  } : { mode: 'seed' };
  run.diversity = {
    ...(run.diversity || {}),
    keyword: {
      ...(result.stats?.diversity || {}),
      seenFiltered: Number(result.stats?.seenFiltered || 0),
      seedReplenished: Number(result.stats?.seedReplenishment?.accepted || 0),
      inspirations: Number(result.inspiration?.stats?.inspirationCount || 0),
      inspirationRejected: Number(result.inspiration?.stats?.inspirationRejected || 0),
      productizedRoots: Number(result.inspiration?.stats?.productizedCount || 0),
      selectedRoots: Number(result.inspiration?.stats?.selectedRootCount || 0),
      inspirationSources: result.inspiration?.stats?.sourceCounts || {},
      observingPoolSize: Number(result.stats?.seedReplenishment?.observingPoolSize || 0),
      observingPoolCapacity: Number(result.stats?.seedReplenishment?.observingPoolCapacity || 0),
      historyRunsScanned: Number(diversityHistory.stats?.runsScanned || 0)
    }
  };
  const rootQueryRows = result.stats?.rootQueries?.rows || [];
  const rootQueryFailures = rootQueryRows.filter(row => row.result === 'failed');
  const chromeFailure = rootQueryFailures.find(row => /ECONNREFUSED|127\.0\.0\.1:9222|no chrome tab found|chrome[^\n]*(?:tab|debug)|cdp|devtools/i.test(String(row.error || '')));
  const platformFailure = rootQueryFailures.find(row => ['login_required', 'slider_required', 'sycm_feature_required'].includes(String(row.status || '')));
  const manualFailure = chromeFailure || platformFailure;
  if (miningSource === 'inspiration' && result.candidates.length === 0) {
    run.status = manualFailure ? 'mining_manual_action_required' : 'mining_empty';
    run.discovery.blocker = chromeFailure
      ? 'sycm_chrome_unavailable'
      : platformFailure
        ? `sycm_${platformFailure.status}`
        : 'no_inspiration_candidates';
    run.discovery.blockerReason = manualFailure?.error || (
      Number(result.inspiration?.stats?.selectedRootCount || 0) === 0
        ? '今日灵感没有选出通过安全、商品化和冷却校验的词根。'
        : '商品词根没有查询到可用的生意参谋关联词。'
    );
    run.discovery.manualAction = manualFailure?.manualAction || null;
  }
  const mineRejected = Number(result.inspiration?.stats?.inspirationRejected || 0)
    + Number(result.stats?.seenFiltered || 0);
  setRunStageMetrics(run, 'mine', {
    input: result.candidates.length + mineRejected,
    passed: result.candidates.length,
    rejected: mineRejected
  }, {
    inspiration_rejected: Number(result.inspiration?.stats?.inspirationRejected || 0),
    recent_keyword_filtered: Number(result.stats?.seenFiltered || 0),
    fallback_used: result.stats?.fallbackUsed ? 1 : 0,
    [run.discovery?.blocker || 'mining_blocked']: ['mining_manual_action_required', 'mining_empty'].includes(run.status) ? 1 : 0
  });
  writeRun(runDir, run);
  const miningBlocked = ['mining_manual_action_required', 'mining_empty'].includes(run.status);
  return flowResponse({
    ok: !miningBlocked,
    runId: run.runId,
    status: run.status,
    candidates: result.candidates,
    stats: result.stats,
    diversity: run.diversity.keyword,
    inspiration: result.inspiration,
    runDir,
    blockers: miningBlocked ? [run.discovery.blocker] : [],
    allowedCommands: miningBlocked ? [] : [buildFlowCommand('review', run.runId)],
    nextCommand: miningBlocked ? '' : buildFlowCommand('review', run.runId),
    platform: manualFailure ? 'sycm' : undefined,
    manualAction: manualFailure
      ? manualFailure.manualAction || {
          platform: 'sycm',
          status: chromeFailure ? 'chrome_unavailable' : platformFailure.status,
          userMessage: chromeFailure
            ? '请启动带 9222 调试端口的 Chrome，登录生意参谋后重试灵感选词。'
            : '请在 Chrome 中处理生意参谋登录、滑块或权限问题后重试灵感选词。'
        }
      : undefined
  });
}

module.exports = {
  appendRunCandidates,
  flowMine
};
