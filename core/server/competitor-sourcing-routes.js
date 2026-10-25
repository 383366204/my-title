'use strict';
const path = require('node:path');
const { readRuntimeState, assertRuntimeRunId } = require('../../skills/pipeline-flow/runtime/store');

/**
 * 在工作台锁内确认选品和货源，不自动向平台提交。
 * @param {object} app Express 实例。
 * @param {object} deps 工作台锁及数据目录。
 * @returns {void}
 */
function registerCompetitorSourcingRoutes(app, { workbench, dataDir = path.join(process.cwd(), 'data/pipeline') }) {
  const base = '/api/workflows/runs/:runId/competitor-sourcing';
  const handle = (action) => async (req, res) => {
    try {
      const { runId } = req.params;
      assertRuntimeRunId(runId);
      const runtime = readRuntimeState({ dataDir, runId });
      if (!runtime || runtime.mode !== 'competitor-analysis' || !runtime.steps?.includes('findCompetitorSources')) return res.status(404).json({ ok: false, error: '当前运行不支持同行选货' });
      const flow = require('../../skills/competitor-analysis/src/sourcing-flow');
      const context = { dataDir, runId };
      if (!action) return res.json({ ok: true, data: await flow.getCompetitorSourcingState(context), runtime });
      if (!['needs_review', 'blocked', 'paused', 'failed'].includes(runtime.status)) return res.status(409).json({ ok: false, error: '请等待节点暂停后再确认' });
      const expectedStep = action === 'selection' ? 'collectCompetitors' : 'findCompetitorSources';
      if (runtime.activeStep !== expectedStep) return res.status(409).json({ ok: false, error: '当前节点已变化，请刷新结果' });
      const data = await workbench.run({ runId, mode: 'competitor-review' }, () => action === 'selection'
        ? flow.saveCompetitorSelection({ ...req.body, ...context })
        : flow.saveCompetitorSourceDecisions({ ...req.body, ...context }));
      res.json({ ok: true, data });
    } catch (error) {
      res.status(error.code === 'WORKFLOW_BUSY' ? 409 : 400).json({ ok: false, error: error.message });
    }
  };
  app.get(base, handle());
  app.post(`${base}/selection`, handle('selection'));
  app.post(`${base}/decisions`, handle('decisions'));
}
module.exports = { registerCompetitorSourcingRoutes };
