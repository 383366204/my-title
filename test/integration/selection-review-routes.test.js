const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { registerSelectionReviewRoutes } = require('../../core/server/selection-review-routes');

test('selection reviews preserve inputs and pause at the correct next step', async () => {
  let runtime = { steps: ['keywordReview', 'verify', 'select'] };
  let input;
  let update;
  let failure;
  let keywordStatus = 'keywords_reviewed';
  let productStatus = 'products_selected';
  const app = express();
  app.use(express.json());
  registerSelectionReviewRoutes(app, {
    isValidWorkflowRunIdParam: runId => runId === 'fixture',
    flowReviewCandidates: value => {
      input = value;
      if (failure) throw failure;
      return { status: keywordStatus, approved: ['杯垫'], rejected: ['茶杯'] };
    },
    flowReviewProducts: value => {
      input = value;
      if (failure) throw failure;
      return { status: productStatus, selected: [{ offerId: '123' }] };
    },
    readRuntimeState: () => runtime,
    updateRuntimeState: value => { update = value; },
    summarizePipelineRun: ({ runId }) => ({ runId }),
    withPipelineRuntimeFields: value => ({ ...value, projected: true })
  });
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const post = (route, body = {}, runId = 'fixture') => fetch(
    `http://127.0.0.1:${server.address().port}/api/workflows/runs/${runId}/${route}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  try {
    for (const route of ['keyword-review', 'product-review']) {
      assert.equal((await post(route, {}, 'null')).status, 400);
    }
    assert.equal(input, undefined);
    const keywordBody = { approvedKeywords: ['杯垫'], rejectedKeywords: ['茶杯'], manualKeywords: ['茶托'], approveAll: true };
    const response = await post('keyword-review', keywordBody);
    assert.equal(response.status, 200);
    assert.deepEqual(input, { runId: 'fixture', ...keywordBody });
    assert.deepEqual((await response.json()).data.currentRun, { runId: 'fixture', projected: true });
    assert.equal(update.patch.status, 'paused');
    assert.equal(update.patch.activeStep, 'verify');
    assert.equal(update.patch.blocker, null);
    assert.equal(update.patch.manualAction, null);
    assert.equal(update.patch.progress.keywordReview.current, 1);
    assert.equal(update.patch.progress.keywordReview.total, 2);
    assert.equal(update.patch.progress.verify.status, 'idle');
    runtime = { steps: ['keywordReview', 'select'] };
    await post('keyword-review', { approvedKeywords: 'invalid', rejectedKeywords: null, approveAll: 'true' });
    assert.deepEqual(input, { runId: 'fixture', approvedKeywords: [], rejectedKeywords: [], manualKeywords: [], approveAll: false });
    assert.equal(update.patch.activeStep, 'select');
    assert.equal(update.patch.progress.select.status, 'idle');
    assert.equal(update.patch.progress.verify, undefined);
    const productBody = { approvedProductIds: ['123'], manualProducts: [{ url: 'fixture' }], approveAll: true };
    await post('product-review', productBody);
    assert.deepEqual(input, { runId: 'fixture', ...productBody });
    assert.equal(update.patch.status, 'paused');
    assert.equal(update.patch.activeStep, 'generate');
    assert.equal(update.patch.progress.select.current, 1);
    assert.equal(update.patch.progress.generate.status, 'idle');
    await post('product-review', { approvedProductIds: 'invalid', manualProducts: null, approveAll: 1 });
    assert.deepEqual(input, { runId: 'fixture', approvedProductIds: [], manualProducts: [], approveAll: false });
    for (const route of ['keyword-review', 'product-review']) {
      runtime = null;
      update = undefined;
      assert.equal((await post(route)).status, 200);
      assert.equal(update, undefined, 'legacy runs without runtime do not create runtime state');
    }
    runtime = { steps: [] };
    keywordStatus = 'needs_review';
    productStatus = 'needs_review';
    for (const route of ['keyword-review', 'product-review']) {
      update = undefined;
      assert.equal((await post(route)).status, 200);
      assert.equal(update, undefined, 'incomplete review must not advance');
      failure = new Error('fixture review failure');
      const failed = await post(route);
      assert.equal(failed.status, 500);
      assert.deepEqual(await failed.json(), { ok: false, error: 'fixture review failure' });
      assert.equal(update, undefined);
      failure = null;
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
