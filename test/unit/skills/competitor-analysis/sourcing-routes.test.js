const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { registerCompetitorSourcingRoutes } = require('../../../../core/server/competitor-sourcing-routes');
const { createWorkbenchCoordinator } = require('../../../../core/server/workbench-coordinator');
const { initRuntimeState, updateRuntimeState } = require('../../../../skills/pipeline-flow/runtime/store');

test('sourcing routes reject legacy runs, running edits and wrong-node edits', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-route-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const routes = new Map();
  const app = { get: (url, fn) => routes.set(`GET ${url}`, fn), post: (url, fn) => routes.set(`POST ${url}`, fn) };
  registerCompetitorSourcingRoutes(app, { dataDir, workbench: createWorkbenchCoordinator() });
  const runId = 'source-route-test';
  const invoke = async (method, suffix = '') => {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await routes.get(`${method} /api/workflows/runs/:runId/competitor-sourcing${suffix}`)({ params: { runId }, body: {} }, res);
    return res;
  };
  initRuntimeState({ dataDir, runId, mode: 'competitor-analysis', steps: ['collectCompetitors'] });
  assert.equal((await invoke('GET')).code, 404);
  updateRuntimeState({ dataDir, runId, patch: { steps: ['collectCompetitors', 'findCompetitorSources'], activeStep: 'collectCompetitors', status: 'running' } });
  assert.equal((await invoke('GET')).code, 200);
  assert.equal((await invoke('POST', '/selection')).code, 409);
  updateRuntimeState({ dataDir, runId, patch: { status: 'needs_review' } });
  assert.equal((await invoke('POST', '/decisions')).code, 409);
});
