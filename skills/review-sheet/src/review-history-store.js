'use strict';

const fs = require('fs');
const path = require('path');
const { reviewFingerprint } = require('./review-similarity');

const DEFAULT_HISTORY_DAYS = 90;
const DEFAULT_HISTORY_LIMIT = 1000;

/**
 * 返回评价历史文件位置。
 * @param {string} dataDir pipeline 数据目录。
 * @returns {string} JSONL 文件路径。
 */
function historyFile(dataDir) {
  return path.join(dataDir, 'review-history.jsonl');
}

function readLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(line => {
      try {
        const value = JSON.parse(line);
        return value && typeof value === 'object' ? [value] : [];
      } catch (_error) {
        return [];
      }
    });
}

/**
 * 读取最近已导出的评价，供跨批次相似度提示使用。
 * @param {object} options 读取选项。
 * @param {string} options.dataDir pipeline 数据目录。
 * @param {number} [options.days] 历史天数。
 * @param {number} [options.limit] 最大返回条数。
 * @returns {Array<object>} 最近评价，时间倒序。
 */
function readReviewHistory({ dataDir, days = DEFAULT_HISTORY_DAYS, limit = DEFAULT_HISTORY_LIMIT } = {}) {
  const cutoff = Date.now() - Math.max(1, Number(days) || DEFAULT_HISTORY_DAYS) * 86400000;
  return readLines(historyFile(dataDir))
    .filter(row => {
      const timestamp = Date.parse(row.exportedAt || '');
      return !Number.isFinite(timestamp) || timestamp >= cutoff;
    })
    .slice(-Math.max(1, Number(limit) || DEFAULT_HISTORY_LIMIT))
    .reverse();
}

/**
 * 幂等记录成功导出的评价。只保存本机质量检测所需字段。
 * @param {object} options 写入选项。
 * @param {string} options.dataDir pipeline 数据目录。
 * @param {string} options.runId 运行 ID。
 * @param {Array<object>} options.rows 已导出的评价。
 * @returns {{recorded:number,file:string}} 写入结果。
 */
function recordReviewHistory({ dataDir, runId, rows = [] } = {}) {
  const file = historyFile(dataDir);
  const existing = readLines(file);
  const keys = new Set(existing.map(row => `${row.runId}:${row.draftId}`));
  const exportedAt = new Date().toISOString();
  const additions = (Array.isArray(rows) ? rows : []).flatMap(row => {
    const draftId = String(row.id || row.draftId || '').trim();
    const reviewContent = String(row.reviewContent || '').trim();
    const key = `${runId}:${draftId}`;
    if (!draftId || !reviewContent || keys.has(key)) return [];
    keys.add(key);
    return [{
      runId: String(runId || ''),
      draftId,
      reviewContent,
      fingerprint: reviewFingerprint(reviewContent),
      exportedAt
    }];
  });
  if (additions.length > 0) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${additions.map(row => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  }
  return { recorded: additions.length, file };
}

module.exports = {
  DEFAULT_HISTORY_DAYS,
  DEFAULT_HISTORY_LIMIT,
  historyFile,
  readReviewHistory,
  recordReviewHistory
};
