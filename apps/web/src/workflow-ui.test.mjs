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
  formatWorkflowProgressLabel,
  normalizeWorkflowProgressEvent,
  getStartNodeParams,
  getWorkflowLaunchBlocker
} from './workflow-ui.js';
import {
  labelPipelineStatus,
  labelPipelineStage,
  labelPipelineCount,
  labelNextAction
} from './pipeline-labels.js';
import {
  getPipelineActionView,
  getPipelineSummaryText,
  normalizeVerifiedKeywordForTitle
} from './pipeline-action-view.js';

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

test('pipeline labels localize status, stage, counts, and next commands', () => {
  assert.equal(labelPipelineStatus('verified_empty'), '验真无结果');
  assert.equal(labelPipelineStatus('ready_to_distribute'), '待确认铺货');
  assert.equal(labelPipelineStage('verified'), '大盘验真');
  assert.equal(labelPipelineCount('sycmVerified'), '验真通过');
  assert.equal(labelPipelineCount('generatedProducts'), '标题货源');
  assert.equal(labelNextAction({
    nextCommand: 'node bin/cli.js flow generate --run 2026-07-01-212255 --json'
  }), '生成标题货源');
});

test('getPipelineActionView returns one primary CTA per pipeline stage', () => {
  assert.equal(getPipelineActionView(null).label, '启动每日流程');
  assert.deepEqual(getPipelineActionView({ runId: 'run_1', status: 'mined', stage: 'mined' }), {
    label: '执行大盘验真',
    targetTab: 'mine',
    step: 'verify',
    tone: 'default',
    description: '候选词已经准备好，下一步需要用生意参谋等指标验真。'
  });

  assert.deepEqual(getPipelineActionView({ runId: 'run_1', status: 'verified', stage: 'verified' }), {
    label: '生成标题货源',
    targetTab: 'title',
    step: 'generate',
    tone: 'default',
    description: '已有通过验真的关键词，可以进入标题和货源生成。'
  });

  assert.equal(getPipelineActionView({ runId: 'run_1', status: 'needs_review', stage: 'review' }).tone, 'warn');
  assert.equal(getPipelineActionView({ runId: 'run_1', status: 'ready_to_distribute', stage: 'ready' }).label, '确认铺货清单');
  assert.deepEqual(getPipelineActionView({ runId: 'run_1', status: 'verified_empty', stage: 'verified' }), {
    label: '处理验真阻塞',
    targetTab: 'mine',
    step: 'verify',
    tone: 'warn',
    description: '验真阶段需要人工处理或更换候选词。'
  });
});

test('getPipelineSummaryText summarizes empty and active runs', () => {
  assert.equal(getPipelineSummaryText(null), '暂无当前流程');
  assert.equal(getPipelineSummaryText({
    runId: '2026-07-04-120000',
    status: 'mined',
    counts: { candidates: 12, sycmVerified: 0, generatedProducts: 0 }
  }), '候选词 12 个 · 验真通过 0 个 · 标题货源 0 个');
});

test('normalizeVerifiedKeywordForTitle preserves verified safety context', () => {
  const candidate = normalizeVerifiedKeywordForTitle({
    keyword: '纯银项链女',
    sycmScore: { score: 86, reason: '搜索人气和供需通过' },
    sycmData: { searchPopularity: 2300, demandSupplyRatio: 1.8 }
  });

  assert.equal(candidate.keyword, '纯银项链女');
  assert.equal(candidate.canDistribute, true);
  assert.equal(candidate.gateStatus, 'verified');
  assert.equal(candidate.localScore, 86);
  assert.equal(candidate.sycmData.searchPopularity, 2300);
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
  assert.equal(getCanvasNodeTone('waiting_manual'), 'warn');
  assert.equal(getCanvasNodeTone('retryable'), 'warn');
  assert.equal(getCanvasNodeTone('paused'), 'warn');
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
    label: '重试节点',
    action: 'retry-node',
    tone: 'warn'
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
  assert.deepEqual(getWorkflowNodeAction('mine', 'waiting_manual'), {
    label: '继续流程',
    action: 'resume',
    tone: 'warn'
  });
  assert.deepEqual(getWorkflowNodeAction('verify', 'paused'), {
    label: '继续流程',
    action: 'resume',
    tone: 'warn'
  });
  assert.deepEqual(getWorkflowNodeAction('generate', 'retryable'), {
    label: '重试节点',
    action: 'retry-node',
    tone: 'warn'
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

test('formatWorkflowProgressLabel formats current, total, percent, and empty values', () => {
  assert.equal(formatWorkflowProgressLabel({ current: 3, total: 10, percent: 30 }), '3/10 · 30%');
  assert.equal(formatWorkflowProgressLabel({ current: 3, total: 10 }), '3/10');
  assert.equal(formatWorkflowProgressLabel({ percent: 45 }), '45%');
  assert.equal(formatWorkflowProgressLabel({ message: '验真 3/10', percent: 30 }), '验真 3/10 · 30%');
  assert.equal(formatWorkflowProgressLabel(null), '');
  assert.equal(formatWorkflowProgressLabel({}), '');
});

test('normalizeWorkflowProgressEvent accepts payload and flat SSE progress events', () => {
  assert.deepEqual(normalizeWorkflowProgressEvent({
    event: 'progress',
    payload: { step: 'verify', current: 3, total: 10, percent: 30, message: '验真 3/10' }
  }), {
    step: 'verify',
    current: 3,
    total: 10,
    percent: 30,
    message: '验真 3/10'
  });

  assert.deepEqual(normalizeWorkflowProgressEvent({
    event: 'progress',
    step: 'mine',
    current: 1,
    total: 5,
    percent: 20,
    message: '挖词 1/5'
  }), {
    step: 'mine',
    current: 1,
    total: 5,
    percent: 20,
    message: '挖词 1/5'
  });
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

  assert.equal(blocker.status, 'blocked');
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
