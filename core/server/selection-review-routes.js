'use strict';

/**
 * 注册人工筛词、货源选品复核；确认后等待显式继续。
 * @param {object} app Express 应用。
 * @param {object} deps 选品复核和运行状态访问依赖。
 * @returns {void}
 */
function registerSelectionReviewRoutes(app, deps) {
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
      const result = flowReviewCandidates({
        runId,
        approvedKeywords: Array.isArray(req.body?.approvedKeywords) ? req.body.approvedKeywords : [],
        rejectedKeywords: Array.isArray(req.body?.rejectedKeywords) ? req.body.rejectedKeywords : [],
        manualKeywords: Array.isArray(req.body?.manualKeywords) ? req.body.manualKeywords : [],
        approveAll: req.body?.approveAll === true
      });
      const runtime = readRuntimeState({ runId });
      if (runtime && result.status === 'keywords_reviewed') {
        const nextStep = runtime.steps?.includes('verify') ? 'verify' : 'select';
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
              ...(runtime.steps?.includes('verify') ? { verify: {
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
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/workflows/runs/:runId/product-review', (req, res) => {
    const runId = req.params.runId;
    if (!isValidWorkflowRunIdParam(runId)) {
      return res.status(400).json({ ok: false, error: '无效的运行 ID。' });
    }
    try {
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
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
}

module.exports = { registerSelectionReviewRoutes };
