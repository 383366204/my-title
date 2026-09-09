import { getCanvasNodeTone, getWorkflowNodeAction } from "./workflow-node-actions.js";
import { parseCompetitorShareInputs, parseRootKeywords } from "./workflow-launch-params.js";

const ORDER_SHEET_DATE_LABELS = {
  latest_day: "最近可用单日",
  last_7_days: "最近 7 天",
  last_30_days: "最近 30 天",
  custom: "自定义日期"
};

const ORDER_SHEET_SORT_LABELS = {
  itmUv: "商品访客数",
  payAmt: "支付金额",
  payItmCnt: "支付件数",
  itemCartCnt: "商品加购件数",
  sucRefundAmt: "成功退款金额"
};

export function labelWorkflowNodeStatus(status) {
  const normalized = String(status || '').toLowerCase();
  const labels = {
    idle: '未开始',
    pending: '等待启动',
    running: '运行中',
    resuming: '继续中',
    retrying: '重试中',
    completed: '已完成',
    paused: '已暂停',
    waiting_manual: '等待人工处理',
    waiting_confirmation: '等待确认',
    needs_review: '等待复核',
    retryable: '待重试',
    ready: '待铺货',
    blocked: '已阻塞',
    failed: '失败',
    cancelled: '已取消'
  };
  return labels[normalized] || '未知状态';
}

export function getWorkflowBlockerView(state = {}) {
  const status = String(state.status || '').toLowerCase();
  const blocker = String(state.blocker || '').toLowerCase();
  const error = String(state.error || '').trim();
  const actionHint = String(state.actionHint || '').trim();
  const cooldown = Number(state.cooldownRemainingMs || 0);

  if (cooldown > 0) {
    return {
      title: '请求冷却中',
      message: `平台请求频率受限，约 ${Math.ceil(cooldown / 1000)} 秒后可继续。`
    };
  }
  if (['pending', 'running', 'retrying', 'resuming'].includes(status)) return null;
  if (status === 'waiting_manual' || /login|slider|captcha|manual|sycm|taobao|1688/.test(blocker)) {
    return {
      title: '需要人工处理',
      message: actionHint || error || '请处理平台登录、滑块或授权后继续流程。'
    };
  }
  if (status === 'retryable') {
    return {
      title: '可以重试',
      message: error || actionHint || '该节点失败但可以从当前节点重试。'
    };
  }
  if (status === 'blocked' || status === 'failed') {
    return {
      title: status === 'failed' ? '执行失败' : '流程阻塞',
      message: error || actionHint || state.blocker || '请查看节点详情后处理。'
    };
  }
  return null;
}

export function getCompetitorConfigSummary(state = {}) {
  const parsed = parseCompetitorShareInputs(state.competitorText || '');
  const hotLimit = Math.max(5, Math.min(50, Number.parseInt(state.hotLimit, 10) || 20));
  const newLimit = Math.max(5, Math.min(50, Number.parseInt(state.newLimit, 10) || 20));
  const detailLimit = Math.max(0, Math.min(20, Number.parseInt(state.detailLimit, 10) || 0));
  return parsed.links.length > 0
    ? `${parsed.links.length} 条同行链接 · 爆款 ${hotLimit}/店 · 新品 ${newLimit}/店 · 链接 ${detailLimit}/榜`
    : '尚未录入同行链接';
}

export function getRootKeywordConfigSummary(state = {}) {
  const roots = parseRootKeywords(state.rootsText ?? state.roots);
  const profile = state.sycmRiskProfile === 'conservative' ? '保守节奏' : state.sycmRiskProfile === 'custom' ? '自定义节奏' : '标准节奏';
  return roots.length > 0 ? `${roots.length} 个词根 · ${profile} · 串行查询` : '尚未录入词根';
}

/**
 * 格式化刷单表流水线的采集条件，供开始节点回显。
 * @param {object} state 开始节点配置。
 * @returns {string} 日期、页数和排序指标摘要。
 */
