'use strict';

const { createWorkflowControlService } = require('../workflow/control-service');

function sendServiceResult(res, result) {
  if (result.httpStatus && result.httpStatus !== 200) {
    return res.status(result.httpStatus).json(result.body);
  }
  return res.json(result.body);
}

/**
 * 注册画布端工作流控制路由；支持直接注入 controlService 或按依赖即时装配。
 * @param {object} app Express 应用。
 * @param {object} dependencies 共享控制服务或底层依赖。
 * @returns {void}
 */
function registerWorkflowControlRoutes(app, dependencies = {}) {
  const controlService = dependencies.controlService || createWorkflowControlService(dependencies);

  app.post('/api/workflows/runs/:runId/inspiration-roots', (req, res) => {
    const result = controlService.updateInspirationRoots({
      runId: req.params.runId,
      rootsText: req.body?.rootsText,
      revision: req.body?.revision
    });
    return sendServiceResult(res, result);
  });

  app.post('/api/workflows/runs/:runId/keyword-filter/recollect', (req, res) => {
    const result = controlService.recollectKeywordFilter({
      runId: req.params.runId,
      version: req.body?.version,
      decisions: req.body?.decisions
    });
    return sendServiceResult(res, result);
  });

  app.post('/api/workflows/runs/:runId/keywords/query', (req, res) => {
    const result = controlService.queryKeywordSupplement({
      runId: req.params.runId,
      keywords: req.body?.keywords,
      decisions: req.body?.decisions
    });
    return sendServiceResult(res, result);
  });

  app.post('/api/workflows/validate', (req, res) => {
    const result = controlService.validateWorkflowDefinition(req.body || {});
    return sendServiceResult(res, result);
  });

  // 3. POST /api/workflows/run - 启动一个新工作流
  app.post('/api/workflows/run', async (req, res) => {
    const result = await controlService.startRun(req.body || {}, { source: 'workflow' });
    return sendServiceResult(res, result);
  });

  // 6. POST /api/workflows/runs/:runId/cancel - 请求 runtime 在安全边界取消
  app.post('/api/workflows/runs/:runId/cancel', (req, res) => {
    const result = controlService.cancelRun({
      runId: req.params.runId,
      reason: req.body?.reason
    });
    return sendServiceResult(res, result);
  });

  // 7. POST /api/workflows/runs/:runId/retry-node - 重试某个特定节点
  app.post('/api/workflows/runs/:runId/retry-node', async (req, res) => {
    const result = await controlService.retryStep({
      runId: req.params.runId,
      stepId: req.body?.nodeId,
      source: 'workflow',
      allowLegacyFallback: true
    });
    return sendServiceResult(res, result);
  });

  // 8. POST /api/workflows/runs/:runId/resume - 继续执行工作流
  app.post('/api/workflows/runs/:runId/resume', async (req, res) => {
    const result = await controlService.resumeRun({
      runId: req.params.runId,
      source: 'workflow',
      allowLegacyFallback: true
    });
    return sendServiceResult(res, result);
  });

  // 8.5. POST /api/workflows/runs/:runId/pause - 暂停执行工作流
  app.post('/api/workflows/runs/:runId/pause', (req, res) => {
    const result = controlService.pauseRun({
      runId: req.params.runId,
      reason: req.body?.reason,
      allowLegacyFallback: true
    });
    return sendServiceResult(res, result);
  });
}

module.exports = { registerWorkflowControlRoutes };
