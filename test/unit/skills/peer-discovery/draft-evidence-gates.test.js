'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createPeerStateStore, fingerprint } = require('../../../../skills/peer-discovery/src/state-store');
const { runPeerPrepareListingDraftsStep } = require('../../../../skills/peer-discovery/src/listing-draft-preparer');
const { runPeerReviewListingsStep } = require('../../../../skills/peer-discovery/src/peer-listing-adapter');
const { runPeerVerifyImageSourcesStep } = require('../../../../skills/peer-discovery/src/verify-image-sources-step');

async function setup(t, row) {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'draft-evidence-'));
  t.after(() => fs.rm(runDir, { recursive: true, force: true }));
  const store = createPeerStateStore(runDir);
  await store.initialize({});
  await store.transact(0, state => {
    state.bundle = { draftRevision: 'old', reviewState: 'completed', activeDrafts: [] };
    state.allocationPlan = { planId: 'old' };
  });
  await fs.writeFile(path.join(runDir, 'peer-products.jsonl'), JSON.stringify({ itemId: '1', snapshotRevision: 's1' }) + '\n');
  if (row) await fs.writeFile(path.join(runDir, 'image-sourcing-results.jsonl'), JSON.stringify({
    productKey: '1', snapshotRevision: 's1', observedAt: Date.now() - 1000, expiresAt: Date.now() + 60000,
    searchConfigHash: fingerprint({ provider: '1688-image-search-v1', port: 9222 }),
    judgeConfigHash: fingerprint({ imagePriceRatioThreshold: '1', similarityThreshold: 0.45 }),
    ...row,
  }) + '\n');
  return { runDir, store };
}

test('newly collected confirmed evidence is not compared against a pre-request clock', async t => {
  const { runDir } = await setup(t);
  const now = Date.now();
  await fs.writeFile(path.join(runDir, 'peer-products.jsonl'), JSON.stringify({
    itemId: '1', snapshotRevision: 's1', priceText: '100', currency: 'CNY',
    singlePiecePriceVerified: true, imageDigest: 'image', observedAt: now - 100, expiresAt: now + 60000,
  }) + '\n');
  let calls = 0;
  const provider = { search: async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 30));
    const observedAt = Date.now();
    return { ok: true, complete: true, candidates: [{
      offerId: '123', priceText: '50', currency: 'CNY', similarity: 0.9,
      singlePiecePriceVerified: true, available: true, specStatus: 'consistent',
      observedAt, expiresAt: observedAt + 60000,
    }] };
  } };
  const result = await runPeerVerifyImageSourcesStep({ runDir, provider });
  assert.equal(result.status, 'completed');
  assert.equal(result.confirmedCount, 1);
  const cached = await runPeerVerifyImageSourcesStep({ runDir, provider });
  assert.equal(cached.status, 'completed');
  assert.equal(cached.confirmedCount, 1);
  assert.equal(calls, 1);
});

test('confirmed evidence expiring during title generation cannot publish drafts', async t => {
  const now = Date.now();
  const { runDir, store } = await setup(t, { complete: true, candidates: [{
    offerId: '123', title: '商品', observedAt: now - 100, expiresAt: now + 60000,
    verdict: { level: 'confirmed', expiresAt: now + 60000 },
  }] });
  let clock = now;
  t.mock.method(Date, 'now', () => clock);
  let calls = 0;
  const result = await runPeerPrepareListingDraftsStep({ runDir, store, llmCaller: async () => {
    calls++;
    clock += 120000;
    return '测试商品标题';
  } });
  assert.equal(calls, 1);
  assert.equal(result.reason, 'evidence_expired_during_preparation');
  assert.equal(result.status, 'manual_action_required');
  assert.equal((await store.read()).bundle, null);
  await assert.rejects(fs.access(path.join(runDir, 'peer-listing-drafts.jsonl')), { code: 'ENOENT' });
});

