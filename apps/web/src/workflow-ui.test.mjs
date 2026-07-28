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
  buildWorkflowDeleteRunRequest,
  getWorkflowTemplateView,
  labelWorkflowNodeStatus,
  getWorkflowRunActiveNodeId,
  getUnifiedWorkflowHistoryItem,
  getPipelineFirstNavItems,
  getWorkflowNodeIdForLegacyTarget,
  getPipelineFirstActionTarget,
  getWorkflowNodePanelKind,
  getWorkflowNodeSuccessLabel,
  getWorkflowNodeResultLocation,
  getWorkflowResultSummaryView
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
  assert.equal(mapPipelineStageToFunnel('keyword_review'), 'candidate');
  assert.equal(mapPipelineStageToFunnel('verified'), 'verified');
  assert.equal(mapPipelineStageToFunnel('selected'), 'selected');
  assert.equal(mapPipelineStageToFunnel('generated'), 'generated');
  assert.equal(mapPipelineStageToFunnel('review'), 'pending_review');
  assert.equal(mapPipelineStageToFunnel('ready'), 'pending_review');
  assert.equal(mapPipelineStageToFunnel('submitted'), 'submitted');
  assert.equal(mapPipelineStageToFunnel('unknown'), 'candidate');
});

test('pipeline labels localize status, stage, counts, and next commands', () => {
  assert.equal(labelPipelineStatus('verified_empty'), '验真无结果');
  assert.equal(labelPipelineStatus('awaiting_keyword_review'), '等待人工筛词');
  assert.equal(labelPipelineStatus('ready_to_distribute'), '待确认铺货');
  assert.equal(labelPipelineStage('keyword_review'), '人工筛词');
  assert.equal(labelPipelineStage('verified'), '大盘验真');
  assert.equal(labelPipelineCount('keywordReviewApproved'), '筛词通过');
  assert.equal(labelPipelineCount('sycmVerified'), '验真通过');
  assert.equal(labelPipelineCount('generatedProducts'), '生成记录');
  assert.equal(labelPipelineCount('selectedProducts'), '已选货源');
  assert.equal(labelNextAction({
    nextCommand: 'node bin/cli.js flow review --run 2026-07-01-212255 --json'
  }), '人工筛词');
  assert.equal(labelNextAction({
    nextCommand: 'node bin/cli.js flow select --run 2026-07-01-212255 --json'
  }), '执行货源选品');
  assert.equal(labelNextAction({
    nextCommand: 'node bin/cli.js flow generate --run 2026-07-01-212255 --json'
  }), '生成标题');
});

test('getPipelineActionView returns one primary CTA per pipeline stage', () => {
  assert.equal(getPipelineActionView(null).label, '启动每日流程');
  assert.deepEqual(getPipelineActionView({ runId: 'run_1', status: 'mined', stage: 'mined' }), {
    label: '人工筛词',
    targetTab: 'workflow',
    step: 'keywordReview',
    tone: 'default',
    description: '候选词已经准备好，先人工筛除明显不适合的词，再进入生意参谋校验。'
  });

  assert.deepEqual(getPipelineActionView({ runId: 'run_1', status: 'keywords_reviewed', stage: 'keyword_review' }), {
    label: '执行大盘验真',
    targetTab: 'workflow',
    step: 'verify',
    tone: 'default',
    description: '人工筛词已完成，下一步用生意参谋等指标验真。'
  });

  assert.deepEqual(getPipelineActionView({ runId: 'run_1', status: 'verified', stage: 'verified' }), {
    label: '执行货源选品',
    targetTab: 'workflow',
    step: 'select',
    tone: 'default',
    description: '已有通过验真的关键词，下一步先搜索并筛选可用货源。'
  });

  assert.deepEqual(getPipelineActionView({ runId: 'run_1', status: 'products_selected', stage: 'selected' }), {
    label: '生成标题',
    targetTab: 'workflow',
    step: 'generate',
    tone: 'default',
    description: '货源已筛选完成，可以基于已选货源生成铺货标题。'
  });

  assert.equal(getPipelineActionView({ runId: 'run_1', status: 'needs_review', stage: 'review' }).tone, 'warn');
  assert.equal(getPipelineActionView({ runId: 'run_1', status: 'ready_to_distribute', stage: 'ready' }).label, '确认铺货清单');
  assert.deepEqual(getPipelineActionView({ runId: 'run_1', status: 'verified_empty', stage: 'verified' }), {
    label: '处理验真阻塞',
    targetTab: 'workflow',
    step: 'verify',
    tone: 'warn',
    description: '验真阶段需要人工处理或更换候选词。'
  });
});

