export const PIPELINE_STATUS_LABEL = {
  created: '已创建',
  mined: '已挖词',
  mining_manual_action_required: '灵感选词需人工处理',
  mining_empty: '灵感选词无结果',
  awaiting_keyword_review: '等待人工筛词',
  keywords_reviewed: '已完成人工筛词',
  keyword_review_empty: '筛词无通过项',
  verified: '已验真',
  verified_empty: '验真无结果',
  verified_no_generation_eligible: '无可生成词',
  verified_partial_manual_required: '部分需人工处理',
  products_selected: '已选货源',
  select_failed: '选品失败',
  generated: '已生成标题',
  generate_failed: '生成失败',
  export_empty: '导出为空',
  needs_review: '待铺货复核',
  ready_to_distribute: '待确认铺货',
  awaiting_user_confirmation: '等待确认',
  submitted: '已提交',
  workflow_complete: '流程完成',
  manual_action_required: '需要人工处理',
  failed: '失败',
  cancelled: '已取消',
  running: '运行中',
  blocked: '已阻塞',
  ready: '正常',
  platform_cooling_down: '平台冷却中',
  platform_queued: '平台排队中',
  rate_limited: '平台限流',
  slider_required: '需要滑块验证',
  login_required: '需要重新登录',
  permission_required: '权限不足',
  sycm_feature_required: '生意参谋权限不足',
  transient_failure: '临时失败',
  idle: '等待中',
  completed: '已完成',
  waiting_manual: '等待人工',
  retryable: '待重试',
  paused: '已暂停',
  unknown: '未知'
};

export const PIPELINE_STAGE_LABEL = {
  seed: '种子准备',
  candidate: '候选词',
  mined: '已挖词',
  keyword_review: '人工筛词',
  verified: '大盘验真',
  selected: '货源选品',
  generated: '标题生成',
  review: '铺货复核',
  ready: '待铺货',
  pending_review: '待确认铺货',
  submitted: '已提交',
  unknown: '未知阶段'
};

export const PIPELINE_COUNT_LABEL = {
  candidates: '候选词',
  keywordReviewApproved: '筛词通过',
  keywordReviewRejected: '筛词筛除',
  sycmVerified: '验真通过',
  sycmRejected: '验真拒绝',
  selectedProducts: '已选货源',
  generatedProducts: '生成记录',
  readyToDistribute: '待铺货'
};

export const NEXT_ACTION_LABEL = {
  ready_to_distribute: '确认铺货清单',
  review_required: '处理铺货复核',
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
  if (/flow review\b/.test(command)) return '人工筛词';
  if (/flow verify\b/.test(command)) return '执行大盘验真';
  if (/flow select\b/.test(command)) return '执行货源选品';
  if (/flow generate\b/.test(command)) return '生成标题';
  if (/flow export\b/.test(command)) return '导出铺货清单';
  if (/distribute\b/.test(command)) return '确认铺货清单';
  if (/workflow resume\b/.test(command)) return '确认后继续提交';
  if (/^Review\b/.test(command)) return '查看铺货复核';
  if (run.userMessage && !/[A-Za-z]{3,}/.test(run.userMessage)) return run.userMessage;
  return '流程记录已更新，可继续从工作台处理。';
}
