'use strict';

function withLegacyBatchFields(summary) {
  return {
    ...summary,
    requiresReview: Boolean(
      summary.mustReview ||
      summary.status === 'needs_review' ||
      Number((summary.counts || {}).reviewCandidates || 0) > 0
    ),
    reviewPreview: (summary.previews && summary.previews.distributionReview) || ''
  };
}

/**
 * 注册旧工作台入口，与 runtime 路由共享同一个协调器。
 * @param {object} app Express 应用。
 * @param {object} dependencies 子进程启动、摘要读取与共享占用。
 * @returns {void}
 */
function registerWorkbenchRoutes(app, {
  parsePositiveNumber,
  listPipelineRuns,
  summarizePipelineRun,
  workbench,
  buildWorkbenchCliArgs,
  spawn,
  appendCappedOutput,
  originalLog,
  originalError
}) {
  app.get('/api/workflow/batches', (req, res) => {
    try {
      const limit = parsePositiveNumber(req.query.limit, 20);
      const data = listPipelineRuns({ limit });
      const runs = data.runs.map(withLegacyBatchFields);
      res.json({ ok: true, data: { ...data, runs, latest: runs[0] || null } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });
  // 1.6 GET /api/workbench/runs - Daily workbench run summaries
  app.get('/api/workbench/runs', (req, res) => {
    try {
      const limit = parsePositiveNumber(req.query.limit, 20);
      res.json({ ok: true, data: listPipelineRuns({ limit }) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 1.7 GET /api/workbench/runs/:runId - Daily workbench run details
  app.get('/api/workbench/runs/:runId', (req, res) => {
    try {
      const summary = summarizePipelineRun({ runId: req.params.runId });
      if (!summary) {
        return res.status(404).json({ ok: false, error: '未找到该工作流运行记录' });
      }
      res.json({ ok: true, data: summary });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 1.8 POST /api/workbench/run - Start guarded CLI workflow in background
  app.post('/api/workbench/run', (req, res) => {
    if (workbench.current) {
      return res.status(409).json({
        ok: false,
        status: 'workflow_busy',
        error: '已有工作流正在运行，请等待完成后再启动。'
      });
    }

    const body = req.body || {};
    const mode = body.mode === 'keyword' ? 'keyword' : 'daily';
    const keyword = String(body.keyword || '').trim();
    if (mode === 'keyword' && !keyword) {
      return res.status(400).json({ ok: false, error: '关键词不能为空' });
    }

    const args = buildWorkbenchCliArgs(mode, keyword, body);
    let child;
    try {
      child = spawn(process.execPath, args, {
        cwd: process.cwd(),
        env: process.env
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }

    const runState = {
      child,
      pid: child.pid,
      mode,
      stdout: '',
      stderr: ''
    };
    workbench.tryAcquire(runState);

    child.stdout.on('data', chunk => {
      runState.stdout = appendCappedOutput(runState.stdout, chunk);
    });
    child.stderr.on('data', chunk => {
      runState.stderr = appendCappedOutput(runState.stderr, chunk);
    });
    child.on('error', err => {
      workbench.release(runState);
      originalError('[Workbench Run] 子进程启动失败:', err.message);
    });
    child.on('exit', (code, signal) => {
      workbench.release(runState);
      if (code === 0) {
        originalLog(`[Workbench Run] ${mode} 工作流完成，pid=${runState.pid}`);
      } else {
        originalError(`[Workbench Run] ${mode} 工作流失败，pid=${runState.pid}, code=${code}, signal=${signal || ''}`);
        if (runState.stderr) originalError(runState.stderr.slice(-4000));
      }
    });

    res.json({ ok: true, data: { status: 'started', pid: child.pid, mode } });
  });
}

module.exports = { registerWorkbenchRoutes };