export function getOrderSheetConfigSummary(state = {}) {
  const dateMode = String(state.dateMode || 'latest_day');
  const dateLabel = dateMode === 'custom' && state.startDate && state.endDate
    ? `${state.startDate} 至 ${state.endDate}`
    : ORDER_SHEET_DATE_LABELS[dateMode] || ORDER_SHEET_DATE_LABELS.latest_day;
  const pages = Math.max(1, Math.min(5, Number.parseInt(state.pages, 10) || 1));
  const sortLabel = ORDER_SHEET_SORT_LABELS[state.sortMetric] || ORDER_SHEET_SORT_LABELS.itmUv;
  return `${dateLabel} · ${pages} 页 · ${sortLabel}降序`;
}

/**
 * 格式化生成业务表格节点的输出配置。
 * @param {object} state 制表节点配置。
 * @returns {string} 表格类型、数量和关键版式摘要。
 */
export function getSheetConfigSummary(state = {}) {
  const sheetType = state.sheetType === 'review' ? 'review' : 'order';
  const limit = Math.max(0, Number.parseInt(state.productLimit, 10) || 0);
  const countLabel = limit > 0 ? `${limit} 个商品` : '全部商品';
  if (sheetType === 'review') {
    if (state.reviewSourceUpload === true) return '评价表 · 按上传订单组';
    const groupSize = [1, 2, 4].includes(Number(state.reviewGroupSize)) ? Number(state.reviewGroupSize) : 4;
    return `评价表 · ${countLabel} · ${groupSize} 个/组`;
  }
  const amountLabel = {
    average: '平均实付',
    payment: '支付金额',
    blank: '金额留空'
  }[state.amountMode] || '平均实付';
  return `刷单表 · ${countLabel} · ${amountLabel}${state.includeImages === false ? ' · 无主图' : ''}`;
}

