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
  getPipelineMonitorNodeStatus,
  getPipelineSummaryVisualState,
  normalizeWorkflowProgressEvent,
  getStartNodeParams,
  getWorkflowLaunchBlocker,
  getWorkflowBlockerActions,
  getMiningRecoveryHint,
  getMiningRecoveryAction,
  getWorkflowArtifactView,
  getWorkflowNodeViewModel,
  getWorkflowNodeDetailRows,
  getWorkflowOperationMessage,
  getWorkflowRuntimeActions,
  buildWorkflowOperationRequest,
  labelWorkflowNodeStatus,
  getWorkflowRunActiveNodeId,
  getUnifiedWorkflowHistoryItem
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

test('pipeline monitor visual state treats empty verification as user action instead of running', () => {
  assert.equal(getPipelineSummaryVisualState({
    status: 'verified_empty',
    stage: 'verified'
  }), 'paused');
  assert.equal(getPipelineMonitorNodeStatus({ stageIndex: 2 }, {
    status: 'verified_empty',
    stage: 'verified',
    stageIndex: 2
  }), 'paused');
  assert.equal(getPipelineMonitorNodeStatus({ stageIndex: 1 }, {
    status: 'verified_empty',
    stage: 'verified',
    stageIndex: 2
  }), 'completed');
});

