const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { flowDiscoverInspirations } = require('../../../../skills/pipeline-flow/src/inspiration-flow');
const { getRun, readJsonl } = require('../../../../skills/pipeline-flow/src/run-store');
const { productizeInspirations } = require('../../../../skills/keyword-mining/src/inspiration-productizer');
const { fetchNewsFeeds } = require('../../../../skills/keyword-mining/src/inspiration-sources');
const { flowExpandRootKeywords } = require('../../../../skills/pipeline-flow/src/root-keyword-expansion-flow');
const { rootResearchStatus } = require('../../../../skills/keyword-mining/src/root-research-store');
const { buildNodeStates } = require('../../../../core/workflow/pipeline-node-state');
const { runPipelineRuntime } = require('../../../../skills/pipeline-flow/runtime/runner');
const { inspirationReviewState, saveInspirationRoots } = require('../../../../skills/pipeline-flow/src/inspiration-root-review');
const { updateRuntimeState } = require('../../../../skills/pipeline-flow/runtime/store');

test('inspiration node saves roots independently and reuses its snapshot', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inspiration-node-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const progress = [];
  const options = { dataDir, runId: 'test-inspiration', keywordDataDir: path.join(dataDir, 'keywords'),
    inspirationUseLLM: false, newsFeedUrls: [], dictionaryWords: ['收纳', '运动', '照明'],
    onProgress: value => progress.push(value) };
  const first = await flowDiscoverInspirations(options);
  assert.equal(first.ok, true);
  const { run } = getRun(options);
  assert.ok(readJsonl(run.files.inspirationRoots).length > 0);
  assert.equal(readJsonl(run.files.candidates).length, 0);
  const second = await flowDiscoverInspirations(options);
  assert.deepEqual(second.roots, first.roots);
  assert.ok(progress.some(item => /已保存/.test(item.message)));
});

test('productizer resumes completed batches without requesting them again', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inspiration-batch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let calls = 0;
  const llmClient = { productizeInspirations: async () => {
    calls += 1;
    if (calls === 2) throw new Error('temporary failure');
    return [];
  } };
  const inspirations = Array.from({ length: 21 }, (_, i) => ({ id: `i${i}`, inspirationWord: '收纳' }));
  await assert.rejects(productizeInspirations(inspirations, { llmClient, batchSize: 20, batchCacheDir: dir }), /temporary failure/);
  await productizeInspirations(inspirations, { llmClient, batchSize: 20, batchCacheDir: dir });
  assert.equal(calls, 3);
});

test('news sources reuse cached feeds and report progress', async t => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'news-cache-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  let calls = 0;
  const options = { cacheDir, fetcher: async () => {
    calls += 1;
    return { data: '<rss><channel><item><title>高温天气</title></item></channel></rss>' };
  } };
  const first = await fetchNewsFeeds(['https://example.test/feed'], options);
  const replay = await fetchNewsFeeds(['https://example.test/feed'], options);
  assert.deepEqual(replay.items, first.items);
  assert.equal(calls, 1);
});

test('daily expansion records cooldown, reuses completed work and invalidates changed query context', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-expansion-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let calls = 0;
  const options = { dataDir, keywordDataDir: path.join(dataDir, 'keywords'), runId: 'daily',
    workflowMode: 'daily', roots: ['杯垫'], sycmMode: 'hot',
    sycmExtractor: async () => { calls += 1; return { data: [{ keyword: '隔热杯垫' }] }; } };
  await flowExpandRootKeywords(options);
  await flowExpandRootKeywords(options);
  assert.equal(calls, 1);
  assert.equal(getRun(options).run.options.mode, 'daily');
  assert.equal(rootResearchStatus('杯垫', { dataDir: options.keywordDataDir }).state, 'cooling');
  await flowExpandRootKeywords({ ...options, pages: 2 });
  assert.equal(calls, 2);
});

test('inspiration running does not mark the following SYCM node running', () => {
  const states = buildNodeStates({ status: 'created', runtime: { mode: 'daily', activeStep: 'inspire', status: 'running',
    steps: ['inspire', 'mine'], progress: { inspire: { status: 'running' }, mine: { status: 'idle' } } } });
  assert.equal(states.inspire.status, 'running');
  assert.equal(states.mine.status, 'idle');
});

test('optional root review pauses before SYCM and prevents stale or active edits', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'root-review-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const options = { dataDir, runId: 'review-roots' };
  const result = await runPipelineRuntime({ ...options, mode: 'daily', params: {
    reviewInspirationRoots: true, inspirationUseLLM: false, newsFeedUrls: [],
    keywordDataDir: path.join(dataDir, 'keywords')
  } });
  assert.equal(result.status, 'paused');
  const state = inspirationReviewState(options);
  assert.equal(state.editable, true);
  const saved = saveInspirationRoots({ ...options, revision: state.revision, rootsText: '杯垫\n浴室脚垫\n杯垫' });
  assert.deepEqual(saved.rows.map(row => row.rootKeyword), ['杯垫', '浴室脚垫']);
  assert.throws(() => saveInspirationRoots({ ...options, revision: state.revision, rootsText: '收纳盒' }), /已更新/);
  updateRuntimeState({ ...options, patch: { status: 'running' } });
  assert.throws(() => saveInspirationRoots({ ...options, revision: saved.revision, rootsText: '收纳盒' }), /暂停/);
});

test('partial daily expansion blocks and retries only the failed query', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'partial-expansion-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const calls = [];
  let fail = true;
  const options = { dataDir, keywordDataDir: path.join(dataDir, 'keywords'), runId: 'partial',
    workflowMode: 'daily', roots: ['杯垫'], sycmMaxRetries: 0,
    sycmExtractor: async (_, config) => {
      calls.push(config.mode);
      if (config.mode === 'blue' && fail) throw new Error('temporary failure');
      return { data: [{ keyword: '隔热杯垫' }] };
    } };
  const first = await flowExpandRootKeywords(options);
  assert.equal(first.status, 'mining_manual_action_required');
  assert.equal(first.stepIncomplete, true);
  fail = false;
  const second = await flowExpandRootKeywords(options);
  assert.equal(second.status, 'mined');
  assert.equal(getRun(options).run.counts.rootQueriesFailed, 0);
  assert.deepEqual(calls, ['hot', 'blue', 'blue']);
});
