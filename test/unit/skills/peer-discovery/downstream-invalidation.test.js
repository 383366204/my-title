'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createPeerStateStore } = require('../../../../skills/peer-discovery/src/state-store');
const { invalidateDownstreamState } = require('../../../../skills/peer-discovery/src/downstream-invalidation');
const { runPeerVerifyImageSourcesStep } = require('../../../../skills/peer-discovery/src/verify-image-sources-step');
const { runPeerPrepareListingDraftsStep } = require('../../../../skills/peer-discovery/src/listing-draft-preparer');

async function setup(t) {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-invalidation-'));
  t.after(() => fs.rm(runDir, { recursive: true, force: true }));
  const store = createPeerStateStore(runDir);
  await store.initialize({});
  await store.transact(0, state => {
    state.bundle = { draftRevision: 'old', reviewState: 'completed' };
    state.allocationPlan = { planId: 'old' };
    state.checkpoints.prepareListingDrafts = { status: 'completed' };
  });
  await fs.writeFile(path.join(runDir, 'peer-allocation-plan.json'), 'old-plan');
  await fs.writeFile(path.join(runDir, 'peer-listing-drafts.jsonl'), 'old-drafts');
  return { runDir, store };
}

for (const [name, execute] of [['verification', runPeerVerifyImageSourcesStep], ['preparation', runPeerPrepareListingDraftsStep]]) {
  for (const code of ['PEER_REVISION_CONFLICT', 'ENOSPC']) {
    test(`${name} propagates invalidation ${code} without deleting uncommitted views`, async t => {
      const { runDir, store } = await setup(t);
      const error = Object.assign(new Error(code), { code });
      const failingStore = { ...store, transact: async () => { throw error; } };
      await assert.rejects(execute({ runDir, store: failingStore }), cause => cause === error);
      assert.equal((await store.read()).allocationPlan.planId, 'old');
      assert.equal(await fs.readFile(path.join(runDir, 'peer-allocation-plan.json'), 'utf8'), 'old-plan');
      assert.equal(await fs.readFile(path.join(runDir, 'peer-listing-drafts.jsonl'), 'utf8'), 'old-drafts');
      const result = await execute({ runDir, store });
      assert.equal(result.reason, 'products_missing');
      assert.equal((await store.read()).allocationPlan, undefined);
      await assert.rejects(fs.access(path.join(runDir, 'peer-allocation-plan.json')), { code: 'ENOENT' });
    });
  }
}

test('invalidation reads latest revision only after acquiring state lock', async t => {
  const { runDir, store } = await setup(t);
  let entered;
  let release;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const writer = store.withLock(async () => {
    entered();
    await gate;
    const current = await store.read();
    await store.transact(current.revision, state => { state.marker = 'concurrent change'; });
  });
  await ready;
  const invalidating = invalidateDownstreamState(store, runDir, { reason: 'test' });
  release();
  await writer;
  const state = await invalidating;
  assert.equal(state.marker, 'concurrent change');
  assert.equal(state.bundle, null);
  assert.equal(state.allocationPlan, undefined);
  assert.equal(state.checkpoints.prepareListingDrafts, undefined);
});

test('invalidation preserves caller-provided status like running or completed', async t => {
  const { runDir, store } = await setup(t);
  const running = await invalidateDownstreamState(store, runDir, { status: 'running', reason: 'started' });
  assert.equal(running.checkpoints.verifyImageSources.status, 'running');
  assert.equal(running.checkpoints.verifyImageSources.reason, 'started');

  const completed = await invalidateDownstreamState(store, runDir, { status: 'completed', reason: 'no_products' });
  assert.equal(completed.checkpoints.verifyImageSources.status, 'completed');
  assert.equal(completed.checkpoints.verifyImageSources.reason, 'no_products');
});

test('verifyImageSources records completed checkpoint when zero products are collected', async t => {
  const { runDir, store } = await setup(t);
  await fs.writeFile(path.join(runDir, 'peer-products.jsonl'), '');
  const result = await runPeerVerifyImageSourcesStep({ runDir, store });
  assert.equal(result.status, 'completed');
  assert.equal(result.totalProducts, 0);
  const state = await store.read();
  assert.equal(state.checkpoints.verifyImageSources.status, 'completed');
  assert.equal(state.checkpoints.verifyImageSources.reason, 'no_products');
  assert.equal(state.allocationPlan, undefined);
  assert.equal(state.bundle, null);
});
