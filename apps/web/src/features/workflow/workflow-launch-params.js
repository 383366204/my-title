import { describeRequiredReviewGroupFields, findMissingReviewGroupFields } from "./review-group-fields.js";

export function isWorkflowInputNodeType(type) {
  return type === 'keyword-input' || type === 'input' || type === 'start';
}

export function getStartNodeParams(nodes = []) {
  const startNode = nodes.find((node) => isWorkflowInputNodeType(node.type) || node.id === 'start') || nodes[0];
  if (!startNode?.data) return {};
  const params = { ...startNode.data };
  ['status', 'state', 'output', 'error', 'progress', 'onSelect', 'originalType'].forEach((key) => delete params[key]);
  return params;
}

export function parseExactKeywords(input) {
  return [...new Set((Array.isArray(input) ? input : [input])
    .flatMap((value) => String(value || '').split(/[\r\n,，;；、]+/))
    .map((value) => value.trim())
    .filter(Boolean))];
}

export function parseRootKeywords(input) {
  return [...new Map((Array.isArray(input) ? input : [input])
    .flatMap((value) => String(value || '').split(/[\r\n,，;；、]+/))
    .map((value) => value.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .map((value) => [value.replace(/\s+/g, '').toLowerCase(), value])).values()];
}

export function parseCompetitorShareInputs(input) {
  const urls = String(input || '').match(/https?:\/\/[^\s<>{}\[\]"'，；]+/gi) || [];
  const seen = new Set();
  const links = [];
  let duplicateCount = 0;
  let invalidCount = 0;
  for (const value of urls) {
    const text = value.replace(/[)）\]】>,，。；;]+$/g, '');
    try {
      const url = new URL(text);
      const host = url.hostname.toLowerCase();
      const trusted = ['taobao.com', 'tmall.com', 'tmall.hk', 'tb.cn'].some(suffix => host === suffix || host.endsWith(`.${suffix}`));
      const unsafeAuthority = Boolean(url.username || url.password || (url.port && !['80', '443'].includes(url.port)));
      if (!trusted || unsafeAuthority) {
        invalidCount += 1;
        continue;
      }
      url.hash = '';
      if (seen.has(url.href)) {
        duplicateCount += 1;
        continue;
      }
      seen.add(url.href);
      links.push(url.href);
    } catch (_error) {
      invalidCount += 1;
    }
  }
  return {
    links: links.slice(0, 10),
    duplicateCount,
    invalidCount,
    truncatedCount: Math.max(0, links.length - 10)
  };
}

function isAllowedOrderSheetItemUrl(url) {
  const hostname = url.hostname.toLowerCase();
  const allowedHost = ['item.taobao.com', 'detail.tmall.com', 'detail.tmall.hk'].includes(hostname)
    || hostname === 'm.taobao.com'
    || hostname.endsWith('.m.taobao.com')
    || hostname === 'tb.cn'
    || hostname.endsWith('.tb.cn');
  const defaultPort = url.protocol === 'https:' ? ['', '443'] : url.protocol === 'http:' ? ['', '80'] : [];
  return allowedHost && defaultPort.includes(url.port);
}

function parseOrderSheetManualItem(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    return { itemId: text, productUrl: `https://item.taobao.com/item.htm?id=${text}` };
  }
  const urlText = text.match(/https?:\/\/[^\s，,；;]+/i)?.[0] || '';
  if (!urlText) return null;
  try {
    const url = new URL(urlText);
    if (!isAllowedOrderSheetItemUrl(url)) return null;
    const queryId = url.searchParams.get('id') || url.searchParams.get('itemId');
    const pathId = url.pathname.match(/\/(?:item\/|i?)(\d+)(?:\.html?)?/i)?.[1] || '';
    const itemId = /^\d+$/.test(String(queryId || '')) ? String(queryId) : pathId;
    return {
      itemId,
      productUrl: url.href,
      ...(itemId ? {} : { sourceKey: `url:${url.href}` })
    };
  } catch {
    return null;
  }
}

/**
 * Parse order-sheet item IDs and Taobao/Tmall links for immediate UI feedback.
 * Backend validation repeats the same trust boundary before starting a run.
 * @param {string} input Multiline product input.
 * @param {Array<object>} [overrides=[]] User-entered product details.
 * @returns {{items:Array<object>, totalCount:number, duplicateCount:number, duplicateItems:Array<{key:string,itemId:string,label:string,occurrenceCount:number}>, invalidCount:number, truncatedCount:number}}
 */
