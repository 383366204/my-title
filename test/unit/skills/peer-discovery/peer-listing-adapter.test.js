'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  savePeerDraftEdits,
  createPeerAllocationPlan,
  submitPeerAllocationPlan,
  reconcilePeerSubmissions,
  runPeerReviewListingsStep
} = require('../../../../skills/peer-discovery/src/peer-listing-adapter');
const { createPeerStateStore } = require('../../../../skills/peer-discovery/src/state-store');

test('peer-listing-adapter: draft edits with revision check', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adapter-test-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const store = createPeerStateStore(tempDir);
  await store.initialize({ discoveryBranch: 'image-selection' });
  await store.transact(0, draft => {
    draft.bundle = {
      draftRevision: 'rev_v1',
      activeDrafts: [
        { draftKey: '101#default', offerId: '101', title: '原标题', category: null, needsInput: true }
      ],
      reviewState: 'needs_input'
    };
  });

  // Revision conflict error
  await assert.rejects(
    () => savePeerDraftEdits({ runDir: tempDir, store }, { expectedDraftRevision: 'wrong_rev', edits: {} }),
    /草稿版本冲突/
  );

  // Successful edit
  const res = await savePeerDraftEdits({ runDir: tempDir, store }, {
    expectedDraftRevision: 'rev_v1',
    edits: {
      '101#default': { title: '新标题', category: '50010788' }
    }
  });

  assert.equal(res.ok, true);
  assert.equal(res.bundle.activeDrafts[0].title, '新标题');
  assert.equal(res.bundle.activeDrafts[0].category, '50010788');
  assert.equal(res.bundle.activeDrafts[0].needsInput, false);
  assert.equal(res.bundle.reviewState, 'ready_to_submit');
});

test('peer-listing-adapter: allocation plan and missing title/category blocks submission', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adapter-test-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const store = createPeerStateStore(tempDir);
  await store.initialize({ discoveryBranch: 'image-selection' });
  await store.transact(0, draft => {
    draft.bundle = {
      draftRevision: 'rev_ready',
      activeDrafts: [
        { draftKey: '101#default', offerId: '101', title: '标题101', category: 'cat1' },
        { draftKey: '102#default', offerId: '102', title: '', category: 'cat2' },
        { draftKey: '103#default', offerId: '103', title: '标题103', category: null }
      ],
      reviewState: 'ready_to_submit'
    };
  });

  const targetShops = [
    { id: 'shop_A', platformShopName: 'A店', port: 9222 },
    { id: 'shop_B', platformShopName: 'B店', port: 9222 }
  ];

  const planRes = await createPeerAllocationPlan({ runDir: tempDir, store }, {
    expectedDraftRevision: 'rev_ready',
    offerIds: ['101', '102'],
    targetShops,
    mode: 'sequential-average'
  });

  assert.equal(planRes.ok, true);
  assert.equal(planRes.plan.items.length, 2);

  // Missing title blocked
  await assert.rejects(
    () => submitPeerAllocationPlan({ runDir: tempDir, store }, {
      expectedDraftRevision: 'rev_ready',
      expectedPlanId: planRes.plan.planId,
      confirm: true
    }),
    /缺少标题/
  );

  // Plan with missing category blocked
  const planWithMissingCat = await createPeerAllocationPlan({ runDir: tempDir, store }, {
    expectedDraftRevision: 'rev_ready',
    offerIds: ['101', '103'],
    targetShops,
    mode: 'sequential-average'
  });

  await assert.rejects(
    () => submitPeerAllocationPlan({ runDir: tempDir, store }, {
      expectedDraftRevision: 'rev_ready',
      expectedPlanId: planWithMissingCat.plan.planId,
      confirm: true
    }),
    /缺少目标类目/
  );
});

