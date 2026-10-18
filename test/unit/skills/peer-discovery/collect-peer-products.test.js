'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { collectPeerProducts } = require('../../../../skills/peer-discovery/src/collect-peer-products');
const { createPeerStateStore } = require('../../../../skills/peer-discovery/src/state-store');

test('collection resumes valid shops and removes obsolete shops from the current result', async t => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-collect-'));
  t.after(() => fs.rm(runDir, { recursive: true, force: true }));
  const shops = ['a', 'b'].map(shopKey => ({ shopKey, shopUrl: `https://shop${shopKey}.taobao.com/` }));
  let calls = 0;
  const collector = async shop => { calls++; return { products: [{ itemId: shop.shopKey, paymentText: '20人付款' }], stopReason: 'limit_reached' }; };
  const options = { runDir, shops, channel: 'web', collector, params: { discoveryBranch: 'image-selection' } };
  const first = await collectPeerProducts(options);
  assert.equal(first.eligibleCount, 2);
  assert.equal(first.incompleteShops.length, 2);
  const second = await collectPeerProducts({ ...options, shops: shops.slice(1) });
  assert.equal(calls, 2);
  assert.deepEqual(second.products.map(p => p.itemId), ['b']);
  assert.notEqual(first.generation, second.generation);
  await assert.rejects(() => collectPeerProducts({ ...options, channel: 'native' }), /固定采集通道/);
});

test('failed shop preserves earlier snapshots and retry only collects unfinished work', async t => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-collect-'));
  t.after(() => fs.rm(runDir, { recursive: true, force: true }));
  const shops = ['a', 'b'].map(shopKey => ({ shopKey, shopUrl: `https://shop${shopKey}.taobao.com/` }));
  const calls = [];
  let fail = true;
  const collector = async shop => {
    calls.push(shop.shopKey);
    if (shop.shopKey === 'b' && fail) throw Object.assign(new Error('请登录'), { code: 'LOGIN_REQUIRED' });
    return { products: [{ itemId: shop.shopKey, paymentText: '20人付款' }] };
  };
  const options = { runDir, shops, channel: 'web', collector };
  await assert.rejects(() => collectPeerProducts(options), /请登录/);
  const state = await createPeerStateStore(runDir).read();
  assert.ok(state.shopManifest.a.snapshotRevision);
  assert.equal(state.checkpoints.collectPeerProducts.error.code, 'LOGIN_REQUIRED');
  fail = false;
  assert.equal((await collectPeerProducts(options)).eligibleCount, 2);
  assert.deepEqual(calls, ['a', 'b', 'b']);
});

test('stalled snapshots require attention and are recollected on retry', async t => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-collect-'));
  t.after(() => fs.rm(runDir, { recursive: true, force: true }));
  let calls = 0;
  const options = { runDir, channel: 'web', shops: [{ shopKey: 's', shopUrl: 'https://shop1.taobao.com/' }], collector: async () => {
    calls++;
    return { products: [], stopReason: 'load_stalled' };
  } };
  const first = await collectPeerProducts(options);
  assert.equal(first.status, 'needs_attention');
  assert.deepEqual(first.pendingShops, ['s']);
  await collectPeerProducts(options);
  assert.equal(calls, 2);
});

