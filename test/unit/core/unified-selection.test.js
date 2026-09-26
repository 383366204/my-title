'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listProductionWorkflowTemplates, listProductionWorkflowVariants } = require('../../../core/workflow/pipeline-templates');
const { validateProductionWorkflow, resolveProductionWorkflowLaunch, resolveProductionWorkflowDefinition, sanitizeWorkflowParams } = require('../../../core/workflow/pipeline-params');
const { runPipelineRuntime } = require('../../../skills/pipeline-flow/runtime/runner');
const { verifyExactSelectionKeywords } = require('../../../skills/pipeline-flow/src/exact-keyword-verification');
const { flowKeywordStart } = require('../../../skills/pipeline-flow/src/flow-orchestrator');
const { getRun, readJsonl } = require('../../../skills/pipeline-flow/src/run-store');
const { summaryInterventionForNode } = require('../../../core/workflow/pipeline-node-diagnostics');
const { buildNodeStates } = require('../../../core/workflow/pipeline-node-state');
const { flowExpandRootKeywords } = require('../../../skills/pipeline-flow/src/root-keyword-expansion-flow');
const { prepareKeywordSupplement } = require('../../../skills/pipeline-flow/src/keyword-supplement');

function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-selection-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return { dataDir, runId: 'selection-test' };
}

test('one selection entry validates and snapshots each concrete mode', () => {
  const entry = listProductionWorkflowTemplates().filter(item => item.id === 'selection-v1');
  assert.equal(entry.length, 1);
  assert.equal(entry[0].selectionModes.length, 3);
  for (const item of listProductionWorkflowVariants().filter(item => item.id === 'selection-v1')) {
    const request = { templateId: item.id, mode: item.mode, workflow: item.workflow, params: { keyword: '杯垫', roots: ['杯垫'] } };
    assert.equal(validateProductionWorkflow(item.workflow, request).ok, true);
    const launch = resolveProductionWorkflowLaunch(request);
    assert.equal(launch.mode, item.mode);
    const snapshot = resolveProductionWorkflowDefinition(request, launch);
    assert.equal(snapshot.id, 'selection-v1');
    assert.equal(snapshot.mode, item.mode);
    assert.equal(snapshot.nodes.filter(node => node.id === 'keywordReview').length, item.mode === 'keyword' ? 0 : 1);
    assert.equal(snapshot.nodes.some(node => node.id === 'verify'), false);
  }
  const graph = entry[0].workflow;
  assert.equal(validateProductionWorkflow(graph, { templateId: 'selection-v1', mode: 'keyword' }).ok, false);
  assert.equal(validateProductionWorkflow(graph, { templateId: 'daily-selection-v1' }).ok, false);
  assert.throws(() => resolveProductionWorkflowLaunch({ templateId: 'selection-v1', mode: 'manual' }), /未知/);
});

test('sanitization preserves large inputs and enforces manual confirmation', () => {
  assert.equal(sanitizeWorkflowParams('keyword', { keywords: Array.from({ length: 120 }, (_, i) => `词${i}`) }).keywords.length, 120);
  assert.equal(sanitizeWorkflowParams('daily', { autoApproveKeywords: true }).autoApproveKeywords, false);
  const root = sanitizeWorkflowParams('root-keyword', { roots: ['男装'] });
  assert.equal(root.sycmMode, 'both');
  assert.equal(root.pages, 3);
  assert.equal(root.sycmMaxPages, 3);
});

test('prepared exact input points to product selection, not removed keyword steps', () => {
  const states = buildNodeStates({ status: 'mined', options: { mode: 'keyword' } });
  assert.equal(states.start.status, 'completed');
  assert.equal(states.select.status, 'running');
  assert.equal(states.verify.status, 'idle');
  assert.equal(states.keywordReview.status, 'idle');
});