test('long verification batches recheck earlier cached evidence at completion', async t => {
  const { runDir } = await setup(t);
  const now = Date.now();
  let clock = now;
  t.mock.method(Date, 'now', () => clock);
  const source = { snapshotRevision: 's1', priceText: '100', currency: 'CNY', imageDigest: 'image',
    singlePiecePriceVerified: true, observedAt: now - 100, expiresAt: now + 60000 };
  const candidate = { offerId: '123', priceText: '50', currency: 'CNY', similarity: 0.9,
    singlePiecePriceVerified: true, available: true, specStatus: 'consistent', observedAt: now - 100, expiresAt: now + 1000,
    verdict: { level: 'confirmed', expiresAt: now + 1000 } };
  await fs.writeFile(path.join(runDir, 'peer-products.jsonl'), ['1', '2'].map(itemId => JSON.stringify({ ...source, itemId })).join('\n'));
  await fs.writeFile(path.join(runDir, 'image-sourcing-results.jsonl'), JSON.stringify({
    productKey: '1', snapshotRevision: 's1', observedAt: now - 100, expiresAt: now + 1000,
    searchConfigHash: fingerprint({ provider: '1688-image-search-v1', port: 9222 }),
    judgeConfigHash: fingerprint({ imagePriceRatioThreshold: '1', similarityThreshold: 0.45 }),
    candidates: [candidate], complete: true,
  }));
  const result = await runPeerVerifyImageSourcesStep({ runDir, provider: { search: async () => {
    clock += 2000;
    return { ok: true, complete: true, candidates: [{ ...candidate, observedAt: clock, expiresAt: clock + 60000 }] };
  } } });
  assert.equal(result.status, 'manual_action_required');
  assert.equal(result.confirmedCount, 1);
  assert.equal(result.pendingEvidence[0].productKey, '1');
  assert.deepEqual(result.pendingEvidence[0].reasons, ['evidence_needs_refresh']);
});

for (const [name, row] of [
  ['missing', null],
  ['expired', { observedAt: 1, expiresAt: 2, complete: true, candidates: [] }],
  ['incomplete search', { complete: false, candidates: [] }],
  ['unknown specifications', { complete: true, candidates: [{ verdict: { level: 'suspected', reason: 'specification_unknown' } }] }],
  ['card-only evidence', { complete: false, candidates: [{ verdict: { level: 'inconclusive', reason: 'missing_similarity' } }] }],
]) {
  test(`${name} evidence cannot become an empty completed review`, async t => {
    const { runDir, store } = await setup(t, row);
    const result = await runPeerPrepareListingDraftsStep({ runDir });
    assert.equal(result.status, 'manual_action_required');
    assert.equal(result.reason, 'source_evidence_incomplete');
    assert.equal(result.pendingEvidence.length, 1);
    const state = await store.read();
    assert.equal(state.bundle.reviewState, 'needs_evidence');
    assert.equal(state.allocationPlan, undefined);
    assert.equal((await runPeerReviewListingsStep({ runDir })).reason, 'source_evidence_incomplete');
  });
}

test('complete, conclusively rejected evidence may finish with zero drafts', async t => {
  const now = Date.now();
  const { runDir, store } = await setup(t, { complete: true, candidates: [{ observedAt: now - 1000, expiresAt: now + 60000, verdict: { level: 'rejected', expiresAt: now + 60000 } }] });
  const result = await runPeerPrepareListingDraftsStep({ runDir });
  assert.equal(result.status, 'completed');
  assert.equal(result.totalDrafts, 0);
  assert.equal((await store.read()).allocationPlan, undefined);
});

for (const execute of [runPeerPrepareListingDraftsStep, runPeerVerifyImageSourcesStep]) {
  test(`${execute.name}: corrupt results cannot leave the old completed bundle or plan active`, async t => {
    const { runDir, store } = await setup(t);
    await fs.writeFile(path.join(runDir, 'image-sourcing-results.jsonl'), '{broken');
    await assert.rejects(execute({ runDir }), SyntaxError);
    const state = await store.read();
    assert.equal(state.bundle, null);
    assert.equal(state.allocationPlan, undefined);
  });
}