export function getWorkflowNodeSuccessLabel(nodeId, state = {}) {
  const output = state.output && typeof state.output === 'object' ? state.output : {};
  const normalized = String(nodeId || '');
  if (normalized === 'mine') {
    const count = Number(output.count ?? state.count ?? 0);
    return count > 0 ? `成功 ${count} 个候选词` : '';
  }
  if (normalized === 'keywordReview') {
    const approved = Number(output.approved ?? state.approved ?? 0);
    const rejected = Number(output.rejected ?? state.rejected ?? 0);
    const pending = Number(output.pending ?? state.pending ?? 0);
    if (approved > 0 || rejected > 0) return `通过 ${approved} 个，筛除 ${rejected} 个`;
    if (pending > 0) return `待筛选 ${pending} 个候选词`;
    return '';
  }
  if (normalized === 'verify') {
    const verified = Number(output.verified ?? output.count ?? state.verified ?? 0);
    const rejected = Number(output.rejected ?? state.rejected ?? 0);
    const generationEligible = Number(output.generationEligible ?? verified);
    const opportunityReview = Number(output.opportunityReview ?? Math.max(0, verified - generationEligible));
    if (verified > 0 || rejected > 0) {
      return `验真通过 ${verified} 个，可生成 ${generationEligible} 个，需复核/拒绝 ${opportunityReview} 个，验真拒绝 ${rejected} 个`;
    }
    return '';
  }
  if (normalized === 'generate') {
    const count = Number(output.count ?? state.count ?? 0);
    const titleCount = Number(output.titleCount ?? count);
    const sourceCount = Number(output.sourceCount ?? count);
    return count > 0 ? `${count} 条标题记录（${titleCount} 个标题，关联 ${sourceCount} 个已选货源）` : '';
  }
  if (normalized === 'select') {
    const count = Number(output.productCount ?? output.count ?? state.count ?? 0);
    const failed = Number(output.failed ?? state.failed ?? 0);
    if (state.manualDirectInput === true) {
      if (count > 0 || failed > 0) return `获取 ${count} 个商品，失败 ${failed} 个`;
      return '';
    }
    return count > 0 ? `选中 ${count} 条货源` : '';
  }
  if (normalized === 'export') {
    const count = Number(output.count ?? state.count ?? 0);
    return count > 0 ? `成功 ${count} 条铺货清单` : '';
  }
  if (normalized === 'collectRank') {
    const count = Number(output.count ?? state.count ?? 0);
    const manualCount = Number(output.manualCount ?? 0);
    const rankCount = Number(output.rankCount ?? Math.max(0, count - manualCount));
    if (manualCount > 0) {
      return rankCount > 0 ? `获取 ${rankCount} 个排行商品，追加 ${manualCount} 个指定商品` : `获取 ${manualCount} 个指定商品资料`;
    }
    const pages = Number(output.pages ?? 0);
    const sortLabel = output.sortLabel || '商品访客数';
    return count > 0 ? `采集 ${pages || 1} 页、${count} 条商品，按${sortLabel}降序` : '';
  }
  if (normalized === 'confirmProducts') {
    const groups = Number(output.groupCount ?? state.groupCount ?? 0);
    const products = Number(output.productCount ?? state.productCount ?? 0);
    return groups > 0 ? `已编排 ${groups} 个任务组、${products} 个商品` : '';
  }
  if (normalized === 'importSheet') {
    const groups = Number(output.groupCount || 0);
    const products = Number(output.productCount || 0);
    return products > 0 ? `识别 ${groups} 个订单组、${products} 个商品` : '';
  }
  if (normalized === 'generateReviews') {
    const count = Number(output.count || 0);
    if (count <= 0) return '';
    const missing = Number(output.missing || 0);
    const blocked = Number(output.blocked || 0);
    const warning = Number(output.warning || 0);
    const issues = [
      missing > 0 ? `${missing} 条待补体验` : '',
      blocked > 0 ? `${blocked} 条重复阻塞` : '',
      warning > 0 ? `${warning} 条历史相似提醒` : ''
    ].filter(Boolean);
    return `已整理 ${count} 条真实体验${issues.length > 0 ? `，${issues.join('、')}` : ''}`;
  }
  if (normalized === 'generateSheet') {
    const count = Number(output.count ?? state.count ?? 0);
    const imageCount = Number(output.imageCount ?? 0);
    if (count <= 0) return '';
    return output.sheetType === 'review'
      ? `生成评价表，写入 ${count} 条商品`
      : `生成刷单表，写入 ${count} 条商品和 ${imageCount} 张主图`;
  }
  if (normalized === 'resolveShops') {
    const count = Number(output.count || 0);
    const failed = Number(output.failed || 0);
    return count > 0 ? `识别 ${count} 家同行店铺${failed ? `，失败 ${failed} 条` : ''}` : '';
  }
  if (normalized === 'collectCompetitors') {
    const hotCount = Number(output.hotCount || 0);
    const newCount = Number(output.newCount || 0);
    return hotCount + newCount > 0 ? `采集 ${hotCount} 个爆款样本、${newCount} 个新品样本` : '';
  }
  if (normalized === 'enrichCompetitors') {
    const count = Number(output.count || 0);
    const failed = Number(output.failed || 0);
    return count + failed > 0 ? `补全 ${count} 个商品链接${failed ? `，失败 ${failed} 个` : ''}` : '';
  }
  if (normalized === 'analyzeCompetitors') {
    const count = Number(output.count || 0);
    const status = String(state.status || state.state || '').toLowerCase();
    return count > 0 ? `发现 ${count} 个待验真机会词` : status === 'completed' ? '同行分析已完成' : '';
  }
  if (normalized === 'competitorReport') {
    const count = Number(output.count || 0);
    return count > 0 ? `报告包含 ${count} 条商品记录` : '';
  }
  return '';
}

