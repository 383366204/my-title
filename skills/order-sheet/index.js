'use strict';

const fs = require('fs');
const path = require('path');
const { collectProductRankPage } = require('../sycm-research/src/product-rank');
const { generateOrderSheet } = require('./src/generate-order-sheet');
const { parseManualItems, enrichManualItems } = require('./src/manual-items');
const {
  DEFAULT_ORDER_GROUP_SIZE,
  getProductKey,
  normalizeOrderProduct,
  autoGroupOrderProducts,
  rowsToOrderGroups,
  validateOrderGroups,
  assertValidOrderGroups,
  normalizeOrderGroups,
  flattenOrderGroups
} = require('./src/order-groups');
const {
  DEFAULT_FLOW_DIR,
  appendJsonl,
  getRun,
  initRun,
  readJsonl,
  writeRun
} = require('../pipeline-flow/src/run-store');

function safeFilename(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 50);
}

/**
 * Merge SYCM rank rows and manual items with deduplication by itemId.
 * Rank fields take priority for metrics, while explicit user fields (title, orderAmount, storeName, imageUrl) override.
 * @param {Array<object>} rankRows SYCM product rank rows.
 * @param {Array<object>} manualRows Normalized manual product items.
 * @returns {Array<object>} Merged deduplicated rows.
 */
function mergeOrderSheetProducts(rankRows = [], manualRows = []) {
  const rankMap = new Map();
  const result = [];

  for (const row of rankRows) {
    const itemId = String(row.itemId || '').trim();
    const normalized = {
      ...row,
      itemId,
      sourceType: row.sourceType || 'rank'
    };
    if (itemId) {
      rankMap.set(itemId, normalized);
    }
    result.push(normalized);
  }

  const seenManualIds = new Set();
  for (const manualRow of manualRows) {
    const itemId = String(manualRow.itemId || '').trim();
    const manualKey = itemId || String(manualRow.sourceKey || manualRow.productUrl || '').trim();
    if (!manualKey || seenManualIds.has(manualKey)) continue;
    seenManualIds.add(manualKey);

    if (itemId && rankMap.has(itemId)) {
      const existing = rankMap.get(itemId);
      if (manualRow.title) existing.title = manualRow.title;
      if (manualRow.storeName) existing.storeName = manualRow.storeName;
      if (manualRow.imageUrl) existing.imageUrl = manualRow.imageUrl;
      if (manualRow.orderAmount != null) existing.orderAmount = manualRow.orderAmount;
      existing.manualEnrichmentStatus = manualRow.enrichmentStatus || 'normalized';
      existing.manualEnrichmentSource = manualRow.enrichmentSource || '';
      existing.skuOptions = manualRow.skuOptions || [];
      existing.selectedSkuId = manualRow.selectedSkuId || '';
      existing.selectedSkuName = manualRow.selectedSkuName || '';
      existing.selectedSkuPrice = manualRow.selectedSkuPrice ?? null;
      existing.selectedSkuImageUrl = manualRow.selectedSkuImageUrl || '';
      existing.lowestSkuId = manualRow.lowestSkuId || '';
      existing.lowestSkuName = manualRow.lowestSkuName || '';
      existing.lowestSkuPrice = manualRow.lowestSkuPrice ?? manualRow.referencePrice ?? null;
      existing.skuSelectionMode = manualRow.skuSelectionMode || 'lowest';
    } else {
      result.push({
        rank: null,
        sourcePage: null,
        itemId,
        ...(manualRow.sourceKey ? { sourceKey: manualRow.sourceKey } : {}),
        title: manualRow.title || '',
        productUrl: manualRow.productUrl || (itemId ? `https://item.taobao.com/item.htm?id=${itemId}` : ''),
        imageUrl: manualRow.imageUrl || '',
        paymentAmount: manualRow.paymentAmount != null ? manualRow.paymentAmount : null,
        refundAmount: null,
        paidItemCount: null,
        cartItemCount: null,
        visitorCount: null,
        visitorChange: null,
        orderAmount: manualRow.orderAmount != null ? manualRow.orderAmount : null,
        referencePrice: manualRow.referencePrice != null ? manualRow.referencePrice : null,
        storeName: manualRow.storeName || '',
        sourceType: 'manual',
        enrichmentStatus: manualRow.enrichmentStatus || 'normalized',
        enrichmentSource: manualRow.enrichmentSource || '',
        skuOptions: manualRow.skuOptions || [],
        selectedSkuId: manualRow.selectedSkuId || '',
        selectedSkuName: manualRow.selectedSkuName || '',
        selectedSkuPrice: manualRow.selectedSkuPrice ?? null,
        selectedSkuImageUrl: manualRow.selectedSkuImageUrl || '',
        lowestSkuId: manualRow.lowestSkuId || '',
        lowestSkuName: manualRow.lowestSkuName || '',
        lowestSkuPrice: manualRow.lowestSkuPrice ?? manualRow.referencePrice ?? null,
        skuSelectionMode: manualRow.skuSelectionMode || 'lowest',
        enrichmentError: manualRow.enrichmentError || ''
      });
    }
  }

  return result;
}

