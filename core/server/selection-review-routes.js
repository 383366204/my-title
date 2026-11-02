'use strict';
const { registerKeywordFilterRoutes } = require('./keyword-filter-routes');
const { getRun } = require('../../skills/pipeline-flow/src/run-store');
const {
  confirmReviewDraft,
  saveReviewDraft,
  getReviewDraft,
  ReviewConflictError,
  ReviewForbiddenError
} = require('../workflow/review-service');

/**
 * 注册人工筛词、货源选品复核；确认后等待显式继续。
 * @param {object} app Express 应用。
 * @param {object} deps 选品复核和运行状态访问依赖。
 * @returns {void}
 */
function registerSelectionReviewRoutes(app, deps) {
  registerKeywordFilterRoutes(app, deps);
  const {
    isValidWorkflowRunIdParam,
    flowReviewCandidates,
    flowReviewProducts,
    readRuntimeState,
    updateRuntimeState,
    withPipelineRuntimeFields,
    summarizePipelineRun
  } = deps;

  app.post('/api/workflows/runs/:runId/keyword-review', (req, res) => {
    const runId = req.params.runId;
    if (!isValidWorkflowRunIdParam(runId)) {
      return res.status(400).json({ ok: false, error: '无效的运行 ID。' });
    }
    try {
      if (req.body?.keywordFilterVersion !== undefined) {
        const { run } = getRun({ runId, dataDir: deps.dataDir });
        if (req.body.keywordFilterVersion !== (run.options?.keywordFilterVersion || 0)) {
          return res.status(409).json({ ok: false, error: '筛选配置已更新，请刷新后再确认。' });
        }
      }
      const previousRuntime = readRuntimeState({ runId });
      if (previousRuntime && ['running', 'retrying', 'resuming'].includes(previousRuntime.status)) {
        return res.status(409).json({ ok: false, error: '节点正在运行，请等待完成或暂停后再确认。' });
      }
      const selectionMode = ['daily', 'keyword', 'root-keyword'].includes(previousRuntime?.mode);
      if (selectionMode && previousRuntime.activeStep !== 'keywordReview') {
        return res.status(409).json({ ok: false, error: '当前已进入后续步骤，请先重跑关键词机会复核节点再修改选词。' });
      }
      const doConfirm = deps.confirmReviewDraft || confirmReviewDraft;
      if (deps.dataDir || deps.confirmReviewDraft || req.body?.version !== undefined || req.body?.expectedVersion !== undefined) {
        doConfirm({
          dataDir: deps.dataDir,
          runId,
          stepId: 'keywordReview',
          decisions: {
            approvedKeywords: Array.isArray(req.body?.approvedKeywords) ? req.body.approvedKeywords : [],
            rejectedKeywords: Array.isArray(req.body?.rejectedKeywords) ? req.body.rejectedKeywords : [],
            manualKeywords: Array.isArray(req.body?.manualKeywords) ? req.body.manualKeywords : [],
            approveAll: req.body?.approveAll === true
          },
          expectedVersion: req.body?.version ?? req.body?.expectedVersion,
          confirmedBy: req.body?.confirmedBy || 'user'
        });
      }
      const result = flowReviewCandidates({
        runId,
        combinedOpportunityReview: selectionMode,
        approvedKeywords: Array.isArray(req.body?.approvedKeywords) ? req.body.approvedKeywords : [],
        rejectedKeywords: Array.isArray(req.body?.rejectedKeywords) ? req.body.rejectedKeywords : [],
        manualKeywords: Array.isArray(req.body?.manualKeywords) ? req.body.manualKeywords : [],
        approveAll: req.body?.approveAll === true
      });
      const runtime = readRuntimeState({ runId });
      if (selectionMode && result.status === 'keyword_review_empty') {
        updateRuntimeState({ runId, patch: { status: 'blocked', activeStep: 'keywordReview',
          progress: { keywordReview: { status: 'blocked', current: 0, total: result.reviewed.length, percent: 100, message: '未保留关键词，请重新选择或返回拓词' } } } });
      }
      if (runtime && result.status === 'keywords_reviewed') {
        const needsVerification = !selectionMode && runtime.steps?.includes('verify');
        const nextStep = needsVerification ? 'verify' : 'select';
        updateRuntimeState({
          runId,
          patch: {
            status: 'paused',
            activeStep: nextStep,
            blocker: null,
            actionHint: null,
            manualAction: null,
            progress: {
              keywordReview: {
                status: 'completed',
                current: result.approved.length,
                total: result.approved.length + result.rejected.length,
                percent: 100,
                message: `人工筛词完成，通过 ${result.approved.length} 个`
              },
              ...(needsVerification ? { verify: {
                status: 'idle',
                current: 0,
                total: 0,
                percent: 0,
                message: '等待继续生意参谋校验'
              } } : { select: {
                status: 'idle',
                current: 0,
                total: 0,
                percent: 0,
                message: '等待继续加载货源'
              } })
            }
          }
        });
      }
      res.json({
        ok: true,
        data: {
          result,
          currentRun: withPipelineRuntimeFields(summarizePipelineRun({ runId }))
        }
      });
    } catch (err) {
      if (err instanceof ReviewConflictError || err.code === 'REVIEW_VERSION_CONFLICT') {
        return res.status(409).json({ ok: false, code: err.code, error: err.message });
      }
      if (err instanceof ReviewForbiddenError || err.code === 'REVIEW_CONFIRM_FORBIDDEN') {
        return res.status(403).json({ ok: false, code: err.code, error: err.message });
      }
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/workflows/runs/:runId/product-review', (req, res) => {
    const runId = req.params.runId;
    if (!isValidWorkflowRunIdParam(runId)) {
      return res.status(400).json({ ok: false, error: '无效的运行 ID。' });
    }
    try {
      const doConfirm = deps.confirmReviewDraft || confirmReviewDraft;
      if (deps.dataDir || deps.confirmReviewDraft || req.body?.version !== undefined || req.body?.expectedVersion !== undefined) {
        doConfirm({
          dataDir: deps.dataDir,
          runId,
          stepId: 'select',
          decisions: {
            approvedProductIds: Array.isArray(req.body?.approvedProductIds) ? req.body.approvedProductIds : [],
            manualProducts: Array.isArray(req.body?.manualProducts) ? req.body.manualProducts : [],
            approveAll: req.body?.approveAll === true
          },
          expectedVersion: req.body?.version ?? req.body?.expectedVersion,
          confirmedBy: req.body?.confirmedBy || 'user'
        });
      }
      const result = flowReviewProducts({
        runId,
        approvedProductIds: Array.isArray(req.body?.approvedProductIds) ? req.body.approvedProductIds : [],
        manualProducts: Array.isArray(req.body?.manualProducts) ? req.body.manualProducts : [],
        approveAll: req.body?.approveAll === true
      });
      const runtime = readRuntimeState({ runId });
      if (runtime && result.status === 'products_selected') {
        updateRuntimeState({
          runId,
          patch: {
            status: 'paused',
            activeStep: 'generate',
            blocker: null,
            actionHint: null,
            progress: {
              select: { status: 'completed', current: result.selected.length, total: result.selected.length, percent: 100, message: `人工选品完成，保留 ${result.selected.length} 个商品` },
              generate: { status: 'idle', current: 0, total: 0, percent: 0, message: '等待继续生成标题' }
            }
          }
        });
      }
      return res.json({ ok: true, data: { result, currentRun: withPipelineRuntimeFields(summarizePipelineRun({ runId })) } });
    } catch (err) {
      if (err instanceof ReviewConflictError || err.code === 'REVIEW_VERSION_CONFLICT') {
        return res.status(409).json({ ok: false, code: err.code, error: err.message });
      }
      if (err instanceof ReviewForbiddenError || err.code === 'REVIEW_CONFIRM_FORBIDDEN') {
        return res.status(403).json({ ok: false, code: err.code, error: err.message });
      }
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/workflows/runs/:runId/review-drafts/:stepId', (req, res) => {
    const { runId, stepId } = req.params;
    if (!isValidWorkflowRunIdParam(runId)) {
      return res.status(400).json({ ok: false, error: '无效的运行 ID。' });
    }
    try {
      const getter = deps.getReviewDraft || getReviewDraft;
      const draft = getter({ dataDir: deps.dataDir, runId, stepId });
      return res.json({ ok: true, data: draft });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/workflows/runs/:runId/review-drafts/:stepId', (req, res) => {
    const { runId, stepId } = req.params;
    if (!isValidWorkflowRunIdParam(runId)) {
      return res.status(400).json({ ok: false, error: '无效的运行 ID。' });
    }
    try {
      const saver = deps.saveReviewDraft || saveReviewDraft;
      const draft = saver({
        dataDir: deps.dataDir,
        runId,
        stepId,
        decisions: req.body?.decisions || req.body || {},
        expectedVersion: req.body?.version ?? req.body?.expectedVersion,
        updatedBy: req.body?.updatedBy || 'user'
      });
      return res.json({ ok: true, data: draft });
    } catch (err) {
      if (err instanceof ReviewConflictError || err.code === 'REVIEW_VERSION_CONFLICT' || err.code === 'REVIEW_ALREADY_CONFIRMED') {
        return res.status(409).json({ ok: false, code: err.code, error: err.message });
      }
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
}

module.exports = { registerSelectionReviewRoutes };
