const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { registerWorkflowControlRoutes } = require('../../core/server/workflow-control-routes');
const { runPipelineRuntime } = require('../../skills/pipeline-flow/runtime/runner');
const { readWorkflowNodeArtifact } = require('../../core/workflow/pipeline-artifacts');

test('paused inspiration roots can be edited through API with conflict protection', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'root-review-api-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const runId = 'api-review';
  await runPipelineRuntime({ dataDir, runId, mode: 'daily', params: {
    reviewInspirationRoots: true, inspirationUseLLM: false, newsFeedUrls: [], keywordDataDir: path.join(dataDir, 'keywords')
  } });
  const artifact = readWorkflowNodeArtifact({ dataDir, runId, nodeId: 'inspire' });
  assert.equal(artifact.editable, true);
  const app = express();
  app.use(express.json());
  registerWorkflowControlRoutes(app, { dataDir, workbench: {}, isValidWorkflowRunIdParam: id => id === runId });
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/workflows/runs/${runId}/inspiration-roots`;
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rootsText: '杯垫\n收纳盒', revision: artifact.revision }) };
  const response = await fetch(url, options);
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.deepEqual(saved.data.rows.map(row => row.rootKeyword), ['杯垫', '收纳盒']);
  assert.equal((await fetch(url, options)).status, 409);
});