/**
 * 保存用户补充的指定商品资料，并返回仍缺少标题的商品。
 * @param {object} [options] 更新选项。
 * @param {string} options.runId 运行 ID。
 * @param {string} [options.dataDir] pipeline 数据目录。
 * @param {Array<object>} options.items 用户补充的商品资料。
 * @returns {object} 更新结果。
 */
function updateOrderSheetManualProducts(options = {}) {
  const context = getRun({ dataDir: options.dataDir || DEFAULT_FLOW_DIR, runId: options.runId });
  const files = ensureOrderSheetFiles(context.run, context.runDir);
  const rows = readJsonl(files.productRank);
  const updates = parseManualItems(Array.isArray(options.items) ? options.items : [], '');
  const updatesByKey = new Map(updates.map(item => [item.itemId || item.sourceKey || item.productUrl, item]));

  const nextRows = rows.map(row => {
    const key = String(row.itemId || row.sourceKey || row.productUrl || '').trim();
    const update = updatesByKey.get(key);
    if (!update) return row;
    return {
      ...row,
      ...(update.title ? { title: update.title } : {}),
      ...(update.imageUrl ? { imageUrl: update.imageUrl } : {}),
      storeName: update.storeName,
      orderAmount: update.orderAmount,
      skuOptions: update.skuOptions?.length > 0 ? update.skuOptions : (row.skuOptions || []),
      selectedSkuId: update.selectedSkuId || row.selectedSkuId || '',
      selectedSkuName: update.selectedSkuName || row.selectedSkuName || '',
      selectedSkuPrice: update.selectedSkuPrice ?? row.selectedSkuPrice ?? null,
      selectedSkuImageUrl: update.selectedSkuImageUrl || row.selectedSkuImageUrl || '',
      lowestSkuId: update.lowestSkuId || row.lowestSkuId || '',
      lowestSkuName: update.lowestSkuName || row.lowestSkuName || '',
      lowestSkuPrice: update.lowestSkuPrice ?? row.lowestSkuPrice ?? row.referencePrice ?? null,
      skuSelectionMode: update.skuSelectionMode || row.skuSelectionMode || 'lowest',
      enrichmentStatus: update.title || row.title ? 'complete' : row.enrichmentStatus,
      enrichmentError: update.title || row.title ? '' : row.enrichmentError
    };
  });

  fs.writeFileSync(files.productRank, '', 'utf8');
  appendJsonl(files.productRank, nextRows);
  const missing = nextRows.filter(row => row.sourceType === 'manual' && !String(row.title || '').trim());
  const manualItems = nextRows
    .filter(row => row.sourceType === 'manual')
    .map(row => ({
      itemId: row.itemId || '',
      ...(row.sourceKey ? { sourceKey: row.sourceKey } : {}),
      productUrl: row.productUrl || '',
      title: row.title || '',
      imageUrl: row.imageUrl || '',
      storeName: row.storeName || '',
      orderAmount: row.orderAmount != null ? row.orderAmount : null,
      skuOptions: row.skuOptions || [],
      selectedSkuId: row.selectedSkuId || '',
      selectedSkuName: row.selectedSkuName || '',
      selectedSkuPrice: row.selectedSkuPrice ?? null,
      selectedSkuImageUrl: row.selectedSkuImageUrl || '',
      lowestSkuId: row.lowestSkuId || '',
      lowestSkuName: row.lowestSkuName || '',
      lowestSkuPrice: row.lowestSkuPrice ?? row.referencePrice ?? null,
      skuSelectionMode: row.skuSelectionMode || 'lowest',
      sourceType: 'manual',
      enrichmentStatus: row.enrichmentStatus || 'normalized'
    }));

  context.run.options = { ...(context.run.options || {}), manualItems };
  context.run.status = missing.length > 0 ? 'manual_action_required' : 'product_rank_collected';
  context.run.blockers = missing.length > 0 ? ['order_sheet_product_details_required'] : [];
  context.run.requiresUserAction = missing.length > 0;
  context.run.manualAction = missing.length > 0 ? {
    platform: 'taobao',
    status: 'product_details_required',
    userMessage: `${missing.length} 个指定商品仍缺少标题，请补充后继续。`,
    missingCount: missing.length,
    itemIds: missing.map(row => row.itemId).filter(Boolean)
  } : null;
  writeRun(context.runDir, context.run);
  return { runId: context.runId, count: nextRows.length, missingCount: missing.length, rows: nextRows, manualItems };
}