test('pipeline monitor visual state keeps generated and ready stages distinct', () => {
  assert.equal(getPipelineSummaryVisualState({ status: 'generated', stage: 'generated' }), 'running');
  assert.equal(getPipelineSummaryVisualState({ status: 'ready_to_distribute', stage: 'ready' }), 'ready');
  assert.equal(getPipelineMonitorNodeStatus({ stageIndex: 5 }, {
    status: 'ready_to_distribute',
    stage: 'ready',
    stageIndex: 5
  }), 'ready');
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

test('labelWorkflowNodeStatus localizes idle and paused statuses', () => {
  assert.equal(labelWorkflowNodeStatus('idle'), '未开始');
  assert.equal(labelWorkflowNodeStatus('paused'), '已暂停');
  assert.equal(labelWorkflowNodeStatus('unknown_new_state'), '未知状态');
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

test('getWorkflowNodeViewModel returns Chinese status, progress, blocker, and action metadata', () => {
  const view = getWorkflowNodeViewModel('verify', {
    status: 'waiting_manual',
    progress: { current: 2, total: 5, percent: 40, message: '等待生意参谋登录' },
    blocker: 'sycm_login_required',
    actionHint: '请登录生意参谋后继续',
    cooldownRemainingMs: 0
  });

  assert.equal(view.statusLabel, '等待人工处理');
  assert.equal(view.tone, 'warn');
  assert.equal(view.progressLabel, '等待生意参谋登录 · 2/5 · 40%');
  assert.equal(view.primaryAction.action, 'resume');
  assert.equal(view.primaryAction.label, '继续流程');
  assert.equal(view.blockerTitle, '需要人工处理');
  assert.match(view.blockerMessage, /生意参谋/);
});

test('getWorkflowNodeViewModel describes rate cooldown and retryable failures', () => {
  const cooldown = getWorkflowNodeViewModel('mine', {
    status: 'running',
    progress: { percent: 30, message: '1688 请求冷却中' },
    cooldownRemainingMs: 65000
  });
  assert.equal(cooldown.blockerTitle, '请求冷却中');
  assert.match(cooldown.blockerMessage, /65 秒/);

  const retryable = getWorkflowNodeViewModel('generate', {
    status: 'retryable',
    error: 'LLM timeout'
  });
  assert.equal(retryable.primaryAction.action, 'retry-node');
  assert.equal(retryable.blockerTitle, '可以重试');
  assert.match(retryable.blockerMessage, /LLM timeout/);
});

test('getWorkflowBlockerActions maps verified-empty blockers to useful next actions', () => {
  const actions = getWorkflowBlockerActions('verify', {
    status: 'blocked',
    blocker: 'verified_empty',
    nextRecommendedAction: {
      action: 'mine-more',
      label: '补充候选词',
      description: '当前没有通过生意参谋验真的词，先补充候选词再重跑验真。'
    }
  });

  assert.deepEqual(actions.map(action => action.action), ['mine-more', 'retry-node']);
  assert.equal(actions[0].label, '补充候选词');
  assert.equal(actions[1].label, '重跑验真');
});

test('getMiningRecoveryHint explains how to recover a verified-empty run', () => {
  assert.equal(getMiningRecoveryHint({
    status: 'verified_empty',
    counts: { candidates: 1, sycmVerified: 0, sycmRejected: 1 }
  }), '当前流程验真无结果。补充候选词后，回到选品流水线重跑“生意参谋校验”。');
});

test('getMiningRecoveryAction only allows verify retry after new candidates are added', () => {
  assert.deepEqual(getMiningRecoveryAction({
    status: 'verified_empty',
    counts: { candidates: 1, sycmVerified: 0, sycmRejected: 1 }
  }, 0), {
    visible: true,
    canRetryVerify: false,
    label: '重跑生意参谋校验',
    message: '请先补充新的候选词，重复词不会触发重跑验真。'
  });

  assert.deepEqual(getMiningRecoveryAction({
    status: 'verified_empty',
    counts: { candidates: 3, sycmVerified: 0, sycmRejected: 1 }
  }, 2), {
    visible: true,
    canRetryVerify: true,
    label: '重跑生意参谋校验',
    message: '已补充 2 个候选词，可以从生意参谋校验节点重跑。'
  });

  assert.deepEqual(getMiningRecoveryAction({ status: 'mined' }, 2), {
    visible: false,
    canRetryVerify: false,
    label: '',
    message: ''
  });
});

test('getWorkflowNodeDetailRows summarizes inputs, progress, output, and error', () => {
  const rows = getWorkflowNodeDetailRows({
    id: 'generate',
    data: {
      keyword: '纯银项链',
      status: 'failed',
      progress: { current: 1, total: 3, percent: 33, message: '生成标题失败' },
      error: 'LLM timeout',
      outputSummary: '生成 2 个标题'
    }
  });

  assert.deepEqual(rows.map((row) => row.label), ['状态', '进度', '关键词', '输出摘要', '错误']);
  assert.equal(rows.find((row) => row.label === '状态').value, '失败');
  assert.match(rows.find((row) => row.label === '进度').value, /生成标题失败/);
});

test('getWorkflowNodeDetailRows lists blocker reason and action hint separately', () => {
  const rows = getWorkflowNodeDetailRows({
    id: 'verify',
    data: {
      status: 'blocked',
      blocker: 'verified_empty',
      actionHint: '生意参谋验真没有通过词。请更换候选词、降低蓝海阈值，或重新挖词后再继续。'
    }
  });

  assert.equal(rows.find((row) => row.label === '阻塞原因').value, '验真无结果');
  assert.match(rows.find((row) => row.label === '处理建议').value, /验真没有通过词/);
});

test('getWorkflowNodeDetailRows surfaces platform manual-action blocker details', () => {
  const rows = getWorkflowNodeDetailRows({
    id: 'verify',
    data: {
      status: 'blocked',
      blocker: 'sycm_manual_action_required',
      platformStatus: 'slider_required',
      manualAction: {
        status: 'slider_required',
        userMessage: '生意参谋需要完成滑块验证后才能继续。'
      }
    }
  });

  assert.equal(rows.find((row) => row.label === '阻塞原因').value, '生意参谋需要人工处理');
  assert.equal(rows.find((row) => row.label === '平台状态').value, '需要滑块验证');
  assert.match(rows.find((row) => row.label === '处理建议').value, /滑块验证/);
});

test('getWorkflowNodeDetailRows infers verify blocker details when runtime omits a reason', () => {
  const rows = getWorkflowNodeDetailRows({
    id: 'verify',
    data: {
      status: 'blocked',
      progress: { current: 1, total: 1, percent: 100, message: '完成' }
    }
  });

  assert.equal(rows.find((row) => row.label === '阻塞原因').value, '生意参谋校验阻塞');
  assert.match(rows.find((row) => row.label === '处理建议').value, /登录、滑块、权限/);
});

test('getWorkflowRuntimeActions exposes pause while a selected node is running', () => {
  assert.deepEqual(getWorkflowRuntimeActions({
    runStatus: 'created',
    nodeId: 'verify',
    state: { status: 'running' }
  }), [{
    action: 'pause',
    label: '暂停当前流程',
    description: '当前步骤会在安全边界停止，之后可以继续执行。'
  }]);

  assert.deepEqual(getWorkflowRuntimeActions({
    runStatus: 'blocked',
    nodeId: 'verify',
    state: { status: 'blocked' }
  }), []);
});

test('getWorkflowOperationMessage returns clear Chinese feedback', () => {
  assert.equal(getWorkflowOperationMessage('pause', 'success'), '已请求暂停，当前步骤会在安全边界停止。');
  assert.equal(getWorkflowOperationMessage('resume', 'success'), '已请求继续，流程会从当前节点恢复。');
  assert.equal(getWorkflowOperationMessage('retry-node', 'success'), '已请求重试，当前节点及下游步骤会重新执行。');
  assert.match(getWorkflowOperationMessage('retry-node', 'error', 'network'), /network/);
});

test('buildWorkflowOperationRequest keeps production controls behind workflow endpoints', () => {
  assert.deepEqual(buildWorkflowOperationRequest('run-20260707-120000', 'pause'), {
    endpoint: '/api/workflows/runs/run-20260707-120000/pause',
    body: {}
  });
  assert.deepEqual(buildWorkflowOperationRequest('run-20260707-120000', 'resume', 'verify'), {
    endpoint: '/api/workflows/runs/run-20260707-120000/resume',
    body: {}
  });
  assert.deepEqual(buildWorkflowOperationRequest('run-20260707-120000', 'retry-node', 'generate'), {
    endpoint: '/api/workflows/runs/run-20260707-120000/retry-node',
    body: { nodeId: 'generate' }
  });
});

test('getWorkflowRunActiveNodeId prefers blocked or running workflow nodes', () => {
  assert.equal(getWorkflowRunActiveNodeId({
    nodeStates: {
      start: { status: 'completed' },
      mine: { status: 'completed' },
      verify: { status: 'blocked' },
      generate: { status: 'idle' }
    }
  }), 'verify');

  assert.equal(getWorkflowRunActiveNodeId({
    nodeStates: {
      start: { status: 'completed' },
      mine: { status: 'running' },
      verify: { status: 'idle' }
    }
  }), 'mine');

  assert.equal(getWorkflowRunActiveNodeId({
    workflow: {
      nodes: [
        { id: 'start', data: { status: 'completed' } },
        { id: 'mine', data: { status: 'completed' } }
      ]
    }
  }), 'mine');
});

test('getUnifiedWorkflowHistoryItem normalizes pipeline and workflow runs for one history list', () => {
  assert.deepEqual(getUnifiedWorkflowHistoryItem({
    runId: '2026-07-06-005614',
    status: 'verified_empty',
    stage: 'verified',
    keyword: '纯银项链',
    updatedAt: '2026-07-06T00:56:14.000Z'
  }), {
    runId: '2026-07-06-005614',
    title: '纯银项链',
    subtitle: '大盘验真',
    statusLabel: '验真无结果',
    visualState: 'paused',
    updatedAt: '2026-07-06T00:56:14.000Z'
  });

  assert.deepEqual(getUnifiedWorkflowHistoryItem({
    runId: 'run_1',
    status: 'running',
    workflow: {
      nodes: [
        { id: 'start', data: { keyword: '珍珠耳环' } }
      ]
    },
    startedAt: '2026-07-06T01:00:00.000Z'
  }), {
    runId: 'run_1',
    title: '珍珠耳环',
    subtitle: '工作流运行',
    statusLabel: '运行中',
    visualState: 'running',
    updatedAt: '2026-07-06T01:00:00.000Z'
  });

  assert.equal(getUnifiedWorkflowHistoryItem({
    runId: '2026-07-06-005614',
    status: 'blocked',
    workflow: { id: 'daily-selection-v1', mode: 'daily', nodes: [{ id: 'start', data: { label: '开始' } }] }
  }).title, '每日蓝海选品流水线');

  assert.equal(getUnifiedWorkflowHistoryItem({
    runId: '2026-07-06-005614',
    status: 'blocked',
    workflow: { id: 'daily-selection-v1', mode: 'daily' }
  }).visualState, 'paused');
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

test('getWorkflowArtifactView formats mining artifacts as readable candidate rows', () => {
  const view = getWorkflowArtifactView({
    nodeId: 'mine',
    type: 'jsonl',
    rows: [
      { keyword: '纯银项链', localScore: 82, reason: '搜索人气高', source: 'hybrid' },
      { word: '珍珠耳环', score: 71, reason: '竞争较低' }
    ]
  });

  assert.equal(view.kind, 'candidate-list');
  assert.equal(view.emptyText, '暂无候选词');
  assert.deepEqual(view.rows.map((row) => row.title), ['纯银项链', '珍珠耳环']);
  assert.match(view.rows[0].meta, /评分 82/);
  assert.match(view.rows[0].meta, /hybrid/);
  assert.equal(view.rows[0].description, '搜索人气高');
});

test('getWorkflowArtifactView formats verified keyword artifacts as metric rows', () => {
  const view = getWorkflowArtifactView({
    nodeId: 'verify',
    type: 'jsonl',
    rows: [
      {
        keyword: '纯银项链',
        score: 88,
        status: 'verified',
        sycmData: { searchPopularity: 3200, demandSupplyRatio: 2.4, clickRate: 0.18 }
      }
    ]
  });

  assert.equal(view.kind, 'business-list');
  assert.equal(view.title, '验真通过词');
  assert.equal(view.rows[0].title, '纯银项链');
  assert.match(view.rows[0].meta, /评分 88/);
  assert.match(view.rows[0].metrics.join(' · '), /搜索人气 3200/);
  assert.match(view.rows[0].metrics.join(' · '), /供需比 2.4/);
});

test('getWorkflowArtifactView formats generated products as product rows', () => {
  const view = getWorkflowArtifactView({
    nodeId: 'generate',
    type: 'jsonl',
    rows: [
      {
        keyword: '纯银项链',
        title: '纯银项链女轻奢高级感',
        productTitle: 'S925纯银项链女',
        price: '18.8',
        sales: 1200,
        reason: '价格带合适'
      }
    ]
  });

  assert.equal(view.kind, 'business-list');
  assert.equal(view.title, '标题货源');
  assert.equal(view.rows[0].title, '纯银项链女轻奢高级感');
  assert.match(view.rows[0].meta, /纯银项链/);
  assert.match(view.rows[0].metrics.join(' · '), /价格 18.8/);
  assert.match(view.rows[0].metrics.join(' · '), /销量 1200/);
});

test('getWorkflowArtifactView formats distribution batches as submit rows', () => {
  const view = getWorkflowArtifactView({
    nodeId: 'export',
    type: 'text',
    text: [
      'https://detail.1688.com/offer/1.html\t纯银项链女轻奢高级感\t18.8',
      'https://detail.1688.com/offer/2.html\t珍珠耳环女高级感\t12.5'
    ].join('\n')
  });

  assert.equal(view.kind, 'business-list');
  assert.equal(view.title, '待确认铺货清单');
  assert.deepEqual(view.rows.map((row) => row.title), ['纯银项链女轻奢高级感', '珍珠耳环女高级感']);
  assert.match(view.rows[0].description, /offer\/1/);
});

test('getWorkflowArtifactView treats start nodes as no-artifact nodes', () => {
  const view = getWorkflowArtifactView(null, 'start');

  assert.equal(view.kind, 'none');
  assert.equal(view.emptyText, '开始节点没有产物。');
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