test('exact runtime searches each deduplicated input without SYCM or keyword review', async t => {
  const options = fixture(t);
  let calls = 0;
  const searched = [];
  const result = await runPipelineRuntime({ ...options, mode: 'keyword', params: {
    keywords: ['杯垫', '茶杯', '杯垫'],
    extractKeywords: async (_mode, input) => ({ coreWord: input.data }),
    searchProducts: async (_core, word) => { searched.push(word); return []; },
    sycmExtractor: async () => { calls++; return { data: [{ keyword: '杯垫', searchPopularity: 0 }] }; }
  } });
  assert.equal(calls, 0);
  assert.deepEqual(searched, ['杯垫', '茶杯']);
  assert.equal(result.status, 'select_failed');
  const { run } = getRun(options);
  assert.deepEqual(readJsonl(run.files.verifiedKeywords), []);
  assert.ok(readJsonl(run.files.candidates).every(row => !row.sycmScore && !row.keywordOpportunity));
});

test('exact keyword validation rejects empty and malformed input and preserves normal product terms', async t => {
  const options = fixture(t);
  for (const keyword of ['', ' \n ', '<script>', 'https://detail.1688.com/offer/123.html', '杯\u0000垫', { keyword: '杯垫' }]) {
    assert.throws(() => sanitizeWorkflowParams('keyword', { keyword }), /关键词/);
    await assert.rejects(flowKeywordStart({ ...options, keyword }), /关键词|keyword/);
  }
  const started = await flowKeywordStart({ ...options, keywords: [' 男士T恤 ', '304不锈钢杯', '男士T恤'] });
  assert.deepEqual(started.exactKeywords, ['男士T恤', '304不锈钢杯']);
  assert.match(started.nextCommand, /flow select/);
});

test('exact verification does not use related terms and resumes unfinished items only', async t => {
  const options = fixture(t);
  await flowKeywordStart({ ...options, keywords: ['杯垫', '茶杯'] });
  let calls = 0;
  const sycmExtractor = async word => { calls++; return { data: [{ keyword: `${word}关联词`, searchPopularity: 900 }] }; };
  const paused = await verifyExactSelectionKeywords({ ...options, sycmExtractor, shouldStop: () => calls ? 'pause' : null });
  assert.equal(paused.status, 'paused');
  await verifyExactSelectionKeywords({ ...options, sycmExtractor });
  assert.equal(calls, 2);
  const rows = readJsonl(getRun(options).run.files.candidates);
  assert.ok(rows.every(row => row.sycmData === null && row.sycmEvidence.exactChecked));
});

test('exact selection does not require an available Chrome connection', async t => {
  const options = fixture(t);
  const result = await runPipelineRuntime({ ...options, mode: 'keyword', params: {
    keyword: '杯垫',
    extractKeywords: async () => ({ coreWord: '杯垫' }),
    searchProducts: async () => [],
    sycmExtractor: async () => { assert.fail('精确选品不应请求生意参谋'); }
  } });
  assert.equal(result.status, 'select_failed');
});

test('exact runtime reaches distribution review and can retry selection without keyword verification', async t => {
  const options = fixture(t);
  const keyword = '硅藻土杯垫';
  const product = {
    subject: `${keyword}吸水隔热防滑桌面茶杯垫家用简约圆形耐热茶托`,
    detailUrl: 'https://detail.1688.com/offer/123456789.html',
    price: 12, sales30days: 100, shopName: '杯垫工厂',
    imageUrl: 'https://example.com/product.jpg', categoryListName: '家居 > 杯垫'
  };
  let searches = 0;
  const params = {
    keyword,
    sycmExtractor: async () => assert.fail('不得发起生意参谋筛词'),
    categoryExtractor: async word => ({ categoryAnalysis: { recommendation: {
      recommended: { category: '家居 > 杯垫', clickRatio: 80, clickRate: 30 }
    } } }),
    extractKeywords: async () => ({ coreWord: keyword }),
    searchProducts: async () => { searches++; return [product]; },
    generator: async word => {
      assert.equal(word, keyword);
      return { products: [{ ...product, '产品链接': product.detailUrl, '铺货标题': `${product.subject}办公水杯防烫垫子` }] };
    }
  };
  const first = await runPipelineRuntime({ ...options, mode: 'keyword', params });
  assert.ok(['ready_to_distribute', 'needs_review'].includes(first.status), first.status);
  const retry = await runPipelineRuntime({ ...options, mode: 'keyword', params, preserveRuntime: true, retryStep: 'select' });
  assert.ok(['ready_to_distribute', 'needs_review'].includes(retry.status), retry.status);
  assert.equal(searches, 2);
  const { run } = getRun(options);
  assert.equal(run.counts.readyToDistribute, 1);
  assert.equal(run.counts.sycmVerified, 0);
  assert.equal(readJsonl(run.files.generatedProducts)[0].keyword, keyword);
});

