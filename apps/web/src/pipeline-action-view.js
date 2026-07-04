import { labelPipelineStatus } from './pipeline-labels.js';

const DEFAULT_ACTION = {
  label: '查看当前流程',
  targetTab: 'dashboard',
  step: '',
  tone: 'default',
  description: '流程记录已更新，可以从工作台查看当前状态。'
};

export function getPipelineActionView(run = {}) {
  const status = String(run.status || '').toLowerCase();
  const stage = String(run.stage || '').toLowerCase();
  if (!run || !run.runId) {
    return {
      label: '启动每日流程',
      targetTab: 'dashboard',
      step: 'start',
      tone: 'default',
      description: '还没有当前流程，先从工作台启动每日选品。'
    };
  }
  if (status === 'created' || stage === 'seed') {
    return {
      label: '开始挖词',
      targetTab: 'mine',
      step: 'mine',
      tone: 'default',
      description: '流程已创建，下一步是生成候选关键词。'
    };
  }
  if (status === 'mined' || stage === 'mined' || stage === 'candidate') {
    return {
      label: '执行大盘验真',
      targetTab: 'mine',
      step: 'verify',
      tone: 'default',
      description: '候选词已经准备好，下一步需要用生意参谋等指标验真。'
    };
  }
  if (status === 'verified' || stage === 'verified') {
    return {
      label: '生成标题货源',
      targetTab: 'title',
      step: 'generate',
      tone: 'default',
      description: '已有通过验真的关键词，可以进入标题和货源生成。'
    };
  }
  if (status === 'generated' || stage === 'generated') {
    return {
      label: '查看标题货源',
      targetTab: 'title',
      step: 'export',
      tone: 'default',
      description: '标题和货源已生成，可以检查商品并加入复核。'
    };
  }
  if (status === 'needs_review' || stage === 'review') {
    return {
      label: '处理人工复核',
      targetTab: 'dashboard',
      step: 'review',
      tone: 'warn',
      description: '存在需要人工确认的标题、货源或风险项。'
    };
  }
  if (status === 'ready_to_distribute' || status === 'awaiting_user_confirmation' || stage === 'ready') {
    return {
      label: '确认铺货清单',
      targetTab: 'dashboard',
      step: 'submit',
      tone: 'warn',
      description: '铺货清单已准备好，提交前需要人工确认。'
    };
  }
  if (status === 'workflow_complete' || status === 'submitted' || stage === 'submitted') {
    return {
      label: '查看已提交结果',
      targetTab: 'dashboard',
      step: '',
      tone: 'success',
      description: '当前流程已经提交完成，可以查看批次记录。'
    };
  }
  if (status === 'manual_action_required' || status === 'verified_partial_manual_required' || status === 'verified_empty') {
    return {
      label: '处理验真阻塞',
      targetTab: 'mine',
      step: 'verify',
      tone: 'warn',
      description: '验真阶段需要人工处理或更换候选词。'
    };
  }
  return {
    ...DEFAULT_ACTION,
    description: `${labelPipelineStatus(status)}，可以从工作台查看当前状态。`
  };
}

export function getPipelineSummaryText(run = null) {
  if (!run || !run.runId) return '暂无当前流程';
  const counts = run.counts || {};
  return [
    `候选词 ${counts.candidates || 0} 个`,
    `验真通过 ${counts.sycmVerified || 0} 个`,
    `标题货源 ${counts.generatedProducts || 0} 个`
  ].join(' · ');
}

export function normalizeVerifiedKeywordForTitle(row = {}) {
  const score = Number(row.sycmScore?.score ?? row.localScore ?? row.score ?? 0);
  return {
    ...row,
    keyword: String(row.keyword || row.word || '').trim(),
    localScore: Number.isFinite(score) && score > 0 ? score : 80,
    source: row.source || 'pipeline_verified',
    gateStatus: 'verified',
    gateReason: row.sycmScore?.reason || row.reason || '当前流程已验真',
    canDistribute: true,
    sycmData: row.sycmData || row.market || {}
  };
}
