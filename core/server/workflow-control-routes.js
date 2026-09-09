'use strict';

/**
 * 注册控制路由；共享占用与运行能力由应用注入，保留请求时动态取 runner。
 * @param {object} app Express 应用。
 * @param {object} dependencies 共享协调器与运行服务。
 * @returns {void}
 */
function registerWorkflowControlRoutes(app, {
  validateProductionWorkflow,
  workbench,
  isValidWorkflowRunIdParam,
  requestRuntimeCancel,
  readRuntimeState,
  getPipelineRuntimeRunner,
  parsePositiveNumber,
  getSycmChromeAvailabilityChecker,
  recoverSycmAccessAfterChrome,
  requestRuntimeRetryStep,
  pipelineRunResponse,
  retryWorkflowNode,
  getRun,
  requestRuntimeResume,
  resumeWorkflow,
  requestRuntimePause,
  markRunPaused,
  resolveProductionWorkflowLaunch,
  resolveManualShareParams,
  sanitizeWorkflowParams,
  createRunId,
  resolveProductionWorkflowDefinition,
  writeWorkflowDefinition,
  originalLog,
  originalError
}) {
  app.post('/api/workflows/validate', (req, res) => {
    try {
      const body = req.body || {};
      const result = validateProductionWorkflow(body.workflow, {
        templateId: body.templateId || body.template_id,
        mode: body.mode
      });
      res.status(result.ok ? 200 : 400).json({ ok: result.ok, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });
  // 3. POST /api/workflows/run - 启动一个新工作流
  app.post('/api/workflows/run', async (req, res) => {
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
        originalLog(`[Workflow Run] ${launch.mode} runtime 完成，runId=${result.runId}, status=${result.runtimeStatus || result.status}`);
      }).catch(err => {
        originalError(`[Workflow Run] ${launch.mode} runtime 失败，runId=${runId}:`, err.message);
      });

      res.json({
        ok: true,
        data: {
          status: 'started',
          runId,
          mode: launch.mode,
          monitor: 'workflow',
          message: `真实 workflow runtime 已启动，runId=${runId}。`
        }
      });
    } catch (err) {
      const status = /未知 workflow mode|未知 workflow template|工作流定义|工作流必须匹配|关键词不能为空|词根不能为空|1688 商品链接|同行链接|商品缺少关键词|商品重复/.test(err.message) ? 400 : 500;
      res.status(status).json({ ok: false, error: err.message });
    } finally {
      if (!runState.promise) workbench.release(runState);
    }
  });

  // 6. POST /api/workflows/runs/:runId/cancel - 请求 runtime 在安全边界取消
  app.post('/api/workflows/runs/:runId/cancel', (req, res) => {
    const runId = req.params.runId;
    if (!isValidWorkflowRunIdParam(runId)) {
      return res.status(400).json({ ok: false, error: '无效的运行 ID。' });
    }
    try {
      const control = requestRuntimeCancel({
        runId,
        reason: req.body?.reason || 'user_cancelled'
      });
      res.json({ ok: true, data: { runId, status: 'cancel_requested', control } });
    } catch (err) {
      const status = /Invalid runtime run id/.test(err.message) ? 400 : 500;
      res.status(status).json({ ok: false, error: err.message });
    }
  });

  // 7. POST /api/workflows/runs/:runId/retry-node - 重试某个特定节点
  app.post('/api/workflows/runs/:runId/retry-node', async (req, res) => {
    const runId = req.params.runId;
    try {
      const nodeId = String(req.body?.nodeId || '').trim();
      if (!nodeId) {
        return res.status(400).json({ ok: false, error: 'nodeId is required' });
      }
      const runtime = readRuntimeState({ runId });
      if (runtime) {
        if (!['mine', 'keywordReview', 'verify', 'select', 'generate', 'export', 'collectRank', 'generateSheet', 'resolveShops', 'collectCompetitors', 'enrichCompetitors', 'analyzeCompetitors', 'competitorReport'].includes(nodeId)) {
          return res.status(400).json({ ok: false, error: '不支持的流程步骤。' });
        }
        const manualOrderSheetCollection = nodeId === 'collectRank'
          && runtime.mode === 'order-sheet'
          && runtime.params?.inputMode === 'manual';
        if (nodeId === 'verify' || nodeId === 'collectRank' || (nodeId === 'mine' && runtime.mode === 'root-keyword')) {
          const port = parsePositiveNumber(runtime.params?.port || process.env.SYCM_DEBUG_PORT || 9222, 9222);
          if (manualOrderSheetCollection) {
            const chromeReady = await getSycmChromeAvailabilityChecker()(port);
            if (!chromeReady) {
              return res.status(409).json({
                ok: false,
                code: 'CHROME_REQUIRED',
                error: `Chrome 调试连接仍不可用（端口 ${port}）。请先点击节点上的“启动 Chrome”，登录淘宝后再重试获取商品资料。`
              });
            }
          } else {
            const recovery = await recoverSycmAccessAfterChrome(port);
            if (!recovery.chromeReady) {
              return res.status(409).json({
                ok: false,
                code: 'SYCM_CHROME_REQUIRED',
                error: `Chrome 调试连接仍不可用（端口 ${port}）。请先点击节点上的“启动 Chrome”，完成登录后再重试当前节点。`
              });
            }
          }
        }
        if (workbench.current) {
          return res.status(409).json({ ok: false, error: '已有工作流正在运行，请等待完成后再重试。' });
        }
        const control = requestRuntimeRetryStep({ runId, step: nodeId });
        const runState = { runId, mode: 'workflow-retry-step' };
        const promise = workbench.run(runState, () => getPipelineRuntimeRunner()({
          runId,
          mode: runtime.mode || (runtime.steps?.includes('keyword') ? 'keyword' : 'daily'),
          params: runtime.params || {},
          preserveRuntime: true,
          retryStep: nodeId,
          steps: runtime.steps
        }));
        promise.then(result => {
          originalLog(`[Workflow Retry] runtime 完成，runId=${result.runId}, status=${result.runtimeStatus || result.status}`);
        }).catch(err => {
          originalError(`[Workflow Retry] runtime 失败，runId=${runId}, step=${nodeId}:`, err.message);
        });
        return res.json({ ok: true, data: pipelineRunResponse(runId, { control }) });
      }
      if (workbench.current) {
        return res.status(409).json({ ok: false, error: '已有工作流正在运行，请等待完成后再重试。' });
      }
      await workbench.run({ runId, mode: 'legacy-retry' }, () => retryWorkflowNode(runId, nodeId));
      return res.json({ ok: true, run: getRun(runId) });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });

  // 8. POST /api/workflows/runs/:runId/resume - 继续执行工作流
  app.post('/api/workflows/runs/:runId/resume', async (req, res) => {
    const runId = req.params.runId;
    try {
      const runtime = readRuntimeState({ runId });
      if (runtime) {
        if (workbench.current) {
          return res.status(409).json({ ok: false, error: '已有工作流正在运行，请等待完成后再继续。' });
        }
        const control = requestRuntimeResume({ runId });
        const runState = { runId, mode: 'workflow-resume' };
        const promise = workbench.run(runState, () => getPipelineRuntimeRunner()({
          runId,
          mode: runtime.mode || (runtime.steps?.includes('keyword') ? 'keyword' : 'daily'),
          params: runtime.params || {},
          preserveRuntime: true,
          resumeFromStep: runtime.activeStep,
          steps: runtime.steps
        }));
        promise.then(result => {
          originalLog(`[Workflow Resume] runtime 完成，runId=${result.runId}, status=${result.runtimeStatus || result.status}`);
        }).catch(err => {
          originalError(`[Workflow Resume] runtime 失败，runId=${runId}:`, err.message);
        });
        return res.json({ ok: true, data: pipelineRunResponse(runId, { control }) });
      }
      if (workbench.current) {
        return res.status(409).json({ ok: false, error: '已有工作流正在运行，请等待完成后再继续。' });
      }
      await workbench.run({ runId, mode: 'legacy-resume' }, () => resumeWorkflow(runId));
      return res.json({ ok: true, run: getRun(runId) });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });

  // 8.5. POST /api/workflows/runs/:runId/pause - 暂停执行工作流
  app.post('/api/workflows/runs/:runId/pause', (req, res) => {
    const runId = req.params.runId;
    try {
      const runtime = readRuntimeState({ runId });
      if (runtime) {
        const control = requestRuntimePause({
          runId,
          reason: req.body?.reason || 'user_paused'
        });
        return res.json({ ok: true, data: pipelineRunResponse(runId, { control }) });
      }
      const run = markRunPaused(runId);
      if (!run) {
        return res.status(404).json({ ok: false, error: '工作流运行不存在' });
      }
      return res.json({ ok: true, run });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });
}

module.exports = { registerWorkflowControlRoutes };
