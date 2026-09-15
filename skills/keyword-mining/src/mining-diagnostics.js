'use strict';

/**
 * 记录原始行数和筛选去向；同词多来源仍保留逐行证据，不混用计数分母。
 * @param {object} result 挖词结果。
 * @returns {object} 可保存到运行记录的诊断摘要。
 */
function summarizeMiningDiagnostics(result) {
  const rows = result.screeningRows || [];
  const reasons = {};
  for (const row of rows) reasons[row.screeningReason] = (reasons[row.screeningReason] || 0) + 1;
  return {
    version: 'mining-diagnostics-v1',
    rawRows: (result.stats?.rootQueries?.rows || []).reduce((total, root) => total + Number(root.candidateCount || 0), 0),
    screenedRows: rows.length,
    uniqueKeywords: new Set(rows.map(row => String(row.keyword || '').normalize('NFKC').trim()).filter(Boolean)).size,
    selected: result.candidates?.length || 0,
    reasons
  };
}

/**
 * 避免把采集成功但筛选为空误报为平台无数据。
 * @param {object} diagnostics 挖词诊断摘要。
 * @returns {string} 筛选为空的用户可读说明。
 */
function emptyMiningReason(diagnostics) {
  if (!diagnostics.rawRows) return '商品词根查询已完成，但生意参谋没有返回关联词。';
  const reasons = diagnostics.reasons || {};
  return `生意参谋已返回 ${diagnostics.rawRows} 行数据，${diagnostics.uniqueKeywords} 个唯一候选词，但本轮筛选后没有入选词。` +
    `文字分未达门槛 ${reasons.local_below_threshold || 0} 行，规则排除 ${reasons.local_rejected || 0} 行，市场指标未通过 ${reasons.market_rejected || 0} 行，去重、历史或配额限制 ${reasons.dedupe_history_or_quota || 0} 行。`;
}

module.exports = { summarizeMiningDiagnostics, emptyMiningReason };