test('peer-listing-adapter: idempotent submission skips already succeeded offers', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adapter-test-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const store = createPeerStateStore(tempDir);
  await store.initialize({ discoveryBranch: 'image-selection' });
  await store.transact(0, draft => {
    draft.bundle = {
      draftRevision: 'rev_all_good',
      activeDrafts: [
        { draftKey: '101#default', offerId: '101', title: '标题101', category: 'cat1' },
        { draftKey: '102#default', offerId: '102', title: '标题102', category: 'cat2' }
      ],
      reviewState: 'ready_to_submit'
    };
  });

  const targetShops = [
    { id: 'shop_A', platformShopName: 'A店', port: 9222 }
  ];

  const planRes = await createPeerAllocationPlan({ runDir: tempDir, store }, {
    expectedDraftRevision: 'rev_all_good',
    offerIds: ['101', '102'],
    targetShops,
    mode: 'sequential-average'
  });

  let submittedBatches = [];
  const submitter = async (batch) => {
    submittedBatches.push(batch);
    return { ok: true, completed: batch.offerIds.length };
  };

  // First submit: both offers submitted
  const firstSub = await submitPeerAllocationPlan({ runDir: tempDir, store, submitter }, {
    expectedDraftRevision: 'rev_all_good',
    expectedPlanId: planRes.plan.planId,
    confirm: true
  });

  assert.equal(firstSub.ok, true);
  assert.equal(firstSub.newSubmissions, 2);
  assert.equal(submittedBatches[0].offerIds.length, 2);

  // Check reconcile
  const recon = await reconcilePeerSubmissions({ runDir: tempDir });
  assert.equal(recon.total, 2);
  assert.equal(recon.success, 2);

  // Second submit: offers already succeeded in ledger, skipped!
  submittedBatches = [];
  const secondSub = await submitPeerAllocationPlan({ runDir: tempDir, store, submitter }, {
    expectedDraftRevision: 'rev_all_good',
    expectedPlanId: planRes.plan.planId,
    confirm: true
  });

  assert.equal(secondSub.newSubmissions, 0);
  assert.equal(submittedBatches.length, 0);
});

test('runPeerReviewListingsStep reflects review state', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adapter-test-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const store = createPeerStateStore(tempDir);
  await store.initialize({ discoveryBranch: 'image-selection' });

  // When no bundle
  const noBundle = await runPeerReviewListingsStep({ runDir: tempDir, store });
  assert.equal(noBundle.status, 'manual_action_required');

  // When bundle needs_input
  await store.transact(0, draft => {
    draft.bundle = {
      draftRevision: 'rev_1',
      activeDrafts: [],
      reviewState: 'needs_input'
    };
  });
  const needsInputRes = await runPeerReviewListingsStep({ runDir: tempDir, store });
  assert.equal(needsInputRes.status, 'manual_action_required');
  assert.equal(needsInputRes.reviewState, 'needs_input');

  // When bundle completed
  await store.transact(1, draft => {
    draft.bundle.reviewState = 'completed';
  });
  const completedRes = await runPeerReviewListingsStep({ runDir: tempDir, store });
  assert.equal(completedRes.status, 'completed');
  assert.equal(completedRes.reviewState, 'completed');
});

test('peer-listing-adapter: submitter requirement, explicit confirm, and failure reconciliation', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adapter-safety-test-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const store = createPeerStateStore(tempDir);
  await store.initialize({ discoveryBranch: 'image-selection' });
  await store.transact(0, draft => {
    draft.bundle = {
      draftRevision: 'rev_safe',
      activeDrafts: [
        { draftKey: '201#default', offerId: '201', title: '商品201', category: 'cat1' }
      ],
      reviewState: 'ready_to_submit'
    };
  });

  const planRes = await createPeerAllocationPlan({ runDir: tempDir, store }, {
    expectedDraftRevision: 'rev_safe',
    offerIds: ['201'],
    targetShops: [{ id: 'shop_safe', platformShopName: '安全店', port: 9222 }],
    mode: 'sequential-average'
  });

  // 1. Missing confirm throws
  await assert.rejects(
    () => submitPeerAllocationPlan({ runDir: tempDir, store, submitter: async () => {} }, {
      expectedDraftRevision: 'rev_safe',
      expectedPlanId: planRes.plan.planId
    }),
    /必须明确确认铺货提交/
  );

  // 2. Missing submitter throws
  await assert.rejects(
    () => submitPeerAllocationPlan({ runDir: tempDir, store }, {
      expectedDraftRevision: 'rev_safe',
      expectedPlanId: planRes.plan.planId,
      confirm: true
    }),
    /未配置铺货分发提交器/
  );

  // 3. Submitter returns failure result -> records failed, not success!
  const failingSubmitter = async () => ({ ok: false, error: '网络超时' });
  const failedSub = await submitPeerAllocationPlan({ runDir: tempDir, store, submitter: failingSubmitter }, {
    expectedDraftRevision: 'rev_safe',
    expectedPlanId: planRes.plan.planId,
    confirm: true
  });
  assert.equal(failedSub.completed, false);
  const failedRecon = await reconcilePeerSubmissions({ runDir: tempDir });
  assert.equal(failedRecon.failed, 1);
  assert.equal(failedRecon.success, 0);

  // 4. Submitter throws timeout error -> records unknown (needs reconciliation)
  const timeoutSubmitter = async () => { throw new Error('Request timeout after 30s'); };
  const timeoutSub = await submitPeerAllocationPlan({ runDir: tempDir, store, submitter: timeoutSubmitter }, {
    expectedDraftRevision: 'rev_safe',
    expectedPlanId: planRes.plan.planId,
    confirm: true
  });
  assert.equal(timeoutSub.completed, false);
  const timeoutRecon = await reconcilePeerSubmissions({ runDir: tempDir });
  assert.equal(timeoutRecon.unknown, 1);
  assert.equal(timeoutRecon.success, 0);
});