/**
 * Ensure an order-sheet run has stable artifact paths.
 * @param {object} run Pipeline run metadata.
 * @param {string} runDir Pipeline run directory.
 * @returns {object} Run artifact paths.
 */
function ensureOrderSheetFiles(run, runDir) {
  run.files = run.files || {};
  run.files.productRank = run.files.productRank || path.join(runDir, 'sycm-product-rank.jsonl');
  run.files.productGroups = run.files.productGroups || path.join(runDir, 'order-product-groups.json');
  run.files.orderSheet = run.files.orderSheet || path.join(runDir, '商品排行刷单表.xlsx');
  return run.files;
}

function readOrderGroupDocument(file) {
  if (!file || !fs.existsSync(file)) {
    return { version: 2, revision: 0, dragCount: DEFAULT_ORDER_GROUP_SIZE, groups: [], unassignedItems: [] };
  }
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    const version = Number(value.version) || 1;
    const groups = Array.isArray(value.groups) ? normalizeOrderGroups(value.groups) : [];
    const legacyGroupSize = groups.length > 0
      ? Math.max(...groups.map(group => 1 + (group.subProducts || []).length))
      : DEFAULT_ORDER_GROUP_SIZE;
    const storedGroupSize = Number.parseInt(value.dragCount, 10);
    return {
      ...value,
      version,
      revision: Number(value.revision) || 0,
      dragCount: version >= 2 && Number.isFinite(storedGroupSize) && storedGroupSize >= 1
        ? storedGroupSize
        : legacyGroupSize,
      groups,
      unassignedItems: Array.isArray(value.unassignedItems)
        ? value.unassignedItems.map(item => normalizeOrderProduct(item))
        : []
    };
  } catch (_) {
    return { version: 2, revision: 0, dragCount: DEFAULT_ORDER_GROUP_SIZE, groups: [], unassignedItems: [] };
  }
}

