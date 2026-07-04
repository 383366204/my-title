export const PIPELINE_STATUS_LABEL = {
  created: '已创建',
  mined: '已挖词',
  verified: '已验真',
  verified_empty: '验真无结果',
  verified_partial_manual_required: '部分需人工处理',
  generated: '已生成标题',
  generate_failed: '生成失败',
  export_empty: '导出为空',
  needs_review: '待人工复核',
  ready_to_distribute: '待确认铺货',
  awaiting_user_confirmation: '等待确认',
  submitted: '已提交',
  workflow_complete: '流程完成',
  manual_action_required: '需要人工处理',
  failed: '失败',
  cancelled: '已取消',
  running: '运行中',
  blocked: '已阻塞',
  unknown: '未知'
};

export const PIPELINE_STAGE_LABEL = {
  seed: '种子准备',
  candidate: '候选词',
  mined: '已挖词',
  verified: '大盘验真',
  generated: '标题货源',
  review: '人工复核',
  ready: '待铺货',
  pending_review: '待确认铺货',
  submitted: '已提交',
  unknown: '未知阶段'
};

export const PIPELINE_COUNT_LABEL = {
  candidates: '候选词',
  sycmVerified: '验真通过',
  sycmRejected: '验真拒绝',
  generatedProducts: '标题货源',
  readyToDistribute: '待铺货'
};

export const NEXT_ACTION_LABEL = {
  ready_to_distribute: '确认铺货清单',
  review_required: '处理人工复核',
  manual_action_required: '完成人工处理',
  fix_blockers: '处理阻塞项',
  confirm_before_submit: '确认后提交',
  submit_ready: '准备提交铺货',
  sycm_query_complete: '继续选品或生成标题'
};

export function labelPipelineStatus(status) {
  return PIPELINE_STATUS_LABEL[String(status || 'unknown')] || String(status || '未知');
}

export function labelPipelineStage(stage) {
  return PIPELINE_STAGE_LABEL[String(stage || 'unknown')] || String(stage || '未知阶段');
}

export function labelPipelineCount(key) {
  return PIPELINE_COUNT_LABEL[key] || key;
}

export function labelNextAction(run = {}) {
  const code = String(run.nextActionCode || '');
  if (NEXT_ACTION_LABEL[code]) return NEXT_ACTION_LABEL[code];
  const command = String(run.nextCommand || run.userMessage || '');
  if (/flow mine\b/.test(command)) return '开始挖词';
  if (/flow verify\b/.test(command)) return '执行大盘验真';
  if (/flow generate\b/.test(command)) return '生成标题货源';
  if (/flow export\b/.test(command)) return '导出铺货清单';
  if (/distribute\b/.test(command)) return '确认铺货清单';
  if (/workflow resume\b/.test(command)) return '确认后继续提交';
  if (/^Review\b/.test(command)) return '查看复核报告';
  if (run.userMessage && !/[A-Za-z]{3,}/.test(run.userMessage)) return run.userMessage;
  return '流程记录已更新，可继续从工作台处理。';
}
