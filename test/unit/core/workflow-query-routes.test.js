const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { registerWorkflowQueryRoutes } = require('../../../core/server/workflow-query-routes');

test('query routes preserve deletion guards, previews, downloads and errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-query-'));
  const textFile = path.join(dir, 'result.txt');
  const sheetFile = path.join(dir, 'result.xlsx');
  fs.writeFileSync(textFile, 'fixture result');
  fs.writeFileSync(sheetFile, Buffer.from([80, 75, 3, 4]));
  const workbench = { current: null };
  let runtime = null;
  let artifact = null;
  let artifactInput;
  let failure = null;
  let deleted = 0;
  let exists = true;
  let limit;
  const app = express();
  app.use(express.json());
  registerWorkflowQueryRoutes(app, {
    listProductionWorkflowTemplates: () => [{ id: 'fixture' }],
    parsePositiveNumber: (value, fallback) => Number(value) > 0 ? Number(value) : fallback,
    listWorkflowRuns: input => { limit = input.limit; return []; },
    workbench,
    readRuntimeState: () => runtime,
    deleteWorkflowRun: () => { if (failure) throw failure; deleted++; return { ok: exists }; },
    readWorkflowNodeArtifact: input => { artifactInput = input; if (failure) throw failure; return artifact; },
    getWorkflowRun: () => exists ? { runId: 'fixture' } : null,
    isValidWorkflowRunIdParam: id => id === 'fixture',
    runtimeOnlyWorkflowSnapshot: () => null,
    readRuntimeEvents: () => []
  });
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/workflows`;
  const remove = confirm => fetch(`${base}/runs/fixture`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm })
  });
  try {
    assert.deepEqual((await (await fetch(`${base}/templates`)).json()).data, [{ id: 'fixture' }]);
    await fetch(`${base}/runs?limit=0`);
    assert.equal(limit, 20);
    await fetch(`${base}/runs?limit=7`);
    assert.equal(limit, 7);
    assert.equal((await remove(false)).status, 400);
    workbench.current = { runId: 'fixture' };
    assert.equal((await remove(true)).status, 409);
    workbench.current = null;
    for (const status of ['running', 'retrying', 'resuming', 'cancelling']) {
      runtime = { status };
      assert.equal((await remove(true)).status, 409);
    }
    assert.equal(deleted, 0);
    runtime = { status: 'completed' };
    assert.equal((await remove(true)).status, 200);
    assert.equal(deleted, 1);
    exists = false;
    assert.equal((await remove(true)).status, 404);
    assert.equal((await fetch(`${base}/runs/fixture`)).status, 404);
    failure = new Error('Invalid workflow run id');
    assert.equal((await remove(true)).status, 400);
    failure = null;
    const preview = `${base}/runs/fixture/artifacts/export`;
    assert.equal((await fetch(preview)).status, 404);
    artifact = { type: 'text', file: textFile };
    assert.equal((await fetch(`${preview}?limit=all&maxChars=99`)).status, 200);
    assert.deepEqual(artifactInput, { runId: 'fixture', nodeId: 'export', limit: 'all', maxChars: 99 });
    assert.equal(await (await fetch(`${preview}/raw`)).text(), 'fixture result');
    assert.equal(artifactInput.limit, 1);
    assert.equal(artifactInput.maxChars, 1);
    artifact = { type: 'xlsx', file: sheetFile, filename: 'download.xlsx' };
    const download = await fetch(`${preview}/raw`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition'), /attachment; filename="download.xlsx"/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), fs.readFileSync(sheetFile));
    artifact = { file: path.join(dir, 'missing') };
    assert.equal((await fetch(`${preview}/raw`)).status, 404);
    failure = new Error('fixture failure');
    const error = await fetch(`${preview}/raw`);
    assert.equal(error.status, 500);
    assert.equal(await error.text(), 'fixture failure');
    assert.equal((await fetch(`${base}/runs/null/events`)).status, 400);
    assert.equal((await fetch(`${base}/runs/fixture/events`)).status, 404);
    exists = true;
    const controller = new AbortController();
    const stream = await fetch(`${base}/runs/fixture/events`, { signal: controller.signal });
    try {
      assert.match(stream.headers.get('content-type'), /text\/event-stream/);
      assert.equal(stream.headers.get('cache-control'), 'no-cache');
      const reader = stream.body.getReader();
      const first = await reader.read();
      assert.match(new TextDecoder().decode(first.value), /"event":"init"/);
    } finally {
      controller.abort();
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
