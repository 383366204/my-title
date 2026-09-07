'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeRootKeywords } = require('../../../core/root-keywords');
const { extractSycmData } = require('../../sycm-research');
const { gateCandidate, keywordSignature, scoreKeyword } = require('../../keyword-mining');
const {
  appendJsonl,
  initRun,
  readJsonl,
  setRunStageMetrics,
  writeRun
} = require('./run-store');
const { flowResponse } = require('./flow-context');
const { waitInterruptibly } = require('./sycm-request-scheduler');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_error) {
    return fallback;
  }
}

function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value || '').replace(/,/g, '').trim();
  if (!text) return 0;
  const parsed = Number.parseFloat(text.replace(/%$/, ''));
  if (!Number.isFinite(parsed)) return 0;
  return text.endsWith('%') ? parsed / 100 : parsed;
}

function sycmMetrics(row = {}) {
  return {
    searchPopularity: parseNumber(row.searchPopularity),
    clickRate: parseNumber(row.clickRate),
    clickPopularity: parseNumber(row.clickPopularity),
    demandSupplyRatio: parseNumber(row.demandSupplyRatio),
    payConversionRate: parseNumber(row.payConversionRate || row.conversionRate),
    conversionRate: parseNumber(row.conversionRate || row.payConversionRate),
    buyerCount: parseNumber(row.buyerCount || row.payBuyerCount),
    onlineProductCount: parseNumber(row.onlineProductCount || row.productCount || row.competitionCount),
    trend: parseNumber(row.trend || row.trendRate || row.searchTrend)
  };
}

function rootCandidateMarketScore(metrics = {}) {
  const search = Math.min(25, Math.log10(Math.max(1, metrics.searchPopularity || 0)) / 5 * 25);
  const demand = Math.min(25, Math.max(0, Number(metrics.demandSupplyRatio || 0)) / 3 * 25);
  const conversion = Math.min(15, Math.max(0, Number(metrics.conversionRate || 0)) / 0.08 * 15);
  const click = Math.min(10, Math.max(0, Number(metrics.clickRate || 0)) / 0.5 * 10);
  const trend = Math.min(10, Math.max(0, Number(metrics.trend || 0)) / 0.5 * 10);
  const competition = metrics.onlineProductCount > 0
    ? Math.min(10, Math.log10(metrics.onlineProductCount + 1) / 7 * 10)
    : 0;
  return Math.max(0, Math.min(100, Math.round(search + demand + conversion + click + trend + 15 - competition)));
}

function recommendedCategory(result = {}) {
  return String(result?.categoryAnalysis?.recommendation?.recommended?.category || '').trim();
}

function buildRootCandidate(row, root, result, options = {}) {
  const keyword = String(row?.keyword || '').trim();
  if (!keyword) return null;
  const normalizedSignature = keywordSignature(keyword);
  const scored = scoreKeyword({
    keyword,
    seed: root,
    category: recommendedCategory(result),
    pattern: 'sycm-root-expansion'
  });
  const metrics = sycmMetrics(row);
  const marketScore = rootCandidateMarketScore(metrics);
  const collectedAt = new Date().toISOString();
  const candidate = {
    date: collectedAt.slice(0, 10),
    keyword,
    seed: root,
    root,
    sourceRoots: [root],
    source: 'sycm_root_expansion',
    category: recommendedCategory(result),
    recommendedCategory: recommendedCategory(result),
    categorySource: recommendedCategory(result) ? 'sycm' : '',
    pattern: 'sycm-root-expansion',
    localScore: scored.localScore,
    marketScore,
    tier: marketScore >= 75 ? 'high' : marketScore >= 55 ? 'mid' : 'low',
    reason: `来自词根「${root}」的生意参谋关联词`,
    nextAction: scored.nextAction === 'reject' ? 'reject' : 'sycm_verify',
    flags: scored.flags || [],
    coreProduct: scored.coreProduct || '',
    familyKey: scored.coreProduct || '',
    signature: scored.signature || normalizedSignature.signature,
    productSignature: scored.productSignature || normalizedSignature.productSignature || scored.coreProduct || keyword,
    rigid: scored.rigid || [],
    optional: scored.optional || [],
    sycmData: metrics,
    sycmEvidence: {
      keyword,
      root,
      mode: options.sycmMode || 'hot',
      period: options.period || '7d',
      compareType: options.compareType || 'cycle',
      collectedAt
    }
  };
  return { ...candidate, ...gateCandidate(candidate, { minSearchPopularity: 0 }) };
}

