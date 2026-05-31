const fs = require('fs');
const path = require('path');
const { DEFAULT_DATA_DIR, listSeeds } = require('./seed-store');
const { expandSeeds } = require('./expand-keywords');
const { scoreKeyword } = require('./score-keyword');

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

function diversifyCandidates(items, { count, maxPerSeed = 5, maxPerCategory = 20, maxPerPattern = 20 } = {}) {
  const selected = [];
  const seedCounts = new Map();
  const categoryCounts = new Map();
  const patternCounts = new Map();

  for (const item of items) {
    const seed = item.seed || '';
    const category = item.category || '';
    const pattern = item.pattern || '';
    if (!belowLimit(seedCounts, seed, maxPerSeed)) continue;
    if (!belowLimit(categoryCounts, category, maxPerCategory)) continue;
    if (!belowLimit(patternCounts, pattern, maxPerPattern)) continue;

    selected.push(item);
    inc(seedCounts, seed);
    inc(categoryCounts, category);
    inc(patternCounts, pattern);
    if (selected.length >= count) break;
  }

  return selected;
}

function buildNextCommands(keyword) {
  const escaped = String(keyword || '').replace(/"/g, '\\"');
  return {
    sycm: `node bin/cli.js sycm "${escaped}" --mode blue --json`,
    titleResearch: `node bin/cli.js "${escaped}" --research`,
    titleGenerate: `node bin/cli.js "${escaped}" --json`
  };
}

/**
 * Mine daily candidate keywords from seed pool.
 * @param {object} [options] 选项
 * @param {number} [options.count=50] 输出候选数量
 * @param {string} [options.dataDir] 数据目录
 * @param {number} [options.maxSeeds=20] 最大使用种子数
 * @param {number} [options.maxPerSeed=30] 每个种子的最大扩词数
 * @param {number} [options.outputMaxPerSeed=5] 输出中每个种子的上限
 * @param {number} [options.outputMaxPerCategory=20] 输出中每个类目的上限
 * @param {number} [options.outputMaxPerPattern=20] 输出中每个扩词模式的上限
 * @param {boolean} [options.persist=true] 是否写入 candidates.jsonl
 * @returns {{ok:boolean,date:string,seedsUsed:number,candidates:Array<object>}}
 */
function mineKeywords({ count = 50, dataDir = DEFAULT_DATA_DIR, maxSeeds = 20, maxPerSeed = 30, outputMaxPerSeed = 5, outputMaxPerCategory = 20, outputMaxPerPattern = 20, persist = true } = {}) {
  const seeds = listSeeds({ dataDir }).slice(0, maxSeeds);
  const expanded = expandSeeds(seeds, { maxPerSeed });
  const date = new Date().toISOString().slice(0, 10);

  const scored = expanded.map(item => {
    const scoredItem = scoreKeyword(item);
    return {
      date,
      keyword: scoredItem.keyword,
      seed: item.seed,
      category: item.category || '',
      pattern: item.pattern,
      localScore: scoredItem.localScore,
      reason: scoredItem.reason,
      nextAction: scoredItem.nextAction,
      nextCommands: buildNextCommands(scoredItem.keyword)
    };
  });

  const ranked = scored
    .filter(item => item.localScore >= 55)
    .sort((a, b) => b.localScore - a.localScore || String(a.seed).localeCompare(String(b.seed), 'zh-CN') || String(a.keyword).localeCompare(String(b.keyword), 'zh-CN'));
  const candidates = diversifyCandidates(ranked, {
    count: Number(count || 50),
    maxPerSeed: outputMaxPerSeed,
    maxPerCategory: outputMaxPerCategory,
    maxPerPattern: outputMaxPerPattern
  });

  if (persist && candidates.length > 0) writeCandidates(candidates, dataDir);

  return {
    ok: true,
    date,
    seedsUsed: seeds.length,
    candidates
  };
}

module.exports = { mineKeywords };
