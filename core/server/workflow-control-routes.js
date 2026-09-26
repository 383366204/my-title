'use strict';
const fs = require('fs');
const path = require('path');
const { prepareKeywordSupplement } = require('../../skills/pipeline-flow/src/keyword-supplement');
const { getRun: getPipelineRun } = require('../../skills/pipeline-flow/src/run-store');
const { readWorkflowNodeArtifact } = require('../workflow/pipeline-artifacts');
const { getKeywordRecollectionRoots } = require('./keyword-filter-routes');

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
  prepareSupplement = prepareKeywordSupplement,
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
  originalError,
  dataDir
}) {
  app.post('/api/workflows/runs/:runId/keyword-filter/recollect', (req, res) => {
    const sourceRunId = req.params.runId;
    if (!isValidWorkflowRunIdParam(sourceRunId)) return res.status(400).json({ ok: false, error: '无效的运行 ID。' });
    const runtime = readRuntimeState({ runId: sourceRunId });
    if (!runtime || runtime.activeStep !== 'keywordReview' || !['blocked', 'paused', 'needs_review'].includes(runtime.status)
      || runtime.progress?.keywordReview?.status === 'completed') {
      return res.status(409).json({ ok: false, error: '请在待确认关键词阶段发起重采。' });
    }
    if (!['daily', 'keyword', 'root-keyword'].includes(runtime.mode)) {
      return res.status(409).json({ ok: false, code: 'RECOLLECTION_UNSUPPORTED', error: '该模式不支持重采。' });
    }
    const reservation = workbench.tryAcquire({ mode: 'keyword-recollect' });
    if (!reservation) return res.status(409).json({ ok: false, error: '已有工作流正在运行。' });
    let receipt;
    let dispatched = false;
    let createdReceipt = false;
    try {
      const { run, runDir } = getPipelineRun({ runId: sourceRunId, dataDir });
      if (!['awaiting_keyword_review', 'keyword_review_empty'].includes(run.status)
        || req.body?.version !== (run.options?.keywordFilterVersion || 0)) {
        return res.status(409).json({ ok: false, error: '筛选配置或运行状态已更新，请刷新。' });
      }
      const rows = readWorkflowNodeArtifact({ runId: sourceRunId, dataDir, nodeId: 'keywordReview', limit: 'all' })?.rows || [];
      const suppliedDecisions = req.body.decisions === undefined ? {} : req.body.decisions;
      const knownKeywords = new Set(rows.map(row => row.keyword));
      if (!suppliedDecisions || typeof suppliedDecisions !== 'object' || Array.isArray(suppliedDecisions)
        || Object.entries(suppliedDecisions).some(([keyword, value]) => !knownKeywords.has(keyword)
          || !['approved', 'rejected'].includes(value))) {
        return res.status(400).json({ ok: false, error: 'decisions 必须是已有关键词到 approved/rejected 的映射。' });
      }
      receipt = path.join(runDir, `keyword-filter-recollection-${req.body.version}.json`);
      if (fs.existsSync(receipt)) {
        return res.json({ ok: true, data: { ...JSON.parse(fs.readFileSync(receipt, 'utf8')), reused: true } });
      }
      const mode = runtime.mode === 'daily' ? 'root-keyword' : runtime.mode;
      const roots = runtime.mode === 'daily' ? getKeywordRecollectionRoots(run) : null;
      if (roots && !roots.length) {
        return res.status(409).json({ ok: false, code: 'RECOLLECTION_UNSUPPORTED', error: '未记录实际查询词根，无法安全重采；不会重新生成灵感。' });
      }
      const decisions = { ...Object.fromEntries(rows.filter(row => ['approved', 'rejected'].includes(row.reviewDraft || row.reviewStatus))
        .map(row => [row.keyword, row.reviewDraft || row.reviewStatus])), ...suppliedDecisions };
      const params = { ...sanitizeWorkflowParams(mode, { ...run.options, ...runtime.params,
        ...(mode === 'keyword' && rows.length ? { keywords: rows.map(row => row.keyword) } : {}),
        ...(roots ? { roots, sycmMode: 'both', pages: runtime.params?.inspirationSycmPages || 3 } : {}),
        keywordFilter: run.options.keywordFilter }),
        guardCache: false, keywordFilterDecisions: decisions, recollectionOf: sourceRunId };
      // 新运行不复用完成队列；禁用 guard 缓存，保留原运行作为审计记录。
      const runId = `${createRunId()}-recollect-${require('crypto').randomUUID().slice(0, 8)}`;
      writeWorkflowDefinition({ runId, definition: resolveProductionWorkflowDefinition({ mode }, { mode, params }) });
      const response = { runId, sourceRunId, status: 'started', mode,
        recollectionMode: 'new_run', keywordFilterVersion: 0, cacheBypassed: true };
      // 每个源运行版本只创建一次，重复请求返回同一个新运行（包括运行完成后）。
      fs.writeFileSync(receipt, JSON.stringify(response), { flag: 'wx' });
      createdReceipt = true;
      Object.assign(reservation, { runId });
      const promise = workbench.runReserved(reservation, () => getPipelineRuntimeRunner()({ runId, mode, params, ...(dataDir ? { dataDir } : {}) }));
      dispatched = true;
      promise.catch(error => originalError(`[Keyword Recollect] ${runId}: ${error.message}`));
      return res.json({ ok: true, data: response });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    } finally {
      if (createdReceipt && !dispatched) fs.unlinkSync(receipt);
      if (!reservation.promise) workbench.release(reservation);
    }
  });
  app.post('/api/workflows/runs/:runId/keywords/query', (req, res) => {
    const runId = req.params.runId;
    if (!isValidWorkflowRunIdParam(runId)) return res.status(400).json({ ok: false, error: '无效的运行 ID。' });
    const runtime = readRuntimeState({ runId });
    if (!runtime || !['daily', 'keyword', 'root-keyword'].includes(runtime.mode)
      || runtime.activeStep !== 'keywordReview' || !['blocked', 'paused', 'needs_review'].includes(runtime.status)) {
      return res.status(409).json({ ok: false, error: '请在关键词确认节点暂停时补充查询。' });
    }
    const runState = workbench.tryAcquire({ runId, mode: 'keyword-supplement' });
    if (!runState) return res.status(409).json({ ok: false, error: '已有工作流正在运行。' });
    try {
      const keywords = prepareSupplement({ runId, keywords: req.body?.keywords, decisions: req.body?.decisions });
      const params = { ...runtime.params, reviewQueryKeywords: keywords };
      const promise = workbench.runReserved(runState, () => getPipelineRuntimeRunner()({ runId, mode: runtime.mode, params,
        preserveRuntime: true, resumeFromStep: 'keywordReview', steps: runtime.steps }));
      promise.catch(error => originalError(`[Keyword Supplement] ${runId}: ${error.message}`));
      return res.json({ ok: true, data: { runId, count: keywords.length, status: 'started' } });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    } finally {
      if (!runState.promise) workbench.release(runState);
    }
  });
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
      const status = err instanceof TypeError || /未知 workflow mode|未知 workflow template|工作流定义|工作流必须匹配|关键词不能为空|词根不能为空|1688 商品链接|同行链接|商品缺少关键词|商品重复/.test(err.message) ? 400 : 500;
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