function mergeCandidate(target, incoming) {
  if (!target) return incoming;
  const sourceRoots = [...new Set([...(target.sourceRoots || [target.root]), ...(incoming.sourceRoots || [incoming.root])].filter(Boolean))];
  const better = Number(incoming.marketScore || 0) > Number(target.marketScore || 0) ? incoming : target;
  return {
    ...better,
    sourceRoots,
    sourceRootCount: sourceRoots.length,
    reason: `由 ${sourceRoots.length} 个词根发现：${sourceRoots.join('、')}`
  };
}

function isManualSycmError(error) {
  const status = String(error?.status || '');
  if (error?.code === 'PLATFORM_ACCESS_BLOCKED' || error?.code === 'PLATFORM_ACCESS_LOCK_TIMEOUT') return true;
  if (['login_required', 'slider_required', 'sycm_feature_required', 'permission_required', 'rate_limited', 'transient_failures', 'lock_timeout'].includes(status)) return true;
  return /ECONNREFUSED|127\.0\.0\.1:9222|No Chrome tab found|Chrome[^\n]*(?:tab|debug)|CDP|DevTools/i.test(String(error?.message || ''));
}

function queueFiles(runDir, run) {
  run.files.rootInput = run.files.rootInput || path.join(runDir, 'root-input.json');
  run.files.rootQueryQueue = run.files.rootQueryQueue || path.join(runDir, 'root-query-queue.json');
  run.files.rootQueryResults = run.files.rootQueryResults || path.join(runDir, 'root-query-results.jsonl');
  return {
    input: run.files.rootInput,
    queue: run.files.rootQueryQueue,
    results: run.files.rootQueryResults
  };
}

function persistCandidates(file, candidateMap) {
  fs.writeFileSync(file, '', 'utf8');
  appendJsonl(file, [...candidateMap.values()].sort((left, right) => (
    Number(right.marketScore || 0) - Number(left.marketScore || 0)
      || String(left.keyword || '').localeCompare(String(right.keyword || ''), 'zh-CN')
  )));
}

/**
 * Expand arbitrary user roots through a persisted, rate-controlled SYCM queue.
 * @param {object} options Flow options.
 * @returns {Promise<object>} Expansion result.
 */
