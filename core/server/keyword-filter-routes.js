'use strict';

const fs = require('fs');
const path = require('path');
const { getRun, readJsonl } = require('../../skills/pipeline-flow/src/run-store');
const { normalizeKeywordFilter, keywordFilterCollectionStatus } = require('../../skills/pipeline-flow/src/keyword-metric-filter');
const { readWorkflowNodeArtifact } = require('../workflow/pipeline-artifacts');
const { scoreRootReviewCandidate } = require('../../skills/pipeline-flow/src/root-opportunity-review');

function editable(run, runtime) {
  return ['awaiting_keyword_review', 'keyword_review_empty'].includes(run.status)
    && runtime?.activeStep === 'keywordReview'
    && ['blocked', 'paused', 'needs_review'].includes(runtime.status)
    && runtime.progress?.keywordReview?.status !== 'completed'
    && !['select', 'generate', 'export'].some(step =>
      ['running', 'completed'].includes(runtime.progress?.[step]?.status));
}

/** @param {object} run 原运行。 @returns {string[]} 有实际查询证据的词根，不重新生成灵感。 */
function getKeywordRecollectionRoots(run) {
  const roots = new Set();
  for (const row of readJsonl(run.files.rootCandidates)) {
    for (const task of row.queryTasks || []) {
      if (typeof task.keyword === 'string' && task.keyword.trim()) roots.add(task.keyword.trim());
    }
  }
  for (const row of readJsonl(run.files.candidates)) {
    for (const value of [row.sycmEvidence?.root, row.root, ...(row.sourceRoots || [])]) {
      if (typeof value === 'string' && value.trim()) roots.add(value.trim());
    }
  }
  return [...roots];
}

function responseData(run, runtime, lookup) {
  const artifact = readWorkflowNodeArtifact({ ...lookup, nodeId: 'keywordReview', limit: 'all' });
  const rows = artifact?.rows || [];
  // 历史采集未持久化完整过滤条件，不能将本地重筛描述为完整重采。
  return { config: normalizeKeywordFilter(run.options?.keywordFilter),
    version: run.options?.keywordFilterVersion || 0, editable: editable(run, runtime),
    readOnlyReason: editable(run, runtime) ? null : '仅允许在待确认关键词阶段修改，运行中、已确认或后续步骤均为只读。',
    ...keywordFilterCollectionStatus(rows, run.options?.keywordFilter),
    recollectionSupported: ['keyword', 'root-keyword'].includes(runtime?.mode)
      || (runtime?.mode === 'daily' && getKeywordRecollectionRoots(run).length > 0),
    recollectionMode: 'new_run',
    artifact, rows, counts: { total: rows.length,
      passed: rows.filter(row => row.metricFilter?.status === 'passed').length,
      failed: rows.filter(row => row.metricFilter?.status === 'failed').length,
      review: rows.filter(row => row.metricFilter?.status === 'review').length } };
}

/** @param {object} app Express 应用。 @param {object} deps 运行状态依赖。 @returns {void} */
function registerKeywordFilterRoutes(app, deps) {
  const route = '/api/workflows/runs/:runId/keyword-filter';
  const handle = update => (req, res) => {
    const runId = req.params.runId;
    if (!deps.isValidWorkflowRunIdParam(runId)) return res.status(400).json({ ok: false, error: '无效的运行 ID。' });
    const lookup = { runId, dataDir: deps.dataDir };
    let lock;
    let temporary;
    let ownsLock = false;
    try {
      let context;
      try { context = getRun(lookup); } catch (error) {
        if (error.message.startsWith('run.json 不存在:')) return res.status(404).json({ ok: false, error: '运行不存在' });
        throw error;
      }
      if (update) {
        lock = path.join(context.runDir, '.keyword-filter.lock');
        const fd = fs.openSync(lock, 'wx');
        ownsLock = true;
        fs.closeSync(fd);
        context = getRun(lookup);
      }
      const { run, runDir } = context;
      const runtime = deps.readRuntimeState(lookup);
      if (update) {
        if (!editable(run, runtime)) return res.status(409).json({ ok: false, error: '当前运行不在待确认关键词阶段' });
        if (!Number.isSafeInteger(req.body?.version) || req.body.version < 0) {
          return res.status(400).json({ ok: false, error: 'version 必须为非负整数' });
        }
        if (req.body.version !== (run.options?.keywordFilterVersion || 0)) {
          return res.status(409).json({ ok: false, error: '筛选配置已更新，请刷新', data: responseData(run, runtime, lookup) });
        }
        if (req.body.config === undefined) throw new TypeError('config is required');
        const config = normalizeKeywordFilter(req.body.config);
        const decisions = req.body.decisions === undefined ? {} : req.body.decisions;
        if (!decisions || typeof decisions !== 'object' || Array.isArray(decisions)
          || Object.values(decisions).some(value => !['approved', 'rejected'].includes(value))) {
          throw new TypeError('decisions must map keywords to approved or rejected');
        }
        const currentRows = responseData(run, runtime, lookup).rows;
        const known = new Set(currentRows.map(row => row.keyword));
        if (Object.keys(decisions).some(key => !known.has(key))) throw new TypeError('Unknown decision keyword');
        run.options = { ...run.options, keywordFilter: config, keywordFilterVersion: req.body.version + 1,
          keywordFilterDecisions: { ...run.options?.keywordFilterDecisions, ...decisions } };
        const filtered = currentRows.map(row => scoreRootReviewCandidate(row, config));
        run.counts = { ...run.counts,
          keywordFilterPassed: filtered.filter(row => row.metricFilter.status === 'passed').length,
          keywordFilterReview: filtered.filter(row => row.metricFilter.status === 'review').length,
          keywordFilterFailed: filtered.filter(row => row.metricFilter.status === 'failed').length };
        run.updatedAt = new Date().toISOString();
        // 配置、版本和草稿以一次 rename 提交，不修改运行步骤或人工确认结果。
        temporary = path.join(runDir, `.keyword-filter-${process.pid}.tmp`);
        fs.writeFileSync(temporary, JSON.stringify(run, null, 2) + '\n');
        fs.renameSync(temporary, path.join(runDir, 'run.json'));
      }
      return res.json({ ok: true, data: responseData(run, runtime, lookup) });
    } catch (error) {
      return res.status(error.code === 'EEXIST' ? 409 : error instanceof TypeError ? 400 : 500)
        .json({ ok: false, error: error.message });
    } finally {
      if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary);
      if (ownsLock) fs.unlinkSync(lock);
    }
  };
  app.get(route, handle(false));
  app.post(route, handle(true));
}

module.exports = { registerKeywordFilterRoutes, getKeywordRecollectionRoots };
