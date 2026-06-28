'use strict';
const fs = require('fs');
const path = require('path');
const { normalizeKeyword } = require('./seed-store');

const CACHE_FILE = 'verify-cache.jsonl';

// 进程内缓存：同一进程只从磁盘读一次，避免大量候选词反复 I/O
let _memCache = null;
let _memCacheDir = null;

/**
 * 获取或初始化进程内缓存 Map。
 * @param {string} dataDir 数据目录
 * @param {number} ttlDays TTL 天数
 * @returns {Map<string, {searchPopularity:number, date:string}>}
 */
function getMemCache(dataDir, ttlDays) {
  if (_memCache && _memCacheDir === dataDir) return _memCache;
  _memCache = loadCacheFromDisk(dataDir, ttlDays);
  _memCacheDir = dataDir;
  return _memCache;
}

/**
 * 从磁盘加载缓存到 Map（后面的记录覆盖前面的同词记录）。
 * @param {string} dataDir 数据目录
 * @param {number} [ttlDays=7] TTL 天数
 * @returns {Map<string, {searchPopularity:number, date:string}>}
 */
function loadCacheFromDisk(dataDir, ttlDays = 7) {
  const file = path.join(dataDir, CACHE_FILE);
  const cutoff = new Date(Date.now() - ttlDays * 86400000).toISOString().slice(0, 10);
  const map = new Map();
  if (!fs.existsSync(file)) return map;
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  for (const line of lines) {
    try {
      const { keyword, searchPopularity, date } = JSON.parse(line);
      const k = normalizeKeyword(keyword);
      if (!k) continue;
      if (date >= cutoff) {
        // 后面的行覆盖前面（取最新记录）
        map.set(k, { searchPopularity, date });
      } else {
        // 过期条目移除
        map.delete(k);
      }
    } catch (_) {}
  }
  return map;
}

/**
 * 查询关键词的 SYCM 验证缓存。
 * @param {string} keyword 关键词
 * @param {object} [options] 选项
 * @param {string} options.dataDir 数据目录
 * @param {number} [options.ttlDays=7] 缓存有效天数
 * @returns {{ hit: boolean, searchPopularity?: number }}
 */
function getCached(keyword, { dataDir, ttlDays = 7 } = {}) {
  const k = normalizeKeyword(keyword);
  if (!k || !dataDir) return { hit: false };
  const cache = getMemCache(dataDir, ttlDays);
  const entry = cache.get(k);
  if (!entry) return { hit: false };
  return { hit: true, searchPopularity: entry.searchPopularity };
}

/**
 * 写入关键词的 SYCM 验证结果到缓存（追加 JSONL + 更新内存 Map）。
 * @param {string} keyword 关键词
 * @param {number} searchPopularity 搜索人气值
 * @param {object} [options] 选项
 * @param {string} options.dataDir 数据目录
 */
function setCached(keyword, searchPopularity, { dataDir } = {}) {
  const k = normalizeKeyword(keyword);
  if (!k || !dataDir) return;
  const date = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.appendFileSync(
    path.join(dataDir, CACHE_FILE),
    JSON.stringify({ keyword: k, searchPopularity, date }) + '\n',
    'utf8'
  );
  // 同步更新进程内缓存，避免同次运行重复读磁盘
  if (_memCache && _memCacheDir === dataDir) {
    _memCache.set(k, { searchPopularity, date });
  }
}

module.exports = { getCached, setCached };