test('exact keyword chrome failure surfaces start-sycm-chrome blocker', async t => {
  const options = fixture(t);
  await flowKeywordStart({ ...options, keywords: ['杯垫'] });
  const result = await verifyExactSelectionKeywords({
    ...options,
    sycmExtractor: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:9222'); }
  });
  assert.equal(result.status, 'manual_action_required');
  assert.equal(result.manualAction.status, 'chrome_unavailable');
  const { run } = getRun(options);
  const failures = readJsonl(run.files.sycmResults).filter(row => row.ok === false);
  assert.equal(failures.length, 1);
  assert.match(failures[0].error, /9222/);
  const intervention = summaryInterventionForNode({
    status: 'manual_action_required',
    files: { sycmResults: run.files.sycmResults }
  }, 'verify');
  assert.equal(intervention.nextRecommendedAction.action, 'start-sycm-chrome');
  assert.equal(intervention.platformStatus, 'chrome_unavailable');
});

test('root expansion queries hot and blue pages with correct provenance', async t => {
  const options = fixture(t);
  const requests = [];
  const result = await flowExpandRootKeywords({ ...options, roots: ['杯垫'], sycmMode: 'both', pages: 3,
    sycmExtractor: async (word, config) => {
      requests.push(config);
      return { data: [{ keyword: `${word}${config.mode}`, searchPopularity: 30 }] };
    }
  });
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(requests.map(item => item.mode), ['hot', 'blue']);
  assert.ok(requests.every(item => item.maxPages === 3 && item.guardMinCooldownMs >= 45000));
  assert.deepEqual(result.candidates.map(row => row.sycmEvidence.mode).sort(), ['blue', 'hot']);
});

test('supplement queries only new words, keeps draft decisions and never approves automatically', async t => {
  const options = fixture(t);
  await runPipelineRuntime({ ...options, mode: 'root-keyword', params: { roots: ['杯垫'], sycmExtractor: async () => ({ data: [{ keyword: '杯垫', searchPopularity: 30 }] }) } });
  const keywords = prepareKeywordSupplement({ ...options, keywords: ['茶杯', '茶杯'], decisions: { 杯垫: 'approved' } });
  assert.deepEqual(keywords, ['茶杯']);
  const queried = [];
  const result = await runPipelineRuntime({ ...options, mode: 'root-keyword', preserveRuntime: true, resumeFromStep: 'keywordReview',
    params: { reviewQueryKeywords: keywords, sycmExtractor: async word => { queried.push(word); return { data: [] }; } } });
  assert.deepEqual(queried, ['茶杯']);
  assert.equal(result.status, 'awaiting_keyword_review');
  assert.equal(result.reviewed.find(row => row.keyword === '杯垫').reviewDraft, 'approved');
  assert.equal(result.approved.length, 0);
  assert.deepEqual(readJsonl(getRun(options).run.files.verifiedKeywords), []);
  assert.throws(() => prepareKeywordSupplement({ ...options, keywords: ['茶杯'] }), /已有查询结果/);
});
