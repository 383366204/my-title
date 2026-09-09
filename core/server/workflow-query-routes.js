'use strict';

const fs = require('fs');
const path = require('path');
const { streamWorkflowEvents } = require('./workflow-event-stream');

/**
 * 注册模板、运行历史、产物和事件读取接口。
 * @param {object} app Express 应用。
 * @param {object} deps 共享任务状态与工作流访问依赖。
 * @returns {void}
 */
function registerWorkflowQueryRoutes(app, deps) {
  const {
    listProductionWorkflowTemplates,
    parsePositiveNumber,
    listWorkflowRuns,
    workbench,
    readRuntimeState,
    deleteWorkflowRun,
    readWorkflowNodeArtifact,
    getWorkflowRun,
    isValidWorkflowRunIdParam,
    runtimeOnlyWorkflowSnapshot,
    readRuntimeEvents
  } = deps;

  app.get('/api/workflows/templates', (req, res) => {
    res.json({ ok: true, data: listProductionWorkflowTemplates() });
  });

  app.get('/api/workflows/runs', (req, res) => {
    try {
      const limit = parsePositiveNumber(req.query.limit, 20);
      res.json({ ok: true, data: listWorkflowRuns({ limit }) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.delete('/api/workflows/runs/:runId', (req, res) => {
    const runId = req.params.runId;
    try {
      if (req.body?.confirm !== true) {
        return res.status(400).json({ ok: false, error: '删除运行历史需要确认。' });
      }
      if (workbench.current && workbench.current.runId === runId) {
        return res.status(409).json({ ok: false, error: '当前运行仍在执行中，不能删除。' });
      }
      const runtime = readRuntimeState({ runId });
      const runtimeStatus = String(runtime?.status || '').toLowerCase();
      if (['running', 'retrying', 'resuming', 'cancelling'].includes(runtimeStatus)) {
        return res.status(409).json({ ok: false, error: '当前运行仍在执行中，不能删除。' });
      }

      const result = deleteWorkflowRun({ runId });
      if (!result.ok) {
        return res.status(404).json({ ok: false, error: '未找到该运行历史。' });
      }
      return res.json({ ok: true, data: result });
    } catch (err) {
      const status = /Invalid workflow run id|Invalid runtime run id/.test(err.message) ? 400 : 500;
      return res.status(status).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/workflows/runs/:runId/artifacts/:nodeId', (req, res) => {
    try {
      const artifact = readWorkflowNodeArtifact({
        runId: req.params.runId,
        nodeId: req.params.nodeId,
        limit: req.query.limit === 'all' ? 'all' : parsePositiveNumber(req.query.limit, 50),
        maxChars: parsePositiveNumber(req.query.maxChars, 10000)
      });
      if (!artifact) {
        return res.status(404).json({ ok: false, error: '未找到该节点产物' });
      }
      res.json({ ok: true, data: artifact });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/workflows/runs/:runId/artifacts/:nodeId/raw', (req, res) => {
    try {
      const artifact = readWorkflowNodeArtifact({
        runId: req.params.runId,
        nodeId: req.params.nodeId,
        limit: 1,
        maxChars: 1
      });
      if (!artifact || !artifact.file || !fs.existsSync(artifact.file)) {
        return res.status(404).type('text/plain').send('未找到该节点产物');
      }
      if (artifact.type === 'xlsx') {
        return res.download(artifact.file, artifact.filename || path.basename(artifact.file));
      }
      res.type('text/plain; charset=utf-8').send(fs.readFileSync(artifact.file, 'utf8'));
    } catch (err) {
      res.status(500).type('text/plain').send(err.message);
    }
  });

  app.get('/api/workflows/runs/:runId', (req, res) => {
    try {
      const runObj = getWorkflowRun({ runId: req.params.runId });
      if (!runObj) {
        return res.status(404).json({ ok: false, error: '未找到该运行记录' });
      }
      res.json({ ok: true, data: runObj });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/workflows/runs/:runId/events', (req, res) => {
    const runId = req.params.runId;
    if (!isValidWorkflowRunIdParam(runId)) {
      return res.status(400).json({ ok: false, error: '无效的运行 ID，请等待真实 pipeline runId 创建后再订阅事件。' });
    }
    streamWorkflowEvents(req, res, {
      readSnapshot: () => getWorkflowRun({ runId }) || runtimeOnlyWorkflowSnapshot(runId),
      readEvents: () => readRuntimeEvents({ runId })
    });
  });
}

module.exports = { registerWorkflowQueryRoutes };
