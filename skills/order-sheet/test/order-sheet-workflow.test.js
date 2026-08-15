'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  collectOrderSheetProducts,
  prepareOrderSheetDraft,
  getOrderSheetDraft,
  saveOrderSheetDraft,
  confirmOrderSheetProducts,
  buildOrderSheet
} = require('../index');
const { runPipelineRuntime } = require('../../pipeline-flow/runtime/runner');
const {
  getRun,
  readJsonl,
  initRun
} = require('../../pipeline-flow/src/run-store');
const {
  readRuntimeState,
  initRuntimeState
} = require('../../pipeline-flow/runtime/store');
const app = require('../../../bin/server');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'order-sheet-wf-test-'));
}

describe('order-sheet workflow and confirmation runtime', () => {
  it('pipeline runner pauses at confirmProducts with needs_review state', async () => {
    const dataDir = makeTempDir();
    const runId = 'test_order_sheet_pause_run';

    const mockEnricher = async (items) => {
      return items.map((item, i) => ({
        ...item,
        title: item.title || `指定商品标题 ${i + 1}`,
        storeName: '测试专卖店',
        orderAmount: 188.0,
        enrichmentStatus: 'complete'
      }));
    };

    const result = await runPipelineRuntime({
      runId,
      dataDir,
      mode: 'order-sheet',
      params: {
        inputMode: 'manual',
        manualItems: [
          { itemId: '6001001', orderAmount: 100 },
          { itemId: '6001002', orderAmount: 50 },
          { itemId: '6001003', orderAmount: 30 }
        ],
        dragCount: 2,
        enrichManualItems: mockEnricher
      }
    });

    assert.equal(result.runId, runId);
    assert.equal(result.status, 'needs_review');
    assert.equal(result.runtimeStatus, 'needs_review');

    const runtimeState = readRuntimeState({ dataDir, runId });
    assert.equal(runtimeState.activeStep, 'confirmProducts');
    assert.equal(runtimeState.status, 'needs_review');

    const context = getRun({ dataDir, runId });
    assert.equal(context.run.status, 'needs_review');
    assert.equal(context.run.requiresUserAction, true);
    assert.equal(context.run.mustReview, true);
    assert.ok(fs.existsSync(context.run.files.productGroups));

    const draft = getOrderSheetDraft({ dataDir, runId });
    assert.equal(draft.count, 3);
    assert.equal(draft.groupCount, 1);
    assert.equal(draft.groups[0].mainProduct.itemId, '6001001');
    assert.equal(draft.groups[0].subProducts.length, 2);
  });

  it('allows saving draft and confirms groups before resuming generation', async () => {
    const dataDir = makeTempDir();
    const runId = 'test_order_sheet_confirm_and_resume';

    const mockEnricher = async (items) => {
      return items.map((item, i) => ({
        ...item,
        title: item.title || `商品标题 ${i + 1}`,
        storeName: '测试专卖店',
        orderAmount: 100,
        enrichmentStatus: 'complete'
      }));
    };

    // Step 1: Run workflow initially
    const initialRun = await runPipelineRuntime({
      runId,
      dataDir,
      mode: 'order-sheet',
      params: {
        inputMode: 'manual',
        manualItems: [
          { itemId: '7001', orderAmount: 100 },
          { itemId: '7002', orderAmount: 50 }
        ],
        enrichManualItems: mockEnricher
      }
    });
    assert.equal(initialRun.status, 'needs_review');

    // Step 2: Read draft
    const draftBefore = getOrderSheetDraft({ dataDir, runId });
    assert.equal(draftBefore.count, 2);
    assert.equal(draftBefore.missingCount, 0);

    // Step 3: Save draft with adjusted groups (e.g. 1 group with 1 main + 1 sub)
    const customGroups = [
      {
        groupId: 'group-custom-1',
        groupName: '定制商品组 1',
        mainProduct: { itemId: '7001', title: '修改后的商品标题 1', orderAmount: 128 },
        subProducts: [
          { itemId: '7002', title: '修改后的商品标题 2', orderAmount: 68 }
        ]
      }
    ];
    const saved = saveOrderSheetDraft({
      dataDir,
      runId,
      groups: customGroups,
      dragCount: 1,
      unassignedItems: [],
      expectedRevision: draftBefore.revision
    });
    assert.equal(saved.groupCount, 1);
    assert.equal(saved.groups[0].groupName, '定制商品组 1');
    assert.equal(saved.dragCount, 1);
    assert.equal(saved.revision, draftBefore.revision + 1);
    assert.throws(() => saveOrderSheetDraft({
      dataDir,
      runId,
      groups: customGroups,
      expectedRevision: draftBefore.revision
    }), /其他页面更新/);

    // Step 4: Confirm products and groups
    const confirmed = confirmOrderSheetProducts({ dataDir, runId, expectedRevision: saved.revision });
    assert.equal(confirmed.groupCount, 1);
    assert.equal(confirmed.count, 2);

    const contextAfterConfirm = getRun({ dataDir, runId });
    assert.equal(contextAfterConfirm.run.status, 'products_confirmed');
    assert.equal(contextAfterConfirm.run.requiresUserAction, false);
    const originalRows = readJsonl(contextAfterConfirm.run.files.productRank);
    assert.equal(originalRows[0].title, '商品标题 1');
    assert.equal(originalRows[1].title, '商品标题 2');

    // Step 5: Resume execution from generateSheet
    const resumeResult = await runPipelineRuntime({
      runId,
      dataDir,
      mode: 'order-sheet',
      preserveRuntime: true,
      resumeFromStep: 'generateSheet'
    });

    assert.equal(resumeResult.status, 'workflow_complete');
    assert.equal(resumeResult.runtimeStatus, 'completed');

    const finalContext = getRun({ dataDir, runId });
    assert.equal(finalContext.run.status, 'workflow_complete');
    assert.ok(fs.existsSync(finalContext.run.files.orderSheet));
  });

  it('blocks confirmation when manual items are missing titles', async () => {
    const dataDir = makeTempDir();
    const runId = 'test_order_sheet_missing_title_run';

    // Enricher returns empty title
    const mockEnricher = async (items) => {
      return items.map(item => ({
        ...item,
        title: '',
        enrichmentStatus: 'failed',
        enrichmentError: '无法提取标题'
      }));
    };

    const initialRun = await collectOrderSheetProducts({
      runId,
      dataDir,
      inputMode: 'manual',
      manualItems: [{ itemId: '8001' }],
      enrichManualItems: mockEnricher
    });

    assert.equal(initialRun.status, 'manual_action_required');
    assert.equal(initialRun.missingCount, 1);

    // Trying to confirm directly throws error
    assert.throws(() => {
      confirmOrderSheetProducts({ dataDir, runId });
    }, /缺少.*标题/);
  });

  it('server routes: draft read/save and confirm endpoints work properly', async () => {
    let server;
    await new Promise(resolve => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const runId = 'api_test_order_sheet_run';
      const mockEnricher = async (items) => {
        return items.map(item => ({
          ...item,
          title: '服务器端测试商品标题',
          storeName: '测试专卖店',
          orderAmount: 99.0,
          enrichmentStatus: 'complete'
        }));
      };

      // 1. Initialize run
      await runPipelineRuntime({
        runId,
        mode: 'order-sheet',
        params: {
          inputMode: 'manual',
          manualItems: [{ itemId: '9001', orderAmount: 99 }],
          enrichManualItems: mockEnricher
        }
      });

      // 2. GET /api/workflows/runs/:runId/order-sheet/draft
      const draftRes = await fetch(`${baseUrl}/api/workflows/runs/${runId}/order-sheet/draft`);
      assert.equal(draftRes.status, 200);
      const draftBody = await draftRes.json();
      assert.equal(draftBody.ok, true);
      assert.equal(draftBody.data.count, 1);

      // 3. POST /api/workflows/runs/:runId/order-sheet/draft
      const saveRes = await fetch(`${baseUrl}/api/workflows/runs/${runId}/order-sheet/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groups: [
            {
              groupId: 'group-api-1',
              groupName: 'API测试组 1',
              mainProduct: { itemId: '9001', title: '修改标题通过API', orderAmount: 150 },
              subProducts: []
            }
          ]
        })
      });
      assert.equal(saveRes.status, 200);
      const saveBody = await saveRes.json();
      assert.equal(saveBody.ok, true);
      assert.equal(saveBody.data.groups[0].groupName, 'API测试组 1');

      // 4. POST /api/workflows/runs/:runId/order-sheet/confirm
      const confirmRes = await fetch(`${baseUrl}/api/workflows/runs/${runId}/order-sheet/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.equal(confirmRes.status, 200);
      const confirmBody = await confirmRes.json();
      assert.equal(confirmBody.ok, true);
      assert.equal(confirmBody.data.status, 'resuming');

    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});
