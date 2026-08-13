'use strict';

const fs = require('fs');
const path = require('path');
const { collectProductRankPage } = require('../sycm-research/src/product-rank');
const { generateOrderSheet } = require('./src/generate-order-sheet');
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
 * Ensure an order-sheet run has stable artifact paths.
 * @param {object} run Pipeline run metadata.
 * @param {string} runDir Pipeline run directory.
 * @returns {object} Run artifact paths.
 */
function ensureOrderSheetFiles(run, runDir) {
  run.files = run.files || {};
  run.files.productRank = run.files.productRank || path.join(runDir, 'sycm-product-rank.jsonl');
  run.files.orderSheet = run.files.orderSheet || path.join(runDir, '商品排行刷单表.xlsx');
  return run.files;
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
  const context = initRun({
    dataDir: options.dataDir || DEFAULT_FLOW_DIR,
    runId: options.runId,
    options: {
      mode: 'order-sheet',
      workflowVersion: 1,
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
      sortMetric: options.sortMetric || 'itmUv'
    }
  });
  const files = ensureOrderSheetFiles(context.run, context.runDir);
  try {
    const result = await collectProductRankPage({
      port: options.port,
      dateMode: options.dateMode,
      startDate: options.startDate,
      endDate: options.endDate,
      pages: options.pages,
      sortMetric: options.sortMetric,
      onProgress: options.onProgress
    });
    fs.writeFileSync(files.productRank, '', 'utf8');
    appendJsonl(files.productRank, result.rows.map(row => ({ ...row, statDate: result.meta.statDate, storeName: result.meta.storeName })));
    context.run.status = 'product_rank_collected';
    context.run.options = { ...(context.run.options || {}), mode: 'order-sheet', workflowVersion: 1 };
    context.run.counts = {
      ...(context.run.counts || {}),
      productRank: result.rows.length,
      productRankPages: result.meta.pagesCollected,
      orderSheetRows: 0
    };
    context.run.productRank = {
      ...result.meta,
      sort: result.sort,
      sortMetric: result.sortMetric,
      sortLabel: result.sortLabel,
      sortVerified: result.sortVerified
    };
    context.run.blockers = [];
    context.run.requiresUserAction = false;
    context.run.manualAction = null;
    writeRun(context.runDir, context.run);
    return { runId: context.runId, runDir: context.runDir, status: context.run.status, count: result.rows.length };
  } catch (error) {
    if (error.manualAction || error.code === 'SYCM_CHROME_REQUIRED' || error.code === 'SYCM_MANUAL_ACTION_REQUIRED') {
      return persistBlockedRun(context, error);
    }
    throw error;
  }
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
  buildOrderSheet,
  collectOrderSheetProducts,
  ensureOrderSheetFiles
};
