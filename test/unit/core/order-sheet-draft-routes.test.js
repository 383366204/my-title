const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { registerOrderSheetDraftRoutes } = require('../../../core/server/order-sheet-draft-routes');

test('draft aliases preserve methods, data, validation and revision conflicts', async () => {
  const app = express();
  app.use(express.json());
  let mode = 'order-sheet';
  let failure = null;
  let saved;
  registerOrderSheetDraftRoutes(app, {
    readRuntimeState: () => mode ? { mode } : null,
    getOrderSheetDraft: ({ runId }) => {
      if (failure) throw failure;
      return { runId, items: [], revision: 3 };
    },
    saveOrderSheetDraft: input => {
      if (failure) throw failure;
      saved = input;
      return { revision: 4 };
    }
  });
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    for (const suffix of ['order-sheet/draft', 'order-sheet-draft']) {
      const url = `http://127.0.0.1:${server.address().port}/api/workflows/runs/fixture/${suffix}`;
      const response = await fetch(url);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, data: { runId: 'fixture', items: [], revision: 3 } });
      const post = () => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [], groups: 'invalid', unassignedItems: [], dragCount: 0, revision: 3 }) });
      assert.equal((await post()).status, 200);
      assert.deepEqual(saved, { runId: 'fixture', items: [], groups: undefined, unassignedItems: [], dragCount: 0, expectedRevision: 3 });
      failure = Object.assign(new Error('fixture conflict'), { code: 'ORDER_SHEET_DRAFT_CONFLICT' });
      assert.equal((await post()).status, 409);
      failure = new Error('fixture read error');
      const invalid = await fetch(url);
      assert.equal(invalid.status, 400);
      assert.deepEqual(await invalid.json(), { ok: false, error: 'fixture read error' });
      assert.equal((await post()).status, 400);
      failure = null;
      for (const unavailable of ['keyword', null]) {
        mode = unavailable;
        assert.equal((await fetch(url)).status, 409);
        assert.equal((await post()).status, 409);
      }
      mode = 'order-sheet';
      assert.equal((await fetch(url, { method: 'DELETE' })).status, 404);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