export function parseOrderSheetManualItems(input, overrides = []) {
  const tokens = String(input || '').split(/[\r\n,，;；、]+/).map((item) => item.trim()).filter(Boolean);
  const byKey = new Map();
  const duplicateByKey = new Map();
  let duplicateCount = 0;
  let invalidCount = 0;
  let truncatedCount = 0;
  for (const token of tokens) {
    const parsed = parseOrderSheetManualItem(token);
    if (!parsed) {
      invalidCount += 1;
      continue;
    }
    const key = parsed.itemId || parsed.sourceKey;
    if (byKey.has(key)) {
      duplicateCount += 1;
      const duplicate = duplicateByKey.get(key) || {
        key,
        itemId: parsed.itemId || '',
        label: parsed.itemId || token,
        occurrenceCount: 1
      };
      duplicate.occurrenceCount += 1;
      duplicateByKey.set(key, duplicate);
      continue;
    }
    if (byKey.size >= 100) {
      truncatedCount += 1;
      continue;
    }
    byKey.set(key, {
      ...parsed,
      title: '',
      imageUrl: '',
      storeName: '',
      orderAmount: null,
      sourceType: 'manual',
      enrichmentStatus: 'pending'
    });
  }
  for (const override of Array.isArray(overrides) ? overrides : []) {
    const key = String(override?.itemId || override?.sourceKey || '').trim();
    if (!key || !byKey.has(key)) continue;
    const current = byKey.get(key);
    byKey.set(key, {
      ...current,
      ...(String(override.title || '').trim() ? { title: String(override.title).trim() } : {}),
      ...(String(override.imageUrl || '').trim() ? { imageUrl: String(override.imageUrl).trim() } : {}),
      ...(String(override.storeName || '').trim() ? { storeName: String(override.storeName).trim() } : {}),
      ...(Number(override.orderAmount) > 0 ? { orderAmount: Number(override.orderAmount) } : {})
    });
  }
  return {
    items: [...byKey.values()],
    totalCount: tokens.length,
    duplicateCount,
    duplicateItems: [...duplicateByKey.values()],
    invalidCount,
    truncatedCount
  };
}

/**
 * Collect executable parameters from the canvas using backend parameter names.
 * @param {Array<object>} nodes Canvas nodes.
 * @returns {object} Workflow launch parameters.
 */
export function getWorkflowLaunchParams(nodes = []) {
  const params = { ...getStartNodeParams(nodes) };
  const dataFor = (id) => nodes.find((node) => node.id === id)?.data || {};
  const mine = dataFor('mine');
  const verify = dataFor('verify');
  const select = dataFor('select');
  const generate = dataFor('generate');
  const exportNode = dataFor('export');
  const generateSheet = dataFor('generateSheet');
  const generateReviews = dataFor('generateReviews');

  if (params.keywordsText != null || params.keywords != null) {
    const keywords = parseExactKeywords(params.keywordsText ?? params.keywords);
    params.keyword = keywords[0] || String(params.keyword || '').trim();
    if (keywords.length > 1) params.keywords = keywords;
    else delete params.keywords;
    delete params.keywordsText;
  }

  if (params.maxLength != null && params.length == null) params.length = params.maxLength;
  delete params.maxLength;
  if (mine.mine != null || mine.count != null) params.mine = mine.mine ?? mine.count;
  if (verify.verify != null || verify.limit != null || verify.count != null) {
    params.verify = verify.verify ?? verify.limit ?? verify.count;
  }
  if (select.select != null || select.limit != null || select.count != null) {
    params.select = select.select ?? select.limit ?? select.count;
  }
  if (generate.generate != null || generate.limit != null || generate.count != null) {
    params.generate = generate.generate ?? generate.limit ?? generate.count;
  }
  if (generate.length != null || generate.maxLength != null) {
    params.length = generate.length ?? generate.maxLength;
  }
  if (exportNode.export != null || exportNode.limit != null || exportNode.count != null) {
    params.export = exportNode.export ?? exportNode.limit ?? exportNode.count;
  }
  for (const key of ['sheetType', 'storeName', 'orderDate', 'productLimit', 'fileName', 'includeRawData', 'includeImages', 'amountMode', 'missingAmountPolicy', 'cartQuantity', 'rowSpan', 'workRequirement', 'orderNote', 'reviewGroupSize', 'includeSpacerRow']) {
    if (generateSheet[key] != null) params[key] = generateSheet[key];
  }
  for (const key of ['reviewTone', 'reviewLength', 'useAI']) {
    if (generateReviews[key] != null) params[key] = generateReviews[key];
  }
  return params;
}

