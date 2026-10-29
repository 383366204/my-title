'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { initRun, getRun, readJsonl, writeRun } = require('../../pipeline-flow/src/run-store');
const { getCompetitorSourcingState } = require('./sourcing-flow');

/**
 * 为已确认货源创建独立、可复用的铺货草稿，不执行铺货或修改同行运行状态。
 * @param {object} options 原运行ID与数据目录，调用方须持有工作台锁。
 * @returns {object} 铺货运行及完整草稿。
 */
function prepareCompetitorDistribution(options) {
  const source = getRun(options);
  const state = getCompetitorSourcingState(options);
  if (!state.reviewConfirmed) throw new Error('请先确认货源选择');
  const runId = `${source.run.runId}-sourcing-distribution`;
  const existingFile = path.join(source.dataDir || options.dataDir || path.join(process.cwd(), 'data/pipeline'), 'runs', runId, 'run.json');
  if (fs.existsSync(existingFile)) {
    const existing = getRun({ ...options, runId });
    if (existing.run.options?.sourceCompetitorRunId !== source.run.runId) throw new Error('关联铺货清单归属不一致');
    if (existing.run.competitorDraftReady) return { runId, status: existing.run.status, rows: readJsonl(existing.run.files.generatedProducts) };
  }
  const seen = new Set();
  const rows = [];
  for (const decision of state.decisions || []) {
    if (decision.action !== 'select') continue;
    const result = state.results.find(row => row.itemId === decision.itemId);
    const candidate = (result?.results || result?.candidates || []).find(row => row.offerId === decision.offerId);
    if (!candidate || !/^\d+$/.test(candidate.offerId) || candidate.verdict?.level === 'rejected') throw new Error('已选货源无效，请检查选货结果');
    if (seen.has(candidate.offerId)) continue;
    seen.add(candidate.offerId);
    const title = String(candidate.title || '').trim();
    if (!title) throw new Error('已选货源缺少标题');
    rows.push({ status: 'generated', title, sourceTitle: title, titleSource: '1688-original',
      url: `https://detail.1688.com/offer/${candidate.offerId}.html`,
      imageUrl: candidate.imageUrl || '', keyword: '', selectedKeyword: title,
      manualSelectionStatus: 'approved', sourceCompetitorItemId: decision.itemId,
      sourceCompetitorRunId: source.run.runId });
  }
  if (!rows.length) throw new Error('没有选中的货源，无法生成铺货清单');
  const child = initRun({ dataDir: options.dataDir, runId, options: { mode: 'manual', sourceCompetitorRunId: source.run.runId, port: source.run.options?.port || 9222 } });
  const temp = `${child.run.files.generatedProducts}.tmp`;
  fs.writeFileSync(temp, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  fs.renameSync(temp, child.run.files.generatedProducts);
  child.run.status = 'needs_review';
  child.run.counts.generatedProducts = rows.length;
  child.run.competitorDraftReady = true;
  writeRun(child.runDir, child.run);
  return { runId, status: child.run.status, rows };
}

module.exports = { prepareCompetitorDistribution };
