'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createPeerStateStore, fingerprint } = require('../../../../skills/peer-discovery/src/state-store');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-state-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = createPeerStateStore(dir);
  await store.initialize({ discoveryBranch: 'image-selection' });
  return store;
}

test('snapshot replacement including an empty collection never resurrects older items', async t => {
  const store = await fixture(t);
  const first = await store.writeSnapshot([{ productKey: '123' }]);
  await store.transact(0, state => { state.manifest.shop = first; });
  const empty = await store.writeSnapshot([]);
  await store.transact(1, state => { state.manifest.shop = empty; });
  assert.deepEqual(await store.readSnapshot((await store.read()).manifest.shop), []);
  assert.equal((await store.readSnapshot(first)).length, 1);
});

test('concurrent writes require a matching revision and preserve ledger', async t => {
  const store = await fixture(t);
  await store.transact(0, state => { state.ledger['shop:offer'] = { status: 'unknown' }; });
  const writes = await Promise.allSettled([
    store.transact(1, state => { state.bundle = { revision: 'a' }; }),
    store.transact(1, state => { state.bundle = { revision: 'b' }; })
  ]);
  assert.equal(writes.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(writes.find(row => row.status === 'rejected').reason.code, 'PEER_REVISION_CONFLICT');
  assert.equal((await store.read()).ledger['shop:offer'].status, 'unknown');
});

test('no-op writes keep revision and invalid or async writes do not publish', async t => {
  const store = await fixture(t);
  assert.equal((await store.transact(0, () => {})).revision, 0);
  await assert.rejects(store.transact(0, state => { state.bad = undefined; }), /不可持久化/);
  await assert.rejects(store.transact(0, async () => {}), /异步/);
  await assert.rejects(store.initialize({ discoveryBranch: 'peer-analysis' }), { code: 'PEER_REVISION_CONFLICT' });
  assert.equal((await store.read()).revision, 0);
  assert.equal(fingerprint({ a: 1, b: 2 }), fingerprint({ b: 2, a: 1 }));
  await assert.rejects(store.readSnapshot('../../other'), /无效/);
});