test('getPipelineFirstNavItems exposes only the pipeline workspace by default', () => {
  const navItems = getPipelineFirstNavItems();

  assert.deepEqual(navItems, [
    { id: 'workflow', label: '选品流水线' }
  ]);
  assert.equal(navItems.some((item) => item.id === 'dashboard'), false);
  assert.equal(navItems.some((item) => item.id === 'mine'), false);
  assert.equal(navItems.some((item) => item.id === 'title'), false);
});

test('getWorkflowNodeIdForLegacyTarget maps old pages to pipeline nodes', () => {
  assert.equal(getWorkflowNodeIdForLegacyTarget('dashboard'), 'review');
  assert.equal(getWorkflowNodeIdForLegacyTarget('mine'), 'mine');
  assert.equal(getWorkflowNodeIdForLegacyTarget('title'), 'generate');
  assert.equal(getWorkflowNodeIdForLegacyTarget('workflow'), '');
  assert.equal(getWorkflowNodeIdForLegacyTarget('unknown'), '');
});

test('getPipelineFirstActionTarget converts old next actions to node selection intents', () => {
  assert.deepEqual(getPipelineFirstActionTarget({ targetTab: 'mine', step: 'verify' }), {
    type: 'select-node',
    nodeId: 'verify'
  });
  assert.deepEqual(getPipelineFirstActionTarget({ targetTab: 'title', step: 'generate' }), {
    type: 'select-node',
    nodeId: 'generate'
  });
  assert.deepEqual(getPipelineFirstActionTarget({ targetTab: 'dashboard', step: 'review' }), {
    type: 'select-node',
    nodeId: 'review'
  });
  assert.deepEqual(getPipelineFirstActionTarget({ targetTab: 'workflow' }), {
    type: 'workspace',
    nodeId: ''
  });
});

test('getPipelineFirstActionTarget selects mine node for mine-more recovery', () => {
  assert.deepEqual(getPipelineFirstActionTarget({ targetTab: 'mine', step: 'mine' }), {
    type: 'select-node',
    nodeId: 'mine'
  });
});

test('getPipelineFirstActionTarget selects workflow nodes when actions stay in workflow workspace', () => {
  assert.deepEqual(getPipelineFirstActionTarget({ targetTab: 'workflow', step: 'keywordReview' }), {
    type: 'select-node',
    nodeId: 'keywordReview'
  });
  assert.deepEqual(getPipelineFirstActionTarget({ targetTab: 'workflow', step: 'verify' }), {
    type: 'select-node',
    nodeId: 'verify'
  });
  assert.deepEqual(getPipelineFirstActionTarget({ targetTab: 'workflow', step: 'review' }), {
    type: 'select-node',
    nodeId: 'review'
  });
});

test('getWorkflowNodePanelKind maps production nodes to embedded panels', () => {
  assert.equal(getWorkflowNodePanelKind('start'), 'start-config');
  assert.equal(getWorkflowNodePanelKind('mine'), 'keyword-mining');
  assert.equal(getWorkflowNodePanelKind('keywordReview'), 'keyword-review');
  assert.equal(getWorkflowNodePanelKind('verify'), 'sycm-verify');
  assert.equal(getWorkflowNodePanelKind('select'), 'product-select');
  assert.equal(getWorkflowNodePanelKind('generate'), 'title-generate');
  assert.equal(getWorkflowNodePanelKind('export'), 'distribution-export');
  assert.equal(getWorkflowNodePanelKind('review'), 'distribution-export');
  assert.equal(getWorkflowNodePanelKind('end'), 'completion');
  assert.equal(getWorkflowNodePanelKind('other'), 'artifact');
});

test('getPipelineSummaryText summarizes empty and active runs', () => {
  assert.equal(getPipelineSummaryText(null), '暂无当前流程');
  assert.equal(getPipelineSummaryText({
    runId: '2026-07-04-120000',
    status: 'mined',
    counts: { candidates: 12, sycmVerified: 0, generatedProducts: 0 }
  }), '候选词 12 个 · 验真通过 0 个 · 已选货源 0 条 · 生成记录 0 条');
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
    label: '查看标题结果',
    targetTab: 'title',
    tone: 'default'
  });
  assert.deepEqual(getWorkflowAction({ stage: 'ready', requiresUserAction: true }), {
    label: '处理待复核',
    targetTab: 'dashboard',
    tone: 'warn'
  });
});

