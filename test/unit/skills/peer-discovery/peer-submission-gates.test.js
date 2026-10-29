'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createPeerStateStore } = require('../../../../skills/peer-discovery/src/state-store');
const { createPeerAllocationPlan, submitPeerAllocationPlan, savePeerDraftEdits } = require('../../../../skills/peer-discovery/src/peer-listing-adapter');

async function setup(t, needsInput = false) {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-submit-gates-'));
  t.after(() => fs.rm(runDir, { recursive: true, force: true }));
  const store = createPeerStateStore(runDir);
  await store.initialize({ discoveryBranch: 'image-selection' });
  await store.transact(0, state => {
    state.bundle = { draftRevision: 'r1', reviewState: 'needs_input', activeDrafts: [
      { draftKey: '1#default', offerId: '1', title: '标题', category: 'cat', needsInput },
      { draftKey: '2#default', offerId: '2', title: '待确认标题', category: 'cat', needsInput: true },
    ] };
  });
  return { runDir, store };
}

const request = { expectedDraftRevision: 'r1', offerIds: ['1'], targetShops: [{ id: 'shop' }] };

test('failed publication propagates and never writes a plan view', async t => {
  const ctx = await setup(t);
  const error = Object.assign(new Error('revision conflict'), { code: 'PEER_REVISION_CONFLICT' });
  await assert.rejects(() => createPeerAllocationPlan({ ...ctx, store: {
    ...ctx.store, transact: async () => { throw error; },
  } }, request), e => e === error);
  assert.equal((await ctx.store.read()).allocationPlan, undefined);
  await assert.rejects(() => fs.access(path.join(ctx.runDir, 'peer-allocation-plan.json')), { code: 'ENOENT' });
});

test('orphan plan file cannot authorize submission', async t => {
  const ctx = await setup(t);
  const { plan } = await createPeerAllocationPlan(ctx, request);
  const state = await ctx.store.read();
  await ctx.store.transact(state.revision, draft => { delete draft.allocationPlan; });
  let calls = 0;
  await assert.rejects(() => submitPeerAllocationPlan({ ...ctx, submitter: async () => { calls++; } }, {
    expectedDraftRevision: 'r1', expectedPlanId: plan.planId, confirm: true,
  }), { code: 'PEER_PLAN_MISSING' });
  assert.equal(calls, 0);
});

test('selected draft requires confirmation; unselected pending drafts do not block', async t => {
  const ctx = await setup(t, true);
  const { plan } = await createPeerAllocationPlan(ctx, request);
  let calls = 0;
  const submitCtx = { ...ctx, submitter: async () => { calls++; return { results: [{ offerId: '1', status: 'success' }] }; } };
  await assert.rejects(() => submitPeerAllocationPlan(submitCtx, {
    expectedDraftRevision: 'r1', expectedPlanId: plan.planId, confirm: true,
  }), { code: 'DRAFT_REVIEW_REQUIRED' });
  assert.equal(calls, 0);
  await assert.rejects(() => fs.access(path.join(ctx.runDir, 'peer-submissions.jsonl')), { code: 'ENOENT' });
  const edited = await savePeerDraftEdits(ctx, { expectedDraftRevision: 'r1', edits: { '1#default': { title: '人工确认标题' } } });
  const next = await createPeerAllocationPlan(ctx, { ...request, expectedDraftRevision: edited.draftRevision });
  const result = await submitPeerAllocationPlan(submitCtx, { expectedDraftRevision: edited.draftRevision, expectedPlanId: next.plan.planId, confirm: true });
  assert.equal(result.completed, true);
  assert.equal(calls, 1);
});
