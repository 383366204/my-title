'use strict';
const fs = require('fs');
const path = require('path');
const { normalizeKeyword } = require('./seed-store');

const SEEN_FILE = 'seen-candidates.jsonl';

/**
 * 加载最近 ttlDays 天内已输出过的关键词集合。
 * @param {object} [options] 选项
 * @param {string} options.dataDir 数据目录
 * @param {number} [options.ttlDays=30] 保留天数
 * @returns {Set<string>} 已见过的关键词（归一化后的）集合
 */
function loadSeen({ dataDir, ttlDays = 30 } = {}) {
  const file = path.join(dataDir, SEEN_FILE);
  if (!fs.existsSync(file)) return new Set();
  const cutoff = new Date(Date.now() - ttlDays * 86400000).toISOString().slice(0, 10);
  const seen = new Set();
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  for (const line of lines) {
    try {
      const { date, keywords } = JSON.parse(line);
      if (date >= cutoff && Array.isArray(keywords)) {
        for (const kw of keywords) {
          const n = normalizeKeyword(kw);
          if (n) seen.add(n);
        }
      }
    } catch (_) {}
  }
  return seen;
}

/**
 * 追加记录已输出的关键词到 seen-candidates.jsonl。
 * 注意：不支持多进程并发写，单进程顺序调用安全。
 * @param {string[]} keywords 已输出的关键词列表
 * @param {object} options 选项
 * @param {string} options.dataDir 数据目录
 */
function recordSeen(keywords, { dataDir } = {}) {
  if (!Array.isArray(keywords) || keywords.length === 0) return;
  const normalized = keywords.map(normalizeKeyword).filter(Boolean);
  if (normalized.length === 0) return;
  const date = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.appendFileSync(
    path.join(dataDir, SEEN_FILE),
    JSON.stringify({ date, keywords: normalized }) + '\n',
    'utf8'
  );
}

module.exports = { loadSeen, recordSeen };
