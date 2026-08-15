/**
 * 汇总 workflow 节点产物的前端展示文案。
 * @param {object|null} artifact 节点产物。
 * @returns {string} 产物摘要。
 */
export function summarizeWorkflowArtifact(artifact) {
  if (!artifact) return '暂无产物';
  const type = String(artifact.type || '').toLowerCase();
  const file = String(artifact.file || '').toLowerCase();
  if (type === 'jsonl') {
    const items = Array.isArray(artifact.items) ? artifact.items : artifact.rows;
    return `${Array.isArray(items) ? items.length : 0} 条数据`;
  }
  if (type === 'xlsx') return `${Number(artifact.count || 0)} 条商品`;
  const text = typeof artifact.text === 'string' ? artifact.text : '';
  if (!text.trim()) return '暂无产物';
  if (type === 'markdown' || file.endsWith('.md')) return '复核报告';
  const lines = text.split(/\r?\n/).filter(line => line.length > 0);
  return `${lines.length} 行文本`;
}

function candidateTitle(row = {}) {
  return String(row.keyword || row.word || row.title || row.query || row.name || '').trim() || '未命名候选词';
}

function candidateScore(row = {}) {
  const value = row.localScore ?? row.score ?? row.sycmScore?.score ?? row.metrics?.score;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : null;
}

function candidateMeta(row = {}) {
  const parts = [];
  const score = candidateScore(row);
  if (score !== null) parts.push(`评分 ${score}`);
  if (row.source) parts.push(row.source === 'inspiration' ? '动态灵感' : String(row.source));
  if (row.searchPopularity) parts.push(`搜索人气 ${row.searchPopularity}`);
  if (row.competition) parts.push(`竞争 ${row.competition}`);
  if (row.familyKey) parts.push(`词族 ${row.familyKey}`);
  const novelty = row.diversity?.noveltyStatus;
  if (novelty === 'new_family') parts.push('新词族');
  if (novelty === 'recent_family') parts.push('近期词族');
  if (novelty === 'cooling_family') parts.push('冷却中词族');
  if (novelty === 'history_fallback') parts.push('历史回退');
  return parts.join(' · ');
}

