const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initRun, writeRun } = require('../../../../skills/pipeline-flow/src/run-store');
const flow = require('../../../../skills/competitor-analysis/src/sourcing-flow');
const { runPipelineRuntime } = require('../../../../skills/pipeline-flow/runtime/runner');
const { readRuntimeState } = require('../../../../skills/pipeline-flow/runtime/store');

function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'competitor-source-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const options = { dataDir, runId: '2026-10-25-120000' };
  const context = initRun(options);
  context.run.files.competitorHotProducts = path.join(context.runDir, 'hot.jsonl');
  fs.writeFileSync(context.run.files.competitorHotProducts, JSON.stringify({ itemId: '123', title: '测试商品', productUrl: 'https://item.taobao.com/item.htm?id=123', imageUrl: 'https://img.alicdn.com/a.jpg', shopKey: 'shop', sortType: 'hot' }) + '\n');
  writeRun(context.runDir, context.run);
  const stageFns = Object.fromEntries(['collectCompetitorProducts', 'enrichCompetitorProducts', 'analyzeCompetitors', 'buildCompetitorAnalysisReport'].map(name => [name, async () => ({ status: 'completed' })]));
  return { ...options, stageFns };
}

test('collection checkpoints stages and waits for explicit selection', async t => {
  const options = fixture(t);
  assert.equal((await flow.runCompetitorCollectionBundle(options)).status, 'needs_review');
  assert.equal(flow.getCompetitorSourcingState(options).products.length, 1);
  options.stageFns = new Proxy({}, { get() { throw new Error('completed stage repeated'); } });
  assert.equal((await flow.runCompetitorCollectionBundle(options)).status, 'needs_review');
  assert.throws(() => flow.saveCompetitorSelection({ ...options, selectedItemIds: [], skip: 'true' }));
  flow.saveCompetitorSelection({ ...options, selectedItemIds: [], skip: true });
  assert.equal((await flow.runCompetitorFindSources(options)).status, 'workflow_complete');
});

test('incomplete image search blocks and can be retried; review requires every product', async t => {
  const options = fixture(t);
  await flow.runCompetitorCollectionBundle(options);
  flow.saveCompetitorSelection({ ...options, selectedItemIds: ['123'] });
  let calls = 0;
  options.provider = { search: async () => ({ ok: true, complete: ++calls > 1, candidates: [{ offerId: '456', priceText: '10' }] }) };
  assert.equal((await flow.runCompetitorFindSources(options)).status, 'manual_action_required');
  assert.equal((await flow.runCompetitorFindSources(options)).status, 'needs_review');
  await flow.runCompetitorFindSources(options);
  assert.equal(calls, 2);
  assert.throws(() => flow.saveCompetitorSourceDecisions({ ...options, decisions: [] }));
  const decisions = [{ itemId: '123', action: 'select', offerId: '456' }];
  assert.throws(() => flow.saveCompetitorSourceDecisions({ ...options, decisions }), /人工核对/);
  decisions[0].riskAccepted = true;
  flow.saveCompetitorSourceDecisions({ ...options, decisions });
  assert.equal((await flow.runCompetitorFindSources(options)).status, 'workflow_complete');
});

test('pause does not call image provider or lose selection', async t => {
  const options = fixture(t);
  await flow.runCompetitorCollectionBundle(options);
  flow.saveCompetitorSelection({ ...options, selectedItemIds: ['123'] });
  const output = await flow.runCompetitorFindSources({ ...options, shouldStop: () => true, provider: { search() { throw new Error('must not search'); } } });
  assert.equal(output.status, 'paused');
  assert.deepEqual(flow.getCompetitorSourcingState(options).selectedItemIds, ['123']);
});

test('stable loaded-card batch permits review without claiming exhaustive results or repeating search', async t => {
  const options = fixture(t);
  await flow.runCompetitorCollectionBundle(options);
  flow.saveCompetitorSelection({ ...options, selectedItemIds: ['123'] });
  let calls = 0;
  options.provider = { search: async () => {
    calls++;
    return { ok: true, complete: false, batchReady: true, candidates: [{ offerId: '456' }] };
  } };
  assert.equal((await flow.runCompetitorFindSources(options)).status, 'needs_review');
  const result = flow.getCompetitorSourcingState(options).results[0];
  assert.equal(result.complete, false);
  assert.equal(result.batchReady, true);
  assert.equal(result.noSources, false);
  await flow.runCompetitorFindSources(options);
  assert.equal(calls, 1);
});

test('runtime moves from collection review to sourcing review and then completion', async t => {
  const options = fixture(t);
  const stepFns = {
    collectCompetitors: () => flow.runCompetitorCollectionBundle(options),
    findCompetitorSources: () => flow.runCompetitorFindSources({ ...options, provider: { search: async () => ({ ok: true, complete: true, candidates: [] }) } })
  };
  const runtimeOptions = { ...options, mode: 'competitor-analysis', steps: Object.keys(stepFns), stepFns };
  assert.equal((await runPipelineRuntime(runtimeOptions)).runtimeStatus, 'needs_review');
  flow.saveCompetitorSelection({ ...options, selectedItemIds: ['123'] });
  assert.equal((await runPipelineRuntime({ ...runtimeOptions, preserveRuntime: true })).runtimeStatus, 'needs_review');
  assert.equal(readRuntimeState(options).activeStep, 'findCompetitorSources');
  flow.saveCompetitorSourceDecisions({ ...options, decisions: [{ itemId: '123', action: 'skip' }] });
  assert.equal((await runPipelineRuntime({ ...runtimeOptions, preserveRuntime: true })).runtimeStatus, 'completed');
});