test('peer-listing-adapter: concurrent submitPeerAllocationPlan calls execute submitter only once without duplicates', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adapter-concurrent-test-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const store = createPeerStateStore(tempDir);
  await store.initialize({ discoveryBranch: 'image-selection' });
  await store.transact(0, draft => {
    draft.bundle = {
      draftRevision: 'rev_concurrent',
      activeDrafts: [
        { draftKey: '301#default', offerId: '301', title: '商品301', category: 'cat1' }
      ],
      reviewState: 'ready_to_submit'
    };
  });

  const planRes = await createPeerAllocationPlan({ runDir: tempDir, store }, {
    expectedDraftRevision: 'rev_concurrent',
    offerIds: ['301'],
    targetShops: [{ id: 'shop_conc', platformShopName: '并发店', port: 9222 }],
    mode: 'sequential-average'
  });

  let submitterCallCount = 0;
  const submitter = async () => {
    submitterCallCount++;
    await new Promise(r => setTimeout(r, 50));
    return { ok: true, completed: 1 };
  };

  // Launch two submissions concurrently
  const [res1, res2] = await Promise.all([
    submitPeerAllocationPlan({ runDir: tempDir, store, submitter }, {
      expectedDraftRevision: 'rev_concurrent',
      expectedPlanId: planRes.plan.planId,
      confirm: true
    }),
    submitPeerAllocationPlan({ runDir: tempDir, store, submitter }, {
      expectedDraftRevision: 'rev_concurrent',
      expectedPlanId: planRes.plan.planId,
      confirm: true
    })
  ]);

  // Submitter MUST be called only once!
  assert.equal(submitterCallCount, 1, 'Submitter should only be called once across concurrent submissions');
  assert.equal(res1.completed, true);
  assert.equal(res2.completed, true);

  const recon = await reconcilePeerSubmissions({ runDir: tempDir });
  assert.equal(recon.success, 1);
  assert.equal(recon.total, 1);
});

test('peer-listing-adapter: unknown timeout result is not automatically resubmitted', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adapter-unknown-test-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const store = createPeerStateStore(tempDir);
  await store.initialize({ discoveryBranch: 'image-selection' });
  await store.transact(0, draft => {
    draft.bundle = {
      draftRevision: 'rev_unknown',
      activeDrafts: [
        { draftKey: '401#default', offerId: '401', title: '商品401', category: 'cat1' }
      ],
      reviewState: 'ready_to_submit'
    };
  });

  const planRes = await createPeerAllocationPlan({ runDir: tempDir, store }, {
    expectedDraftRevision: 'rev_unknown',
    offerIds: ['401'],
    targetShops: [{ id: 'shop_unknown', platformShopName: '超时店', port: 9222 }],
    mode: 'sequential-average'
  });

  let callCount = 0;
  // First call throws timeout -> recorded as unknown
  const timeoutSubmitter = async () => {
    callCount++;
    throw new Error('Connection timeout to shop platform');
  };

  const res1 = await submitPeerAllocationPlan({ runDir: tempDir, store, submitter: timeoutSubmitter }, {
    expectedDraftRevision: 'rev_unknown',
    expectedPlanId: planRes.plan.planId,
    confirm: true
  });
  assert.equal(res1.completed, false);
  assert.equal(callCount, 1);

  // Second call: unknown status MUST NOT be automatically resubmitted without reconciliation!
  const res2 = await submitPeerAllocationPlan({ runDir: tempDir, store, submitter: timeoutSubmitter }, {
    expectedDraftRevision: 'rev_unknown',
    expectedPlanId: planRes.plan.planId,
    confirm: true
  });

  assert.equal(res2.newSubmissions, 0);
  assert.equal(callCount, 1, 'Submitter must NOT be called again when offer status is unknown');
});