async function flowExpandRootKeywords(options = {}) {
  const normalized = normalizeRootKeywords(options.roots || options.rootsText);
  if (normalized.roots.length === 0) throw new Error('请至少输入一个词根');
  const { runDir, run } = initRun({
    dataDir: options.dataDir,
    runId: options.runId,
    options: {
      mode: 'root-keyword',
      roots: normalized.roots,
      rootsText: normalized.roots.join('\n'),
      sycmMode: options.sycmMode || 'hot',
      period: options.period || '7d',
      compareType: options.compareType || 'cycle'
    }
  });
  const files = queueFiles(runDir, run);

  writeJson(files.input, {
    roots: normalized.roots,
    duplicates: normalized.duplicates,
    inputCount: normalized.roots.length + normalized.duplicates.length,
    uniqueCount: normalized.roots.length,
    updatedAt: new Date().toISOString()
  });

  const previousQueue = readJson(files.queue, null);
  const previousByRoot = new Map((previousQueue?.items || []).map(item => [item.root, item]));
  const queue = {
    version: 1,
    items: normalized.roots.map((root, index) => {
      const previous = previousByRoot.get(root);
      if (!previous) return { index, root, status: 'pending', attempts: 0, candidateCount: 0 };
      return { ...previous, index, status: previous.status === 'running' ? 'pending' : previous.status };
    }),
    updatedAt: new Date().toISOString()
  };
  writeJson(files.queue, queue);

  const candidateMap = new Map(readJsonl(run.files.candidates).map(row => [String(row.keyword || '').replace(/\s+/g, '').toLowerCase(), row]));
  const sycmExtractor = options.sycmExtractor || extractSycmData;
  const shouldStop = options.shouldStop || (() => null);
  const maxRetries = Math.max(0, Number(options.sycmMaxRetries ?? 2));
  const retryBaseMs = Math.max(0, Number(options.sycmRetryBaseMs ?? 120000));
  const policy = {
    minIntervalMs: Math.max(0, Number(options.sycmMinIntervalMs ?? 45000)),
    maxIntervalMs: Math.max(0, Number(options.sycmMaxIntervalMs ?? 90000)),
    batchSize: Math.max(1, Number(options.sycmBatchSize ?? 10)),
    minBatchCooldownMs: Math.max(0, Number(options.sycmMinBatchCooldownMs ?? 300000)),
    maxBatchCooldownMs: Math.max(0, Number(options.sycmMaxBatchCooldownMs ?? 600000))
  };

  let completedCount = queue.items.filter(item => item.status === 'completed').length;
  let failedCount = queue.items.filter(item => item.status === 'failed').length;
  for (const item of queue.items) {
    if (item.status === 'completed' || item.status === 'skipped') continue;
    let finished = false;
    while (!finished) {
      const requestedAction = shouldStop();
      if (requestedAction) {
        item.status = 'pending';
        writeJson(files.queue, { ...queue, updatedAt: new Date().toISOString() });
        return flowResponse({
          ok: true,
          runId: run.runId,
          runDir,
          status: requestedAction === 'cancel' ? 'cancelled' : 'paused',
          stepIncomplete: true,
          candidates: [...candidateMap.values()]
        });
      }

      item.status = 'running';
      item.attempts = Number(item.attempts || 0) + 1;
      item.startedAt = new Date().toISOString();
      writeJson(files.queue, { ...queue, updatedAt: new Date().toISOString() });
      options.onProgress?.({
        current: completedCount,
        total: queue.items.length,
        message: `生意参谋拓词 ${completedCount + 1}/${queue.items.length} · ${item.root}`
      });

      try {
        const result = await sycmExtractor(item.root, {
          mode: options.sycmMode || 'hot',
          maxPages: Number(options.sycmMaxPages || 9999),
          port: Number(options.port || 9222),
          pageFilters: {
            timePeriod: options.period || '7d',
            compareType: options.compareType || 'cycle'
          },
          guardMinCooldownMs: policy.minIntervalMs,
          guardMaxCooldownMs: policy.maxIntervalMs,
          guardBatchSize: policy.batchSize,
          guardMinBatchCooldownMs: policy.minBatchCooldownMs,
          guardMaxBatchCooldownMs: policy.maxBatchCooldownMs,
          random: options.random,
          shouldStop,
          onProgress: message => options.onProgress?.({
            current: completedCount,
            total: queue.items.length,
            message: `${item.root}：${String(message || '').replace(/^\[[^\]]+\]\s*/, '')}`
          })
        });
        const rows = Array.isArray(result.data) ? result.data : [];
        for (const row of rows) {
          const candidate = buildRootCandidate(row, item.root, result, options);
          if (!candidate) continue;
          const key = String(candidate.keyword).replace(/\s+/g, '').toLowerCase();
          candidateMap.set(key, mergeCandidate(candidateMap.get(key), candidate));
        }
        persistCandidates(run.files.candidates, candidateMap);
        item.status = 'completed';
        item.candidateCount = rows.length;
        item.completedAt = new Date().toISOString();
        item.error = '';
        completedCount += 1;
        appendJsonl(files.results, {
          root: item.root,
          status: 'completed',
          candidateCount: rows.length,
          recommendedCategory: recommendedCategory(result),
          completedAt: item.completedAt
        });
        finished = true;
      } catch (error) {
        item.error = error.message;
        item.lastFailedAt = new Date().toISOString();
        if (error?.code === 'PLATFORM_ACCESS_INTERRUPTED') {
          item.status = 'pending';
          writeJson(files.queue, { ...queue, updatedAt: new Date().toISOString() });
          return flowResponse({
            ok: true,
            runId: run.runId,
            runDir,
            status: error.status === 'cancel' ? 'cancelled' : 'paused',
            stepIncomplete: true,
            candidates: [...candidateMap.values()]
          });
        }
        if (isManualSycmError(error)) {
          item.status = 'blocked';
          writeJson(files.queue, { ...queue, updatedAt: new Date().toISOString() });
          run.status = 'mining_manual_action_required';
          run.discovery = {
            mode: 'user_roots',
            blocker: /9222|Chrome|CDP|DevTools/i.test(error.message) ? 'sycm_chrome_unavailable' : `sycm_${error.status || 'manual_action_required'}`,
            blockerReason: error.message,
            manualAction: error.details || null,
            queue: { total: queue.items.length, completed: completedCount, failed: failedCount, activeRoot: item.root }
          };
          run.counts.candidates = candidateMap.size;
          writeRun(runDir, run);
          return flowResponse({
            ok: false,
            runId: run.runId,
            runDir,
            status: run.status,
            stepIncomplete: true,
            candidates: [...candidateMap.values()],
            blockers: [run.discovery.blocker],
            platform: 'sycm',
            manualAction: error.details || {
              platform: 'sycm',
              status: 'chrome_unavailable',
              userMessage: '请启动带 9222 调试端口的 Chrome，登录生意参谋后重试拓词。'
            }
          });
        }
        if (item.attempts <= maxRetries) {
          item.status = 'cooling_down';
          writeJson(files.queue, { ...queue, updatedAt: new Date().toISOString() });
          const backoffMs = retryBaseMs * Math.pow(4, item.attempts - 1);
          const waitResult = await waitInterruptibly(backoffMs, {
            sleep: options.sleep,
            shouldStop,
            onWait: remainingMs => options.onProgress?.({
              current: completedCount,
              total: queue.items.length,
              message: `「${item.root}」查询失败，${Math.ceil(remainingMs / 1000)} 秒后重试`
            })
          });
          if (waitResult.interrupted) {
            item.status = 'pending';
            writeJson(files.queue, { ...queue, updatedAt: new Date().toISOString() });
            return flowResponse({ ok: true, runId: run.runId, runDir, status: 'paused', stepIncomplete: true, candidates: [...candidateMap.values()] });
          }
        } else {
          item.status = 'failed';
          failedCount += 1;
          appendJsonl(files.results, {
            root: item.root,
            status: 'failed',
            attempts: item.attempts,
            error: item.error,
            failedAt: item.lastFailedAt
          });
          finished = true;
        }
      }
      writeJson(files.queue, { ...queue, updatedAt: new Date().toISOString() });
    }
  }

  run.status = candidateMap.size > 0 ? 'mined' : 'mining_empty';
  run.counts.candidates = candidateMap.size;
  run.counts.rootQueries = queue.items.length;
  run.counts.rootQueriesCompleted = completedCount;
  run.counts.rootQueriesFailed = failedCount;
  run.discovery = {
    mode: 'user_roots',
    stats: {
      inputRoots: normalized.roots.length + normalized.duplicates.length,
      uniqueRoots: normalized.roots.length,
      duplicateRoots: normalized.duplicates.length,
      completedRoots: completedCount,
      failedRoots: failedCount,
      candidates: candidateMap.size
    },
    files: { rootInput: files.input, rootQueryQueue: files.queue, rootQueryResults: files.results }
  };
  setRunStageMetrics(run, 'mine', {
    input: normalized.roots.length,
    passed: completedCount,
    rejected: failedCount
  }, { root_query_failed: failedCount });
  writeRun(runDir, run);
  options.onProgress?.({
    current: queue.items.length,
    total: queue.items.length,
    message: `拓词完成，共发现 ${candidateMap.size} 个候选词`
  });
  return flowResponse({
    ok: candidateMap.size > 0,
    runId: run.runId,
    runDir,
    status: run.status,
    candidates: [...candidateMap.values()],
    stats: run.discovery.stats,
    blockers: candidateMap.size > 0 ? [] : ['no_root_candidates']
  });
}

module.exports = {
  buildRootCandidate,
  flowExpandRootKeywords,
  mergeCandidate,
  rootCandidateMarketScore
};
