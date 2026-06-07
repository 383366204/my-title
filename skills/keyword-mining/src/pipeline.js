const fs = require('fs');
const path = require('path');
const { DEFAULT_DATA_DIR, listSeeds } = require('./seed-store');
const { expandSeeds } = require('./expand-keywords');
const { scoreKeyword } = require('./score-keyword');
const { precheckCandidates } = require('./sycm-precheck');
const { generateAIKeywordCandidates } = require('./ai-mine-keywords');

const CANDIDATES_FILE = 'candidates.jsonl';

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

function belowLimit(map, key, limit) {
  if (!limit || limit <= 0) return true;
  return (map.get(key) || 0) < limit;
}

function inc(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
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
  const selected = [];
  const seedCounts = new Map();
  const categoryCounts = new Map();
  const patternCounts = new Map();
  const signatureCounts = new Map();
  const productCounts = new Map();

  for (const item of items) {
    const seed = item.seed || '';
    const category = item.category || '';
    const pattern = item.pattern || '';
    const signature = item.signature || item.keyword || '';
    const productCore = item.coreProduct || item.productSignature || '';
    if (!belowLimit(seedCounts, seed, maxPerSeed)) continue;
    if (!belowLimit(categoryCounts, category, maxPerCategory)) continue;
    if (!belowLimit(patternCounts, pattern, maxPerPattern)) continue;
    if (!belowLimit(signatureCounts, signature, maxPerSignature)) continue;
    if (productCore && !belowLimit(productCounts, productCore, maxPerProductCore)) continue;

    selected.push(item);
    inc(seedCounts, seed);
    inc(categoryCounts, category);
    inc(patternCounts, pattern);
    inc(signatureCounts, signature);
    if (productCore) inc(productCounts, productCore);
    if (selected.length >= count) break;
  }

  return selected;
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
  if (['local', 'ai', 'hybrid'].includes(value)) return value;
  throw new Error(`Unsupported keyword mining source: ${source}`);
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
 * @param {string} [options.mode=balanced] strict/balanced/explore threshold mode.
 * @returns {Promise<{ok:boolean,date:string,seedsUsed:number,directKeywords:Array<object>,candidates:Array<object>,stats:object,precheckStats?:object}>}
 */
async function mineKeywords({ count = 50, dataDir = DEFAULT_DATA_DIR, maxSeeds = 20, maxPerSeed = 30, outputMaxPerSeed = 5, outputMaxPerCategory = 20, outputMaxPerPattern = 20, outputMaxPerProductCore = 3, persist = true, sycmPrecheck = false, minSearchPopularity = 50, includeDirect = false, mode = 'balanced', source = 'local', aiCandidates = 80, llmClient = null } = {}) {
  const effectiveSource = normalizeSource(source);
  const seeds = listSeeds({ dataDir }).slice(0, maxSeeds);
  const expandableSeeds = seeds.filter(seed => seed.type !== 'direct');
  const date = new Date().toISOString().slice(0, 10);
  let aiMeta = null;
  let aiExpanded = [];
  if (effectiveSource === 'ai' || effectiveSource === 'hybrid') {
    try {
      const aiResult = await generateAIKeywordCandidates({
        seeds,
        maxCandidates: Number(aiCandidates || 80),
        llmClient,
        date
      });
      aiExpanded = aiResult.candidates;
      aiMeta = {
        ...(aiResult.meta || {}),
        generated: aiExpanded.length
      };
    } catch (error) {
      if (effectiveSource === 'ai') throw error;
      aiMeta = {
        provider: llmClient && llmClient.provider ? llmClient.provider : 'llm',
        model: llmClient && llmClient.model ? llmClient.model : '',
        requested: Number(aiCandidates || 80),
        generated: 0,
        error: error.message
      };
    }
  }
  const localExpanded = effectiveSource === 'local' || effectiveSource === 'hybrid'
    ? expandSeeds(expandableSeeds, { maxPerSeed })
    : [];
  const expanded = [
    ...(includeDirect ? directSeedCandidates(seeds) : []),
    ...aiExpanded,
    ...localExpanded
  ];

  const scored = expanded.map(item => {
    const scoredItem = scoreKeyword(item);
    const aiBoost = item.source === 'ai'
      ? Math.max(-4, Math.min(8, Math.round((Number(item.aiConfidence || 60) - 60) / 5)))
      : 0;
    const localScore = scoredItem.nextAction === 'reject'
      ? scoredItem.localScore
      : Math.max(0, Math.min(100, scoredItem.localScore + aiBoost));
    const nextAction = scoredItem.nextAction === 'reject'
      ? 'reject'
      : localScore >= 62 ? 'sycm_verify' : 'observe';
    return {
      date,
      keyword: scoredItem.keyword,
      seed: item.seed,
      category: item.category || '',
      pattern: item.pattern,
      source: item.source || 'local',
      localScore,
      tier: scoredItem.nextAction === 'reject' ? 'reject' : localScore >= 78 ? 'high' : localScore >= 62 ? 'mid' : 'low',
      reason: scoredItem.reason,
      nextAction,
      flags: scoredItem.flags,
      coreProduct: scoredItem.coreProduct,
      signature: scoredItem.signature,
      productSignature: scoredItem.productSignature,
      rigid: scoredItem.rigid,
      optional: scoredItem.optional,
      aiConfidence: item.aiConfidence,
      aiReason: item.aiReason,
      aiRisk: item.aiRisk,
      intent: item.intent,
      targetCrowd: item.targetCrowd,
      nextCommands: buildNextCommands(scoredItem.keyword)
    };
  });

  const threshold = thresholdForMode(mode);
  const clustered = clusterBySignature(scored)
    .sort((a, b) => b.localScore - a.localScore || String(a.seed).localeCompare(String(b.seed), 'zh-CN') || String(a.keyword).localeCompare(String(b.keyword), 'zh-CN'));

  const ranked = clustered
    .filter(item => item.localScore >= threshold && item.nextAction !== 'reject')
    .sort((a, b) => b.localScore - a.localScore || String(a.seed).localeCompare(String(b.seed), 'zh-CN') || String(a.keyword).localeCompare(String(b.keyword), 'zh-CN'));

  let precheckStats = null;
  let prechecked = ranked;
  if (sycmPrecheck && ranked.length > 0) {
    const pcResult = await precheckCandidates(ranked, { minSearchPopularity });
    prechecked = pcResult.passed;
    precheckStats = pcResult.stats;
  }

  const candidates = diversifyCandidates(prechecked, {
    count: Number(count || 50),
    maxPerSeed: outputMaxPerSeed,
    maxPerCategory: outputMaxPerCategory,
    maxPerPattern: outputMaxPerPattern,
    maxPerProductCore: outputMaxPerProductCore
  });

  if (persist && candidates.length > 0) writeCandidates(candidates, dataDir);

  const result = {
    ok: true,
    date,
    seedsUsed: seeds.length,
    directKeywords: buildDirectKeywords(seeds),
    stats: buildStats({ seeds, expanded, scored, clustered, threshold, source: effectiveSource, aiMeta }),
    candidates
  };
  if (precheckStats) result.precheckStats = precheckStats;
  return result;
}

module.exports = { mineKeywords, thresholdForMode, diversifyCandidates, clusterBySignature, normalizeSource };
