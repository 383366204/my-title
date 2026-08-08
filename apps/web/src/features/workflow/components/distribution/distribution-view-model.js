export const EXPORT_STATUS_LABELS = {
  ready: '可直接导出',
  review_candidate: '待人工复核',
  rejected_before_distribution: '导出前拦截'
};

export const EXPORT_REASON_LABELS = {
  missing_category: '缺少商品或推荐类目',
  keyword_opportunity_reject: '关键词机会评分未通过',
  keyword_opportunity_observe: '关键词需要观察',
  keyword_opportunity_review: '关键词需要人工复核',
  legacy_keyword_opportunity_reject: '历史产物：关键词机会未通过，新流程会在校验节点拦截',
  legacy_keyword_opportunity_observe: '历史产物：关键词需要观察，新流程会在校验节点提示',
  legacy_keyword_opportunity_review: '历史产物：关键词需要复核，新流程会在校验节点提示',
  product_opportunity_candidate: '货源只是候选级别',
  product_opportunity_manual_review: '货源需要人工复核',
  hot_keyword_product: '热搜词货源，需要谨慎铺货',
  sales_missing_or_zero: '销量缺失或为 0',
  fallback_hot: '蓝海数据不足，降级使用热搜趋势',
  missing_url: '缺少 1688 货源链接',
  invalid_1688_url: '1688 货源链接无效',
  missing_title: '缺少铺货标题',
  title_missing_keyword: '标题未包含核心关键词',
  missing_category_product: '商品类目缺失',
  category_conflict: '推荐类目与商品类目冲突',
  duplicate_url: '货源链接重复',
  duplicate_title: '标题重复',
  hot_export_limit: '热搜趋势词超过自动导出上限'
};

export const EXPORT_VALUE_LABELS = {
  reject: '未通过',
  continue: '继续',
  stop: '停止',
  candidate: '候选',
  strong_recommend: '强推荐',
  manual_review: '人工复核',
  generate_title: '生成标题',
  trend: '趋势参考',
  high: '高',
  medium: '中',
  low: '低',
  unknown: '未知',
  trend_reference: '仅作趋势参考',
  title_core: '可作为标题核心词',
  title_optional: '可作为标题辅助词'
};

export const DISTRIBUTION_BLOCKER_LABELS = {
  empty_input: '铺货清单为空',
  login_expired: '铺货工具登录已过期',
  browser_cdp_unavailable: 'Chrome 调试连接不可用',
  distribution_quota_exhausted: '铺货平台剩余额度为 0',
  recent_duplicate_batch: '近期已提交过相同批次'
};

function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Extract selected keyword from a distribution row.
 * @param {object} [row={}] Distribution row object.
 * @returns {string} Selected keyword string.
 */
export function rowSelectedKeyword(row = {}) {
  return String(row.selectedKeyword || row.keyword || row.blueOceanWord || row.product?.蓝海词 || row['蓝海词'] || '').trim();
}

/**
 * Extract source product URL from a distribution row with safe URL fallback.
 * @param {object} [row={}] Distribution row object.
 * @returns {string} Product URL or empty string.
 */
export function distributionRowUrl(row = {}) {
  const descriptionUrl = isHttpUrl(row.description) ? row.description.trim() : '';
  return row.url
    || row.raw?.url
    || row.raw?.productUrl
    || row.raw?.['产品链接']
    || row.raw?.product?.['产品链接']
    || descriptionUrl
    || '';
}

/**
 * Extract product category from a distribution row.
 * @param {object} [row={}] Distribution row object.
 * @returns {string} Product category string.
 */
export function distributionRowCategory(row = {}) {
  return row.category
    || row.raw?.category
    || row.raw?.recommendedCategory
    || row.raw?.productCategory
    || row.raw?.product?.类目
    || row.raw?.product?.category
    || row.raw?.product?.categoryName
    || row.raw?.product?.categoryListName
    || row.raw?.product?.stats?.categoryListName
    || '';
}

