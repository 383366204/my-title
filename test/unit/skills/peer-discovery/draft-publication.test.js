'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createPeerStateStore, fingerprint } = require('../../../../skills/peer-discovery/src/state-store');
const { runPeerPrepareListingDraftsStep } = require('../../../../skills/peer-discovery/src/listing-draft-preparer');
const { savePeerDraftEdits } = require('../../../../skills/peer-discovery/src/peer-listing-adapter');

test('manual save invalidates the old plan even when draft view publication fails', async t => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-publish-error-'));
  t.after(() => fs.rm(runDir, { recursive: true, force: true }));
  const store = createPeerStateStore(runDir);
  const initial = await store.initialize({});
  await store.transact(initial.revision, state => {
    state.bundle = { draftRevision: 'old', activeDrafts: [{ draftKey: 'one', title: '旧标题', category: '家居' }] };
    state.allocationPlan = { draftRevision: 'old' };
  });
  const planFile = path.join(runDir, 'peer-allocation-plan.json');
  const draftsFile = path.join(runDir, 'peer-listing-drafts.jsonl');
  await fs.writeFile(planFile, '{}');
  const originalWrite = fs.writeFile;
  t.mock.method(fs, 'writeFile', async (target, ...args) => {
    if (target === draftsFile) throw new Error('simulated disk failure');
    return originalWrite(target, ...args);
  });
  await assert.rejects(savePeerDraftEdits({ runDir, store }, {
    expectedDraftRevision: 'old', edits: { one: { title: '新标题' } },
  }), /simulated disk failure/);
  const state = await store.read();
  assert.equal(state.allocationPlan, undefined);
  assert.notEqual(state.bundle.draftRevision, 'old');
  await assert.rejects(fs.stat(planFile), { code: 'ENOENT' });
});

test('manual edit waits for automatic publication and leaves the view on the latest revision', async t => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-publish-'));
  t.after(() => fs.rm(runDir, { recursive: true, force: true }));
  const store = createPeerStateStore(runDir);
  await store.initialize({});
  const now = Date.now();
  await fs.writeFile(path.join(runDir, 'peer-products.jsonl'), JSON.stringify({ itemId: '1', snapshotRevision: 's1' }));
  await fs.writeFile(path.join(runDir, 'image-sourcing-results.jsonl'), JSON.stringify({
    productKey: '1', snapshotRevision: 's1', observedAt: now - 100, expiresAt: now + 60000,
    searchConfigHash: fingerprint({ provider: '1688-image-search-v1', port: 9222 }),
    judgeConfigHash: fingerprint({ imagePriceRatioThreshold: '1', similarityThreshold: 0.45 }),
    complete: true, candidates: [{ offerId: '123', title: '商品', category: '家居', observedAt: now - 100, expiresAt: now + 60000, verdict: { level: 'confirmed', expiresAt: now + 60000 } }],
  }));
  const file = path.join(runDir, 'peer-listing-drafts.jsonl');
  const originalWrite = fs.writeFile;
  let enter, release, intercepted = false;
  const ready = new Promise(resolve => { enter = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  t.mock.method(fs, 'writeFile', async (target, ...args) => {
    if (target === file && !intercepted) {
      intercepted = true;
      enter();
      await gate;
    }
    return originalWrite(target, ...args);
  });
  const automatic = runPeerPrepareListingDraftsStep({ runDir, store, llmCaller: async () => '自动商品标题' });
  let manual;
  try {
    await ready;
    const current = await store.read();
    manual = savePeerDraftEdits({ runDir, store }, {
      expectedDraftRevision: current.bundle.draftRevision,
      edits: { [current.bundle.activeDrafts[0].draftKey]: { title: '人工修改后的标题' } },
    });
  } finally { release(); }
  await automatic;
  const saved = await manual;
  const final = await store.read();
  const lines = (await fs.readFile(file, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(final.bundle.draftRevision, saved.draftRevision);
  assert.equal(final.bundle.activeDrafts[0].title, '人工修改后的标题');
  assert.deepEqual(lines, final.bundle.activeDrafts);
});