test('collectPeerProducts writes peer-products.jsonl and verify-image-sources-step reconstructs from manifest if missing', async t => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-verify-link-'));
  t.after(() => fs.rm(runDir, { recursive: true, force: true }));

  const shops = [{ shopKey: 'shop_a', shopUrl: 'https://shopa.taobao.com/' }];
  const collector = async () => ({
    products: [{ itemId: 'item_101', title: '同行爆款纯银项链', price: 50, priceText: '50.0', paymentText: '100人付款', mainImageUrl: 'https://img.alicdn.com/test.jpg' }],
    stopReason: 'limit_reached'
  });

  const res = await collectPeerProducts({
    runDir,
    shops,
    channel: 'web',
    collector,
    params: { minPayment: 10 }
  });
  assert.equal(res.status, 'completed');
  assert.equal(res.eligibleCount, 1);

  // 1. Verify peer-products.jsonl was written by collectPeerProducts
  const peerProductsFile = path.join(runDir, 'peer-products.jsonl');
  const fileContent = await fs.readFile(peerProductsFile, 'utf8');
  assert.ok(fileContent.includes('item_101'));

  // 2. Remove peer-products.jsonl to test verify-image-sources-step manifest reconstruction fallback
  await fs.unlink(peerProductsFile);

  const { runPeerVerifyImageSourcesStep } = require('../../../../skills/peer-discovery/src/verify-image-sources-step');
  const verifyRes = await runPeerVerifyImageSourcesStep({
    runDir,
    params: { minPayment: 10, imagePriceRatioThreshold: '1' },
    provider: {
      search: async () => ({
        ok: true,
        complete: true,
        candidates: [{ offerId: '1688_offer_1', title: '1688纯银项链', priceText: '20.0', specStatus: 'consistent' }]
      })
    }
  });

  assert.equal(verifyRes.status, 'manual_action_required');
  assert.equal(verifyRes.reason, 'source_evidence_incomplete');
  assert.equal(verifyRes.totalProducts, 1);
  // Reconstructed file should now be present on disk again
  const recreatedContent = await fs.readFile(peerProductsFile, 'utf8');
  assert.ok(recreatedContent.includes('item_101'));
});

test('runPeerVerifyImageSourcesStep: manifest priority overrides stale peer-products.jsonl', async t => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-verify-manifest-'));
  t.after(() => fs.rm(runDir, { recursive: true, force: true }));

  const store = createPeerStateStore(runDir);
  await store.initialize({ discoveryBranch: 'image-selection' });
  await store.transact(0, draft => {
    draft.shopManifest = {};
  });

  const peerProductsFile = path.join(runDir, 'peer-products.jsonl');
  await fs.writeFile(peerProductsFile, JSON.stringify({
    itemId: 'stale_item_999',
    title: '旧商品已不在店铺中'
  }) + '\n');

  let searchCalled = false;
  const { runPeerVerifyImageSourcesStep } = require('../../../../skills/peer-discovery/src/verify-image-sources-step');
  const verifyRes = await runPeerVerifyImageSourcesStep({
    runDir,
    params: { minPayment: 10, imagePriceRatioThreshold: '1' },
    provider: {
      search: async () => {
        searchCalled = true;
        return { ok: true, complete: true, candidates: [] };
      }
    }
  });

  assert.equal(verifyRes.status, 'completed');
  assert.equal(verifyRes.totalProducts, 0);
  assert.equal(searchCalled, false, 'Should not search stale product from peer-products.jsonl');

  const content = await fs.readFile(peerProductsFile, 'utf8');
  assert.equal(content.trim(), '', 'Stale peer-products.jsonl must be overwritten with empty content');
});

test('runPeerVerifyImageSourcesStep: missing or corrupted snapshot blocks with manual_action_required', async t => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-verify-corrupt-snapshot-'));
  t.after(() => fs.rm(runDir, { recursive: true, force: true }));

  const store = createPeerStateStore(runDir);
  await store.initialize({ discoveryBranch: 'image-selection' });
  // manifest references non-existent snapshot
  await store.transact(0, draft => {
    draft.shopManifest = {
      shop_corrupt: {
        shopUrl: 'https://shop1.taobao.com',
        snapshotRevision: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      }
    };
  });

  const { runPeerVerifyImageSourcesStep } = require('../../../../skills/peer-discovery/src/verify-image-sources-step');
  const verifyRes = await runPeerVerifyImageSourcesStep({
    runDir,
    params: { minPayment: 10, imagePriceRatioThreshold: '1' },
    provider: { search: async () => ({ ok: true, complete: true, candidates: [] }) }
  });

  assert.equal(verifyRes.status, 'manual_action_required');
  assert.equal(verifyRes.stepIncomplete, true);
  assert.equal(verifyRes.reason, 'snapshot_corrupted');
});
