'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  prepareListingDraft,
  prepareListingDrafts,
  runPeerPrepareListingDraftsStep
} = require('../../../../skills/peer-discovery/src/listing-draft-preparer');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('prepareListingDraft: successful LLM title generation', async () => {
  const candidate = {
    offerId: '919085178721',
    skuKey: 'default',
    title: '1688原厂纯银项链高级感锁骨链女',
    taobaoTitle: '纯银项链高级感锁骨链',
    category: '50010788'
  };

  const draft = await prepareListingDraft(candidate, {
    llmCaller: async () => '纯银项链女锁骨链小众高级感送女友礼物'
  });

  assert.equal(draft.draftKey, '919085178721#default');
  assert.equal(draft.title, '纯银项链女锁骨链小众高级感送女友礼物');
  assert.equal(draft.category, '50010788');
  assert.equal(draft.titleSource, 'llm');
  assert.equal(draft.titleError, null);
  assert.equal(draft.needsInput, false);
});

test('prepareListingDraft: LLM failure falls back and marks needsInput', async () => {
  const candidate = {
    offerId: '919085178721',
    skuKey: 'default',
    title: '1688原厂纯银项链锁骨链',
    taobaoTitle: '纯银项链高级感锁骨链',
    category: '50010788'
  };

  const draft = await prepareListingDraft(candidate, {
    llmCaller: async () => {
      throw new Error('LLM request timeout');
    }
  });

  assert.equal(draft.draftKey, '919085178721#default');
  assert.ok(draft.title.length > 0, 'Should have fallback title');
  assert.equal(draft.titleSource, 'fallback');
  assert.equal(draft.titleError, 'LLM request timeout');
  assert.equal(draft.needsInput, true, 'Fallback title requires confirmation');
});

test('prepareListingDraft: category prefill vs missing category', async () => {
  // With category
  const withCat = await prepareListingDraft({
    offerId: '101',
    title: '纯银项链',
    category: '50010788'
  }, {
    llmCaller: async () => '纯银项链女高级感小众设计款'
  });
  assert.equal(withCat.category, '50010788');
  assert.equal(withCat.needsInput, false);

  // Without category
  const withoutCat = await prepareListingDraft({
    offerId: '102',
    title: '纯银项链',
    category: null
  }, {
    llmCaller: async () => '纯银项链女高级感小众设计款'
  });
  assert.equal(withoutCat.category, null);
  assert.equal(withoutCat.needsInput, true, 'Missing category requires manual input');
});

test('prepareListingDraft: manual edit takes precedence', async () => {
  const candidate = {
    offerId: '101',
    skuKey: 'default',
    title: '1688纯银项链',
    category: null
  };

  const draft = await prepareListingDraft(candidate, {
    manualEdits: {
      '101#default': {
        title: '人工自填纯银项链高级感标题',
        category: '50010788'
      }
    }
  });

  assert.equal(draft.title, '人工自填纯银项链高级感标题');
  assert.equal(draft.category, '50010788');
  assert.equal(draft.titleSource, 'manual');
  assert.equal(draft.needsInput, false);
});

test('prepareListingDrafts: concurrent batch execution and stats', async () => {
  const candidates = [
    { offerId: '1', title: '商品1', category: 'cat1' },
    { offerId: '2', title: '商品2', category: null }, // needsInput
    { offerId: '3', title: '商品3', category: 'cat3' }
  ];

  let progressCalls = 0;
  const result = await prepareListingDrafts(candidates, {
    concurrency: 2,
    llmCaller: async (c) => `标题_${c.offerId}`,
    onProgress: () => { progressCalls++; }
  });

  assert.equal(result.total, 3);
  assert.equal(result.readyCount, 2);
  assert.equal(result.needsInputCount, 1);
  assert.equal(result.failedCount, 0);
  assert.ok(progressCalls >= 3);
  assert.equal(result.drafts[0].title, '标题_1');
  assert.equal(result.drafts[1].needsInput, true);
});

test('runPeerPrepareListingDraftsStep handles empty confirmed candidates gracefully', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'draft-test-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  await fs.writeFile(path.join(tempDir, 'image-sourcing-results.jsonl'), '');
  await fs.writeFile(path.join(tempDir, 'peer-products.jsonl'), '');

  const result = await runPeerPrepareListingDraftsStep({
    runDir: tempDir,
    params: {}
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.totalDrafts, 0);
  assert.equal(result.readyCount, 0);
});

