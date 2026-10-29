'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  writePeerProductReport,
  runPeerProductReportStep
} = require('../../../../skills/peer-discovery/src/peer-product-report-writer');
const { createPeerStateStore } = require('../../../../skills/peer-discovery/src/state-store');

test('writePeerProductReport: writes JSON and Excel files with sanitized cells', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'report-test-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const bundle = {
    draftRevision: 'rev_1',
    activeDrafts: [
      {
        draftKey: '101#default',
        offerId: '101',
        title: '=SUM(1+1)', // injection test
        category: '50010788',
        titleSource: 'llm',
        needsInput: false
      }
    ]
  };

  const allocationPlan = {
    planId: 'plan_1',
    mode: 'sequential-average',
    items: [
      { offerId: '101', targetShopId: 'shop_A' }
    ]
  };

  const ledger = [
    {
      targetShopId: 'shop_A',
      offerId: '101',
      status: 'success',
      batchId: 'batch_1',
      submittedAt: Date.now()
    }
  ];

  const result = await writePeerProductReport({
    runId: 'run_test_1',
    runDir: tempDir,
    bundle,
    allocationPlan,
    ledger
  });

  assert.ok(result.jsonPath);
  assert.ok(result.excelPath);
  assert.equal(result.summary.totalDrafts, 1);
  assert.equal(result.summary.totalAllocated, 1);
  assert.equal(result.summary.successCount, 1);

  // Check JSON content
  const jsonContent = JSON.parse(await fs.readFile(result.jsonPath, 'utf8'));
  assert.equal(jsonContent.runId, 'run_test_1');
  assert.equal(jsonContent.summary.successCount, 1);

  // Check Excel exists and is non-empty
  const excelStat = await fs.stat(result.excelPath);
  assert.ok(excelStat.size > 1000);
});

test('runPeerProductReportStep: executes from state store and ledger', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'report-test-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const store = createPeerStateStore(tempDir);
  await store.initialize({ discoveryBranch: 'image-selection' });
  await store.transact(0, draft => {
    draft.bundle = {
      draftRevision: 'rev_step',
      activeDrafts: [
        { draftKey: '201#default', offerId: '201', title: '测试项链', category: 'cat_1', titleSource: 'llm' }
      ]
    };
    draft.allocationPlan = {
      planId: 'p2',
      items: [{ offerId: '201', targetShopId: 'shop_X' }]
    };
  });

  await fs.writeFile(
    path.join(tempDir, 'peer-submissions.jsonl'),
    JSON.stringify({ targetShopId: 'shop_X', offerId: '201', status: 'success' }) + '\n'
  );

  const stepRes = await runPeerProductReportStep({
    runDir: tempDir,
    runId: 'step_run',
    store
  });

  assert.equal(stepRes.status, 'completed');
  assert.equal(stepRes.summary.totalDrafts, 1);
  assert.equal(stepRes.summary.successCount, 1);
});
