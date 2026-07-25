const fs = require('fs');
const path = require('path');
const { normalizeKeyword } = require('./seed-store');
const { classifySeed } = require('./seed-classifier');

const ROOT_HISTORY_FILE = 'root-history.jsonl';
const BROAD_ROOTS = new Set(['女', '男', '儿童', '宝宝', '饰品', '用品', '家居', '玩具', '礼物', '百货']);

function readHistory(dataDir) {
  const file = path.join(dataDir, ROOT_HISTORY_FILE);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function extractShortRoot(seed) {
  const keyword = normalizeKeyword(typeof seed === 'string' ? seed : seed && seed.keyword);
  if (!keyword) return null;
  const info = classifySeed(typeof seed === 'object' ? seed : { keyword });
  const root = normalizeKeyword(info.coreProduct || '');
  if (!root || root.length < 2 || root.length > 5 || BROAD_ROOTS.has(root)) return null;
  return {
    root,
    originalKeyword: keyword,
    category: typeof seed === 'object' ? seed.category || '' : '',
    source: typeof seed === 'object' ? seed.source || 'seed' : 'seed',
    rootType: 'product'
  };
}

function selectShortRoots(seeds, { dataDir, limit = 5, cooldownDays = 7, includeRecentlyUsed = false } = {}) {
  const history = readHistory(dataDir);
  const cutoff = Date.now() - Number(cooldownDays || 7) * 86400000;
  const latestUse = new Map();
  for (const row of history) {
    const root = normalizeKeyword(row.root);
    const time = Date.parse(row.checkedAt || row.date || '');
    if (!root || !Number.isFinite(time)) continue;
    latestUse.set(root, Math.max(latestUse.get(root) || 0, time));
  }
  const recent = new Set(history.filter(row => {
    const time = Date.parse(row.checkedAt || row.date || '');
    return includeRecentlyUsed || !Number.isFinite(time) || time >= cutoff;
  }).map(row => normalizeKeyword(row.root)).filter(Boolean));
  const available = [];
  const seen = new Set();
  for (const seed of seeds || []) {
    const item = extractShortRoot(seed);
    if (!item || seen.has(item.root)) continue;
    seen.add(item.root);
    available.push({ ...item, lastUsedAt: latestUse.get(item.root) ? new Date(latestUse.get(item.root)).toISOString() : null });
  }
  const selected = available.filter(item => !recent.has(item.root)).slice(0, Number(limit || 5));
  if (selected.length > 0 || includeRecentlyUsed || available.length === 0) return selected;

  // 所有词根都在冷却期时，选择最久未使用的一组，避免退回固定的前几个种子。
  return available
    .sort((a, b) => (latestUse.get(a.root) || 0) - (latestUse.get(b.root) || 0))
    .slice(0, Number(limit || 5))
    .map(item => ({ ...item, cooldownFallback: true }));
}

function recordRootQueries(roots, { dataDir, result = 'queried' } = {}) {
  if (!Array.isArray(roots) || roots.length === 0) return;
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, ROOT_HISTORY_FILE);
  const checkedAt = new Date().toISOString();
  for (const root of roots) {
    fs.appendFileSync(file, JSON.stringify({
      root: root.root || root,
      originalKeyword: root.originalKeyword || '',
      checkedAt,
      result: root.result || result,
      candidateCount: Number(root.candidateCount || 0),
      error: root.error || ''
    }) + '\n', 'utf8');
  }
}

module.exports = { extractShortRoot, selectShortRoots, recordRootQueries };
