import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mapPipelineStageToFunnel,
  getWorkflowAction,
  getCanvasNodeTone,
  getWorkflowNodeAction,
  summarizeWorkflowArtifact,
  normalizeCandidateForTitle,
  buildReviewProduct,
  getStartNodeParams,
  getWorkflowLaunchBlocker
} from './workflow-ui.js';

test('mapPipelineStageToFunnel maps backend stages to five business stages', () => {
  assert.equal(mapPipelineStageToFunnel('seed'), 'candidate');
  assert.equal(mapPipelineStageToFunnel('mined'), 'candidate');
  assert.equal(mapPipelineStageToFunnel('verified'), 'verified');
  assert.equal(mapPipelineStageToFunnel('generated'), 'generated');
  assert.equal(mapPipelineStageToFunnel('review'), 'pending_review');
  assert.equal(mapPipelineStageToFunnel('ready'), 'pending_review');
  assert.equal(mapPipelineStageToFunnel('submitted'), 'submitted');
  assert.equal(mapPipelineStageToFunnel('unknown'), 'candidate');
});

test('getWorkflowAction recommends the next business action', () => {
  assert.deepEqual(getWorkflowAction({ stage: 'mined', requiresUserAction: true }), {
    label: '去挖词确认',
    targetTab: 'mine',
    tone: 'warn'
  });
  assert.deepEqual(getWorkflowAction({ stage: 'generated', requiresUserAction: false }), {
    label: '查看标题货源',
    targetTab: 'title',
    tone: 'default'
  });
  assert.deepEqual(getWorkflowAction({ stage: 'ready', requiresUserAction: true }), {
    label: '处理待复核',
    targetTab: 'dashboard',
    tone: 'warn'
  });
});

test('getCanvasNodeTone maps workflow node states to UI tones', () => {
  assert.equal(getCanvasNodeTone('completed'), 'success');
  assert.equal(getCanvasNodeTone('running'), 'active');
  assert.equal(getCanvasNodeTone('needs_review'), 'warn');
  assert.equal(getCanvasNodeTone('waiting_confirmation'), 'warn');
  assert.equal(getCanvasNodeTone('blocked'), 'danger');
  assert.equal(getCanvasNodeTone('failed'), 'danger');
  assert.equal(getCanvasNodeTone('idle'), 'muted');
  assert.equal(getCanvasNodeTone('unknown'), 'muted');
});

test('getWorkflowNodeAction maps review and terminal states to node actions', () => {
  assert.deepEqual(getWorkflowNodeAction('review', 'needs_review'), {
    label: '处理复核',
    action: 'review',
    tone: 'warn'
  });
  assert.deepEqual(getWorkflowNodeAction('review', 'waiting_confirmation'), {
    label: '处理复核',
    action: 'review',
    tone: 'warn'
  });
  assert.deepEqual(getWorkflowNodeAction('generate', 'failed'), {
    label: '查看阻塞',
    action: 'blocked',
    tone: 'danger'
  });
  assert.deepEqual(getWorkflowNodeAction('export', 'blocked'), {
    label: '查看阻塞',
    action: 'blocked',
    tone: 'danger'
  });
  assert.deepEqual(getWorkflowNodeAction('generate', 'completed'), {
    label: '查看产物',
    action: 'artifact',
    tone: 'success'
  });
  assert.deepEqual(getWorkflowNodeAction('mine', 'idle'), {
    label: '查看节点',
    action: 'inspect',
    tone: 'muted'
  });
});

test('summarizeWorkflowArtifact describes jsonl, markdown, text, and empty artifacts', () => {
  assert.equal(summarizeWorkflowArtifact({ type: 'jsonl', items: [{}, {}, {}] }), '3 条数据');
  assert.equal(summarizeWorkflowArtifact({ type: 'jsonl', rows: [{ keyword: '项链' }] }), '1 条数据');
  assert.equal(summarizeWorkflowArtifact({ type: 'markdown', text: '# 复核' }), '复核报告');
  assert.equal(summarizeWorkflowArtifact({ file: '/tmp/distribution-review.md', text: '# 复核' }), '复核报告');
  assert.equal(summarizeWorkflowArtifact({ type: 'text', text: '第一行\n第二行\n' }), '2 行文本');
  assert.equal(summarizeWorkflowArtifact(null), '暂无产物');
  assert.equal(summarizeWorkflowArtifact({ type: 'text', text: '' }), '暂无产物');
});

test('normalizeCandidateForTitle carries mining metrics into title context', () => {
  const candidate = normalizeCandidateForTitle({
    keyword: '纯银项链女',
    localScore: 82,
    source: 'sycm_blue',
    canDistribute: true,
    gateStatus: 'verified',
    gateReason: '搜索人气和供需比通过',
    sycmData: { searchPopularity: 2300, demandSupplyRatio: 1.8 }
  });

  assert.equal(candidate.keyword, '纯银项链女');
  assert.equal(candidate.canDistribute, true);
  assert.equal(candidate.market.searchPopularity, 2300);
  assert.equal(candidate.score, 82);
  assert.equal(candidate.source, 'sycm_blue');
});

test('buildReviewProduct preserves title, source product, and safety fields', () => {
  const review = buildReviewProduct({
    keyword: '纯银项链女',
    product: {
      产品链接: 'https://detail.1688.com/offer/1.html',
      铺货标题: '纯银项链女小众设计感锁骨链',
      链接原标题: 'S925纯银项链',
      商品原价: '12.80'
    },
    candidate: { canDistribute: true, gateReason: '已验真' }
  });

  assert.equal(review.keyword, '纯银项链女');
  assert.equal(review.title, '纯银项链女小众设计感锁骨链');
  assert.equal(review.productUrl, 'https://detail.1688.com/offer/1.html');
  assert.equal(review.canDistribute, true);
  assert.equal(review.reason, '已验真');
});

test('getStartNodeParams extracts canvas start data without runtime fields', () => {
  const params = getStartNodeParams([
    {
      id: 'start',
      type: 'task',
      data: {
        label: '开始',
        keyword: '纯银项链女',
        productsPerKeyword: 4,
        length: 60,
        status: 'completed',
        output: { runId: 'run_1' },
        error: null,
        onSelect: () => {},
        originalType: 'production-start'
      }
    }
  ]);

  assert.deepEqual(params, {
    label: '开始',
    keyword: '纯银项链女',
    productsPerKeyword: 4,
    length: 60
  });
});

test('getWorkflowLaunchBlocker blocks empty keyword launches before request', () => {
  const blocker = getWorkflowLaunchBlocker('keyword', [
    { id: 'start', type: 'task', data: { keyword: '   ' } }
  ]);

  assert.equal(blocker.status, 'failed');
  assert.equal(blocker.error, '关键词不能为空');
  assert.equal(blocker.logs[0].level, 'error');
  assert.match(blocker.logs[0].message, /关键词不能为空/);
});

test('getWorkflowLaunchBlocker keeps daily start parameters runnable', () => {
  const blocker = getWorkflowLaunchBlocker('daily', [
    {
      id: 'start',
      type: 'task',
      data: {
        mine: 50,
        verify: 20,
        generate: 10,
        export: 20,
        productsPerKeyword: 12,
        length: 60,
        pages: 1
      }
    }
  ]);

  assert.equal(blocker, null);
});
