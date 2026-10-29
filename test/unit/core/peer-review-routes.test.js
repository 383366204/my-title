'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { registerPeerReviewRoutes } = require('../../../core/server/peer-review-routes');
const { createPeerStateStore } = require('../../../skills/peer-discovery/src/state-store');

async function setup(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-routes-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const store = createPeerStateStore(path.join(dataDir, 'runs', 'run1'));
  await store.initialize({ discoveryBranch: 'image-selection' });
  await store.transact(0, state => {
    state.bundle = { draftRevision: 'r1', activeDrafts: [
      { draftKey: 'd1', offerId: '1', title: '标题', category: '类目', needsInput: true },
    ] };
  });
  const routes = new Map();
  const runtime = { mode: 'peer-discovery', params: { discoveryBranch: 'image-selection' } };
  registerPeerReviewRoutes({
    get: (url, handler) => routes.set(`GET ${url}`, handler),
    post: (url, handler) => routes.set(`POST ${url}`, handler),
  }, { dataDir, readRuntimeState: () => runtime, shops: { get: id => ({ id, revision: 's1', platformShopName: '真实店铺', port: 9222 }) } });
  return {
    store, runtime,
    async call(method, suffix = '', body = {}, runId = 'run1') {
      const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; } };
      await routes.get(`${method} /api/workflows/runs/:runId/peer-review${suffix}`)({ params: { runId }, body }, response);
      return response;
    },
  };
}

test('read, edit and allocate authoritative review drafts with revision checks', async t => {
  const { call, store } = await setup(t);
  assert.equal((await call('GET')).body.data.bundle.draftRevision, 'r1');
  const edited = await call('POST', '/drafts', { expectedDraftRevision: 'r1', edits: { d1: { title: '人工确认' } } });
  assert.equal(edited.statusCode, 200);
  const revision = edited.body.data.draftRevision;
  assert.equal(edited.body.data.bundle.activeDrafts[0].needsInput, false);
  assert.equal((await call('POST', '/drafts', { expectedDraftRevision: 'r1', edits: {} })).statusCode, 409);
  const payload = { expectedDraftRevision: revision, offerIds: ['1'], shopIds: ['shop1'], shopRevisions: { shop1: 's1' }, targetShops: [{ id: 'forged' }] };
  const result = await call('POST', '/allocation', payload);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.data.plan.targetShopSnapshots[0].platformShopName, '真实店铺');
  assert.equal((await store.read()).allocationPlan.planId, result.body.data.plan.planId);
  await call('POST', '/drafts', { expectedDraftRevision: revision, edits: { d1: { title: '再次编辑' } } });
  assert.equal((await call('GET')).body.data.allocationPlan, null);
});

test('reject invalid runs, stale shops, foreign products and malformed edits', async t => {
  const { call, runtime } = await setup(t);
  assert.equal((await call('GET', '', {}, '../other')).statusCode, 400);
  assert.equal((await call('POST', '/drafts', { edits: { d1: { category: {} } } })).statusCode, 400);
  assert.equal((await call('POST', '/drafts', { edits: { unknown: {} } })).statusCode, 400);
  assert.equal((await call('POST', '/drafts', { edits: { d1: { needsInput: false } } })).statusCode, 400);
  const payload = { expectedDraftRevision: 'r1', offerIds: ['1'], shopIds: ['shop1'] };
  assert.equal((await call('POST', '/allocation', payload)).statusCode, 409);
  assert.equal((await call('POST', '/allocation', { ...payload, shopRevisions: { shop1: 's1' }, offerIds: ['foreign'] })).statusCode, 400);
  runtime.mode = 'other';
  assert.equal((await call('GET')).statusCode, 409);
});