export function getWorkflowNodeResultLocation(nodeId, state = {}) {
  const output = state.output && typeof state.output === 'object' ? state.output : {};
  const normalized = String(nodeId || '');
  if (normalized === 'mine') return output.file || '';
  if (normalized === 'keywordReview') return output.file || '';
  if (normalized === 'verify') return output.file || '';
  if (normalized === 'select') return output.file || '';
  if (normalized === 'generate') return output.file || '';
  if (normalized === 'collectRank') return output.file || '';
  if (normalized === 'confirmProducts') return output.file || '';
  if (normalized === 'generateSheet') return output.file || '';
  if (normalized === 'resolveShops') return output.file || '';
  if (normalized === 'collectCompetitors') return [output.file, output.newFile].filter(Boolean).join('\n');
  if (normalized === 'enrichCompetitors') return output.file || '';
  if (normalized === 'analyzeCompetitors') return output.file || '';
  if (normalized === 'competitorReport') return output.file || '';
  if (normalized === 'export') {
    const locations = [
      output.batchFile ? `铺货清单：${output.batchFile}` : '',
      output.reviewFile ? `复核报告：${output.reviewFile}` : ''
    ].filter(Boolean);
    return locations.join('\n') || output.file || '';
  }
  if (normalized === 'review') return output.reviewFile || '';
  return output.file || '';
}

export function getWorkflowResultSummaryView(nodeId, state = {}) {
  const normalized = String(nodeId || '');
  const manualProductInput = normalized === 'select' && state.manualDirectInput === true;
  const sheetType = state.output?.sheetType === 'review' ? 'review' : 'order';
  const titles = {
    mine: '灵感选词结果',
    keywordReview: '人工筛词结果',
    verify: '生意参谋校验结果',
    select: '货源选品结果',
    generate: '标题生成结果',
    collectRank: '商品资料获取结果',
    confirmProducts: '商品确认与组合方案',
    generateSheet: sheetType === 'review' ? '商品评价表' : '商品排行刷单表',
    resolveShops: '已识别同行店铺',
    collectCompetitors: '爆款与新品采集结果',
    enrichCompetitors: '重点商品补全结果',
    analyzeCompetitors: '同行对比分析',
    competitorReport: '同行分析报告',
    export: '铺货清单与复核结果',
    review: '铺货清单与复核结果',
    end: '流程完成结果'
  };
  if (manualProductInput) titles.select = '商品资料获取结果';
  const hints = {
    mine: '候选词及其灵感来源在下方预览，完整链路保存在运行产物中。',
    keywordReview: '人工确认后的关键词会保存到 reviewed-candidates.jsonl，只有通过项会进入生意参谋校验。',
    verify: '验真通过词在下方结果列表中预览，完整内容保存在 verified-keywords.jsonl。',
    select: '已选货源会按商品信息和机会分展示，完整内容保存在 selected-products.jsonl。',
    generate: '每条标题记录会关联已选货源；完整内容保存在 generated-products.jsonl。',
    collectRank: '排行商品与指定商品会统一展示；自动读取失败的指定商品可在当前节点补充后继续。',
    confirmProducts: '只有确认后的任务组会进入刷单表；未指定 SKU 时自动采用可售最低价规格。',
    generateSheet: sheetType === 'review'
      ? 'Excel 按1拖多评价格式写入刷单日期、店铺和商品标题，并附带生意参谋原始指标。'
      : 'Excel 按动销一拖多格式写入标题、主图、下单金额、做单要求和店铺，并附带生意参谋原始指标。',
    resolveShops: '按店铺 ID 合并重复分享链接，保留店铺名称、粉丝和经营信号。',
    collectCompetitors: '销量榜和新品榜分别展示；付款人数是页面区间或下限，不等同于30天销量。',
    enrichCompetitors: '重点商品已进入详情页补充真实商品 ID 和可点击链接。',
    analyzeCompetitors: '分析基于已采集事实数据，机会词仍需进入生意参谋验真。',
    competitorReport: '报告包含店铺概览、爆款、新品、机会词和采集异常，可直接下载。',
    export: '自动导出的清单和被拦截的复核项会合并在下方操作台。',
    review: '自动导出的清单和被拦截的复核项会合并在下方操作台。',
    end: '流程完成后可从各节点查看对应产物。'
  };
  if (manualProductInput) hints.select = '每个1688链接会独立读取商品标题、主图、类目和价格，失败项可从当前节点重试。';
  const actionLabels = {
    mine: '查看候选词',
    keywordReview: '查看筛词结果',
    verify: '查看验真词',
    select: '查看已选货源',
    generate: '查看标题结果',
    collectRank: '核对商品资料',
    confirmProducts: '查看组合方案',
    generateSheet: '下载 Excel',
    resolveShops: '查看同行店铺',
    collectCompetitors: '查看爆款与新品',
    enrichCompetitors: '查看重点商品',
    analyzeCompetitors: '查看分析结果',
    competitorReport: '下载分析报告',
    export: '查看铺货复核',
    review: '查看铺货复核',
    end: '查看完成结果'
  };
  if (manualProductInput) actionLabels.select = '查看商品资料';
  const countLabel = getWorkflowNodeSuccessLabel(normalized, state);
  const locationLabel = getWorkflowNodeResultLocation(normalized, state);
  return {
    title: titles[normalized] || '节点结果',
    statusLabel: labelWorkflowNodeStatus(state.status || state.state || 'idle'),
    countLabel,
    locationLabel,
    hint: hints[normalized] || '节点结果会在下方展示，完整内容保存在对应产物文件。',
    primaryActionLabel: actionLabels[normalized] || '查看结果',
    empty: !countLabel && !locationLabel
  };
}

