'use strict';

const fs = require('fs');
const { extractSycmData } = require('../../sycm-research/src/sycm-cdp-extractor');
const { getRun, readJsonl, appendJsonl, writeRun, setRunStageMetrics } = require('./run-store');
const { sycmRecommendedCategory } = require('./product-normalizer');

const keywordKey = value => String(value || '').replace(/\s+/g, '').toLowerCase();

/**
 * 串行校验用户原词，逐词保存；关联词不能替代原词的指标。
 * @param {object} options 运行、查询参数与可注入的平台依赖。
 * @returns {Promise<object>} 查询结果或可恢复阻塞。
 */
async function verifyExactSelectionKeywords(options = {}) {
  const { run, runDir } = getRun(options);
  const candidates = readJsonl(run.files.candidates);
  const extractor = options.sycmExtractor || extractSycmData;
  const shouldStop = options.shouldStop || (() => null);
  const only = Array.isArray(options.onlyKeywords) ? new Set(options.onlyKeywords) : null;
  const targets = candidates.filter(row => !only || only.has(row.keyword));
  const save = () => {
    fs.writeFileSync(run.files.candidates, '');
    appendJsonl(run.files.candidates, candidates);
    writeRun(runDir, run);
  };
  const currentCount = () => targets.filter(row => row.sycmEvidence?.exactChecked === true).length;
  for (const candidate of targets) {
    if (candidate.sycmEvidence?.exactChecked) continue;
    const requested = shouldStop();
    if (requested) {
      run.status = requested === 'cancel' ? 'cancelled' : 'paused';
      save();
      return { runId: run.runId, runDir, status: run.status, stepIncomplete: true };
    }
    options.onProgress?.({ current: currentCount(), total: targets.length, message: `正在校验：${candidate.keyword}` });
    try {
      const result = await extractor(candidate.keyword, {
        mode: 'hot', maxPages: Number(options.pages || 1), port: Number(options.port || 9222),
        filterConditions: { searchPopularity: 0, demandSupplyRatio: 0, conversionRate: 0, buyerCount: 0, referencePrice: 0 },
        guardMinCooldownMs: 45000, guardMaxCooldownMs: 90000,
        shouldStop,
        onProgress: message => options.onProgress?.({ current: currentCount(), total: targets.length, message: String(message) })
      });
      if (!result || result.ok === false) throw new Error(result?.error || '未取得有效的平台查询响应');
      const exactRows = (result.data || []).filter(row => keywordKey(row.keyword) === keywordKey(candidate.keyword));
      candidate.sycmData = exactRows[0] || null;
      candidate.sycmEvidence = { keyword: candidate.keyword, mode: 'hot', exactChecked: true, collectedAt: new Date().toISOString() };
      candidate.recommendedCategory = sycmRecommendedCategory(result) || candidate.recommendedCategory || '';
      candidate.reason = exactRows.length ? '已查询原词，待人工确认机会' : '查询结果未包含原词指标，需人工判断；未使用关联词代替';
      delete candidate.error;
      appendJsonl(run.files.sycmResults, { keyword: candidate.keyword, ok: true, mode: 'hot', data: exactRows });
      save();
    } catch (error) {
      const interrupted = error.code === 'PLATFORM_ACCESS_INTERRUPTED';
      run.status = interrupted ? (shouldStop() === 'cancel' ? 'cancelled' : 'paused') : 'manual_action_required';
      candidate.error = error.message;
      save();
      return { ok: false, runId: run.runId, runDir, status: run.status, stepIncomplete: true, platform: 'sycm',
        manualAction: { ...(error.details || {}), userMessage: error.message,
          status: error.status || (/Chrome|9222|CDP|DevTools/i.test(error.message) ? 'chrome_unavailable' : 'query_failed') },
        blockers: [error.message] };
    }
  }
  run.status = 'verified';
  if (!only) setRunStageMetrics(run, 'verify', { input: targets.length, passed: targets.filter(row => row.sycmData).length, pending: 0 });
  save();
  options.onProgress?.({ current: targets.length, total: targets.length, message: '原词校验完成，等待关键词确认' });
  return { ok: true, runId: run.runId, runDir, status: run.status };
}

module.exports = { verifyExactSelectionKeywords };