function metricValue(row = {}, keys = []) {
  for (const key of keys) {
    const value = key.split('.').reduce((memo, part) => (memo && memo[part] !== undefined ? memo[part] : undefined), row);
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

function compactMetric(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return `${label} ${value}`;
}

function inspirationSourceLabel(value) {
  return ({ news: '新闻', dictionary: '字典', calendar: '日历', trend: '趋势' })[value] || String(value || '');
}

const OPPORTUNITY_DECISION_LABELS = {
  continue: '可生成',
  observe: '观察',
  review: '人工复核',
  reject: '停止'
};

const OPPORTUNITY_ACTION_LABELS = {
  search_1688: '搜索货源',
  manual_review: '人工复核',
  stop: '停止'
};

const SCORE_REASON_LABELS = {
  local_high_intent: '本地挖词意图强',
  local_weak: '本地挖词质量偏弱',
  sycm_blue: '严格蓝海通过',
  sycm_blue_relaxed: '放宽蓝海通过',
  sycm_hot: '只通过热搜降级',
  sycm_passed: '生意参谋通过',
  sycm_not_passed: '生意参谋指标未通过',
  sycm_missing: '缺少生意参谋数据',
  keyword_length_edge: '关键词长度不理想',
  fallback_hot: '热搜降级',
  fallback_blue_relaxed: '放宽蓝海降级',
  fallback_used: '降级查询',
  banned_keyword: '命中违禁词'
};

function labelOpportunityDecision(value) {
  return OPPORTUNITY_DECISION_LABELS[String(value || '').trim()] || String(value || '');
}

function labelOpportunityAction(value) {
  return OPPORTUNITY_ACTION_LABELS[String(value || '').trim()] || String(value || '');
}

function labelScoreReason(value) {
  return SCORE_REASON_LABELS[String(value || '').trim()] || String(value || '');
}

function formatScoreTerm(term = {}) {
  const value = Number(term.value);
  const prefix = Number.isFinite(value) && value > 0 ? '+' : '';
  return `${term.label || term.key || '评分项'} ${Number.isFinite(value) ? `${prefix}${value}` : ''}`.trim();
}

function businessRowTitle(row = {}) {
  return String(
    row.title
    || row['铺货标题']
    || row.keyword
    || row.word
    || row.productTitle
    || row['链接原标题']
    || row.name
    || ''
  ).trim() || '未命名结果';
}

function selectedKeyword(row = {}) {
  return String(row.selectedKeyword || row.keyword || row.blueOceanWord || row.product?.蓝海词 || row['蓝海词'] || '').trim();
}

function businessRowMeta(row = {}, nodeId = '') {
  const parts = [];
  if (nodeId === 'verify') {
    const score = candidateScore(row);
    if (score !== null) parts.push(`评分 ${score}`);
    if (row.keywordOpportunity?.score !== undefined) parts.push(`机会分 ${row.keywordOpportunity.score}`);
    if (row.keywordOpportunity?.decision) parts.push(`决策 ${labelOpportunityDecision(row.keywordOpportunity.decision)}`);
    if (row.status) parts.push(String(row.status));
    if (row.source) parts.push(String(row.source));
  } else if (nodeId === 'select') {
    const keyword = selectedKeyword(row);
    if (keyword) parts.push(`选词 ${keyword}`);
    if (row.productOpportunity?.score !== undefined) parts.push(`货源分 ${row.productOpportunity.score}`);
    if (row.productOpportunity?.decision) parts.push(`决策 ${labelOpportunityDecision(row.productOpportunity.decision)}`);
    if (row.sourceTitle || row.productTitle || row.product?.['链接原标题']) {
      parts.push(String(row.sourceTitle || row.productTitle || row.product?.['链接原标题']));
    }
    if (row.enrichStatus === 'failed' || row.status === 'enrich_failed') parts.push('获取失败');
    if (row.enrichStatus === 'completed') parts.push('资料已获取');
    const novelty = row.productDiversity?.noveltyStatus;
    if (novelty === 'new_offer') parts.push('新货源');
    if (novelty === 'recent_generated_offer') parts.push('近期生成过');
    if (novelty === 'history_fallback') parts.push('历史回退');
  } else if (nodeId === 'generate') {
    const keyword = selectedKeyword(row);
    if (keyword) parts.push(`选词 ${keyword}`);
    if (row.productTitle || row['链接原标题'] || row.product?.['链接原标题']) {
      parts.push(String(row.productTitle || row['链接原标题'] || row.product?.['链接原标题']));
    }
  } else if (nodeId === 'export') {
    const keyword = selectedKeyword(row);
    if (keyword) parts.push(`选词 ${keyword}`);
    if (row.status) parts.push(String(row.status));
  }
  return parts.join(' · ');
}

function businessMetrics(row = {}, nodeId = '') {
  if (nodeId === 'verify') {
    return [
      compactMetric('搜索人气', metricValue(row, ['searchPopularity', 'sycmData.searchPopularity', 'marketMetrics.searchPopularity'])),
      compactMetric('供需比', metricValue(row, ['demandSupplyRatio', 'sycmData.demandSupplyRatio', 'marketMetrics.demandSupplyRatio'])),
      compactMetric('点击率', metricValue(row, ['clickRate', 'sycmData.clickRate', 'marketMetrics.clickRate'])),
      compactMetric('转化率', metricValue(row, ['conversionRate', 'sycmData.conversionRate', 'marketMetrics.conversionRate'])),
      compactMetric('下一步', labelOpportunityAction(row.keywordOpportunity?.nextAction)),
      row.keywordOpportunity?.breakdown?.gapToContinue
        ? compactMetric('距生成线还差', row.keywordOpportunity.breakdown.gapToContinue)
        : ''
    ].filter(Boolean);
  }
  if (nodeId === 'select' || nodeId === 'generate' || nodeId === 'export') {
    const keyword = selectedKeyword(row);
    return [
      keyword ? compactMetric('选词', keyword) : '',
      compactMetric('价格', metricValue(row, ['price', '商品原价', 'minPrice', 'product.商品原价', 'product.price'])),
      compactMetric('销量', metricValue(row, ['sales', 'sales30days', '30天销量', 'monthlySales', 'product.30天销量', 'product.sales'])),
      compactMetric('好评率', metricValue(row, ['positiveRate', '好评率', 'product.好评率'])),
      compactMetric('复购率', metricValue(row, ['repurchaseRate', '复购率', 'product.复购率'])),
      row.productDiversity?.historicalOfferCount
        ? compactMetric('历史出现', `${row.productDiversity.historicalOfferCount} 次`)
        : '',
      row.supplierName ? compactMetric('供应商', row.supplierName) : ''
    ].filter(Boolean);
  }
  return [];
}

function businessDescription(row = {}, nodeId = '') {
  if (nodeId === 'select' && row.enrichError) {
    return `获取失败：${row.enrichError}`;
  }
  if (nodeId === 'select' && row.productOpportunity) {
    const opportunity = row.productOpportunity || {};
    const reasons = Array.isArray(opportunity.reasons)
      ? opportunity.reasons.map(labelScoreReason).join('，')
      : '';
    const risks = Array.isArray(opportunity.riskFlags)
      ? opportunity.riskFlags.map(labelScoreReason).join('，')
      : '';
    const suggestion = opportunity.decision === 'continue'
      ? '建议继续进入标题生成。'
      : opportunity.decision === 'observe'
        ? '建议人工观察货源稳定性后再放行。'
        : '建议停止使用该货源。';
    return [
      reasons ? `依据：${reasons}` : '',
      risks ? `风险：${risks}` : '',
      suggestion
    ].filter(Boolean).join('；');
  }
  if (row.keywordOpportunity) {
    const breakdown = row.keywordOpportunity.breakdown || {};
    const positive = Array.isArray(breakdown.positive) ? breakdown.positive.map(formatScoreTerm).join('，') : '';
    const negative = Array.isArray(breakdown.negative) ? breakdown.negative.map(formatScoreTerm).join('，') : '';
    const reasons = Array.isArray(row.keywordOpportunity.reasons)
      ? row.keywordOpportunity.reasons.map(labelScoreReason).join('，')
      : '';
    const risks = Array.isArray(row.keywordOpportunity.riskFlags)
      ? row.keywordOpportunity.riskFlags.map(labelScoreReason).join('，')
      : '';
    const suggestion = row.keywordOpportunity.decision === 'continue'
      ? '建议继续进入标题与货源生成。'
      : row.keywordOpportunity.decision === 'observe'
        ? '建议加入观察池，或人工确认后再放行。'
        : '建议停止生成，补充更具体的蓝海候选词。';
    return [
      positive ? `加分：${positive}` : '',
      negative ? `扣分：${negative}` : '',
      reasons ? `依据：${reasons}` : '',
      risks ? `风险：${risks}` : '',
      suggestion
    ].filter(Boolean).join('；');
  }
  return String(
    row.reason
    || row.选品理由
    || row.product?.选品理由
    || row.gateReason
    || row.risk
    || row.riskReason
    || row.nextAction
    || row.productUrl
    || row['产品链接']
    || row.product?.['产品链接']
    || ''
  ).trim();
}

function mapBusinessRows(items = [], nodeId = '') {
  return items.map((item) => ({
    title: businessRowTitle(item),
    meta: businessRowMeta(item, nodeId),
    metrics: businessMetrics(item, nodeId),
    description: businessDescription(item, nodeId),
    raw: item
  }));
}

function parseDistributionBatch(text = '') {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const distributionParts = line.includes('$$')
        ? line.split('$$').map((part) => part.trim())
        : null;
      const legacyParts = distributionParts
        ? distributionParts
        : line.split(/\t|,/).map((part) => part.trim()).filter(Boolean);
      const url = distributionParts?.[0] || legacyParts.find((part) => /^https?:\/\//.test(part)) || '';
      const title = distributionParts?.[1]
        || legacyParts.find((part) => part && part !== url && !/^\d+(\.\d+)?$/.test(part))
        || line;
      const category = distributionParts ? distributionParts.slice(2).join('$$').trim() : '';
      const price = distributionParts ? '' : legacyParts.find((part) => /^\d+(\.\d+)?$/.test(part)) || '';
      return {
        title,
        meta: price ? `价格 ${price}` : '',
        metrics: [],
        description: url,
        category,
        raw: { line, url, title, category, price }
      };
    });
}

const REVIEW_SECTION_GROUP = {
  'Recommended Submit': 'recommended',
  'Manual Review Candidates': 'manual',
  'Hard Rejected': 'rejected'
};

const REVIEW_FIELD = {
  'Export Status': 'status',
  'Review Reasons': 'reason',
  URL: 'url',
  Title: 'title',
  Category: 'category',
  'Category Confidence': 'categoryConfidence',
  'Category Reason': 'categoryReason',
  'Verify Mode': 'verifyMode',
  Confidence: 'confidence',
  Usage: 'usage',
  'Keyword Opportunity': 'keywordOpportunity',
  'Product Opportunity': 'productOpportunity',
  'Product Risk Flags': 'riskFlags',
  Decision: 'decision',
  Risk: 'risk',
  Fallback: 'fallback',
  'SYCM Reason': 'sycmReason'
};

function pushReviewRow(rows, row) {
  if (!row) return;
  rows.push({
    ...row,
    title: row.title || row.heading || '未命名复核项',
    reason: row.reason || '',
    raw: { ...row }
  });
}

function parseDistributionReview(text = '') {
  const rows = [];
  let group = '';
  let current = null;

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const section = line.match(/^##\s+(.+)$/);
    if (section) {
      pushReviewRow(rows, current);
      current = null;
      group = REVIEW_SECTION_GROUP[section[1].trim()] || group;
      continue;
    }

    const heading = line.match(/^###\s+\d+\.\s+(.+)$/);
    if (heading) {
      pushReviewRow(rows, current);
      current = { group: group || 'manual', heading: heading[1].trim() };
      continue;
    }

    const field = line.match(/^-\s+([^:]+):\s*(.*)$/);
    if (field && current) {
      const fieldName = field[1].trim();
      const key = REVIEW_FIELD[fieldName] || fieldName.replace(/\s+/g, '_').toLowerCase();
      current[key] = field[2].trim();
    }
  }

  pushReviewRow(rows, current);
  return rows;
}

export function getWorkflowArtifactView(artifact, nodeId = '') {
  const effectiveNodeId = nodeId || artifact?.nodeId || '';
  if (effectiveNodeId === 'start') {
    return { kind: 'none', emptyText: '开始节点没有产物。', rows: [], text: '' };
  }
  if (!artifact) {
    return { kind: 'empty', emptyText: '选择运行记录后，节点完成产物会在这里展示。', rows: [], text: '' };
  }
  const type = String(artifact.type || '').toLowerCase();
  const items = Array.isArray(artifact.items) ? artifact.items : artifact.rows;
  if (effectiveNodeId === 'mine' && Array.isArray(items)) {
    return {
      kind: 'candidate-list',
      emptyText: '暂无候选词',
      rows: items.map((item) => ({
        title: candidateTitle(item),
        meta: candidateMeta(item),
        metrics: [
          item.rootKeyword ? `商品词根 ${item.rootKeyword}` : '',
          item.inspiration?.sourceType ? `来源 ${inspirationSourceLabel(item.inspiration.sourceType)}` : '',
          item.diversity?.familyRunCount ? `词族历史 ${item.diversity.familyRunCount} 次` : '',
          item.diversity?.historyPenalty ? `新鲜度扣分 ${item.diversity.historyPenalty}` : ''
        ].filter(Boolean),
        description: [
          item.inspiration?.inspirationWord ? `灵感“${item.inspiration.inspirationWord}”映射为“${item.rootKeyword || item.coreProduct || ''}”` : '',
          item.relationReason || item.reason || item.keywordOpportunity || item.nextAction || ''
        ].filter(Boolean).join('；'),
        sourceUrl: String(item.inspiration?.sourceUrl || item.sourceUrl || '').trim(),
        raw: item
      })),
      text: ''
    };
  }
  if (effectiveNodeId === 'keywordReview' && Array.isArray(items)) {
    return {
      kind: 'candidate-list',
      title: '人工筛词结果',
      emptyText: '暂无待筛选候选词',
      rows: items.map((item) => ({
        title: candidateTitle(item),
        meta: [
          candidateMeta(item),
          item.reviewStatus === 'approved' ? '已通过' : item.reviewStatus === 'rejected' ? '已筛除' : '待确认'
        ].filter(Boolean).join(' · '),
        description: String(item.reviewReason || item.reason || item.nextAction || '').trim(),
        raw: item
      })),
      text: ''
    };
  }
  if (effectiveNodeId === 'verify' && Array.isArray(items)) {
    return {
      kind: 'business-list',
      title: '验真通过词',
      emptyText: '暂无验真通过词',
      rows: mapBusinessRows(items, effectiveNodeId),
      text: ''
    };
  }
  if (effectiveNodeId === 'select' && Array.isArray(items)) {
    return {
      kind: 'business-list',
      title: '货源选品结果',
      emptyText: '暂无已选货源',
      rows: mapBusinessRows(items, effectiveNodeId),
      text: ''
    };
  }
  if (effectiveNodeId === 'generate' && Array.isArray(items)) {
    return {
      kind: 'business-list',
      title: '标题与货源链接',
      emptyText: '暂无标题与货源链接',
      rows: mapBusinessRows(items, effectiveNodeId),
      text: ''
    };
  }
  if (effectiveNodeId === 'collectRank' && Array.isArray(items)) {
    const pages = Math.max(1, ...items.map((item) => Number(item.sourcePage || 1)));
    const manualCount = items.filter(item => item.sourceType === 'manual').length;
    return {
      kind: 'business-list',
      title: manualCount > 0 ? `商品资料（含 ${manualCount} 个指定商品）` : `商品排行（${pages} 页）`,
      emptyText: '暂无商品资料',
      rows: items.map((item, index) => {
        if (item.sourceType === 'manual') {
          return {
            title: item.title || `待补标题商品 ${index + 1}`,
            meta: [item.itemId ? `商品ID ${item.itemId}` : '短链接商品', item.storeName || '', '用户指定'].filter(Boolean).join(' · '),
            metrics: [
              item.orderAmount != null ? `下单金额 ${Number(item.orderAmount).toFixed(2)}` : '下单金额待填写',
              item.referencePrice != null ? `页面参考价 ${Number(item.referencePrice).toFixed(2)}` : ''
            ].filter(Boolean),
            description: item.enrichmentError ? `自动读取失败：${item.enrichmentError}` : '指定商品资料已保存',
            sourceUrl: item.productUrl || '',
            raw: item
          };
        }
        const monetarySort = ['payAmt', 'sucRefundAmt'].includes(item.sortMetric);
        const primaryValue = Number(item.sortValue ?? item.visitorCount ?? 0);
        const metrics = [
          `${item.sortLabel || '商品访客数'} ${monetarySort ? primaryValue.toFixed(2) : primaryValue}`
        ];
        if (item.sortMetric !== 'itmUv') metrics.push(`商品访客数 ${Number(item.visitorCount || 0)}`);
        if (item.sortMetric !== 'payAmt') metrics.push(`支付金额 ${Number(item.paymentAmount || 0).toFixed(2)}`);
        if (item.sortMetric !== 'payItmCnt') metrics.push(`支付件数 ${Number(item.paidItemCount || 0)}`);
        if (item.sortMetric !== 'itemCartCnt') metrics.push(`加购件数 ${Number(item.cartItemCount || 0)}`);
        return {
          title: item.title || `第 ${index + 1} 名商品`,
          meta: [
            `排名 ${item.rank || index + 1}`,
            `第 ${item.sourcePage || 1} 页`,
            item.itemId ? `商品ID ${item.itemId}` : '',
            item.storeName || ''
          ].filter(Boolean).join(' · '),
          metrics,
          description: item.visitorChange ? `访客较上一周期 ${item.visitorChange}` : `按${item.sortLabel || '商品访客数'}降序采集`,
          sourceUrl: item.productUrl || '',
          raw: item
        };
      }),
      text: ''
    };
  }
  if (effectiveNodeId === 'generateSheet' && type === 'xlsx') {
    const fileName = String(artifact.filename || artifact.file || '');
    return {
      kind: 'file',
      title: fileName.includes('评价') ? '商品评价表' : '商品排行刷单表',
      emptyText: '表格尚未生成',
      rows: [],
      text: ''
    };
  }
  if (effectiveNodeId === 'export' && Array.isArray(items)) {
    return {
      kind: 'business-list',
      title: '待确认铺货清单',
      emptyText: '暂无铺货清单',
      rows: mapBusinessRows(items, effectiveNodeId),
      text: ''
    };
  }
  const text = typeof artifact.text === 'string'
    ? artifact.text
    : typeof artifact.content === 'string'
      ? artifact.content
      : '';
  if (effectiveNodeId === 'export' && text.trim()) {
    return {
      kind: 'business-list',
      title: '待确认铺货清单',
      emptyText: '暂无铺货清单',
      rows: parseDistributionBatch(text),
      text: ''
    };
  }
  if (effectiveNodeId === 'review' && text.trim()) {
    return {
      kind: 'review-list',
      title: '铺货复核',
      emptyText: '暂无复核项',
      rows: parseDistributionReview(text),
      text: ''
    };
  }
  if (Array.isArray(items)) {
    return { kind: 'json-list', emptyText: '暂无数据项', rows: items, text: '' };
  }
  return {
    kind: type === 'json' ? 'json-text' : 'text',
    emptyText: '暂无文本产物',
    rows: [],
    text: text || (type === 'json' ? JSON.stringify(artifact, null, 2) : '')
  };
}