export function labelWorkflowBlockerReason(blocker) {
  const normalized = String(blocker || '').toLowerCase();
  const labels = {
    sycm_chrome_unavailable: 'Chrome 调试连接不可用',
    chrome_unavailable: 'Chrome 调试连接不可用',
    no_inspiration_candidates: '没有可用的动态候选词',
    verified_empty: '验真无结果',
    keyword_review_required: '需要人工筛词',
    no_keyword_review_approved: '没有通过筛词的关键词',
    no_generation_eligible_keywords: '没有可生成标题的词',
    sycm_manual_action_required: '生意参谋需要人工处理',
    sycm_partial_manual_required: '生意参谋部分阻塞',
    sycm_login_required: '生意参谋需要登录',
    slider_required: '需要滑块验证',
    captcha_required: '需要验证码',
    login_required: '需要登录',
    permission_required: '权限不足',
    platform_cooldown: '平台请求冷却',
    generate_failed: '标题生成失败',
    export_empty: '导出无结果',
    review_rejected_rows: '需要人工复核',
    order_sheet_product_details_required: '指定商品资料不完整',
    product_confirmation_required: '需要确认商品与编组',
    taobao_native_manual_action_required: '淘宝客户端需要人工处理'
  };
  return labels[normalized] || String(blocker || '');
}