/**
 * Build batch distribution text formatted as URL$$title$$category.
 * @param {Array<object>} [rows=[]] List of distribution rows.
 * @returns {string} Formatted distribution text block.
 */
export function buildDistributionText(rows = []) {
  return (rows || [])
    .map((row) => {
      const url = distributionRowUrl(row);
      const category = distributionRowCategory(row);
      return [url, row.title || '', category && category !== '-' ? category : ''].join('$$');
    })
    .filter((line) => line.replace(/\$/g, '').trim())
    .join('\n');
}

/**
 * Map export value key to human readable label.
 * @param {string} value Export value key.
 * @returns {string} Human readable label.
 */
export function labelExportValue(value) {
  const normalized = String(value || '').trim();
  return EXPORT_VALUE_LABELS[normalized] || normalized;
}

/**
 * Map distribution blocker key to human readable label.
 * @param {string} value Blocker key.
 * @returns {string} Human readable label.
 */
export function labelDistributionBlocker(value) {
  const normalized = String(value || '').trim();
  return DISTRIBUTION_BLOCKER_LABELS[normalized] || normalized;
}

/**
 * Map export status key to human readable label.
 * @param {string} status Export status key.
 * @returns {string} Human readable status label.
 */
export function labelExportStatus(status) {
  return EXPORT_STATUS_LABELS[String(status || '').trim()] || String(status || '待处理');
}

/**
 * Map comma-separated export reason keys to human readable labels.
 * @param {string} reasonText Reason text string.
 * @returns {string} Formatted human readable reasons.
 */
export function labelExportReasons(reasonText) {
  return String(reasonText || '')
    .split(',')
    .map((reason) => reason.trim())
    .filter(Boolean)
    .map((reason) => {
      const titleTooShort = reason.match(/^title_too_short:(.+)$/);
      if (titleTooShort) return `标题过短（${titleTooShort[1]}）`;
      const bannedWords = reason.match(/^banned_words:(.+)$/);
      if (bannedWords) return `包含违禁词：${bannedWords[1]}`;
      return EXPORT_REASON_LABELS[reason] || reason;
    })
    .join('，');
}

/**
 * Format opportunity score summary string into human readable text.
 * @param {string} value Opportunity summary raw string.
 * @returns {string} Formatted summary text.
 */
export function labelOpportunitySummary(value) {
  const parts = String(value || '').split('/').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3) {
    return `评分 ${parts[0]}，判断 ${labelExportValue(parts[1])}，下一步 ${labelExportValue(parts[2])}`;
  }
  return labelExportValue(value);
}

/**
 * Convert a review/blocked item row into a distribution row format.
 * @param {object} [row={}] Review item row.
 * @param {number} [index=0] Row index for fallback key generation.
 * @returns {object} Standardized distribution row.
 */
export function exportReviewRowToDistributionRow(row = {}, index = 0) {
  const statusLabel = labelExportStatus(row.status);
  const reasonLabel = labelExportReasons(row.reason);
  const keyword = rowSelectedKeyword(row);
  return {
    ...row,
    selectedKeyword: keyword,
    key: `blocked:${row.url || row.title || row.heading || 'row'}:${index}`,
    title: row.title || row.heading || '未命名拦截项',
    meta: `${row.group === 'rejected' ? '系统拦截' : '待人工复核'} · ${statusLabel}`,
    metrics: [
      keyword ? `选词：${keyword}` : '',
      row.category && row.category !== '-' ? `类目 ${row.category}` : '',
      row.confidence ? `置信度 ${labelExportValue(row.confidence)}` : '',
      row.usage ? `用途 ${labelExportValue(row.usage)}` : '',
      row.productOpportunity ? `货源机会：${labelOpportunitySummary(row.productOpportunity)}` : '',
      row.keywordOpportunity ? `关键词机会：${labelOpportunitySummary(row.keywordOpportunity)}` : ''
    ].filter(Boolean),
    description: reasonLabel || row.risk || row.decision || '',
    riskText: row.risk || '',
    decisionText: row.decision || '',
    fromReview: true
  };
}
