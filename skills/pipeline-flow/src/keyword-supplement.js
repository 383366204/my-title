'use strict';
const fs = require('fs');
const { normalizeExactKeywords } = require('../../../core/exact-keywords');
const { getRun, readJsonl, appendJsonl } = require('./run-store');

/**
 * 保存待查补充词及尚未确认的筛选草稿，不写入人工通过清单。
 * @param {object} options 运行、补充词与未提交的勾选状态。
 * @returns {string[]} 本次需要查询的词。
 */
function prepareKeywordSupplement(options = {}) {
  const { run } = getRun(options);
  const words = normalizeExactKeywords(options.keywords);
  if (!words.length) throw new Error('请先输入需要查询的关键词');
  const rows = readJsonl(run.files.candidates);
  const byWord = new Map(rows.map(row => [row.keyword, row]));
  const pending = [];
  for (const word of words) {
    let row = byWord.get(word);
    if (!row) {
      row = { keyword: word, source: 'manual', reason: '人工补充，等待查询' };
      rows.push(row);
      byWord.set(word, row);
    }
    if (!row.sycmEvidence?.exactChecked && !row.sycmData) pending.push(word);
  }
  if (!pending.length) throw new Error('这些关键词已有查询结果，请直接筛选');
  const decisions = options.decisions || {};
  for (const row of rows) {
    if (['approved', 'rejected'].includes(decisions[row.keyword])) row.reviewDraft = decisions[row.keyword];
  }
  fs.writeFileSync(run.files.candidates, '');
  appendJsonl(run.files.candidates, rows);
  return pending;
}

module.exports = { prepareKeywordSupplement };