export function getWorkflowNodeDetailRows(node = {}) {
  const data = node.data || {};
  const view = getWorkflowNodeViewModel(node.id, data);
  const manualAction = data.manualAction && typeof data.manualAction === 'object' ? data.manualAction : null;
  const platformStatus = data.platformStatus || manualAction?.status || '';
  const actionHint = data.actionHint || manualAction?.userMessage || '';
  const status = String(data.status || data.state || '').toLowerCase();
  const active = ['pending', 'running', 'retrying', 'resuming'].includes(status);
  const verifyOutput = data.output && typeof data.output === 'object' ? data.output : {};
  const inferredVerifiedEmpty = node.id === 'verify'
    && status === 'blocked'
    && !data.blocker
    && !data.error
    && Number(verifyOutput.verified || 0) === 0
    && Number(verifyOutput.rejected || 0) > 0;
  const inferredVerifyBlocked = node.id === 'verify' && status === 'blocked' && !data.blocker && !data.error && !inferredVerifiedEmpty;
  const rows = [
    { label: '状态', value: view.statusLabel }
  ];
  if (view.progressLabel) rows.push({ label: '进度', value: view.progressLabel });
  if (data.keyword) rows.push({ label: '关键词', value: data.keyword });
  if (data.count) rows.push({ label: '数量', value: `${data.count}` });
  if (data.maxLength) rows.push({ label: '标题长度', value: `${data.maxLength}` });
  if (view.successLabel) rows.push({ label: '成功数量', value: view.successLabel });
  if (view.outputSummary) rows.push({ label: '输出摘要', value: view.outputSummary });
  if (view.resultLocation) rows.push({ label: '产物位置', value: view.resultLocation });
  if (data.error) rows.push({ label: '错误', value: data.error });
  if (data.blocker && !data.error && !active) rows.push({ label: '阻塞原因', value: labelWorkflowBlockerReason(data.blocker) });
  if (inferredVerifiedEmpty) rows.push({ label: '阻塞原因', value: '验真无结果' });
  if (inferredVerifyBlocked) rows.push({ label: '阻塞原因', value: '生意参谋校验阻塞' });
  if (platformStatus && !data.error && !active) rows.push({ label: '平台状态', value: labelWorkflowBlockerReason(platformStatus) });
  if (actionHint && !data.error && !active) rows.push({ label: '处理建议', value: actionHint });
  if (inferredVerifiedEmpty && !actionHint) {
    rows.push({ label: '处理建议', value: '生意参谋验真没有通过词。请更换候选词、降低蓝海阈值，或重新挖词后再继续。' });
  }
  if (inferredVerifyBlocked && !actionHint) {
    rows.push({ label: '处理建议', value: '请检查生意参谋登录、滑块、权限或验真结果为空，再继续或重跑校验。' });
  }
  if (view.blockerMessage && !data.error && !actionHint && !inferredVerifyBlocked) rows.push({ label: view.blockerTitle || '提示', value: view.blockerMessage });
  return rows.filter((row) => row.value !== null && row.value !== undefined && String(row.value).trim() !== '');
}

export function getWorkflowNodePanelKind(nodeId) {
  const normalized = String(nodeId || '');
  if (normalized === 'start') return 'start-config';
  if (normalized === 'mine') return 'keyword-mining';
  if (normalized === 'keywordReview') return 'keyword-review';
  if (normalized === 'verify') return 'sycm-verify';
  if (normalized === 'select') return 'product-select';
  if (normalized === 'generate') return 'title-generate';
  if (normalized === 'generateReviews') return 'review-drafts';
  if (normalized === 'collectRank') return 'order-sheet-products';
  if (normalized === 'confirmProducts') return 'order-sheet-groups';
  if (normalized === 'resolveShops') return 'competitor-shops';
  if (normalized === 'collectCompetitors') return 'competitor-products';
  if (normalized === 'enrichCompetitors') return 'competitor-details';
  if (normalized === 'analyzeCompetitors') return 'competitor-analysis';
  if (normalized === 'competitorReport') return 'competitor-report';
  if (normalized === 'export') return 'distribution-export';
  if (normalized === 'review') return 'distribution-export';
  if (normalized === 'end') return 'completion';
  return 'artifact';
}

