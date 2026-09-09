'use strict';

/**
 * 注册铺货预检、提交、人工确认及任务控制接口。
 * @param {object} app Express 应用。
 * @param {object} deps 铺货任务服务和平台执行依赖。
 * @returns {void}
 */
function registerDistributionRoutes(app, deps) {
  // 环境检查尚未创建任务时，也必须阻止第二次提交。
  let submissionPreparing = false;
  const { jobs, parseItems, checkDistributionReadiness, parsePositiveNumber, createRunId, distributeProducts, summarizePipelineRun, originalError } = deps;
  const { activeDistributionJobs, readDistributionJob, writeDistributionJob, updateDistributionJob, recheckDistributionJob, syncCompletedDistributionWorkflow } = jobs;

  app.post('/api/distribution/check', async (req, res) => {
    try {
      const input = String(req.body?.input || '').trim();
      if (!input) {
        return res.status(400).json({ ok: false, error: '铺货清单为空，请先保留或加入至少 1 个商品。' });
      }
      const result = await checkDistributionReadiness({
        input,
        batchSize: parsePositiveNumber(req.body?.batchSize, 20),
        port: parsePositiveNumber(req.body?.port, process.env.BROWSER_CDP_PORT || process.env.CHROME_DEBUG_PORT || 9222),
        skipBrowser: req.body?.skipBrowser === true
      });
      return res.json({ ok: true, data: result });
    } catch (err) {
      const status = err && err.code === 'INVALID_ITEM' ? 400 : 500;
      return res.status(status).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/distribution/submit', async (req, res) => {
    let ownsPreparation = false;
    try {
      if (req.body?.confirm !== true) {
        return res.status(400).json({ ok: false, error: '自动铺货需要用户明确确认。' });
      }
      const input = String(req.body?.input || '').trim();
      const items = parseItems(input);
      if (items.length === 0) {
        return res.status(400).json({ ok: false, error: '铺货清单为空。' });
      }
      if (submissionPreparing) {
        return res.status(409).json({ ok: false, error: '正在检查铺货环境，请勿重复提交。' });
      }
      const runningJob = [...activeDistributionJobs.values()].find(job => ['checking', 'submitting', 'paused'].includes(job.status));
      if (runningJob) {
        return res.status(409).json({ ok: false, error: `已有铺货任务正在处理：${runningJob.jobId}` });
      }

      submissionPreparing = true;
      ownsPreparation = true;
      const readiness = await checkDistributionReadiness({
        input,
        batchSize: parsePositiveNumber(req.body?.batchSize, 20),
        port: parsePositiveNumber(req.body?.port, process.env.BROWSER_CDP_PORT || process.env.CHROME_DEBUG_PORT || 9222)
      });
      if (!readiness.canSubmit) {
        return res.status(409).json({ ok: false, error: '铺货环境检查未通过。', data: readiness });
      }

      const jobId = `${req.body?.runId || createRunId()}-distribution`;
      const job = writeDistributionJob({
        jobId,
        workflowRunId: req.body?.runId || '',
        status: 'submitting',
        requestedAction: null,
        total: items.length,
        completed: 0,
        failed: 0,
        skipped: 0,
        batchSize: parsePositiveNumber(req.body?.batchSize, 20),
        progress: { batchIndex: 0, batchTotal: Math.ceil(items.length / parsePositiveNumber(req.body?.batchSize, 20)), phase: 'starting' },
        items: items.map(item => ({ offerId: item.offerId, url: item.url, title: item.title, category: item.category })),
        results: [],
        startedAt: new Date().toISOString()
      });
      activeDistributionJobs.set(jobId, job);

      Promise.resolve().then(() => distributeProducts({
        input,
        batchSize: job.batchSize,
        port: parsePositiveNumber(req.body?.port, process.env.BROWSER_CDP_PORT || process.env.CHROME_DEBUG_PORT || 9222),
        onProgress: async (event) => {
          const results = event.results || [];
          updateDistributionJob(jobId, {
            status: event.status === 'pause' ? 'paused' : event.status === 'cancel' ? 'cancelled' : 'submitting',
            progress: { batchIndex: event.batchIndex || 0, batchTotal: event.batchTotal || job.progress.batchTotal, phase: event.phase || '' },
            results,
            completed: results.filter(row => row.status === 'confirmed' || row.ok === true).reduce((sum, row) => sum + Number(row.count || 0), 0),
            failed: results.filter(row => row.status && row.status !== 'confirmed' && !row.skipped).reduce((sum, row) => sum + Number(row.count || 0), 0),
            skipped: results.filter(row => row.skipped).reduce((sum, row) => sum + Number(row.count || 0), 0)
          });
        },
        shouldStop: async () => {
          const current = activeDistributionJobs.get(jobId) || readDistributionJob(jobId);
          return current?.requestedAction || null;
        }
      })).then(result => {
        const finalStatus = result.stoppedStatus === 'pause'
          ? 'paused'
          : result.stoppedStatus === 'cancel'
            ? 'cancelled'
            : result.ok
              ? 'completed'
              : 'completed_with_issues';
        if (finalStatus === 'completed' && job.workflowRunId) {
          try {
            syncCompletedDistributionWorkflow({ ...job, status: finalStatus, result });
          } catch (workflowError) {
            originalError(`[Distribution Complete] 工作流状态回写失败，runId=${job.workflowRunId}:`, workflowError.message);
          }
        }
        updateDistributionJob(jobId, {
          status: finalStatus,
          result,
          results: result.batches || [],
          progress: { batchIndex: result.batches?.length || 0, batchTotal: job.progress.batchTotal, phase: finalStatus },
          requestedAction: null
        });
        activeDistributionJobs.delete(jobId);
      }).catch(error => {
        updateDistributionJob(jobId, { status: 'failed', error: error.message, requestedAction: null });
        activeDistributionJobs.delete(jobId);
      });

      return res.json({ ok: true, data: { jobId, status: 'submitting', total: items.length } });
    } catch (err) {
      const status = err && err.code === 'INVALID_ITEM' ? 400 : 500;
      return res.status(status).json({ ok: false, error: err.message });
    } finally {
      if (ownsPreparation) submissionPreparing = false;
    }
  });

  app.post('/api/distribution/manual-complete', (req, res) => {
    try {
      if (req.body?.confirm !== true) {
        return res.status(400).json({ ok: false, error: '人工铺货完成需要用户明确确认。' });
      }
      const workflowRunId = String(req.body?.runId || '').trim();
      if (!workflowRunId) {
        return res.status(400).json({ ok: false, error: '缺少工作流运行 ID。' });
      }
      const input = String(req.body?.input || '').trim();
      const items = parseItems(input);
      if (items.length === 0) {
        return res.status(400).json({ ok: false, error: '人工铺货清单为空。' });
      }
      const incompleteItem = items.find(item => !item.url || !item.title);
      if (incompleteItem) {
        return res.status(400).json({ ok: false, error: '人工铺货清单必须包含链接和标题；类目可在人工铺货时补充。' });
      }

      const currentSummary = summarizePipelineRun({ runId: workflowRunId });
      if (!currentSummary?.runId) {
        return res.status(404).json({ ok: false, error: '未找到对应的工作流运行。' });
      }
      const allowedStatuses = new Set(['ready_to_distribute', 'needs_review', 'awaiting_user_confirmation', 'workflow_complete']);
      if (!allowedStatuses.has(currentSummary.status)) {
        return res.status(409).json({ ok: false, error: `当前流程状态为 ${currentSummary.status || '未知'}，还不能确认人工铺货完成。` });
      }

      const jobId = `${workflowRunId}-distribution`;
      const existingJob = activeDistributionJobs.get(jobId) || readDistributionJob(jobId);
      if (existingJob?.status === 'completed' && existingJob?.mode === 'manual') {
        return res.json({ ok: true, data: existingJob });
      }
      if (existingJob?.status === 'completed') {
        return res.status(409).json({ ok: false, error: '该流水线已经通过自动铺货完成，不能改记为人工铺货。' });
      }
      if (currentSummary.status === 'workflow_complete') {
        return res.status(409).json({ ok: false, error: '该流水线已经完成，无需再次确认人工铺货。' });
      }
      if (existingJob && ['checking', 'checking_confirmation', 'submitting', 'paused'].includes(existingJob.status)) {
        return res.status(409).json({ ok: false, error: '自动铺货任务仍在处理中，请先暂停或取消后再确认人工铺货。' });
      }

      const completedAt = new Date().toISOString();
      const job = writeDistributionJob({
        jobId,
        workflowRunId,
        mode: 'manual',
        status: 'completed',
        requestedAction: null,
        total: items.length,
        completed: items.length,
        failed: 0,
        skipped: 0,
        items: items.map(item => ({ offerId: item.offerId, url: item.url, title: item.title, category: item.category })),
        results: [],
        result: {
          ok: true,
          status: 'manually_confirmed',
          method: 'manual',
          total: items.length,
          confirmed: items.length
        },
        progress: { batchIndex: 1, batchTotal: 1, phase: 'manual_completed' },
        startedAt: existingJob?.startedAt || completedAt,
        completedAt,
        previousStatus: existingJob?.status || null
      });
      activeDistributionJobs.delete(jobId);
      syncCompletedDistributionWorkflow(job);
      return res.json({ ok: true, data: job });
    } catch (err) {
      const status = err && err.code === 'INVALID_ITEM' ? 400 : /未找到|不存在/.test(String(err?.message || '')) ? 404 : 500;
      return res.status(status).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/distribution/runs/:jobId', (req, res) => {
    try {
      let job = activeDistributionJobs.get(req.params.jobId) || readDistributionJob(req.params.jobId);
      if (!job) return res.status(404).json({ ok: false, error: '未找到铺货任务。' });
      if (job.status === 'completed' && job.workflowRunId) {
        try {
          syncCompletedDistributionWorkflow(job);
          job = readDistributionJob(req.params.jobId) || job;
        } catch (workflowError) {
          originalError(`[Distribution Complete] 历史任务状态回写失败，runId=${job.workflowRunId}:`, workflowError.message);
        }
      }
      return res.json({ ok: true, data: job });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/distribution/runs/:jobId/:action', async (req, res) => {
    const action = String(req.params.action || '');
    if (!['pause', 'cancel', 'recheck'].includes(action)) {
      return res.status(400).json({ ok: false, error: '不支持的铺货控制操作。' });
    }
    try {
      const job = activeDistributionJobs.get(req.params.jobId) || readDistributionJob(req.params.jobId);
      if (!job) return res.status(404).json({ ok: false, error: '未找到铺货任务。' });
      if (action === 'recheck') {
        if (!['completed_with_issues', 'checking_confirmation'].includes(job.status)) {
          return res.status(409).json({ ok: false, error: `当前任务状态为${job.status}，无需重新核对。` });
        }
        const next = await recheckDistributionJob(job);
        return res.json({ ok: true, data: next });
      }
      if (!['submitting', 'paused'].includes(job.status)) {
        return res.status(409).json({ ok: false, error: `当前任务状态为${job.status}，不能执行该操作。` });
      }
      const next = updateDistributionJob(req.params.jobId, {
        requestedAction: action,
        controlMessage: action === 'pause' ? '将在当前批次完成后暂停' : '将在当前批次完成后取消'
      });
      return res.json({ ok: true, data: next });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });
}

module.exports = { registerDistributionRoutes };