export function getWorkflowLaunchBlocker(mode, nodes = []) {
  const params = getStartNodeParams(nodes);
  if (mode === 'competitor-analysis') {
    const parsed = parseCompetitorShareInputs(params.competitorText || '');
    if (parsed.links.length === 0) {
      const message = '请先在开始节点粘贴至少一条淘宝或天猫同行分享链接';
      return {
        status: 'blocked',
        error: message,
        logs: [{ timestamp: new Date().toISOString(), level: 'error', message: `[competitor_links_required] ${message}` }]
      };
    }
    return null;
  }
  if (mode === 'review-sheet') {
    const groups = Array.isArray(params.groups) ? params.groups : [];
    if (!params.uploadId || groups.length === 0) {
      const message = '请先在上传刷单表节点选择并解析 .xlsx 文件';
      return { status: 'blocked', error: message, logs: [{ timestamp: new Date().toISOString(), level: 'error', message: `[review_source_required] ${message}` }] };
    }
      // 只校验必填字段：旺旺、手机号、订单号允许留空，事后补录
      const missing = findMissingReviewGroupFields(groups);
      if (missing.length > 0) {
        const message = `还有 ${missing.length} 项订单信息未补全，请填写${describeRequiredReviewGroupFields()}`;
        return { status: 'blocked', error: message, logs: [{ timestamp: new Date().toISOString(), level: 'error', message: `[review_order_info_required] ${message}` }] };
      }
    return null;
  }
  if (mode === 'manual') {
    const items = Array.isArray(params.items) ? params.items : [];
    if (items.length > 0 && items.every((item) => /1688\.com/i.test(String(item?.url || '')))) return null;
    const message = '请先在开始节点录入有效的 1688 商品链接';
    return {
      status: 'blocked',
      error: message,
      logs: [{
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `[manual_products_required] ${message}`
      }]
    };
  }
  if (mode === 'order-sheet') {
    const inputMode = ['rank', 'manual', 'hybrid'].includes(params.inputMode) ? params.inputMode : 'rank';
    const parsed = parseOrderSheetManualItems(params.manualItemsText || '', params.manualItems || []);
    if (inputMode === 'manual' && parsed.items.length === 0) {
      const message = '请至少输入一个有效的淘宝或天猫商品 ID／链接';
      return {
        status: 'blocked',
        error: message,
        logs: [{ timestamp: new Date().toISOString(), level: 'error', message: `[order_sheet_items_required] ${message}` }]
      };
    }
  }
  if (mode === 'order-sheet' && params.inputMode !== 'manual' && params.dateMode === 'custom') {
    const startDate = String(params.startDate || '');
    const endDate = String(params.endDate || '');
    const start = /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? new Date(`${startDate}T00:00:00Z`) : null;
    const end = /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? new Date(`${endDate}T00:00:00Z`) : null;
    const days = start && end ? Math.floor((end.getTime() - start.getTime()) / 86400000) + 1 : 0;
    const message = !start || !end
      ? '请选择完整的开始日期和结束日期'
      : days < 1
        ? '开始日期不能晚于结束日期'
        : days > 31
          ? '生意参谋自定义日期范围最多选择 31 天'
          : '';
    if (message) {
      return {
        status: 'blocked',
        error: message,
        logs: [{ timestamp: new Date().toISOString(), level: 'error', message: `[date_range_invalid] ${message}` }]
      };
    }
  }
  if (mode === 'root-keyword') {
    const roots = parseRootKeywords(params.rootsText ?? params.roots);
    if (roots.length > 0) return null;
    const message = '请先在录入词根节点输入至少一个词根';
    return {
      status: 'blocked',
      error: message,
      logs: [{ timestamp: new Date().toISOString(), level: 'error', message: `[root_keywords_required] ${message}` }]
    };
  }
  if (mode !== 'keyword') return null;
  const keywords = parseExactKeywords(params.keywordsText ?? params.keywords ?? params.keyword);
  if (keywords.length > 20) {
    const message = '一次最多输入 20 个关键词';
    return {
      status: 'blocked',
      error: message,
      logs: [{
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `[keywords_limit_exceeded] ${message}`
      }]
    };
  }
  if (keywords.length > 0) return null;
  const message = '关键词不能为空';
  return {
    status: 'blocked',
    error: message,
    logs: [{
      timestamp: new Date().toISOString(),
      level: 'error',
      message: `[keyword_required] ${message}`
    }]
  };
}