export function getWorkflowTemplateView(template = {}) {
  const mode = String(template.mode || template.workflow?.mode || '').toLowerCase();
  const id = String(template.id || '').toLowerCase();
  const isKeyword = mode === 'keyword' || id === 'exact-keyword-v1';
  const isRootKeyword = mode === 'root-keyword' || id === 'root-keyword-selection-v1';
  const isManual = mode === 'manual' || ['manual-selection-v1', 'manual-selection-v2'].includes(id);
  const isOrderSheet = mode === 'order-sheet' || id === 'sycm-order-sheet-v1';
  const isCompetitor = mode === 'competitor-analysis' || id === 'competitor-analysis-v1';
  const defaults = isRootKeyword
    ? {
        entryLabel: '入口：手动词根',
        scenarioLabel: '适合：从短词根持续拓展选品机会',
        flowSummary: '流程：录入词根 → 分时拓词 → 人工筛词 → 机会确认 → 货源选品 → 标题生成 → 铺货复核',
        modeHint: '不限制词根和候选词数量；所有生意参谋查询串行执行，并按安全节奏自动冷却。'
      }
    : isCompetitor
    ? {
        entryLabel: '入口：同行分享链接',
        scenarioLabel: '适合：分析同行爆款与新品',
        flowSummary: '流程：识别店铺 → 采集销量榜/新品榜 → 补全商品 → 对比分析 → Excel',
        modeHint: '支持完整淘宝分享文案、短链接、商品链接和店铺链接，使用当前淘宝客户端登录状态。'
      }
    : isOrderSheet
    ? {
        entryLabel: '入口：生意参谋商品排行',
        scenarioLabel: '适合：按指定范围制作商品动销表',
        flowSummary: '流程：设置日期/页数/指标 → 商品排行 → 降序采集 → Excel',
        modeHint: '选择日期范围、采集页数和排序指标，使用当前 Chrome 登录态生成可下载表格。'
      }
    : isManual
    ? {
        entryLabel: '入口：1688链接（关键词可选）',
        scenarioLabel: '适合：已经确定货源',
        flowSummary: '流程：获取商品 → 提取并验真关键词 → MiniMax生成标题 → 铺货复核',
        modeHint: '支持1688商品链接和手机分享口令；手动填写的关键词会被优先验证。'
      }
    : isKeyword
    ? {
        entryLabel: '入口：手动关键词',
        scenarioLabel: '适合：批量验证明确目标词',
        flowSummary: '流程：批量输入关键词 → 跳过挖词 → 生意参谋校验 → 货源选品 → 标题生成 → 导出复核',
        modeHint: '每行输入一个关键词，系统会逐词验真、选品和生成标题。'
      }
    : {
        entryLabel: '入口：动态灵感',
        scenarioLabel: '适合：每天自动发现新机会',
        flowSummary: '流程：灵感选词 → 人工筛词 → 生意参谋校验 → 货源选品 → 标题生成 → 导出复核',
        modeHint: '从新闻、字典、日历和趋势动态发现商品词根，不要求预先维护种子池。'
      };
  return {
    entryLabel: template.entryLabel || defaults.entryLabel,
    scenarioLabel: template.scenarioLabel || defaults.scenarioLabel,
    flowSummary: template.flowSummary || defaults.flowSummary,
    modeHint: template.modeHint || defaults.modeHint
  };
}

export function normalizeCandidateForTitle(candidate = {}) {
  const sycmData = candidate.sycmData || candidate.marketMetrics || {};
  return {
    keyword: String(candidate.keyword || '').trim(),
    score: candidate.localScore ?? candidate.score ?? null,
    source: candidate.source || 'manual',
    gateStatus: candidate.gateStatus || (candidate.canDistribute ? 'verified' : 'candidate'),
    gateReason: candidate.gateReason || candidate.lastReason || '',
    canDistribute: Boolean(candidate.canDistribute),
    marketScore: candidate.marketScore ?? sycmData.marketScore ?? null,
    confidence: candidate.marketMetrics?.confidence || candidate.confidence || null,
    scoreBreakdown: candidate.marketMetrics?.breakdown || candidate.scoreBreakdown || null,
    market: {
      searchPopularity: sycmData.searchPopularity ?? null,
      demandSupplyRatio: sycmData.demandSupplyRatio ?? null,
      clickRate: sycmData.clickRate ?? null,
      conversionRate: sycmData.conversionRate ?? sycmData.payConversionRate ?? null,
      buyerCount: sycmData.buyerCount ?? null,
      onlineProductCount: sycmData.onlineProductCount ?? null,
      trend: sycmData.trend ?? null
    },
    raw: candidate
  };
}