test('verification blocks card-only evidence and retries unresolved results instead of reusing them', async t => {
  const { runDir, store } = await setup(t);
  let calls = 0;
  const provider = { search: async () => {
    calls++;
    return { ok: true, complete: false, imageDigest: 'uploaded-image', candidates: [
      { offerId: '123', observedAt: Date.now() - 100, expiresAt: Date.now() + 60000, similarity: null },
    ] };
  } };
  for (let i = 0; i < 2; i++) {
    const result = await runPeerVerifyImageSourcesStep({ runDir, provider });
    assert.equal(result.status, 'manual_action_required');
    assert.equal(result.reason, 'source_evidence_incomplete');
    assert.equal(result.confirmedCount, 0);
    assert.equal(result.pendingEvidence.length, 1);
  }
  assert.equal(calls, 2);
  const state = await store.read();
  assert.equal(state.checkpoints.verifyImageSources.status, 'blocked');
  assert.equal(state.bundle.reviewState, 'needs_evidence');
  assert.equal(state.allocationPlan, undefined);
});

test('candidate-level or verdict-level expiry causes verify-image-sources-step to re-query provider instead of reusing cached confirmed', async t => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'candidate-expiry-'));
  t.after(() => fs.rm(runDir, { recursive: true, force: true }));
  const store = createPeerStateStore(runDir);
  await store.initialize({});
  await fs.writeFile(path.join(runDir, 'peer-products.jsonl'), JSON.stringify({
    itemId: 'prod_1',
    title: '商品1',
    snapshotRevision: 's1',
    priceText: '50.0'
  }) + '\n');

  // Existing row has outer validity in the future, but candidate/verdict expired in the past
  const now = Date.now();
  await fs.writeFile(path.join(runDir, 'image-sourcing-results.jsonl'), JSON.stringify({
    productKey: 'prod_1',
    snapshotRevision: 's1',
    searchConfigHash: fingerprint({ provider: '1688-image-search-v1', port: 9222 }),
    judgeConfigHash: fingerprint({ imagePriceRatioThreshold: '1', similarityThreshold: 0.45 }),
    observedAt: now - 5000,
    expiresAt: now + 60000,
    candidates: [
      {
        offerId: 'cand_1',
        title: '货源1',
        priceText: '20.0',
        observedAt: now - 5000,
        expiresAt: now - 1000,
        verdict: {
          level: 'confirmed',
          expiresAt: now - 1000
        }
      }
    ],
    confirmed: true,
    confirmedCount: 1,
    complete: true
  }) + '\n');

  let providerCalled = false;
  const provider = {
    search: async () => {
      providerCalled = true;
      return {
        ok: true,
        complete: true,
        candidates: []
      };
    }
  };

  const result = await runPeerVerifyImageSourcesStep({ runDir, provider });
  assert.equal(providerCalled, true, 'Provider must be called when candidate/verdict has expired');
  assert.notEqual(result.confirmedCount, 1, 'Expired candidate must not be counted as confirmed');
});

test('early block on products_missing invalidates downstream review state and deletes allocation plan', async t => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'early-block-'));
  t.after(() => fs.rm(runDir, { recursive: true, force: true }));
  const store = createPeerStateStore(runDir);
  await store.initialize({});
  await store.transact(0, draft => {
    draft.bundle = { draftRevision: 'old_rev', reviewState: 'completed', activeDrafts: [{ offerId: '1' }] };
    draft.allocationPlan = { planId: 'old_plan', draftRevision: 'old_rev' };
  });
  const planFile = path.join(runDir, 'peer-allocation-plan.json');
  await fs.writeFile(planFile, JSON.stringify({ planId: 'old_plan' }), 'utf8');

  // No peer-products.jsonl and empty shopManifest => products_missing
  const verifyResult = await runPeerVerifyImageSourcesStep({ runDir });
  assert.equal(verifyResult.status, 'manual_action_required');
  assert.equal(verifyResult.reason, 'products_missing');

  // Verify downstream state is invalidated
  const state = await store.read();
  assert.equal(state.bundle, null);
  assert.equal(state.allocationPlan, undefined);
  await assert.rejects(fs.access(planFile));

  // Downstream review step must not report completed
  const reviewResult = await runPeerReviewListingsStep({ runDir });
  assert.equal(reviewResult.status, 'manual_action_required');
  assert.equal(reviewResult.stepIncomplete, true);
});

