const fs = require('fs');
const path = require('path');
const { DEFAULT_DATA_DIR, addSeed, listSeeds, loadSeeds, normalizeKeyword } = require('./seed-store');
const { expandSeeds } = require('./expand-keywords');
const { scoreKeyword } = require('./score-keyword');
const { precheckCandidates } = require('./sycm-precheck');
const { generateAIKeywordCandidates } = require('./ai-mine-keywords');
const { gateCandidate } = require('./candidate-gate');
const { loadSeen, recordSeen } = require('./seen-store');
const { selectShortRoots, recordRootQueries } = require('./root-keywords');
const { applySeedFeedback } = require('./seed-feedback');
const { auditSeedPool } = require('./seed-profile');
const { scheduleSeedProfiles } = require('./seed-profile');
const { prepareSeedSuggestions } = require('./seed-suggestions');
const { productFamily } = require('./product-words');
const { selectDiverseCandidates } = require('./diversity-selector');
const { discoverInspirationRoots } = require('./inspiration-engine');

const CANDIDATES_FILE = 'candidates.jsonl';
const MINING_PROGRESS_TOTAL = 6;

function ensureDir(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function stringifyAsciiJson(value) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, char => {
    return '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0');
  });
}

function writeCandidates(candidates, dataDir) {
  ensureDir(dataDir);
  const file = path.join(dataDir, CANDIDATES_FILE);
  for (const item of candidates) {
    fs.appendFileSync(file, stringifyAsciiJson(item) + '\n', 'utf8');
  }
}

function clusterBySignature(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.signature || item.keyword;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...item, cluster: [item.keyword], clusterSize: 1 });
      continue;
    }
    existing.cluster = [...new Set([...(existing.cluster || []), item.keyword])];
    existing.clusterSize = existing.cluster.length;
    const better = item.localScore > existing.localScore
      || (item.localScore === existing.localScore && item.keyword.length > existing.keyword.length);
    if (better) {
      groups.set(key, {
        ...item,
        cluster: existing.cluster,
        clusterSize: existing.cluster.length
      });
    }
  }
  return [...groups.values()];
}

function diversifyCandidates(items, { count, maxPerSeed = 5, maxPerCategory = 20, maxPerPattern = 20, maxPerSignature = 1, maxPerProductCore = 3 } = {}) {
  return selectDiverseCandidates(items, {
    count,
    maxPerSeed,
    maxPerCategory,
    maxPerPattern,
    maxPerSignature,
    maxPerProductCore
  }).selected;
}