test('getWorkflowTemplateView explains daily and exact keyword differences', () => {
  assert.deepEqual(getWorkflowTemplateView({
    id: 'daily-selection-v1',
    name: '每日蓝海选品流水线',
    mode: 'daily'
  }), {
    entryLabel: '入口：种子池',
    scenarioLabel: '适合：每天自动发现新机会',
    flowSummary: '流程：选词挖掘 → 人工筛词 → 生意参谋校验 → 货源选品 → 标题生成 → 导出复核',
    modeHint: '从种子池自动扩展候选词，会先执行选词挖掘。'
  });

  assert.deepEqual(getWorkflowTemplateView({
    id: 'exact-keyword-v1',
    name: '精确关键词选品流水线',
    mode: 'keyword'
  }), {
    entryLabel: '入口：手动关键词',
    scenarioLabel: '适合：验证一个明确目标词',
    flowSummary: '流程：输入关键词 → 跳过挖词 → 生意参谋校验 → 货源选品 → 标题生成 → 导出复核',
    modeHint: '使用你输入的关键词，跳过选词挖掘，直接进入生意参谋校验。'
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
  assert.deepEqual(getWorkflowNodeAction('start', { status: 'idle', manualInput: true }), {
    label: '录入词和货源',
    action: 'manual-input',
    tone: 'warn'
  });
  assert.deepEqual(getWorkflowNodeAction('select', { status: 'completed', manualDirectInput: true, output: { failed: 1 } }), {
    label: '重试失败项',
    action: 'retry-node',
    tone: 'warn'
  });
  assert.deepEqual(getWorkflowNodeAction('keywordReview', 'awaiting_keyword_review'), {
    label: '输入/筛词',
    action: 'keyword-review',
    tone: 'warn'
  });
  assert.deepEqual(getWorkflowNodeAction('export', 'needs_review'), {
    label: '处理铺货复核',
    action: 'open-review',
    tone: 'warn'
  });
  assert.deepEqual(getWorkflowNodeAction('export', 'completed'), {
    label: '查看铺货清单',
    action: 'confirm-distribution',
    tone: 'success'
  });
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

test('getWorkflowNodeSuccessLabel summarizes pipeline output counts', () => {
  assert.equal(getWorkflowNodeSuccessLabel('mine', {
    output: { count: 5, file: '/tmp/candidates.jsonl' }
  }), '成功 5 个候选词');
  assert.equal(getWorkflowNodeSuccessLabel('verify', {
    output: { verified: 3, rejected: 2, file: '/tmp/verified-keywords.jsonl' }
  }), '验真通过 3 个，可生成 3 个，需复核/拒绝 0 个，验真拒绝 2 个');
  assert.equal(getWorkflowNodeSuccessLabel('verify', {
    output: { verified: 3, generationEligible: 1, opportunityReview: 2, rejected: 2 }
  }), '验真通过 3 个，可生成 1 个，需复核/拒绝 2 个，验真拒绝 2 个');
  assert.equal(getWorkflowNodeSuccessLabel('select', {
    output: { count: 8, productCount: 8, file: '/tmp/selected-products.jsonl' }
  }), '选中 8 条货源');
  assert.equal(getWorkflowNodeSuccessLabel('generate', {
    output: { count: 12, file: '/tmp/generated-products.jsonl' }
  }), '12 条标题记录（12 个标题，关联 12 个已选货源）');
});

test('getWorkflowNodeResultLocation exposes artifact paths for completed nodes', () => {
  assert.equal(getWorkflowNodeResultLocation('mine', {
    output: { count: 5, file: '/tmp/candidates.jsonl' }
  }), '/tmp/candidates.jsonl');
  assert.equal(getWorkflowNodeResultLocation('verify', {
    output: { verified: 3, file: '/tmp/verified-keywords.jsonl' }
  }), '/tmp/verified-keywords.jsonl');
  assert.equal(getWorkflowNodeResultLocation('generate', {
    output: { count: 12, file: '/tmp/generated-products.jsonl' }
  }), '/tmp/generated-products.jsonl');
  assert.equal(getWorkflowNodeResultLocation('select', {
    output: { count: 8, file: '/tmp/selected-products.jsonl' }
  }), '/tmp/selected-products.jsonl');
  assert.equal(getWorkflowNodeResultLocation('export', {
    output: { count: 8, batchFile: '/tmp/distribution-batch.txt' }
  }), '铺货清单：/tmp/distribution-batch.txt');
  assert.equal(getWorkflowNodeResultLocation('export', {
    output: { count: 0, batchFile: '/tmp/distribution-batch.txt', reviewFile: '/tmp/distribution-review.md' }
  }), '铺货清单：/tmp/distribution-batch.txt\n复核报告：/tmp/distribution-review.md');
});

test('getWorkflowResultSummaryView explains count, location, and next action', () => {
  assert.deepEqual(getWorkflowResultSummaryView('generate', {
    status: 'completed',
    output: { count: 48, titleCount: 48, sourceCount: 47, file: '/tmp/generated-products.jsonl' }
  }), {
    title: '标题生成结果',
    statusLabel: '已完成',
    countLabel: '48 条标题记录（48 个标题，关联 47 个已选货源）',
    locationLabel: '/tmp/generated-products.jsonl',
    hint: '每条标题记录会关联已选货源；完整内容保存在 generated-products.jsonl。',
    primaryActionLabel: '查看标题结果',
    empty: false
  });

  assert.equal(getWorkflowResultSummaryView('verify', {
    status: 'blocked',
    output: { verified: 0, rejected: 5, file: '/tmp/verified-keywords.jsonl' }
  }).countLabel, '验真通过 0 个，可生成 0 个，需复核/拒绝 0 个，验真拒绝 5 个');
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

test('getWorkflowNodeDetailRows lists success count and artifact location from output', () => {
  const rows = getWorkflowNodeDetailRows({
    id: 'verify',
    data: {
      status: 'completed',
      output: {
        verified: 3,
        rejected: 2,
        file: '/tmp/verified-keywords.jsonl'
      }
    }
  });

  assert.equal(rows.find((row) => row.label === '成功数量').value, '验真通过 3 个，可生成 3 个，需复核/拒绝 0 个，验真拒绝 2 个');
  assert.equal(rows.find((row) => row.label === '产物位置').value, '/tmp/verified-keywords.jsonl');
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

test('getWorkflowNodeDetailRows infers verified-empty blocker details from verify output', () => {
  const rows = getWorkflowNodeDetailRows({
    id: 'verify',
    data: {
      status: 'blocked',
      output: { verified: 0, rejected: 5 },
      progress: { current: 1, total: 1, percent: 100, message: '完成' }
    }
  });

  assert.equal(rows.find((row) => row.label === '阻塞原因').value, '验真无结果');
  assert.match(rows.find((row) => row.label === '处理建议').value, /生意参谋验真没有通过词/);
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
  assert.deepEqual(buildWorkflowOperationRequest('run-20260707-120000', 'mine-more', 'verify'), {
    endpoint: '/api/workflows/runs/run-20260707-120000/retry-node',
    body: { nodeId: 'mine' }
  });
  assert.deepEqual(buildWorkflowOperationRequest('run-20260707-120000', 'start-sycm-chrome', 'verify'), {
    endpoint: '/api/workflows/sycm/chrome/start',
    body: { runId: 'run-20260707-120000', nodeId: 'verify' }
  });
});

test('buildWorkflowDeleteRunRequest deletes workflow history through confirmed endpoint', () => {
  assert.deepEqual(buildWorkflowDeleteRunRequest('run-20260707-120000'), {
    endpoint: '/api/workflows/runs/run-20260707-120000',
    options: {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true })
    }
  });
});

test('getWorkflowBlockerActions offers Chrome startup for SYCM browser blockers', () => {
  const actions = getWorkflowBlockerActions('verify', {
    status: 'blocked',
    blocker: 'browser_cdp_unavailable',
    actionHint: 'Chrome CDP 不可用。请先启动带远程调试端口的 Chrome。'
  });

  assert.deepEqual(actions[0], {
    action: 'start-sycm-chrome',
    label: '启动 Chrome',
    description: '打开带调试端口的 Chrome，登录生意参谋后可重新检测或重跑验真。'
  });
  assert.ok(actions.some((action) => action.action === 'retry-node'));
});

test('getWorkflowBlockerActions offers Chrome startup when SYCM reports no Chrome tab', () => {
  const actions = getWorkflowBlockerActions('verify', {
    status: 'blocked',
    error: 'sycm access is cooling down: No Chrome tab found on port 9222',
    nextRecommendedAction: {
      action: 'resume-after-manual',
      label: '我已处理，继续流程'
    }
  });

  assert.deepEqual(actions.map((action) => action.action), ['start-sycm-chrome', 'retry-node']);
  assert.equal(actions[0].label, '启动 Chrome');
});

test('getWorkflowBlockerActions hides stale blocker actions while node is retrying', () => {
  assert.deepEqual(getWorkflowBlockerActions('verify', {
    status: 'retrying',
    blocker: 'browser_cdp_unavailable',
    actionHint: 'Chrome CDP 不可用。'
  }), []);
});

test('running verify node hides stale blocker and result counts from a previous attempt', () => {
  const state = {
    status: 'running',
    blocker: 'verified_empty',
    actionHint: '上一轮没有验真通过词。',
    output: { verified: 0, rejected: 6 },
    progress: { current: 2, total: 6, percent: 33, message: '生意参谋验真 2/6' }
  };
  const view = getWorkflowNodeViewModel('verify', state);
  const rows = getWorkflowNodeDetailRows({ id: 'verify', data: state });

  assert.equal(view.hasBlocker, false);
  assert.equal(view.successLabel, '');
  assert.equal(rows.some((row) => row.label === '阻塞原因'), false);
  assert.equal(rows.some((row) => row.label === '处理建议'), false);
  assert.equal(rows.some((row) => row.label === '成功数量'), false);
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

  assert.equal(getWorkflowRunActiveNodeId({
    nodeStates: {
      export: { status: 'completed' },
      review: { status: 'needs_review' }
    }
  }), 'export');
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
        keywordOpportunity: {
          score: 38,
          decision: 'reject',
          nextAction: 'stop',
          reasons: ['local_high_intent', 'sycm_hot'],
          riskFlags: ['fallback_hot'],
          breakdown: {
            positive: [
              { key: 'local_score', label: '本地挖词质量', value: 31.2 },
              { key: 'sycm_score', label: '生意参谋指标', value: 23.9 }
            ],
            negative: [
              { key: 'fallback_penalty', label: '热搜降级惩罚', value: -12 }
            ],
            gapToContinue: 34
          }
        },
        sycmData: { searchPopularity: 3200, demandSupplyRatio: 2.4, clickRate: 0.18 }
      }
    ]
  });

  assert.equal(view.kind, 'business-list');
  assert.equal(view.title, '验真通过词');
  assert.equal(view.rows[0].title, '纯银项链');
  assert.match(view.rows[0].meta, /评分 88/);
  assert.match(view.rows[0].meta, /决策 停止/);
  assert.match(view.rows[0].metrics.join(' · '), /搜索人气 3200/);
  assert.match(view.rows[0].metrics.join(' · '), /供需比 2.4/);
  assert.match(view.rows[0].metrics.join(' · '), /距生成线还差 34/);
  assert.match(view.rows[0].description, /加分：本地挖词质量 \+31.2/);
  assert.match(view.rows[0].description, /扣分：热搜降级惩罚 -12/);
  assert.match(view.rows[0].description, /建议停止生成/);
});

test('getWorkflowArtifactView formats generated products as product rows', () => {
  const view = getWorkflowArtifactView({
    nodeId: 'generate',
    type: 'jsonl',
    rows: [
      {
        keyword: '纯银项链',
        selectedKeyword: '纯银项链',
        title: '纯银项链女轻奢高级感',
        productTitle: 'S925纯银项链女',
        price: '18.8',
        sales: 1200,
        reason: '价格带合适'
      }
    ]
  });

  assert.equal(view.kind, 'business-list');
  assert.equal(view.title, '标题与货源链接');
  assert.equal(view.rows[0].title, '纯银项链女轻奢高级感');
  assert.match(view.rows[0].meta, /选词 纯银项链/);
  assert.match(view.rows[0].metrics.join(' · '), /选词 纯银项链/);
  assert.match(view.rows[0].metrics.join(' · '), /价格 18.8/);
  assert.match(view.rows[0].metrics.join(' · '), /销量 1200/);
});

test('getWorkflowArtifactView formats generated rows with nested product fields', () => {
  const view = getWorkflowArtifactView({
    nodeId: 'generate',
    type: 'jsonl',
    rows: [
      {
        keyword: '高级感情侣手机壳',
        selectedKeyword: '高级感情侣手机壳',
        title: '高级感情侣手机壳适用苹果16promax',
        product: {
          链接原标题: '史迪仔情侣手机壳',
          商品原价: '2.13',
          '30天销量': 10,
          产品链接: 'https://detail.1688.com/offer/1.html',
          选品理由: '销量稳定'
        }
      }
    ]
  });

  assert.equal(view.kind, 'business-list');
  assert.equal(view.rows[0].title, '高级感情侣手机壳适用苹果16promax');
  assert.match(view.rows[0].meta, /选词 高级感情侣手机壳/);
  assert.match(view.rows[0].meta, /史迪仔情侣手机壳/);
  assert.match(view.rows[0].metrics.join(' · '), /选词 高级感情侣手机壳/);
  assert.match(view.rows[0].metrics.join(' · '), /价格 2.13/);
  assert.match(view.rows[0].metrics.join(' · '), /销量 10/);
  assert.equal(view.rows[0].description, '销量稳定');
});

test('getWorkflowArtifactView formats distribution batches as submit rows', () => {
  const view = getWorkflowArtifactView({
    nodeId: 'export',
    type: 'text',
    text: [
      'https://detail.1688.com/offer/1.html$$纯银项链女轻奢高级感$$饰品 > 项链',
      'https://detail.1688.com/offer/2.html\t珍珠耳环女高级感\t12.5'
    ].join('\n')
  });

  assert.equal(view.kind, 'business-list');
  assert.equal(view.title, '待确认铺货清单');
  assert.deepEqual(view.rows.map((row) => row.title), ['纯银项链女轻奢高级感', '珍珠耳环女高级感']);
  assert.match(view.rows[0].description, /offer\/1/);
  assert.equal(view.rows[0].category, '饰品 > 项链');
  assert.equal(view.rows[0].raw.category, '饰品 > 项链');
});

test('getWorkflowArtifactView formats review markdown as actionable review rows', () => {
  const view = getWorkflowArtifactView({
    nodeId: 'review',
    type: 'text',
    text: [
      '# Distribution Review',
      '',
      '## Recommended Submit',
      '',
      '### 1. 纯银项链',
      '',
      '- Export Status: ready',
      '- Review Reasons: title_ok',
      '- URL: https://detail.1688.com/offer/1.html',
      '- Title: 纯银项链女轻奢高级感',
      '- Category: 饰品 > 项链',
      '- Decision: 严格蓝海，可作为标题核心词',
      '',
      '## Manual Review Candidates',
      '',
      '### 1. 珍珠耳环',
      '',
      '- Export Status: review_candidate',
      '- Review Reasons: hot_keyword_product, missing_category',
      '- URL: https://detail.1688.com/offer/2.html',
      '- Title: 珍珠耳环女高级感',
      '- Category: -',
      '- Risk: 该词不是严格蓝海词，只能证明有热搜趋势，铺货前必须人工确认。',
      '',
      '## Hard Rejected',
      '',
      'No rows.'
    ].join('\n')
  });

  assert.equal(view.kind, 'review-list');
  assert.equal(view.title, '铺货复核');
  assert.equal(view.rows.length, 2);
  assert.equal(view.rows[0].group, 'recommended');
  assert.equal(view.rows[0].title, '纯银项链女轻奢高级感');
  assert.equal(view.rows[0].category, '饰品 > 项链');
  assert.equal(view.rows[1].group, 'manual');
  assert.match(view.rows[1].reason, /missing_category/);
  assert.match(view.rows[1].risk, /不是严格蓝海词/);
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

test('getWorkflowLaunchBlocker requires keyword-bound 1688 items for manual mode', () => {
  const missing = getWorkflowLaunchBlocker('manual', [
    { id: 'start', type: 'production-start', data: { defaultKeyword: '法式连衣裙', items: [] } }
  ]);
  const ready = getWorkflowLaunchBlocker('manual', [
    {
      id: 'start',
      type: 'production-start',
      data: {
        defaultKeyword: '法式连衣裙',
        items: [{ keyword: '', url: 'https://detail.1688.com/offer/123456.html' }]
      }
    }
  ]);

  assert.equal(missing.status, 'blocked');
  assert.match(missing.error, /1688 商品链接/);
  assert.equal(ready, null);
});