test('runPeerPrepareListingDraftsStep ignores stale, expired or ratio-mismatched candidate results', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'draft-stale-test-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const { fingerprint } = require('../../../../skills/peer-discovery/src/state-store');
  const now = Date.now();
  const searchConfigHash = fingerprint({ provider: '1688-image-search-v1', port: 9222 });
  const judgeConfigHash = fingerprint({
    imagePriceRatioThreshold: '1',
    similarityThreshold: 0.45
  });

  // Current product: prod_1 with snapshotRevision rev_1
  await fs.writeFile(path.join(tempDir, 'peer-products.jsonl'), JSON.stringify({
    itemId: 'prod_1',
    productKey: 'prod_1',
    snapshotRevision: 'rev_1',
    title: '纯银项链'
  }) + '\n');

  const rows = [
    // Row 1: Valid current matching candidate
    {
      productKey: 'prod_1',
      snapshotRevision: 'rev_1',
      searchConfigHash,
      judgeConfigHash,
      observedAt: now - 1000,
      expiresAt: now + 3600000,
      source: { itemId: 'prod_1', title: '纯银项链' },
      candidates: [{ offerId: 'valid_offer', level: 'confirmed', title: '货源有效', observedAt: now - 1000, expiresAt: now + 3600000 }]
    },
    // Row 2: Expired candidate
    {
      productKey: 'prod_expired',
      snapshotRevision: 'rev_1',
      searchConfigHash,
      judgeConfigHash,
      observedAt: now - 100000,
      expiresAt: now - 50000,
      source: { itemId: 'prod_expired' },
      candidates: [{ offerId: 'expired_offer', level: 'confirmed', title: '已过期货源' }]
    },
    // Row 3: Old ratio candidate (different judgeConfigHash)
    {
      productKey: 'prod_1',
      snapshotRevision: 'rev_1',
      searchConfigHash,
      judgeConfigHash: 'old_judge_hash',
      observedAt: now - 1000,
      expiresAt: now + 3600000,
      source: { itemId: 'prod_1' },
      candidates: [{ offerId: 'old_ratio_offer', level: 'confirmed', title: '旧比例货源' }]
    }
  ];

  await fs.writeFile(path.join(tempDir, 'image-sourcing-results.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

  const result = await runPeerPrepareListingDraftsStep({
    runDir: tempDir,
    params: {
      imagePriceRatioThreshold: '1',
      similarityThreshold: 0.45,
      port: 9222
    },
    llmCaller: async () => '生成新标题'
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.totalDrafts, 1);
  assert.equal(result.drafts[0].offerId, 'valid_offer');
});

test('runPeerPrepareListingDraftsStep: manifest priority overrides stale peer-products.jsonl', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'draft-manifest-priority-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const { createPeerStateStore, fingerprint } = require('../../../../skills/peer-discovery/src/state-store');
  const store = createPeerStateStore(tempDir);
  await store.initialize({ discoveryBranch: 'image-selection' });
  await store.transact(0, draft => {
    draft.shopManifest = {};
  });

  // Stale peer-products.jsonl on disk
  await fs.writeFile(path.join(tempDir, 'peer-products.jsonl'), JSON.stringify({
    itemId: 'stale_prod_1',
    productKey: 'stale_prod_1',
    snapshotRevision: 'stale_rev_1',
    title: '旧商品'
  }) + '\n');

  // Stale results on disk matching the stale product
  await fs.writeFile(path.join(tempDir, 'image-sourcing-results.jsonl'), JSON.stringify({
    productKey: 'stale_prod_1',
    snapshotRevision: 'stale_rev_1',
    searchConfigHash: fingerprint({ provider: '1688-image-search-v1', port: 9222 }),
    judgeConfigHash: fingerprint({ imagePriceRatioThreshold: '1', similarityThreshold: 0.45 }),
    observedAt: Date.now(),
    expiresAt: Date.now() + 3600000,
    source: { itemId: 'stale_prod_1', title: '旧商品' },
    candidates: [{ offerId: 'stale_offer_1', level: 'confirmed', title: '旧货源' }]
  }) + '\n');

  const result = await runPeerPrepareListingDraftsStep({
    runDir: tempDir,
    params: {
      imagePriceRatioThreshold: '1',
      similarityThreshold: 0.45,
      port: 9222
    },
    llmCaller: async () => '新标题'
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.totalDrafts, 0);
  assert.equal(result.drafts.length, 0);

  // peer-products.jsonl must be overwritten with empty string
  const content = await fs.readFile(path.join(tempDir, 'peer-products.jsonl'), 'utf8');
  assert.equal(content.trim(), '');
});

test('runPeerPrepareListingDraftsStep: missing or corrupted snapshot blocks with manual_action_required', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'draft-corrupt-snapshot-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const { createPeerStateStore } = require('../../../../skills/peer-discovery/src/state-store');
  const store = createPeerStateStore(tempDir);
  await store.initialize({ discoveryBranch: 'image-selection' });
  await store.transact(0, draft => {
    draft.shopManifest = {
      shop_corrupt: {
        shopUrl: 'https://shop1.taobao.com',
        snapshotRevision: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      }
    };
  });

  const result = await runPeerPrepareListingDraftsStep({
    runDir: tempDir,
    params: {
      imagePriceRatioThreshold: '1',
      similarityThreshold: 0.45,
      port: 9222
    },
    llmCaller: async () => '新标题'
  });

  assert.equal(result.status, 'manual_action_required');
  assert.equal(result.stepIncomplete, true);
  assert.equal(result.reason, 'snapshot_corrupted');
});