function buildNextCommands(keyword) {
  const escaped = String(keyword || '').replace(/"/g, '\\"');
  return {
    sycm: `node bin/cli.js sycm "${escaped}" --mode hot --json`,
    hotCheck: `node bin/cli.js sycm "${escaped}" --mode hot --json`,
    blueExplore: `node bin/cli.js sycm "${escaped}" --mode blue --json`,
    titleResearch: `node bin/cli.js "${escaped}" --research`,
    titleGenerate: `node bin/cli.js "${escaped}" --json`
  };
}

function thresholdForMode(mode) {
  if (mode === 'strict') return 68;
  if (mode === 'explore') return 45;
  return 55;
}

function normalizeSource(source) {
  const value = String(source || 'local').trim().toLowerCase();
  if (['local', 'ai', 'hybrid', 'sycm_hot', 'sycm_blue', 'inspiration'].includes(value)) return value;
  throw new Error(`Unsupported keyword mining source: ${source}`);
}

function parseSearchPop(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const m = String(val).replace(/,/g, '').match(/(\d[\d]*)/);
  return m ? parseInt(m[1], 10) : 0;
}

function parsePercentOrNumber(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const str = String(val).trim();
  if (str.endsWith('%')) {
    const num = parseFloat(str.slice(0, -1));
    return Number.isFinite(num) ? num / 100 : 0;
  }
  const num = parseFloat(str);
  return Number.isFinite(num) ? num : 0;
}

function buildStats({ seeds, expanded, scored, clustered, threshold, source, aiMeta = null }) {
  return {
    source,
    seeds: seeds.length,
    expanded: expanded.length,
    scored: scored.length,
    clustered: clustered ? clustered.length : scored.length,
    duplicatesRemoved: clustered ? scored.length - clustered.length : 0,
    threshold,
    high: scored.filter(item => item.tier === 'high').length,
    mid: scored.filter(item => item.tier === 'mid').length,
    low: scored.filter(item => item.tier === 'low').length,
    rejected: scored.filter(item => item.nextAction === 'reject').length,
    ai: aiMeta
  };
}

function createProgressReporter(onProgress) {
  return function reportProgress(event = {}) {
    if (typeof onProgress !== 'function') return;
    onProgress({
      current: 0,
      total: 0,
      ...event
    });
  };
}

function directSeedCandidates(seeds) {
  return seeds
    .filter(seed => seed.type === 'direct')
    .map(seed => ({
      keyword: seed.keyword,
      seed: seed.keyword,
      category: seed.category || '',
      pattern: 'direct-seed'
    }));
}

/**
 * Keep one highest-ranked seed per semantic product family.
 * @param {Array<object>} seeds Enriched seeds sorted by preference.
 * @returns {Array<object>} Family-deduped seeds.
 */
function dedupeSeedFamilies(seeds = []) {
  const families = new Set();
  return seeds.filter(seed => {
    const familyKey = seed.familyKey || seed.coreProduct || seed.keyword;
    if (families.has(familyKey)) return false;
    families.add(familyKey);
    return true;
  });
}

function buildDirectKeywords(seeds, limit = 20) {
  return directSeedCandidates(seeds).slice(0, limit).map(item => {
    const scoredItem = scoreKeyword(item);
    return {
      keyword: item.keyword,
      category: item.category || '',
      pattern: item.pattern,
      localScore: scoredItem.localScore,
      tier: scoredItem.tier,
      reason: 'direct 种子：已足够具体，可直接进入选品或先做 hot/blue 双验证',
      nextAction: 'direct_product_search',
      nextCommands: buildNextCommands(item.keyword)
    };
  });
}

/**
 * Mine daily candidate keywords from seed pool.
 * @param {object} [options] Options.
 * @param {number} [options.count=50] Candidate count.
 * @param {string} [options.dataDir] Data directory.
 * @param {number} [options.maxSeeds=20] Max seeds to use.
 * @param {number} [options.maxPerSeed=30] Max expansions per seed.
 * @param {number} [options.outputMaxPerSeed=5] Output cap per seed.
 * @param {number} [options.outputMaxPerCategory=20] Output cap per category.
 * @param {number} [options.outputMaxPerPattern=20] Output cap per expansion pattern.
 * @param {number} [options.outputMaxPerProductCore=3] Output cap per core product.
 * @param {boolean} [options.persist=true] Whether to append candidates.jsonl.
 * @param {boolean} [options.sycmPrecheck=false] Whether to run SYCM precheck.
 * @param {number} [options.minSearchPopularity=50] Min SYCM search popularity.
 * @param {boolean} [options.includeDirect=false] Whether direct seeds should also appear in candidates.
 * @param {boolean} [options.excludeSeen=false] Whether recent output keywords should be skipped.
 * @param {string[]} [options.excludeKeywords] Additional keywords to skip.
 * @param {boolean} [options.recordSeen=false] Whether selected keywords should be recorded as seen.
 * @param {number} [options.seenTtlDays=30] Recent seen keyword TTL.
 * @param {string} [options.mode=balanced] strict/balanced/explore threshold mode.
 * @param {Function} [options.onProgress] Optional progress callback.
 * @param {object|null} [options.diversityHistory] Recent pipeline history snapshot.
 * @returns {Promise<{ok:boolean,date:string,seedsUsed:number,directKeywords:Array<object>,candidates:Array<object>,stats:object,precheckStats?:object}>}
 */
async function mineKeywords({ count = 50, dataDir = DEFAULT_DATA_DIR, maxSeeds = 20, maxObservingSeeds = 3, maxObservingPoolSize = 24, maxPerSeed = 30, outputMaxPerSeed = 5, outputMaxPerCategory = 20, outputMaxPerPattern = 20, outputMaxPerProductCore = 3, persist = true, sycmPrecheck = false, minSearchPopularity = 50, includeDirect = false, excludeSeen = false, excludeKeywords = [], recordSeen: shouldRecordSeen = false, recordSeedFeedback = false, autoReplenishSeeds = false, maxNewSeeds = 3, seenTtlDays = 30, mode = 'balanced', source = 'local', aiCandidates = 80, aiBatchSize = 20, llmClient = null, onProgress = null, rootMode = 'auto', rootLimit = 5, rootCooldownDays = 7, familyCooldownDays = 7, recordRootHistory = true, sycmExtractor = null, sycmMaxPages = 1, sycmPort = 9222, diversityHistory = null, allowHistoryFallback = false, date = new Date().toISOString().slice(0, 10), runAttempt = 0, newsItems = [], newsFeedUrls, dictionaryWords, trendItems = [], inspirationUseLLM = true } = {}) {
  const effectiveSource = normalizeSource(source);
  const lifecycleSeeds = effectiveSource === 'inspiration' ? [] : listSeeds({ dataDir, includePaused: true });
  const auditedSeeds = auditSeedPool(lifecycleSeeds).profiles;
  const seeds = scheduleSeedProfiles(auditedSeeds, {
    maxSeeds: Number(maxSeeds || 20),
    maxObservingSeeds: Number(maxObservingSeeds || 3),
    coolingRetryDays: 3
  });
  const executableSeeds = seeds.filter(seed => ['discovery_root', 'direct_candidate'].includes(seed.role));
  const expandableBeforeDedupe = executableSeeds.filter(seed => seed.type !== 'direct' && seed.role === 'discovery_root');
  const expandableSeeds = dedupeSeedFamilies(expandableBeforeDedupe);
  const reportProgress = createProgressReporter(onProgress);
  reportProgress({
    stage: effectiveSource === 'inspiration' ? 'collect-inspirations' : 'load-seeds',
    current: 1,
    total: MINING_PROGRESS_TOTAL,
    message: effectiveSource === 'inspiration' ? '收集新闻、字典与日历灵感' : '读取种子池'
  });
  if (recordSeedFeedback && executableSeeds.length > 0) {
    applySeedFeedback(executableSeeds.map(seed => ({
      root: seed.keyword,
      originalKeyword: seed.keyword,
      runs: 1
    })), { dataDir, eventType: 'seed-scheduled' });
  }
  let aiMeta = null;
  let aiExpanded = [];
  let inspirationDiscovery = null;
  const rootResults = [];
  if (effectiveSource === 'inspiration') {
    inspirationDiscovery = await discoverInspirationRoots({
      date,
      runAttempt,
      rootLimit: Number(rootLimit || 8),
      rootCooldownDays: Number(rootCooldownDays ?? 14),
      familyCooldownDays: Number(familyCooldownDays ?? 7),
      history: diversityHistory,
      llmClient,
      useLLM: inspirationUseLLM,
      newsItems,
      newsFeedUrls,
      dictionaryWords,
      trendItems
    });
    reportProgress({
      stage: 'productize-inspirations',
      current: 2,
      total: MINING_PROGRESS_TOTAL,
      message: `灵感 ${inspirationDiscovery.stats.inspirationCount} 条，选出词根 ${inspirationDiscovery.selectedRoots.length} 个`
    });
  }
  if (effectiveSource === 'ai' || effectiveSource === 'hybrid') {
    reportProgress({
      stage: 'ai-expand',
      current: 2,
      total: MINING_PROGRESS_TOTAL,
      message: 'AI 扩展候选词'
    });
    try {
      const aiResult = await generateAIKeywordCandidates({
        seeds: expandableSeeds,
        maxCandidates: Number(aiCandidates || 80),
        batchSize: Number(aiBatchSize || 20),
        llmClient,
        date
      });
      aiExpanded = aiResult.candidates;
      aiMeta = {
        ...(aiResult.meta || {}),
        generated: aiExpanded.length
      };
      reportProgress({
        stage: 'ai-expand',
        current: 2,
        total: MINING_PROGRESS_TOTAL,
        message: `AI 扩展候选词 ${aiExpanded.length} 个`
      });
    } catch (error) {
      if (effectiveSource === 'ai') throw error;
      aiMeta = {
        provider: llmClient && llmClient.provider ? llmClient.provider : 'llm',
        model: llmClient && llmClient.model ? llmClient.model : '',
        requested: Number(aiCandidates || 80),
        generated: 0,
        error: error.message
      };
      reportProgress({
        stage: 'ai-expand',
        current: 2,
        total: MINING_PROGRESS_TOTAL,
        message: 'AI 扩展失败，改用本地规则'
      });
    }
  }
  const localExpanded = effectiveSource === 'local' || effectiveSource === 'hybrid'
    ? expandSeeds(expandableSeeds, { maxPerSeed })
    : [];
  if (effectiveSource === 'local' || effectiveSource === 'hybrid') {
    reportProgress({
      stage: 'expand',
      current: 2,
      total: MINING_PROGRESS_TOTAL,
      message: `扩展候选词 ${localExpanded.length} 个`
    });
  }

  let sycmExpanded = [];
  if (effectiveSource === 'sycm_hot' || effectiveSource === 'sycm_blue' || effectiveSource === 'inspiration') {
    const isBlue = effectiveSource === 'sycm_blue';
    const sycmMode = isBlue ? 'blue' : 'hot';
    const roots = effectiveSource === 'inspiration'
      ? inspirationDiscovery.selectedRoots.map(item => ({
          ...item,
          root: item.rootKeyword,
          originalKeyword: item.rootKeyword,
          category: item.category || item.familyKey || ''
        }))
      : rootMode === 'seed'
        ? expandableSeeds.map(seed => ({ root: seed.keyword, originalKeyword: seed.keyword, category: seed.category || '' }))
        : selectShortRoots(expandableSeeds, { dataDir, limit: rootLimit, cooldownDays: rootCooldownDays });
    const querySeeds = roots;
    console.log(`🔌 开始生意参谋关联词挖掘模式: ${sycmMode}，查询 ${querySeeds.length} 个词根...`);
    for (let seedIndex = 0; seedIndex < querySeeds.length; seedIndex++) {
      const seed = querySeeds[seedIndex];
      const query = seed.root || seed.keyword;
      try {
        reportProgress({
          stage: 'sycm-expand',
          current: seedIndex,
          total: querySeeds.length,
          message: `查询生意参谋关联词：${query}`
        });
        console.log(`🔍 正在查询词根 "${query}" 的生意参谋关联词...`);
        const extractor = sycmExtractor || require('../../sycm-research').extractSycmData;
        const sycmRes = await extractor(query, {
          mode: sycmMode,
          maxPages: Math.max(1, Number(sycmMaxPages || 1)),
          port: Number(sycmPort || 9222)
        });
        const items = sycmRes.data || [];
        rootResults.push({ ...seed, result: items.length > 0 ? 'success' : 'empty', candidateCount: items.length });
        console.log(`✓ 词根 "${query}" 成功获取到 ${items.length} 个关联词。`);

        const startIndex = (items.length > 0 && String(items[0].keyword).trim() === String(query).trim()) ? 1 : 0;
        for (let i = startIndex; i < items.length; i++) {
          const item = items[i];
          sycmExpanded.push({
            keyword: item.keyword,
            seed: query,
            root: query,
            category: seed.category || '',
            pattern: `sycm-${sycmMode}-related`,
            source: effectiveSource,
            inspirationId: seed.inspirationId || '',
            inspiration: seed.inspiration || null,
            relationReason: seed.relationReason || '',
            rootScore: seed.rootScore || null,
            familyKey: seed.familyKey || '',
            sycmData: {
              searchPopularity: parseSearchPop(item.searchPopularity),
              clickRate: parsePercentOrNumber(item.clickRate),
              clickPopularity: parseSearchPop(item.clickPopularity),
              demandSupplyRatio: parsePercentOrNumber(item.demandSupplyRatio),
              payConversionRate: parsePercentOrNumber(item.payConversionRate || item.conversionRate),
              conversionRate: parsePercentOrNumber(item.conversionRate || item.payConversionRate),
              buyerCount: parseSearchPop(item.buyerCount || item.payBuyerCount),
              onlineProductCount: parseSearchPop(item.onlineProductCount || item.productCount || item.competitionCount),
              trend: parsePercentOrNumber(item.trend || item.trendRate || item.searchTrend)
            }
          });
        }
      } catch (err) {
        rootResults.push({
          ...seed,
          result: 'failed',
          error: err.message,
          status: err.status || '',
          manualAction: err.details || err.manualAction || null
        });
        console.error(`❌ 查询词根 "${query}" 失败:`, err.message);
      }
      reportProgress({
        stage: 'sycm-expand',
        current: seedIndex + 1,
        total: querySeeds.length,
        message: `生意参谋关联词已处理 ${seedIndex + 1}/${querySeeds.length}`
      });
    }
    if (rootResults.length > 0 && recordRootHistory) recordRootQueries(rootResults, { dataDir });
    if (rootResults.length > 0 && recordSeedFeedback && effectiveSource !== 'inspiration') {
      applySeedFeedback(rootResults.map(root => ({
        root: root.root,
        originalKeyword: root.originalKeyword,
        failures: root.result === 'failed' || root.result === 'empty' ? 1 : 0
      })), { dataDir, eventType: 'root-query' });
    }
  }

  const expanded = [
    ...(includeDirect ? directSeedCandidates(seeds) : []),
    ...aiExpanded,
    ...localExpanded,
    ...sycmExpanded
  ];
  reportProgress({
    stage: 'score',
    current: 3,
    total: MINING_PROGRESS_TOTAL,
    message: `评分候选词 ${expanded.length} 个`
  });

  const scored = expanded.map(item => {
    const scoredItem = scoreKeyword(item);
    const aiBoost = item.source === 'ai'
      ? Math.max(-4, Math.min(3, Math.round((Number(item.aiConfidence || 60) - 60) / 12)))
      : 0;

    let sycmBoost = 0;
    if (item.sycmData) {
      const pop = item.sycmData.searchPopularity || 0;
      if (pop > 5000) sycmBoost += 5;
      else if (pop > 2000) sycmBoost += 3;
      else if (pop > 500) sycmBoost += 1;

      const ds = item.sycmData.demandSupplyRatio || 0;
      if (ds > 1.5) sycmBoost += 3;
    }

    const localScore = scoredItem.nextAction === 'reject'
      ? scoredItem.localScore
      : Math.max(0, Math.min(100, scoredItem.localScore + aiBoost + sycmBoost));
    const nextAction = scoredItem.nextAction === 'reject'
      ? 'reject'
      : localScore >= 62 ? 'sycm_verify' : 'observe';
    const candidate = {
      date,
      keyword: scoredItem.keyword,
      seed: item.seed,
      category: item.category || '',
      pattern: item.pattern,
      source: item.source || 'local',
      root: item.root || item.seed || '',
      localScore,
      tier: scoredItem.nextAction === 'reject' ? 'reject' : localScore >= 78 ? 'high' : localScore >= 62 ? 'mid' : 'low',
      reason: scoredItem.reason,
      nextAction,
      flags: scoredItem.flags,
      coreProduct: scoredItem.coreProduct,
      familyKey: productFamily(scoredItem.coreProduct) || scoredItem.coreProduct || '',
      signature: scoredItem.signature,
      productSignature: scoredItem.productSignature,
      rigid: scoredItem.rigid,
      optional: scoredItem.optional,
      seedRole: item.seedRole,
      seedCoreProduct: item.seedCoreProduct,
      compatibility: item.compatibility || null,
      aiConfidence: item.aiConfidence,
      aiReason: item.aiReason,
      aiRisk: item.aiRisk,
      intent: item.intent,
      targetCrowd: item.targetCrowd,
      inspirationId: item.inspirationId || '',
      inspiration: item.inspiration || null,
      relationReason: item.relationReason || '',
      rootScore: item.rootScore || null,
      sycmData: item.sycmData || null,
      nextCommands: buildNextCommands(scoredItem.keyword)
    };
    return {
      ...candidate,
      ...gateCandidate(candidate, { minSearchPopularity })
    };
  });

  const threshold = thresholdForMode(mode);
  const clustered = clusterBySignature(scored)
    .sort((a, b) => b.localScore - a.localScore || String(a.seed).localeCompare(String(b.seed), 'zh-CN') || String(a.keyword).localeCompare(String(b.keyword), 'zh-CN'));

  const ranked = clustered
    .filter(item => item.localScore >= threshold && item.nextAction !== 'reject' && item.gateStatus !== 'rejected')
    .sort((a, b) => b.localScore - a.localScore || String(a.seed).localeCompare(String(b.seed), 'zh-CN') || String(a.keyword).localeCompare(String(b.keyword), 'zh-CN'));
  reportProgress({
    stage: 'rank',
    current: 4,
    total: MINING_PROGRESS_TOTAL,
    message: `排序筛选 ${ranked.length} 个`
  });

  let precheckStats = null;
  let prechecked = ranked;
  if (sycmPrecheck && ranked.length > 0) {
    const needPrecheck = ranked.filter(item => !item.sycmData);
    const alreadyPassed = ranked.filter(item => !!item.sycmData && item.sycmData.searchPopularity >= minSearchPopularity);
    const alreadyFiltered = ranked.filter(item => !!item.sycmData && item.sycmData.searchPopularity < minSearchPopularity);

    if (needPrecheck.length > 0) {
      const pcResult = await precheckCandidates(needPrecheck, { minSearchPopularity });
      prechecked = [
        ...alreadyPassed.map(item => ({ ...item, ...gateCandidate(item, { minSearchPopularity }) })),
        ...pcResult.passed.map(item => {
          const withSycmData = {
            ...item,
            sycmData: item.sycmData || {
              searchPopularity: item.searchPopularity || 0,
              demandSupplyRatio: item.demandSupplyRatio || 0,
              clickRate: item.clickRate || 0,
              conversionRate: item.conversionRate || 0,
              buyerCount: item.buyerCount || 0
            }
          };
          return { ...withSycmData, ...gateCandidate(withSycmData, { minSearchPopularity }) };
        })
      ];
      precheckStats = {
        total: ranked.length,
        passed: prechecked.length,
        filtered: alreadyFiltered.length + pcResult.stats.filtered,
        errors: pcResult.stats.errors
      };
    } else {
      prechecked = alreadyPassed;
      precheckStats = {
        total: ranked.length,
        passed: prechecked.length,
        filtered: alreadyFiltered.length,
        errors: 0
      };
    }
  }

  const recentSeen = excludeSeen ? loadSeen({ dataDir, ttlDays: Number(seenTtlDays || 30) }) : new Set();
  for (const keyword of Array.isArray(excludeKeywords) ? excludeKeywords : []) {
    const normalized = normalizeKeyword(keyword);
    if (normalized) recentSeen.add(normalized);
  }
  const unseenPrechecked = excludeSeen
    ? prechecked.filter(item => !recentSeen.has(normalizeKeyword(item.keyword)))
    : prechecked;
  // 开启去重后，候选池耗尽应显式暴露给上层补词策略，不能悄悄复用旧词。
  const selectionPool = excludeSeen ? unseenPrechecked : prechecked;
  const seenFiltered = Math.max(0, prechecked.length - unseenPrechecked.length);
  const seenPoolExhausted = excludeSeen && unseenPrechecked.length === 0 && prechecked.length > 0;

  const targetSelectionSize = Math.min(Number(count || 50), selectionPool.length);
  const shareBasedFamilyLimit = Math.max(1, Math.floor(targetSelectionSize * 0.3));
  const selectableFamilyCount = new Set(selectionPool
    .map(item => item.familyKey || productFamily(item.coreProduct || item.productSignature || '') || item.coreProduct)
    .filter(Boolean)).size;
  const coverageRequiredLimit = selectableFamilyCount > 0
    ? Math.ceil(targetSelectionSize / selectableFamilyCount)
    : Number(outputMaxPerProductCore || 3);
  const effectiveProductCoreLimit = Math.min(
    Number(outputMaxPerProductCore || 3),
    Math.max(shareBasedFamilyLimit, coverageRequiredLimit)
  );
  const diversitySelection = selectDiverseCandidates(selectionPool, {
    count: Number(count || 50),
    maxPerSeed: outputMaxPerSeed,
    maxPerCategory: outputMaxPerCategory,
    maxPerPattern: outputMaxPerPattern,
    maxPerProductCore: effectiveProductCoreLimit,
    history: diversityHistory,
    mode,
    excludeExactHistory: !!diversityHistory,
    allowHistoryFallback
  });
  const candidates = diversitySelection.selected;

  if (effectiveSource === 'hybrid' && !candidates.some(item => item.source === 'ai')) {
    const bestAi = prechecked.find(item => item.source === 'ai')
      || scored
        .filter(item => item.source === 'ai' && item.nextAction !== 'reject')
        .sort((a, b) => b.localScore - a.localScore)[0];
    if (bestAi) {
      if (candidates.length >= Number(count || 50)) candidates[candidates.length - 1] = bestAi;
      else candidates.push(bestAi);
      candidates.sort((a, b) => b.localScore - a.localScore || String(a.keyword).localeCompare(String(b.keyword), 'zh-CN'));
    }
  }

  if (persist && candidates.length > 0) writeCandidates(candidates, dataDir);
  if (shouldRecordSeen && candidates.length > 0) {
    recordSeen(candidates.map(item => item.keyword), { dataDir });
  }
  if (recordSeedFeedback && candidates.length > 0) {
    const candidateCounts = new Map();
    for (const candidate of candidates) {
      const root = candidate.root || candidate.seed || candidate.coreProduct || '';
      if (!root) continue;
      candidateCounts.set(root, (candidateCounts.get(root) || 0) + 1);
    }
    applySeedFeedback([...candidateCounts].map(([root, candidateCount]) => ({ root, candidates: candidateCount })), {
      dataDir,
      eventType: 'candidate-output'
    });
  }
  let seedReplenishment = null;
  if (autoReplenishSeeds && effectiveSource !== 'inspiration' && sycmExpanded.length > 0) {
    const existingSeeds = loadSeeds(dataDir);
    const observingPoolSize = existingSeeds.filter(seed => ['observing', 'explore'].includes(String(seed.status || '').toLowerCase())).length;
    const observingPoolCapacity = Math.max(0, Number(maxObservingPoolSize));
    const availableSlots = Math.max(0, observingPoolCapacity - observingPoolSize);
    const suggestionLimit = Math.min(Math.max(0, Number(maxNewSeeds)), availableSlots);
    seedReplenishment = prepareSeedSuggestions(sycmExpanded.map(item => ({
      keyword: item.keyword,
      category: item.category,
      source: effectiveSource,
      searchPopularity: item.sycmData?.searchPopularity || 0,
      demandSupplyRatio: item.sycmData?.demandSupplyRatio || 0,
      conversionRate: item.sycmData?.conversionRate || 0,
      reason: `从词根「${item.root || item.seed}」的生意参谋关联词中发现`
    })), {
      existingSeeds,
      maxSuggestions: suggestionLimit
    });
    seedReplenishment.summary = {
      ...seedReplenishment.summary,
      observingPoolSize,
      observingPoolCapacity,
      availableSlots,
      capacityReached: availableSlots === 0
    };
    for (const suggestion of seedReplenishment.accepted) {
      addSeed(suggestion.keyword, {
        category: suggestion.category,
        priority: suggestion.priority,
        source: suggestion.source,
        reason: suggestion.reason,
        type: suggestion.type,
        status: 'observing',
        coreProduct: suggestion.coreProduct,
        familyKey: suggestion.familyKey,
        role: suggestion.role,
        evidence: suggestion.evidence,
        dataDir
      });
    }
  }
  reportProgress({
    stage: 'complete',
    current: MINING_PROGRESS_TOTAL,
    total: MINING_PROGRESS_TOTAL,
    message: `挖词完成 ${candidates.length} 个`
  });

  const result = {
    ok: true,
    date,
    seedsUsed: seeds.length,
    directKeywords: buildDirectKeywords(seeds),
    stats: {
      ...buildStats({ seeds, expanded, scored, clustered, threshold, source: effectiveSource, aiMeta }),
      seenFiltered,
      seenTtlDays: Number(seenTtlDays || 30),
      seenPoolExhausted,
      skippedContextSeeds: seeds.length - executableSeeds.length,
      duplicateRootFamiliesRemoved: expandableBeforeDedupe.length - expandableSeeds.length,
      rootFamiliesUsed: expandableSeeds.length,
      observingSeedsUsed: seeds.filter(seed => seed.status === 'observing').length,
      coolingSeedsRetried: seeds.filter(seed => seed.status === 'cooling').length,
      diversity: diversitySelection.stats,
      rootQueries: {
        total: rootResults.length,
        succeeded: rootResults.filter(item => item.result === 'success').length,
        empty: rootResults.filter(item => item.result === 'empty').length,
        failed: rootResults.filter(item => item.result === 'failed').length,
        rows: rootResults
      },
      seedReplenishment: seedReplenishment ? seedReplenishment.summary : null
    },
    candidates,
    inspiration: inspirationDiscovery
  };
  if (precheckStats) result.precheckStats = precheckStats;
  return result;
}

module.exports = { mineKeywords, thresholdForMode, diversifyCandidates, clusterBySignature, normalizeSource, dedupeSeedFamilies };