test('peer-listing-adapter: undefined, empty object or in-flight responses are not marked as success', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adapter-empty-res-test-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const store = createPeerStateStore(tempDir);
  await store.initialize({ discoveryBranch: 'image-selection' });
  await store.transact(0, draft => {
    draft.bundle = {
      draftRevision: 'rev_empty',
      activeDrafts: [
        { draftKey: '501#default', offerId: '501', title: '商品501', category: 'cat1' }
      ],
      reviewState: 'ready_to_submit'
    };
  });

  const planRes = await createPeerAllocationPlan({ runDir: tempDir, store }, {
    expectedDraftRevision: 'rev_empty',
    offerIds: ['501'],
    targetShops: [{ id: 'shop_empty', platformShopName: '空响应店', port: 9222 }],
    mode: 'sequential-average'
  });

  // 1. Submitter returns undefined -> must be unknown, completed = false
  const resUndefined = await submitPeerAllocationPlan({ runDir: tempDir, store, submitter: async () => undefined }, {
    expectedDraftRevision: 'rev_empty',
    expectedPlanId: planRes.plan.planId,
    confirm: true
  });
  assert.equal(resUndefined.completed, false);

  const ledgerContent = await fs.readFile(path.join(tempDir, 'peer-submissions.jsonl'), 'utf8');
  const rows = ledgerContent.trim().split('\n').map(l => JSON.parse(l));
  const finalRow = rows[rows.length - 1];
  assert.equal(finalRow.status, 'unknown', 'Empty response must be recorded as unknown to avoid duplicate submissions');

  // 2. Submitter returns in-flight status: 'accepted' -> must be unknown, completed = false
  const curState = await store.read();
  await store.transact(curState.revision, draft => {
    draft.bundle.activeDrafts[0].offerId = '502';
    draft.bundle.activeDrafts[0].draftKey = '502#default';
    draft.bundle.draftRevision = 'rev_empty_2';
  });
  const planRes2 = await createPeerAllocationPlan({ runDir: tempDir, store }, {
    expectedDraftRevision: 'rev_empty_2',
    offerIds: ['502'],
    targetShops: [{ id: 'shop_empty', platformShopName: '空响应店', port: 9222 }],
    mode: 'sequential-average'
  });

  const resAccepted = await submitPeerAllocationPlan({ runDir: tempDir, store, submitter: async () => ({ status: 'accepted' }) }, {
    expectedDraftRevision: 'rev_empty_2',
    expectedPlanId: planRes2.plan.planId,
    confirm: true
  });
  assert.equal(resAccepted.completed, false);

  const recon = await reconcilePeerSubmissions({ runDir: tempDir });
  assert.equal(recon.unknown, 2);
  assert.equal(recon.failed, 0);
  assert.equal(recon.success, 0);
});

test('peer-listing-adapter: re-entrant store.withLock persists completed reviewState without delay', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adapter-lock-test-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const store = createPeerStateStore(tempDir);
  await store.initialize({ discoveryBranch: 'image-selection' });
  await store.transact(0, draft => {
    draft.bundle = {
      draftRevision: 'rev_lock_1',
      activeDrafts: [
        { draftKey: '701#default', offerId: '701', title: '测试商品701', category: 'cat1' }
      ],
      reviewState: 'ready_to_submit'
    };
  });

  const planRes = await createPeerAllocationPlan({ runDir: tempDir, store }, {
    expectedDraftRevision: 'rev_lock_1',
    offerIds: ['701'],
    targetShops: [{ id: 'shop_1', platformShopName: '店铺1', port: 9222 }],
    mode: 'sequential-average'
  });

  const startTime = Date.now();
  const res = await submitPeerAllocationPlan({
    runDir: tempDir,
    store,
    submitter: async () => ({ ok: true, completed: 1 })
  }, {
    expectedDraftRevision: 'rev_lock_1',
    expectedPlanId: planRes.plan.planId,
    confirm: true
  });
  const elapsed = Date.now() - startTime;

  assert.equal(res.completed, true);
  assert.ok(elapsed < 2000, `Expected submission to finish promptly without lock timeout, took ${elapsed}ms`);

  const updatedState = await store.read();
  assert.equal(updatedState.bundle.reviewState, 'completed', 'reviewState must be persisted as completed');

  const { runPeerReviewListingsStep } = require('../../../../skills/peer-discovery/src/peer-listing-adapter');
  const reviewStepRes = await runPeerReviewListingsStep({ runDir: tempDir, store });
  assert.equal(reviewStepRes.status, 'completed');
  assert.equal(reviewStepRes.reviewState, 'completed');
});