function writeOrderGroupDocument(file, document = {}) {
  const payload = {
    version: 2,
    revision: Math.max(1, Number(document.revision) || 1),
    runId: document.runId,
    dragCount: Math.max(1, Number.parseInt(document.dragCount, 10) || DEFAULT_ORDER_GROUP_SIZE),
    groups: normalizeOrderGroups(document.groups || []),
    unassignedItems: Array.isArray(document.unassignedItems)
      ? document.unassignedItems.map(item => normalizeOrderProduct(item))
      : [],
    updatedAt: new Date().toISOString(),
    ...(document.confirmedAt ? { confirmedAt: document.confirmedAt } : {})
  };
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

function assertDraftRevision(document, expectedRevision) {
  if (expectedRevision == null) return;
  if (Number(expectedRevision) !== Number(document.revision || 0)) {
    const error = new Error('商品组合已经在其他页面更新，请刷新后重新操作。');
    error.code = 'ORDER_SHEET_DRAFT_CONFLICT';
    throw error;
  }
}

function persistBlockedRun(context, error) {
  const run = context.run;
  ensureOrderSheetFiles(run, context.runDir);
  run.status = 'manual_action_required';
  run.options = { ...(run.options || {}), mode: 'order-sheet', workflowVersion: 1 };
  run.blockers = [error.status || 'sycm_manual_action_required'];
  run.requiresUserAction = true;
  run.manualAction = error.manualAction || {
    platform: 'sycm',
    status: error.status || 'manual_action_required',
    userMessage: error.message
  };
  writeRun(context.runDir, run);
  return {
    runId: context.runId,
    runDir: context.runDir,
    status: run.status,
    platform: 'sycm',
    manualAction: run.manualAction
  };
}

/**
 * 按配置采集生意参谋商品排行并写入运行产物。
 * @param {object} [options] 采集选项。
 * @param {string} [options.dataDir] pipeline 数据目录。
 * @param {string} options.runId 运行 ID。
 * @param {number} [options.port] Chrome 调试端口。
 * @param {Function} [options.onProgress] 进度回调。
 * @returns {Promise<object>} pipeline 步骤结果。
 */
async function collectOrderSheetProducts(options = {}) {
  const inputMode = ['rank', 'manual', 'hybrid'].includes(String(options.inputMode || ''))
    ? String(options.inputMode)
    : 'rank';
  const parsedManualItems = parseManualItems(options.manualItems, options.manualItemsText);

  if (inputMode === 'manual' && parsedManualItems.length === 0) {
    throw new Error('指定商品模式下必须包含至少 1 个淘宝或天猫商品 ID/链接');
  }

  const context = initRun({
    dataDir: options.dataDir || DEFAULT_FLOW_DIR,
    runId: options.runId,
    options: {
      mode: 'order-sheet',
      workflowVersion: 1,
      inputMode,
      port: Number(options.port || 9222),
      dateMode: options.dateMode || 'latest_day',
      startDate: options.startDate || '',
      endDate: options.endDate || '',
      orderDate: options.orderDate || '',
      storeName: options.storeName || '',
      sheetType: options.sheetType === 'review' ? 'review' : 'order',
      productLimit: Number(options.productLimit || 0),
      fileName: options.fileName || '',
      includeRawData: options.includeRawData !== false,
      includeImages: options.includeImages !== false,
      amountMode: options.amountMode || 'average',
      missingAmountPolicy: options.missingAmountPolicy || 'blank',
      cartQuantity: Number(options.cartQuantity || 1),
      rowSpan: Number(options.rowSpan || 3),
      workRequirement: options.workRequirement || '',
      orderNote: options.orderNote || '',
      reviewGroupSize: Number(options.reviewGroupSize || 4),
      includeSpacerRow: options.includeSpacerRow !== false,
      pages: Number(options.pages || 1),
      sortMetric: options.sortMetric || 'itmUv',
      manualItemsText: options.manualItemsText || '',
      manualItems: parsedManualItems
    }
  });
  const files = ensureOrderSheetFiles(context.run, context.runDir);
  try {
    let rankResult = { rows: [], meta: {} };
    if (inputMode === 'rank' || inputMode === 'hybrid') {
      rankResult = await collectProductRankPage({
        port: options.port,
        dateMode: options.dateMode,
        startDate: options.startDate,
        endDate: options.endDate,
        pages: options.pages,
        sortMetric: options.sortMetric,
        onProgress: options.onProgress
      });
    }

    const enricher = typeof options.enrichManualItems === 'function' ? options.enrichManualItems : enrichManualItems;
    const enrichedManual = (inputMode === 'manual' || inputMode === 'hybrid')
      ? await enricher(parsedManualItems, { ...options, onProgress: options.onProgress })
      : [];

    const rankRows = (rankResult.rows || []).map(row => ({
      ...row,
      statDate: rankResult.meta?.statDate || row.statDate || '',
      storeName: rankResult.meta?.storeName || row.storeName || options.storeName || '',
      sourceType: 'rank'
    }));

    const finalRows = mergeOrderSheetProducts(rankRows, enrichedManual);

    fs.writeFileSync(files.productRank, '', 'utf8');
    appendJsonl(files.productRank, finalRows);

    const rankCount = rankRows.length;
    const manualCount = enrichedManual.length;
    const storeName = rankResult.meta?.storeName || options.storeName || enrichedManual[0]?.storeName || '';
    const statDate = rankResult.meta?.statDate || options.orderDate || (new Date()).toISOString().slice(0, 10);

    context.run.status = 'product_rank_collected';
    context.run.options = { ...(context.run.options || {}), mode: 'order-sheet', workflowVersion: 1, inputMode };
    context.run.counts = {
      ...(context.run.counts || {}),
      productRank: finalRows.length,
      productRankPages: rankResult.meta?.pagesCollected || 0,
      rankCount,
      manualCount,
      orderSheetRows: 0
    };
    context.run.productRank = {
      ...(rankResult.meta || {}),
      storeName,
      statDate,
      inputMode,
      rankCount,
      manualCount,
      totalCount: finalRows.length,
      sort: rankResult.sort || '',
      sortMetric: rankResult.sortMetric || options.sortMetric || 'itmUv',
      sortLabel: rankResult.sortLabel || '',
      sortVerified: rankResult.sortVerified || false
    };
    const incompleteManualRows = finalRows.filter(row => row.sourceType === 'manual' && !String(row.title || '').trim());
    if (incompleteManualRows.length > 0) {
      context.run.status = 'manual_action_required';
      context.run.blockers = ['order_sheet_product_details_required'];
      context.run.requiresUserAction = true;
      context.run.manualAction = {
        platform: 'taobao',
        status: 'product_details_required',
        userMessage: `${incompleteManualRows.length} 个指定商品没有读取到标题。请补充商品资料后继续。`,
        missingCount: incompleteManualRows.length,
        itemIds: incompleteManualRows.map(row => row.itemId).filter(Boolean)
      };
      writeRun(context.runDir, context.run);
      return {
        runId: context.runId,
        runDir: context.runDir,
        status: context.run.status,
        count: finalRows.length,
        rankCount,
        manualCount,
        missingCount: incompleteManualRows.length,
        manualAction: context.run.manualAction
      };
    }
    context.run.blockers = [];
    context.run.requiresUserAction = false;
    context.run.manualAction = null;
    writeRun(context.runDir, context.run);
    return {
      runId: context.runId,
      runDir: context.runDir,
      status: context.run.status,
      count: finalRows.length,
      rankCount,
      manualCount
    };
  } catch (error) {
    if (error.manualAction || error.code === 'SYCM_CHROME_REQUIRED' || error.code === 'SYCM_MANUAL_ACTION_REQUIRED') {
      return persistBlockedRun(context, error);
    }
    throw error;
  }
}

/**
 * 准备刷单表商品与编组草稿，并将状态置为 needs_review 以等待人工确认。
 * @param {object} [options] 选项。
 * @param {string} options.runId 运行 ID。
 * @param {string} [options.dataDir] pipeline 数据目录。
 * @param {number} [options.dragCount] 默认 1 拖 N 编组数。
 * @param {Function} [options.onProgress] 进度回调。
 * @returns {Promise<object>} 草稿准备结果。
 */
async function prepareOrderSheetDraft(options = {}) {
  const context = getRun({ dataDir: options.dataDir || DEFAULT_FLOW_DIR, runId: options.runId });
  const files = ensureOrderSheetFiles(context.run, context.runDir);
  const rows = readJsonl(files.productRank);

  const currentDraft = readOrderGroupDocument(files.productGroups);
  let groups = currentDraft.groups.length > 0 ? currentDraft.groups : null;
  let draft = currentDraft;

  if (!groups) {
    const dragCount = Number.isFinite(Number(options.dragCount))
      ? Number(options.dragCount)
      : (Number.isFinite(Number(context.run.options?.dragCount)) ? Number(context.run.options.dragCount) : DEFAULT_ORDER_GROUP_SIZE);
    groups = normalizeOrderGroups(rows, { dragCount });
    draft = writeOrderGroupDocument(files.productGroups, {
      runId: context.runId,
      revision: currentDraft.revision + 1,
      dragCount,
      groups,
      unassignedItems: []
    });
  }

  context.run.status = 'needs_review';
  context.run.requiresUserAction = true;
  context.run.mustReview = true;
  context.run.counts = {
    ...(context.run.counts || {}),
    orderGroups: groups.length,
    confirmedProducts: rows.length
  };
  writeRun(context.runDir, context.run);
  return {
    runId: context.runId,
    runDir: context.runDir,
    status: 'needs_review',
    count: rows.length,
    groupCount: groups.length,
    dragCount: draft.dragCount,
    revision: draft.revision,
    groups,
    unassignedItems: draft.unassignedItems
  };
}

/**
 * 读取刷单表草稿数据（包含 items 与 groups）。
 * @param {object} [options] 读取选项。
 * @param {string} options.runId 运行 ID。
 * @param {string} [options.dataDir] pipeline 数据目录。
 * @returns {object} 草稿数据。
 */
function getOrderSheetDraft(options = {}) {
  const context = getRun({ dataDir: options.dataDir || DEFAULT_FLOW_DIR, runId: options.runId });
  const files = ensureOrderSheetFiles(context.run, context.runDir);
  const rows = readJsonl(files.productRank);

  const document = readOrderGroupDocument(files.productGroups);
  let groups = document.groups;
  let dragCount = document.dragCount;

  if (groups.length === 0 && rows.length > 0) {
    dragCount = Number.isFinite(Number(context.run.options?.dragCount))
      ? Math.max(1, Number(context.run.options.dragCount))
      : DEFAULT_ORDER_GROUP_SIZE;
    groups = normalizeOrderGroups(rows, { dragCount });
  }

  const missingCount = rows.filter(row => row.sourceType === 'manual' && !String(row.title || '').trim()).length;

  return {
    runId: context.runId,
    status: context.run.status,
    count: rows.length,
    groupCount: groups.length,
    missingCount,
    revision: document.revision,
    dragCount,
    groups,
    unassignedItems: document.unassignedItems,
    items: rows,
    options: context.run.options || {},
    productRank: context.run.productRank || null
  };
}

/**
 * 建立"商品标识 -> 已存盘完整资料"的索引，用于补齐前端省略的静态字段。
 * @param {Array<object>} rows sycm-product-rank.jsonl 中的商品行
 * @param {object} draft 当前已存盘的编组文档
 * @returns {Map<string, object>} 商品资料索引
 */
function buildProductCatalog(rows, draft) {
  const catalog = new Map();
  const remember = (product) => {
    if (!product || typeof product !== 'object') return;
    const key = getProductKey(product);
    if (key && !catalog.has(key)) catalog.set(key, product);
  };
  (Array.isArray(rows) ? rows : []).forEach(remember);
  (draft.groups || []).forEach(group => {
    remember(group.mainProduct);
    (group.subProducts || []).forEach(remember);
  });
  (draft.unassignedItems || []).forEach(remember);
  return catalog;
}

/**
 * 用已存盘资料补齐单个商品：客户端显式提交的字段优先，未提交的字段以服务端为准。
 * @param {object} product 客户端回传的最小商品对象
 * @param {Map<string, object>} catalog buildProductCatalog 的结果
 * @returns {object} 补齐后的商品对象
 */
function restoreProductFields(product, catalog) {
  if (!product || typeof product !== 'object') return product;
  const stored = catalog.get(getProductKey(product));
  return stored ? { ...stored, ...product } : product;
}

function restoreDraftGroups(groups, catalog) {
  return groups.map(group => ({
    ...group,
    mainProduct: restoreProductFields(group.mainProduct, catalog),
    subProducts: (group.subProducts || []).map(item => restoreProductFields(item, catalog))
  }));
}

function restoreDraftProducts(list, catalog) {
  return list.map(item => restoreProductFields(item, catalog));
}

/**
 * 保存刷单表草稿（更新商品资料或商品编组，但不推进至生成表格）。
 * @param {object} [options] 保存选项。
 * @param {string} options.runId 运行 ID。
 * @param {string} [options.dataDir] pipeline 数据目录。
 * @param {Array<object>} [options.items] 更新的商品列表。
 * @param {Array<object>} [options.groups] 更新的编组列表。
 * @returns {object} 保存结果。
 */
function saveOrderSheetDraft(options = {}) {
  const context = getRun({ dataDir: options.dataDir || DEFAULT_FLOW_DIR, runId: options.runId });
  const files = ensureOrderSheetFiles(context.run, context.runDir);

  if (Array.isArray(options.items) && options.items.length > 0) {
    updateOrderSheetManualProducts({
      runId: options.runId,
      dataDir: options.dataDir,
      items: options.items
    });
  }

  const currentDraft = readOrderGroupDocument(files.productGroups);
  assertDraftRevision(currentDraft, options.expectedRevision);
  const rows = readJsonl(files.productRank);
  // 前端只回传可编辑字段，这里补齐 skuOptions、主图等静态数据，避免 413 又不丢规格
  const catalog = buildProductCatalog(rows, currentDraft);
  let nextGroups = currentDraft.groups;
  if (Array.isArray(options.groups)) {
    nextGroups = normalizeOrderGroups(restoreDraftGroups(options.groups, catalog));
  }
  const savedDraft = writeOrderGroupDocument(files.productGroups, {
    runId: context.runId,
    revision: currentDraft.revision + 1,
    dragCount: options.dragCount == null ? currentDraft.dragCount : options.dragCount,
    groups: nextGroups,
    unassignedItems: Array.isArray(options.unassignedItems)
      ? restoreDraftProducts(options.unassignedItems, catalog)
      : currentDraft.unassignedItems
  });

  const missingCount = rows.filter(row => row.sourceType === 'manual' && !String(row.title || '').trim()).length;

  context.run.counts = {
    ...(context.run.counts || {}),
    orderGroups: nextGroups.length,
    productRank: rows.length
  };
  writeRun(context.runDir, context.run);

  return {
    runId: context.runId,
    count: rows.length,
    groupCount: nextGroups.length,
    missingCount,
    revision: savedDraft.revision,
    dragCount: savedDraft.dragCount,
    groups: nextGroups,
    unassignedItems: savedDraft.unassignedItems
  };
}

/**
 * 最终确认商品与编组，校验组内无重复商品、资料完整后将状态置为 products_confirmed。
 * @param {object} [options] 确认选项。
 * @param {string} options.runId 运行 ID。
 * @param {string} [options.dataDir] pipeline 数据目录。
 * @param {Array<object>} [options.items] 可选传入的最终商品修改。
 * @param {Array<object>} [options.groups] 可选传入的最终编组修改。
 * @returns {object} 确认结果。
 */
function confirmOrderSheetProducts(options = {}) {
  const context = getRun({ dataDir: options.dataDir || DEFAULT_FLOW_DIR, runId: options.runId });
  const files = ensureOrderSheetFiles(context.run, context.runDir);

  if (Array.isArray(options.items) && options.items.length > 0) {
    updateOrderSheetManualProducts({
      runId: options.runId,
      dataDir: options.dataDir,
      items: options.items
    });
  }

  const currentDraft = readOrderGroupDocument(files.productGroups);
  assertDraftRevision(currentDraft, options.expectedRevision);
  const rows = readJsonl(files.productRank);
  const missing = rows.filter(row => row.sourceType === 'manual' && !String(row.title || '').trim());
  if (missing.length > 0) {
    const err = new Error(`仍有 ${missing.length} 个指定商品缺少标题，请补充后继续`);
    err.code = 'ORDER_SHEET_PRODUCT_DETAILS_REQUIRED';
    err.missingCount = missing.length;
    throw err;
  }

  // 前端只回传可编辑字段，这里补齐静态数据后再校验
  const catalog = buildProductCatalog(rows, currentDraft);
  const rawGroups = Array.isArray(options.groups)
    ? restoreDraftGroups(options.groups, catalog)
    : (currentDraft.groups.length > 0 ? currentDraft.groups : rows);
  const groups = normalizeOrderGroups(rawGroups);
  const dragCount = Math.max(1, Number.parseInt(
    options.dragCount == null ? currentDraft.dragCount : options.dragCount,
    10
  ) || DEFAULT_ORDER_GROUP_SIZE);

  // 校验分组
  assertValidOrderGroups(groups, { groupSize: dragCount });

  const flattened = flattenOrderGroups(groups);
  const savedDraft = writeOrderGroupDocument(files.productGroups, {
    runId: context.runId,
    revision: currentDraft.revision + 1,
    dragCount,
    groups,
    unassignedItems: Array.isArray(options.unassignedItems)
      ? restoreDraftProducts(options.unassignedItems, catalog)
      : currentDraft.unassignedItems,
    confirmedAt: new Date().toISOString()
  });

  context.run.status = 'products_confirmed';
  context.run.requiresUserAction = false;
  context.run.mustReview = false;
  context.run.blockers = [];
  context.run.manualAction = null;
  context.run.counts = {
    ...(context.run.counts || {}),
    orderGroups: groups.length,
    productRank: flattened.length,
    confirmedProducts: flattened.length
  };
  writeRun(context.runDir, context.run);

  return {
    runId: context.runId,
    count: flattened.length,
    groupCount: groups.length,
    revision: savedDraft.revision,
    dragCount: savedDraft.dragCount,
    groups,
    unassignedItems: savedDraft.unassignedItems
  };
}

/**
 * 将已采集的商品排行生成 Excel 工作簿。
 * @param {object} [options] 生成选项。
 * @param {string} [options.dataDir] pipeline 数据目录。
 * @param {string} options.runId 运行 ID。
 * @param {Function} [options.onProgress] 进度回调。
 * @returns {Promise<object>} pipeline 步骤结果。
 */
async function buildOrderSheet(options = {}) {
  const context = getRun({ dataDir: options.dataDir || DEFAULT_FLOW_DIR, runId: options.runId });
  const files = ensureOrderSheetFiles(context.run, context.runDir);
  const rows = readJsonl(files.productRank);
  const groupDocument = readOrderGroupDocument(files.productGroups);
  const groups = groupDocument.groups.length > 0 ? groupDocument.groups : null;
  const generationOptions = { ...(context.run.options || {}), ...options };
  const storeName = String(generationOptions.storeName || context.run.productRank?.storeName || rows[0]?.storeName || '').trim();
  const orderDate = generationOptions.orderDate || '';
  const sheetType = generationOptions.sheetType === 'review' ? 'review' : 'order';
  const statDate = context.run.productRank?.statDate || rows[0]?.statDate || '';
  const sortLabel = context.run.productRank?.sortLabel || rows[0]?.sortLabel || '商品访客数';
  const customFileName = safeFilename(generationOptions.fileName);
  const filenameParts = customFileName
    ? [customFileName]
    : [sheetType === 'review' ? '商品评价表' : '商品排行刷单表', safeFilename(storeName), safeFilename(statDate), safeFilename(sortLabel)].filter(Boolean);
  files.orderSheet = path.join(context.runDir, `${filenameParts.join('-').replace(/\.xlsx$/i, '')}.xlsx`);
  const result = await generateOrderSheet({
    rows,
    groups,
    meta: {
      storeName,
      statDate,
      startDate: context.run.productRank?.startDate || '',
      endDate: context.run.productRank?.endDate || '',
      period: context.run.productRank?.period || '日',
      sort: context.run.productRank?.sort || 'itmUv_desc',
      sortLabel,
      pages: context.run.productRank?.pagesCollected || 1,
      orderDate
    },
    outputFile: files.orderSheet,
    sheetType,
    productLimit: generationOptions.productLimit,
    includeRawData: generationOptions.includeRawData,
    includeImages: generationOptions.includeImages,
    amountMode: generationOptions.amountMode,
    missingAmountPolicy: generationOptions.missingAmountPolicy,
    cartQuantity: generationOptions.cartQuantity,
    rowSpan: generationOptions.rowSpan,
    dragCount: groupDocument.dragCount,
    workRequirement: generationOptions.workRequirement,
    orderNote: generationOptions.orderNote,
    reviewGroupSize: generationOptions.reviewGroupSize,
    includeSpacerRow: generationOptions.includeSpacerRow,
    onProgress: options.onProgress
  });
  context.run.status = 'workflow_complete';
  context.run.options = {
    ...(context.run.options || {}),
    mode: 'order-sheet',
    workflowVersion: 1,
    orderDate,
    storeName,
    sheetType,
    productLimit: Number(generationOptions.productLimit || 0),
    fileName: generationOptions.fileName || '',
    includeRawData: generationOptions.includeRawData !== false,
    includeImages: generationOptions.includeImages !== false,
    amountMode: generationOptions.amountMode || 'average',
    missingAmountPolicy: generationOptions.missingAmountPolicy || 'blank',
    cartQuantity: Number(generationOptions.cartQuantity || 1),
    rowSpan: Number(generationOptions.rowSpan || 3),
    dragCount: groupDocument.dragCount,
    workRequirement: generationOptions.workRequirement || '',
    orderNote: generationOptions.orderNote || '',
    reviewGroupSize: Number(generationOptions.reviewGroupSize || 4),
    includeSpacerRow: generationOptions.includeSpacerRow !== false
  };
  context.run.counts = {
    ...(context.run.counts || {}),
    orderSheetRows: result.count,
    orderSheetImages: result.imageCount,
    orderSheetSkipped: result.skippedCount
  };
  context.run.files = files;
  context.run.requiresUserAction = false;
  context.run.blockers = [];
  context.run.nextCommand = '';
  writeRun(context.runDir, context.run);
  return { runId: context.runId, runDir: context.runDir, status: context.run.status, ...result };
}

module.exports = {
  DEFAULT_ORDER_GROUP_SIZE,
  buildOrderSheet,
  collectOrderSheetProducts,
  confirmOrderSheetProducts,
  ensureOrderSheetFiles,
  getOrderSheetDraft,
  mergeOrderSheetProducts,
  prepareOrderSheetDraft,
  saveOrderSheetDraft,
  updateOrderSheetManualProducts,
  getProductKey,
  normalizeOrderProduct,
  autoGroupOrderProducts,
  rowsToOrderGroups,
  validateOrderGroups,
  assertValidOrderGroups,
  normalizeOrderGroups,
  flattenOrderGroups
};
