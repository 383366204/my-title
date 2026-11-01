'use strict';

const { createWorkflowControlService } = require('../workflow/control-service');

function sendServiceResult(res, result) {
  if (result.httpStatus && result.httpStatus !== 200) {
    return res.status(result.httpStatus).json(result.body);
  }
  return res.json(result.body);
}

/**
 * 注册 Pipeline 门面控制路由；支持直接注入 controlService 或按依赖即时装配。
 * @param {object} app Express 应用。
 * @param {object} dependencies 共享控制服务或底层依赖。
 * @returns {void}
 */
function registerPipelineRoutes(app, dependencies = {}) {
  const controlService = dependencies.controlService || createWorkflowControlService(dependencies);

  // 1.9 Unified pipeline facade. The React app should treat this as the durable flow API.
  app.get('/api/pipeline/current', (req, res) => {
    const result = controlService.getCurrentPipelineRuns({ limit: req.query.limit });
    return sendServiceResult(res, result);
  });

  app.get('/api/pipeline/runs/:runId', (req, res) => {
    const result = controlService.getPipelineRunSummary({ runId: req.params.runId });
    return sendServiceResult(res, result);
  });

  app.post('/api/pipeline/start', async (req, res) => {
    const result = await controlService.startRun(req.body || {}, { source: 'pipeline' });
    return sendServiceResult(res, result);
  });

  app.post('/api/pipeline/runs/:runId/candidates', async (req, res) => {
    const result = await controlService.appendCandidates({
      runId: req.params.runId,
      body: req.body || {}
    });
    return sendServiceResult(res, result);
  });

  app.post('/api/pipeline/runs/:runId/pause', (req, res) => {
    const result = controlService.pauseRun({
      runId: req.params.runId,
      reason: req.body?.reason,
      validateRunId: true,
      allowLegacyFallback: false
    });
    return sendServiceResult(res, result);
  });

  app.post('/api/pipeline/runs/:runId/resume', async (req, res) => {
    const result = await controlService.resumeRun({
      runId: req.params.runId,
      validateRunId: true,
      allowLegacyFallback: false,
      source: 'pipeline'
    });
    return sendServiceResult(res, result);
  });

  app.post('/api/pipeline/runs/:runId/:step/retry', async (req, res) => {
    const result = await controlService.retryStep({
      runId: req.params.runId,
      stepId: req.params.step,
      source: 'pipeline',
      allowLegacyFallback: false
    });
    return sendServiceResult(res, result);
  });

  app.post('/api/pipeline/runs/:runId/:step', async (req, res) => {
    const result = await controlService.executeSingleStep({
      runId: req.params.runId,
      step: req.params.step,
      body: req.body || {}
    });
    return sendServiceResult(res, result);
  });
}

module.exports = { registerPipelineRoutes };
