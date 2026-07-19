import { labelPipelineStatus } from './pipeline-labels.js';

const DEFAULT_ACTION = {
  label: '查看当前流程',
  targetTab: 'workflow',
  step: '',
  tone: 'default',
  description: '流程记录已更新，可以在选品流水线中查看当前状态。'
};

export function getPipelineActionView(run = null) {
  if (!run || !run.runId) {
    return {
      label: '启动每日流程',
      targetTab: 'workflow',
      step: 'start',
      tone: 'default',
      description: '还没有当前流程，先在流水线开始节点启动每日选品。'
    };
  }
  const status = String(run.status || '').toLowerCase();
  const stage = String(run.stage || '').toLowerCase();
  if (status === 'created' || stage === 'seed') {
    return {
      label: '开始挖词',
      targetTab: 'workflow',
      step: 'mine',
      tone: 'default',
      description: '流程已创建，下一步是生成候选关键词。'
    };
  }
  if (status === 'mined' || stage === 'mined' || stage === 'candidate') {
    return {
      label: '人工筛词',
      targetTab: 'workflow',
      step: 'keywordReview',
      tone: 'default',
      description: '候选词已经准备好，先人工筛除明显不适合的词，再进入生意参谋校验。'
    };
  }
  if (status === 'keywords_reviewed') {
    return {
      label: '执行大盘验真',
      targetTab: 'workflow',
      step: 'verify',
      tone: 'default',
      description: '人工筛词已完成，下一步用生意参谋等指标验真。'
    };
  }
  if (status === 'awaiting_keyword_review' || status === 'keyword_review_empty' || stage === 'keyword_review') {
    return {
      label: '处理人工筛词',
      targetTab: 'workflow',
      step: 'keywordReview',
      tone: status === 'keyword_review_empty' ? 'warn' : 'default',
      description: '确认保留的关键词后，再进入生意参谋校验。'
    };
  }
  if (status === 'manual_action_required' || status === 'verified_partial_manual_required' || status === 'verified_empty' || status === 'verified_no_generation_eligible') {
    return {
      label: '处理验真阻塞',
      targetTab: 'workflow',
      step: 'verify',
      tone: 'warn',
      description: '验真阶段需要人工处理或更换候选词。'
    };
  }
  if (status === 'verified' || stage === 'verified') {
    return {
      label: '执行货源选品',
      targetTab: 'workflow',
      step: 'select',
      tone: 'default',
      description: '已有通过验真的关键词，下一步先搜索并筛选可用货源。'
    };
  }
  if (status === 'products_selected' || stage === 'selected') {
    return {
      label: '生成标题',
      targetTab: 'workflow',
      step: 'generate',
      tone: 'default',
      description: '货源已筛选完成，可以基于已选货源生成铺货标题。'
    };
  }
  if (status === 'generated' || stage === 'generated') {
    return {
      label: '查看标题结果',
      targetTab: 'workflow',
      step: 'export',
      tone: 'default',
      description: '标题已生成，可以进入铺货复核检查清单。'
    };
  }
  if (status === 'needs_review' || stage === 'review') {
    return {
      label: '处理铺货复核',
      targetTab: 'workflow',
      step: 'export',
      tone: 'warn',
      description: '存在需要人工确认的标题、货源或风险项。'
    };
  }
  if (status === 'ready_to_distribute' || status === 'awaiting_user_confirmation' || stage === 'ready') {
    return {
      label: '确认铺货清单',
      targetTab: 'workflow',
      step: 'submit',
      tone: 'warn',
      description: '铺货清单已准备好，提交前需要人工确认。'
    };
  }
  if (status === 'workflow_complete' || status === 'submitted' || stage === 'submitted') {
    return {
      label: '查看已提交结果',
      targetTab: 'workflow',
      step: '',
      tone: 'success',
      description: '当前流程已经提交完成，可以查看批次记录。'
    };
  }
  return {
    ...DEFAULT_ACTION,
    description: `${labelPipelineStatus(status)}，可以在选品流水线中查看当前状态。`
  };
}

export function getPipelineSummaryText(run = null) {
  if (!run || !run.runId) return '暂无当前流程';
  const counts = run.counts || {};
  return [
    `候选词 ${counts.candidates || 0} 个`,
    `验真通过 ${counts.sycmVerified || 0} 个`,
    `已选货源 ${counts.selectedProducts || 0} 条`,
    `生成记录 ${counts.generatedProducts || 0} 条`
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