test('peer-listing-adapter: item-level results check offer coverage and mixed statuses', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adapter-items-test-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const store = createPeerStateStore(tempDir);
  await store.initialize({ discoveryBranch: 'image-selection' });
  await store.transact(0, draft => {
    draft.bundle = {
      draftRevision: 'rev_items_1',
      activeDrafts: [
        { draftKey: '801#default', offerId: '801', title: '商品801', category: 'cat1' },
        { draftKey: '802#default', offerId: '802', title: '商品802', category: 'cat1' }
      ],
      reviewState: 'ready_to_submit'
    };
  });

  const planRes = await createPeerAllocationPlan({ runDir: tempDir, store }, {
    expectedDraftRevision: 'rev_items_1',
    offerIds: ['801', '802'],
    targetShops: [{ id: 'shop_items', platformShopName: '明细店', port: 9222 }],
    mode: 'sequential-average'
  });

  // 1. Partial results: offer 801 succeeds, offer 802 is omitted from results array
  const subRes1 = await submitPeerAllocationPlan({
    runDir: tempDir,
    store,
    submitter: async () => ({
      ok: true,
      results: [{ offerId: '801', ok: true }]
    })
  }, {
    expectedDraftRevision: 'rev_items_1',
    expectedPlanId: planRes.plan.planId,
    confirm: true
  });

  assert.equal(subRes1.completed, false, 'Missing item 802 means batch is incomplete');

  const recon1 = await reconcilePeerSubmissions({ runDir: tempDir });
  assert.equal(recon1.success, 1, '801 should be success');
  assert.equal(recon1.unknown, 1, 'Missing 802 should be unknown');

  // 2. Mixed results: offer 803 succeeds, offer 804 fails explicitly
  const cur = await store.read();
  await store.transact(cur.revision, draft => {
    draft.bundle.activeDrafts = [
      { draftKey: '803#default', offerId: '803', title: '商品803', category: 'cat1' },
      { draftKey: '804#default', offerId: '804', title: '商品804', category: 'cat1' }
    ];
    draft.bundle.draftRevision = 'rev_items_2';
  });
  const planRes2 = await createPeerAllocationPlan({ runDir: tempDir, store }, {
    expectedDraftRevision: 'rev_items_2',
    offerIds: ['803', '804'],
    targetShops: [{ id: 'shop_items', platformShopName: '明细店', port: 9222 }],
    mode: 'sequential-average'
  });

  const subRes2 = await submitPeerAllocationPlan({
    runDir: tempDir,
    store,
    submitter: async () => ({
      results: [
        { offerId: '803', status: 'success' },
        { offerId: '804', status: 'failed', error: '类目已下线' }
      ]
    })
  }, {
    expectedDraftRevision: 'rev_items_2',
    expectedPlanId: planRes2.plan.planId,
    confirm: true
  });

  assert.equal(subRes2.completed, false);
  const recon2 = await reconcilePeerSubmissions({ runDir: tempDir });
  assert.equal(recon2.success, 2, '801 and 803 succeed');
  assert.equal(recon2.failed, 1, '804 failed');
  assert.equal(recon2.unknown, 1, '802 unknown');
});

test('peer-listing-adapter: corrupted ledger blocks submissions and prevents data loss', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adapter-corrupt-test-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const store = createPeerStateStore(tempDir);
  await store.initialize({ discoveryBranch: 'image-selection' });
  await store.transact(0, draft => {
    draft.bundle = {
      draftRevision: 'rev_corrupt_1',
      activeDrafts: [
        { draftKey: '901#default', offerId: '901', title: '商品901', category: 'cat1' }
      ],
      reviewState: 'ready_to_submit'
    };
  });

  const planRes = await createPeerAllocationPlan({ runDir: tempDir, store }, {
    expectedDraftRevision: 'rev_corrupt_1',
    offerIds: ['901'],
    targetShops: [{ id: 'shop_1', platformShopName: '店铺1', port: 9222 }],
    mode: 'sequential-average'
  });

  // Write a corrupted line (truncated JSON) in peer-submissions.jsonl
  const ledgerFile = path.join(tempDir, 'peer-submissions.jsonl');
  await fs.writeFile(ledgerFile, '{"offerId": "901", "status": "succ\n', 'utf8');

  let submitterCalled = false;
  await assert.rejects(
    () => submitPeerAllocationPlan({
      runDir: tempDir,
      store,
      submitter: async () => { submitterCalled = true; return { ok: true }; }
    }, {
      expectedDraftRevision: 'rev_corrupt_1',
      expectedPlanId: planRes.plan.planId,
      confirm: true
    }),
    err => {
      assert.equal(err.code, 'SUBMISSION_LEDGER_CORRUPTED');
      return true;
    }
  );

  assert.equal(submitterCalled, false, 'Submitter must not be executed when ledger is corrupted');
});

