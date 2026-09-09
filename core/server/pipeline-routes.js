'use strict';

/**
 * 注册控制路由；共享占用与运行能力由应用注入，保留请求时动态取 runner。
 * @param {object} app Express 应用。
 * @param {object} dependencies 共享协调器与运行服务。
 * @returns {void}
 */
function registerPipelineRoutes(app, {
  parsePositiveNumber,
  listPipelineRuns,
  withPipelineRuntimeFields,
  isValidWorkflowRunIdParam,
  summarizePipelineRun,
  workbench,
  resolveProductionWorkflowLaunch,
  resolveManualShareParams,
  sanitizeWorkflowParams,
  createRunId,
  resolveProductionWorkflowDefinition,
  writeWorkflowDefinition,
  getPipelineRuntimeRunner,
  originalLog,
  originalError,
  readRuntimeState,
  appendRunCandidates,
  requestRuntimePause,
  pipelineRunResponse,
  requestRuntimeResume,
  requestRuntimeRetryStep,
  runPipelineStep
}) {
  // 1.9 Unified pipeline facade. The React app should treat this as the durable flow API.
  app.get('/api/pipeline/current', (req, res) => {
    try {
      const limit = parsePositiveNumber(req.query.limit, 20);
      const data = listPipelineRuns({ limit });
      res.json({
        ok: true,
        data: {
          ...data,
          currentRun: withPipelineRuntimeFields(data.latest)
        }
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/pipeline/runs/:runId', (req, res) => {
    const runId = req.params.runId;
    if (!isValidWorkflowRunIdParam(runId)) {
      return res.status(400).json({ ok: false, error: '无效的运行 ID。' });
    }
    try {
      const summary = summarizePipelineRun({ runId });
      if (!summary) {
        return res.status(404).json({ ok: false, error: '未找到该流程运行记录' });
      }
      res.json({ ok: true, data: withPipelineRuntimeFields(summary) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/pipeline/start', async (req, res) => {
    const runState = workbench.tryAcquire({ mode: 'preparing' });
    if (!runState) {
      return res.status(409).json({
        ok: false,
        status: 'workflow_busy',
        error: '已有工作流正在运行，请等待完成后再启动。'
      });
    }

    try {
      const launch = resolveProductionWorkflowLaunch(req.body || {});
      const resolvedParams = await resolveManualShareParams(launch.mode, launch.params);
      const params = sanitizeWorkflowParams(launch.mode, resolvedParams);
      const runId = createRunId();
      const definition = resolveProductionWorkflowDefinition(req.body || {}, launch);
      writeWorkflowDefinition({ runId, definition });
      Object.assign(runState, { runId, mode: launch.mode });
      const promise = workbench.runReserved(runState, () => getPipelineRuntimeRunner()({ runId, mode: launch.mode, params }));

      promise.then(result => {
        originalLog(`[Pipeline Start] ${launch.mode} runtime 完成，runId=${result.runId}, status=${result.runtimeStatus || result.status}`);
      }).catch(err => {
        originalError(`[Pipeline Start] ${launch.mode} runtime 失败，runId=${runId}:`, err.message);
      });

      res.json({
        ok: true,
        data: {
          status: 'started',
          runId,
          mode: launch.mode,
          runtime: readRuntimeState({ runId }),
          currentRun: withPipelineRuntimeFields(summarizePipelineRun({ runId }))
        }
      });
    } catch (err) {
      const status = /未知 workflow mode|未知 workflow template|工作流定义|工作流必须匹配|关键词不能为空|词根不能为空|1688 商品链接|同行链接|商品缺少关键词|商品重复/.test(err.message) ? 400 : 500;
      res.status(status).json({ ok: false, error: err.message });
    } finally {
      if (!runState.promise) workbench.release(runState);
    }
  });

  app.post('/api/pipeline/runs/:runId/candidates', async (req, res) => {
    const runId = req.params.runId;
    if (!isValidWorkflowRunIdParam(runId)) {
      return res.status(400).json({ ok: false, error: '无效的运行 ID。' });
    }
    try {
      const result = await appendRunCandidates({
        ...(req.body || {}),
        runId,
        candidates: Array.isArray(req.body?.candidates) ? req.body.candidates : []
      });
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

  app.post('/api/pipeline/runs/:runId/pause', (req, res) => {
    const runId = req.params.runId;
    if (!isValidWorkflowRunIdParam(runId)) {
      return res.status(400).json({ ok: false, error: '无效的运行 ID。' });
    }
    try {
      const runtime = readRuntimeState({ runId });
      if (!runtime) return res.status(404).json({ ok: false, error: '未找到该流程运行记录' });
      const control = requestRuntimePause({
        runId,
        reason: req.body?.reason || 'user_paused'
      });
      res.json({ ok: true, data: pipelineRunResponse(runId, { control }) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/pipeline/runs/:runId/resume', async (req, res) => {
    const runId = req.params.runId;
    if (!isValidWorkflowRunIdParam(runId)) {
      return res.status(400).json({ ok: false, error: '无效的运行 ID。' });
    }
    if (workbench.current) {
      return res.status(409).json({ ok: false, error: '已有工作流正在运行，请等待完成后再继续。' });
    }
    try {
      const runtime = readRuntimeState({ runId });
      if (!runtime) return res.status(404).json({ ok: false, error: '未找到该流程运行记录' });
      const control = requestRuntimeResume({ runId });
      const runState = { runId, mode: 'resume' };
      const promise = workbench.run(runState, () => getPipelineRuntimeRunner()({
        runId,
        mode: runtime.mode || (runtime.steps?.includes('keyword') ? 'keyword' : 'daily'),
        params: runtime.params || {},
        preserveRuntime: true,
        resumeFromStep: runtime.activeStep,
        steps: runtime.steps
      }));
      promise.then(result => {
        originalLog(`[Pipeline Resume] runtime 完成，runId=${result.runId}, status=${result.runtimeStatus || result.status}`);
      }).catch(err => {
        originalError(`[Pipeline Resume] runtime 失败，runId=${runId}:`, err.message);
      });
      res.json({ ok: true, data: pipelineRunResponse(runId, { control }) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/pipeline/runs/:runId/:step/retry', async (req, res) => {
    const runId = req.params.runId;
    const step = String(req.params.step || '');
    if (!isValidWorkflowRunIdParam(runId)) {
      return res.status(400).json({ ok: false, error: '无效的运行 ID。' });
    }
    if (!['mine', 'review', 'keywordReview', 'verify', 'select', 'generate', 'export'].includes(step)) {
      return res.status(400).json({ ok: false, error: '不支持的流程步骤。' });
    }
    if (workbench.current) {
      return res.status(409).json({ ok: false, error: '已有工作流正在运行，请等待完成后再重试。' });
    }
    try {
      const runtime = readRuntimeState({ runId });
      if (!runtime) return res.status(404).json({ ok: false, error: '未找到该流程运行记录' });
      const control = requestRuntimeRetryStep({ runId, step });
      const runState = { runId, mode: 'retry-step' };
      const promise = workbench.run(runState, () => getPipelineRuntimeRunner()({
        runId,
        mode: runtime.mode || (runtime.steps?.includes('keyword') ? 'keyword' : 'daily'),
        params: runtime.params || {},
        preserveRuntime: true,
        retryStep: step,
        steps: runtime.steps
      }));
      promise.then(result => {
        originalLog(`[Pipeline Retry] runtime 完成，runId=${result.runId}, status=${result.runtimeStatus || result.status}`);
      }).catch(err => {
        originalError(`[Pipeline Retry] runtime 失败，runId=${runId}, step=${step}:`, err.message);
      });
      res.json({ ok: true, data: pipelineRunResponse(runId, { control }) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/pipeline/runs/:runId/:step', async (req, res) => {
    const runId = req.params.runId;
    const step = String(req.params.step || '');
    if (!isValidWorkflowRunIdParam(runId)) {
      return res.status(400).json({ ok: false, error: '无效的运行 ID。' });
    }
    if (!['mine', 'review', 'keywordReview', 'verify', 'select', 'generate', 'export'].includes(step)) {
      return res.status(400).json({ ok: false, error: '不支持的流程步骤。' });
    }
    if (workbench.current) {
      return res.status(409).json({ ok: false, error: '已有工作流正在运行，请等待完成后再继续。' });
    }
    try {
      const result = await workbench.run({ runId, mode: 'pipeline-step' }, () => runPipelineStep(step, runId, req.body || {}));
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
}

module.exports = { registerPipelineRoutes };
