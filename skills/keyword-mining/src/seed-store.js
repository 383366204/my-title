const fs = require('fs');
const path = require('path');
const { checkBannedWords } = require('../../../core/banned-words');

const DEFAULT_DATA_DIR = path.resolve(__dirname, '../../../data/keyword-mining');
const SEEDS_FILE = 'seeds.json';
const EVENTS_FILE = 'seed-events.jsonl';

/**
 * Normalize a keyword for seed dedupe.
 * @param {string} keyword 原始关键词
 * @returns {string} 归一化关键词
 */
function normalizeKeyword(keyword) {
  if (typeof keyword !== 'string') return '';
  return keyword
    .replace(/[^\u4e00-\u9fff\u3400-\u4dbfa-zA-Z0-9]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function ensureDir(dataDir = DEFAULT_DATA_DIR) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function seedsPath(dataDir = DEFAULT_DATA_DIR) {
  return path.join(dataDir, SEEDS_FILE);
}

function eventsPath(dataDir = DEFAULT_DATA_DIR) {
  return path.join(dataDir, EVENTS_FILE);
}

/**
 * Load current seeds.
 * @param {string} [dataDir] 数据目录
 * @returns {Array<object>} 种子列表
 */
function loadSeeds(dataDir = DEFAULT_DATA_DIR) {
  ensureDir(dataDir);
  const file = seedsPath(dataDir);
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.trim()) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Save current seeds.
 * @param {Array<object>} seeds 种子列表
 * @param {string} [dataDir] 数据目录
 * @returns {Array<object>} 保存后的种子列表
 */
function saveSeeds(seeds, dataDir = DEFAULT_DATA_DIR) {
  ensureDir(dataDir);
  const normalized = Array.isArray(seeds) ? seeds : [];
  fs.writeFileSync(seedsPath(dataDir), JSON.stringify(normalized, null, 2) + '\n', 'utf8');
  return normalized;
}

/**
 * Append a seed event.
 * @param {object} event 事件对象
 * @param {string} [dataDir] 数据目录
 * @returns {object} 写入后的事件
 */
function recordSeedEvent(event, dataDir = DEFAULT_DATA_DIR) {
  ensureDir(dataDir);
  const payload = {
    date: new Date().toISOString(),
    ...event
  };
  fs.appendFileSync(eventsPath(dataDir), JSON.stringify(payload) + '\n', 'utf8');
  return payload;
}

/**
 * Compute dynamic seed score.
 * @param {object} seed 种子对象
 * @param {Date} [now] 当前时间
 * @returns {number} 动态优先分
 */
function getSeedScore(seed, now = new Date()) {
  if (!seed) return 0;
  const priority = Number(seed.priority || 0);
  const success = Number(seed.successCount || 0) * 1.5;
  const fail = Number(seed.failCount || 0);
  let stalePenalty = 0;
  if (seed.lastUsedAt) {
    const days = Math.floor((now - new Date(seed.lastUsedAt)) / (24 * 60 * 60 * 1000));
    if (Number.isFinite(days) && days > 30) stalePenalty = Math.min(3, Math.floor(days / 30));
  }
  return Number((priority + success - fail - stalePenalty).toFixed(2));
}

/**
 * Normalize a seed lifecycle status while keeping legacy seed records compatible.
 * @param {string} status Raw status.
 * @returns {string} Normalized lifecycle status.
 */
function normalizeSeedStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (['active', 'observing', 'explore', 'cooling', 'paused', 'disabled'].includes(value)) return value;
  return 'active';
}

/**
 * List active seeds sorted by dynamic score.
 * @param {object} [options] 选项
 * @param {string} [options.dataDir] 数据目录
 * @param {boolean} [options.includePaused=false] 是否包含暂停种子
 * @returns {Array<object>} 排序后的种子
 */
function listSeeds({ dataDir = DEFAULT_DATA_DIR, includePaused = false } = {}) {
  return loadSeeds(dataDir)
    .map(seed => ({ ...seed, status: normalizeSeedStatus(seed.status) }))
    .filter(seed => includePaused || seed.status === 'active')
    .map(seed => ({ ...seed, normalized: normalizeKeyword(seed.keyword), priorityScore: getSeedScore(seed) }))
    .sort((a, b) => b.priorityScore - a.priorityScore || String(a.keyword).localeCompare(String(b.keyword), 'zh-CN'));
}

/**
 * Add or update one seed.
 * @param {string} keyword 种子词
 * @param {object} [options] 选项
 * @param {string} [options.category] 类目
 * @param {number} [options.priority=5] 基础优先级
 * @param {string} [options.source=manual] 来源
 * @param {string} [options.reason] 原因
 * @param {string} [options.type=expand] 种子类型: expand(参与扩词挖掘) / direct(直接使用不挖掘)
 * @param {string} [options.dataDir] 数据目录
 * @returns {object} 新增或更新后的种子
 */
function addSeed(keyword, { category = '', priority = 5, source = 'manual', reason = '', type = 'expand', dataDir = DEFAULT_DATA_DIR } = {}) {
  const normalized = normalizeKeyword(keyword);
  if (!normalized) throw new Error('种子词不能为空');
  const banned = checkBannedWords(normalized);
  if (!banned.valid) throw new Error(`种子词包含违禁词: ${banned.words.join(',')}`);

  const seeds = loadSeeds(dataDir);
  const existing = seeds.find(seed => normalizeKeyword(seed.keyword) === normalized);
  if (existing) {
    existing.priority = Math.max(Number(existing.priority || 0), Number(priority || 0));
    existing.category = category || existing.category || '';
    existing.source = existing.source || source;
    existing.status = existing.status || 'active';
    existing.reason = reason || existing.reason || '';
    existing.type = type || existing.type || 'expand';
    recordSeedEvent({ type: 'update', keyword: normalized, source, reason }, dataDir);
    saveSeeds(seeds, dataDir);
    return existing;
  }

  const seed = {
    keyword: normalized,
    category,
    priority: Number(priority || 5),
    source,
    type,
    status: 'active',
    successCount: 0,
    failCount: 0,
    reason
  };
  seeds.push(seed);
  saveSeeds(seeds, dataDir);
  recordSeedEvent({ type: 'add', keyword: normalized, source, reason }, dataDir);
  return seed;
}

module.exports = {
  DEFAULT_DATA_DIR,
  normalizeKeyword,
  loadSeeds,
  saveSeeds,
  recordSeedEvent,
  getSeedScore,
  normalizeSeedStatus,
  listSeeds,
  addSeed
};