test('peer-listing-adapter: draft update during lock wait invalidates stale submission and does not mark new draft completed', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adapter-stale-draft-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const store = createPeerStateStore(tempDir);
  await store.initialize({ discoveryBranch: 'image-selection' });
  await store.transact(0, draft => {
    draft.bundle = {
      draftRevision: 'rev_old',
      activeDrafts: [
        { draftKey: '1001#default', offerId: '1001', title: '商品1001', category: 'cat1' }
      ],
      reviewState: 'ready_to_submit'
    };
  });

  const planRes = await createPeerAllocationPlan({ runDir: tempDir, store }, {
    expectedDraftRevision: 'rev_old',
    offerIds: ['1001'],
    targetShops: [{ id: 'shop_1', platformShopName: '店铺1', port: 9222 }],
    mode: 'sequential-average'
  });

  // Now update draft to rev_new (e.g. user updated draft and removed 1001)
  const curState = await store.read();
  await store.transact(curState.revision, draft => {
    draft.bundle.draftRevision = 'rev_new';
    draft.bundle.activeDrafts = [
      { draftKey: '1002#default', offerId: '1002', title: '新商品1002', category: 'cat1' }
    ];
    draft.bundle.reviewState = 'ready_to_submit';
  });

  let submitterCalled = false;
  await assert.rejects(
    () => submitPeerAllocationPlan({
      runDir: tempDir,
      store,
      submitter: async () => { submitterCalled = true; return { ok: true, completed: 1 }; }
    }, {
      expectedDraftRevision: 'rev_old',
      expectedPlanId: planRes.plan.planId,
      confirm: true
    }),
    err => {
      assert.equal(err.code, 'PEER_REVISION_CONFLICT');
      return true;
    }
  );

  assert.equal(submitterCalled, false, 'Old submission must not execute submitter after draft updated');

  // Verify that the new draft (rev_new) was NOT marked as completed by the old submission
  const finalState = await store.read();
  assert.equal(finalState.bundle.draftRevision, 'rev_new');
  assert.equal(finalState.bundle.reviewState, 'ready_to_submit');
});

test('peer-listing-adapter: item-level pending/running status is not misidentified as success even with ok: true', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adapter-pending-test-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const store = createPeerStateStore(tempDir);
  await store.initialize({ discoveryBranch: 'image-selection' });
  await store.transact(0, draft => {
    draft.bundle = {
      draftRevision: 'rev_pending_1',
      activeDrafts: [
        { draftKey: '1101#default', offerId: '1101', title: '待处理商品1101', category: 'cat1' }
      ],
      reviewState: 'ready_to_submit'
    };
  });

  const planRes = await createPeerAllocationPlan({ runDir: tempDir, store }, {
    expectedDraftRevision: 'rev_pending_1',
    offerIds: ['1101'],
    targetShops: [{ id: 'shop_1', platformShopName: '店铺1', port: 9222 }],
    mode: 'sequential-average'
  });

  // Submitter returns { ok: true, results: [{ offerId: '1101', ok: true, status: 'pending' }] }
  const res = await submitPeerAllocationPlan({
    runDir: tempDir,
    store,
    submitter: async () => ({
      ok: true,
      results: [{ offerId: '1101', ok: true, status: 'pending' }]
    })
  }, {
    expectedDraftRevision: 'rev_pending_1',
    expectedPlanId: planRes.plan.planId,
    confirm: true
  });

  assert.equal(res.completed, false, 'Pending item must not mark submission as completed');

  const recon = await reconcilePeerSubmissions({ runDir: tempDir });
  assert.equal(recon.unknown, 1, 'Pending item must be recorded as unknown');
  assert.equal(recon.success, 0);

  const finalState = await store.read();
  assert.equal(finalState.bundle.reviewState, 'needs_attention');
});

