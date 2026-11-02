'use strict';
const { registerKeywordFilterRoutes } = require('./keyword-filter-routes');
const { getRun } = require('../../skills/pipeline-flow/src/run-store');
const { resolveTrustedHumanContext } = require('../workflow/human-context');
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

      // 1. 乐观锁版本预检：如果调用方传入了预期版本号，在执行任何变更前预检冲突
      const expectedVersion = req.body?.version ?? req.body?.expectedVersion;
      if (expectedVersion !== undefined) {
        const getter = deps.getReviewDraft || getReviewDraft;
        const currentDraft = getter({ dataDir: deps.dataDir, runId, stepId: 'keywordReview' });
        const currentVersion = currentDraft ? Number(currentDraft.version || 0) : 0;
        if (Number(expectedVersion) !== currentVersion) {
          return res.status(409).json({
            ok: false,
            code: 'REVIEW_VERSION_CONFLICT',
            error: `复核确认版本冲突：当前版本为 ${currentVersion}，传入预期版本为 ${expectedVersion}，请刷新后再确认`
          });
        }
      }

      // 2. 校验可信人工确认上下文，严禁 Agent 自行确认
      const humanContext = resolveTrustedHumanContext(req, deps);
      if (!humanContext.ok) {
        return res.status(403).json({ ok: false, code: humanContext.code, error: humanContext.error });
      }

      // 3. 执行业务决策校验与应用
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

      // 4. 只有在业务决策成功生效并通过门禁时，才持久化确认 ReviewDraft
      if (result.status === 'keywords_reviewed') {
        const doConfirm = deps.confirmReviewDraft || confirmReviewDraft;
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
          expectedVersion,
          confirmedBy: humanContext.identity
        });

        if (runtime) {
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
      // 1. 乐观锁版本预检：如果调用方传入了预期版本号，在执行任何变更前预检冲突
      const expectedVersion = req.body?.version ?? req.body?.expectedVersion;
      if (expectedVersion !== undefined) {
        const getter = deps.getReviewDraft || getReviewDraft;
        const currentDraft = getter({ dataDir: deps.dataDir, runId, stepId: 'select' });
        const currentVersion = currentDraft ? Number(currentDraft.version || 0) : 0;
        if (Number(expectedVersion) !== currentVersion) {
          return res.status(409).json({
            ok: false,
            code: 'REVIEW_VERSION_CONFLICT',
            error: `复核确认版本冲突：当前版本为 ${currentVersion}，传入预期版本为 ${expectedVersion}，请刷新后再确认`
          });
        }
      }

      // 2. 校验可信人工确认上下文，严禁 Agent 自行确认
      const humanContext = resolveTrustedHumanContext(req, deps);
      if (!humanContext.ok) {
        return res.status(403).json({ ok: false, code: humanContext.code, error: humanContext.error });
      }

      // 3. 执行业务决策校验与应用（如果商品无效或为空，会抛出或返回 awaiting_product_review）
      const result = flowReviewProducts({
        runId,
        approvedProductIds: Array.isArray(req.body?.approvedProductIds) ? req.body.approvedProductIds : [],
        manualProducts: Array.isArray(req.body?.manualProducts) ? req.body.manualProducts : [],
        approveAll: req.body?.approveAll === true
      });

      // 4. 只有在商品成功被选中生效时，才确认 ReviewDraft
      if (result.status === 'products_selected') {
        const doConfirm = deps.confirmReviewDraft || confirmReviewDraft;
        doConfirm({
          dataDir: deps.dataDir,
          runId,
          stepId: 'select',
          decisions: {
            approvedProductIds: Array.isArray(req.body?.approvedProductIds) ? req.body.approvedProductIds : [],
            manualProducts: Array.isArray(req.body?.manualProducts) ? req.body.manualProducts : [],
            approveAll: req.body?.approveAll === true
          },
          expectedVersion,
          confirmedBy: humanContext.identity
        });

        const runtime = readRuntimeState({ runId });
        if (runtime) {
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
      if (req.body?.action === 'confirm') {
        const humanContext = resolveTrustedHumanContext(req, deps);
        if (!humanContext.ok) {
          return res.status(403).json({ ok: false, code: humanContext.code, error: humanContext.error });
        }
        const doConfirm = deps.confirmReviewDraft || confirmReviewDraft;
        const draft = doConfirm({
          dataDir: deps.dataDir,
          runId,
          stepId,
          decisions: req.body?.decisions,
          expectedVersion: req.body?.version ?? req.body?.expectedVersion,
          confirmedBy: humanContext.identity
        });
        return res.json({ ok: true, data: draft });
      }
      const humanContext = resolveTrustedHumanContext(req, deps);
      const callerIsAgent = !humanContext.ok || req.body?.updatedBy === 'agent_draft';
      const updatedBy = callerIsAgent ? 'agent_draft' : (humanContext.identity || 'user');
      const saver = deps.saveReviewDraft || saveReviewDraft;
      const draft = saver({
        dataDir: deps.dataDir,
        runId,
        stepId,
        decisions: req.body?.decisions || req.body || {},
        expectedVersion: req.body?.version ?? req.body?.expectedVersion,
        updatedBy
      });
      return res.json({ ok: true, data: draft });
    } catch (err) {
      if (err instanceof ReviewConflictError || err.code === 'REVIEW_VERSION_CONFLICT' || err.code === 'REVIEW_ALREADY_CONFIRMED') {
        return res.status(409).json({ ok: false, code: err.code, error: err.message });
      }
      if (err instanceof ReviewForbiddenError || err.code === 'REVIEW_CONFIRM_FORBIDDEN') {
        return res.status(403).json({ ok: false, code: err.code, error: err.message });
      }
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
}

module.exports = { registerSelectionReviewRoutes };