export function buildReviewProduct({ keyword, product = {}, candidate = {} }) {
  return {
    id: `${keyword || candidate.keyword || ''}:${product['产品链接'] || product.productUrl || product['铺货标题'] || Date.now()}`,
    keyword: keyword || candidate.keyword || '',
    selectedKeyword: keyword || candidate.selectedKeyword || candidate.keyword || '',
    title: product['铺货标题'] || product.title || '',
    productTitle: product['链接原标题'] || product.productTitle || '',
    productUrl: product['产品链接'] || product.productUrl || '',
    imageUrl: product['主图链接'] || product.imageUrl || '',
    price: product['商品原价'] || product.price || '',
    canDistribute: Boolean(candidate.canDistribute),
    reason: candidate.gateReason || candidate.reason || ''
  };
}

/**
 * 格式化 workflow 节点进度文案。
 * @param {object|null} progress 节点进度。
 * @returns {string} 进度展示文案。
 */
export function formatWorkflowProgressLabel(progress) {
  if (!progress || typeof progress !== 'object') return '';
  const parts = [];
  const hasCurrent = progress.current !== null && progress.current !== undefined && progress.current !== '';
  const hasTotal = progress.total !== null && progress.total !== undefined && progress.total !== '';
  const hasPercent = progress.percent !== null && progress.percent !== undefined && progress.percent !== '';
  const message = String(progress.message || '').trim();
  if (message) parts.push(message);
  if (hasCurrent && hasTotal) parts.push(`${progress.current}/${progress.total}`);
  if (hasPercent) parts.push(`${progress.percent}%`);
  return parts.join(' · ');
}

/**
 * 归一化 workflow SSE progress 事件，兼容 payload 包裹和扁平 runtime event。
 * @param {object|null} event SSE 事件数据。
 * @returns {object} 节点进度。
 */
export function normalizeWorkflowProgressEvent(event) {
  if (!event || typeof event !== 'object') return {};
  const source = event.payload && typeof event.payload === 'object' ? event.payload : event;
  const { event: _event, ...progress } = source;
  return progress;
}

export function getWorkflowNodeViewModel(nodeId, state = {}) {
  const status = state.status || state.state || 'idle';
  const active = ['pending', 'running', 'retrying', 'resuming'].includes(String(status).toLowerCase());
  const progress = state.progress || null;
  const blocker = getWorkflowBlockerView(state);
  const successLabel = active ? '' : getWorkflowNodeSuccessLabel(nodeId, state);
  const resultLocation = getWorkflowNodeResultLocation(nodeId, state);
  return {
    nodeId,
    status,
    statusLabel: labelWorkflowNodeStatus(status),
    tone: getCanvasNodeTone(status),
    progress,
    progressLabel: formatWorkflowProgressLabel(progress),
    progressPercent: progress && Number.isFinite(Number(progress.percent))
      ? Math.max(0, Math.min(100, Number(progress.percent)))
      : 0,
    primaryAction: getWorkflowNodeAction(nodeId, state),
    blockerTitle: blocker?.title || '',
    blockerMessage: blocker?.message || '',
    hasBlocker: Boolean(blocker),
    durationMs: Number.isFinite(Number(state.durationMs)) ? Number(state.durationMs) : null,
    outputSummary: active ? '' : state.outputSummary || successLabel || '',
    successLabel,
    resultLocation,
    configSummary: String(nodeId) === 'start' && state.reviewUpload === true
      ? (state.uploadId ? `${state.uploadName || '刷单表'} · ${state.uploadSummary?.parsedSheetCount || state.groups?.length || 0} 个订单组 · ${state.uploadSummary?.productCount || 0} 个商品` : '尚未上传刷单表')
      : String(nodeId) === 'start' && state.orderSheetConfig === true
      ? getOrderSheetConfigSummary(state)
      : String(nodeId) === 'start' && state.competitorConfig === true
        ? getCompetitorConfigSummary(state)
      : String(nodeId) === 'start' && (state.rootsText != null || Array.isArray(state.roots))
        ? getRootKeywordConfigSummary(state)
      : String(nodeId) === 'generateSheet' && state.sheetConfig === true
        ? getSheetConfigSummary(state)
        : ''
  };
}