test('runPeerPrepareListingDraftsStep propagates error when state transaction fails', async t => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'draft-fail-'));
  t.after(() => fs.rm(runDir, { recursive: true, force: true }));
  const store = createPeerStateStore(runDir);
  await store.initialize({});
  await fs.writeFile(path.join(runDir, 'peer-products.jsonl'), JSON.stringify({ itemId: 'prod_1', snapshotRevision: 's1', title: 'T1' }) + '\n');
  const now = Date.now();
  await fs.writeFile(path.join(runDir, 'image-sourcing-results.jsonl'), JSON.stringify({
    productKey: 'prod_1',
    snapshotRevision: 's1',
    searchConfigHash: fingerprint({ provider: '1688-image-search-v1', port: 9222 }),
    judgeConfigHash: fingerprint({ imagePriceRatioThreshold: '1', similarityThreshold: 0.45 }),
    observedAt: now,
    expiresAt: now + 60000,
    candidates: [
      {
        offerId: 'cand_1',
        title: '货源1',
        priceText: '20.0',
        observedAt: now,
        expiresAt: now + 60000,
        verdict: {
          level: 'confirmed',
          expiresAt: now + 60000
        }
      }
    ],
    confirmed: true,
    confirmedCount: 1,
    complete: true
  }) + '\n');

  // Intercept store.transact to simulate write error/revision conflict on draft bundle update
  const origTransact = store.transact.bind(store);
  store.transact = async (expectedRevision, mutate, options) => {
    const draft = { checkpoints: {} };
    mutate(draft);
    if (draft.bundle && draft.checkpoints?.prepareListingDrafts?.status === 'completed') {
      const err = new Error('Disk full or version conflict');
      err.code = 'WRITE_FAILED';
      throw err;
    }
    return origTransact(expectedRevision, mutate, options);
  };

  await assert.rejects(
    runPeerPrepareListingDraftsStep({ runDir, store }),
    /Disk full or version conflict/
  );
  await assert.rejects(fs.access(path.join(runDir, 'peer-listing-drafts.jsonl')), { code: 'ENOENT' });
});

test('savePeerDraftEdits invalidates existing allocation plan and removes plan file', async t => {
  const { runDir, store } = await setup(t);
  const now = Date.now();
  const cur = await store.read();
  await store.transact(cur.revision, state => {
    state.bundle = {
      draftRevision: 'r1',
      reviewState: 'needs_input',
      activeDrafts: [{ draftKey: 'cand_1#default', offerId: 'cand_1', skuKey: 'default', title: '', category: '' }],
      updatedAt: now
    };
    state.allocationPlan = { planId: 'p1', draftRevision: 'r1', items: [] };
  });
  const planFile = path.join(runDir, 'peer-allocation-plan.json');
  await fs.writeFile(planFile, JSON.stringify({ planId: 'p1' }));

  const { savePeerDraftEdits } = require('../../../../skills/peer-discovery/src/peer-listing-adapter');
  const res = await savePeerDraftEdits({ runDir, store }, {
    expectedDraftRevision: 'r1',
    edits: { 'cand_1#default': { title: '人工标题', category: '女装' } }
  });
  assert.equal(res.ok, true);
  const state = await store.read();
  assert.equal(state.allocationPlan, undefined);
  await assert.rejects(fs.access(planFile), { code: 'ENOENT' });
});
