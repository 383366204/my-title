'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const ExcelJS = require('exceljs');
const { createPeerStateStore } = require('./state-store');

/**
 * Sanitize text to prevent Excel formula injection.
 * @param {unknown} value
 * @returns {string}
 */
function sanitizeText(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

/**
 * Write JSON and Excel reports for the image-selection branch.
 * @param {object} options
 * @param {string} options.runId
 * @param {string} options.runDir
 * @param {object} [options.bundle]
 * @param {object} [options.allocationPlan]
 * @param {object[]} [options.ledger]
 * @param {string} [options.outputDir]
 * @returns {Promise<object>}
 */
async function writePeerProductReport(options = {}) {
  const { runId, runDir } = options;
  if (!runDir) throw new Error('运行目录缺失');
  const outputDir = options.outputDir || runDir;

  const bundle = options.bundle || { activeDrafts: [] };
  const drafts = bundle.activeDrafts || [];
  const allocationPlan = options.allocationPlan || { items: [] };
  const items = allocationPlan.items || [];
  const ledger = options.ledger || [];

  const successCount = ledger.filter(e => e.status === 'success').length;
  const failedCount = ledger.filter(e => e.status === 'failed').length;
  const unknownCount = ledger.filter(e => e.status === 'unknown').length;

  const reportRevision = `report_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const summary = {
    totalDrafts: drafts.length,
    totalAllocated: items.length,
    totalSubmissions: ledger.length,
    successCount,
    failedCount,
    unknownCount
  };

  // 1. JSON 报告
  const jsonReport = {
    runId,
    reportRevision,
    generatedAt: new Date().toISOString(),
    summary,
    drafts,
    allocationPlan,
    ledger
  };
  const jsonPath = path.join(outputDir, 'peer-product-result.json');
  await fs.writeFile(jsonPath, JSON.stringify(jsonReport, null, 2), 'utf8');

  // 2. Excel 报告
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ecom-ai-tools';
  workbook.created = new Date();

  // 工作表 1: 汇总
  const summarySheet = workbook.addWorksheet('选品与铺货汇总');
  summarySheet.columns = [{ key: 'label', width: 24 }, { key: 'value', width: 60 }];
  summarySheet.addRows([
    { label: '运行 ID', value: sanitizeText(runId) },
    { label: '报告版本', value: sanitizeText(reportRevision) },
    { label: '生成时间', value: sanitizeText(new Date().toLocaleString('zh-CN')) },
    { label: '草稿商品总数', value: summary.totalDrafts },
    { label: '计划分配项数', value: summary.totalAllocated },
    { label: '提交成功数', value: summary.successCount },
    { label: '提交失败数', value: summary.failedCount },
    { label: '状态未知数', value: summary.unknownCount },
    { label: '分配模式', value: sanitizeText(allocationPlan.mode || 'sequential-average') }
  ]);
  summarySheet.getColumn('label').font = { bold: true };

  // 工作表 2: 商品与草稿明细
  const draftsSheet = workbook.addWorksheet('商品与草稿明细');
  draftsSheet.columns = [
    { header: '草稿键', key: 'draftKey', width: 24 },
    { header: '1688货源ID', key: 'offerId', width: 18 },
    { header: '铺货标题', key: 'title', width: 45 },
    { header: '目标类目ID', key: 'category', width: 16 },
    { header: '标题来源', key: 'titleSource', width: 14 },
    { header: '是否待处理', key: 'needsInput', width: 14 },
    { header: '错误诊断', key: 'titleError', width: 25 }
  ];
  draftsSheet.getRow(1).font = { bold: true };
  for (const d of drafts) {
    draftsSheet.addRow({
      draftKey: sanitizeText(d.draftKey),
      offerId: sanitizeText(d.offerId),
      title: sanitizeText(d.title),
      category: sanitizeText(d.category || '未设置'),
      titleSource: sanitizeText(d.titleSource),
      needsInput: d.needsInput ? '是' : '否',
      titleError: sanitizeText(d.titleError || '')
    });
  }

  // 工作表 3: 店铺分配与提交
  const allocSheet = workbook.addWorksheet('店铺分配与提交');
  allocSheet.columns = [
    { header: '目标店铺ID', key: 'targetShopId', width: 20 },
    { header: '1688货源ID', key: 'offerId', width: 18 },
    { header: '提交状态', key: 'status', width: 14 },
    { header: '批次ID', key: 'batchId', width: 25 },
    { header: '提交时间', key: 'submittedAt', width: 22 },
    { header: '错误信息', key: 'error', width: 30 }
  ];
  allocSheet.getRow(1).font = { bold: true };

  const ledgerMap = new Map();
  for (const entry of ledger) {
    ledgerMap.set(`${entry.targetShopId}#${entry.offerId}`, entry);
  }

  for (const item of items) {
    const entry = ledgerMap.get(`${item.targetShopId}#${item.offerId}`);
    allocSheet.addRow({
      targetShopId: sanitizeText(item.targetShopId),
      offerId: sanitizeText(item.offerId),
      status: sanitizeText(entry?.status || '待提交'),
      batchId: sanitizeText(entry?.batchId || ''),
      submittedAt: entry?.submittedAt ? sanitizeText(new Date(entry.submittedAt).toLocaleString('zh-CN')) : '',
      error: sanitizeText(entry?.error || '')
    });
  }

  const excelPath = path.join(outputDir, '图搜选货铺货报告.xlsx');
  await workbook.xlsx.writeFile(excelPath);

  return {
    jsonPath,
    excelPath,
    summary,
    reportRevision
  };
}

/**
 * Runner step adapter for peerProductReport.
 * @param {object} options
 * @returns {Promise<object>}
 */
async function runPeerProductReportStep(options = {}) {
  const { runDir, runId } = options;
  if (!runDir) throw new Error('运行目录缺失');

  const store = options.store || createPeerStateStore(runDir);
  const state = await store.read().catch(() => null);

  const bundle = state?.bundle || null;
  const allocationPlan = state?.allocationPlan || null;

  // 读取账本
  const ledgerFile = path.join(runDir, 'peer-submissions.jsonl');
  let ledger = [];
  try {
    const content = await fs.readFile(ledgerFile, 'utf8');
    ledger = content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  } catch (_) {
    ledger = [];
  }

  const result = await writePeerProductReport({
    runId: runId || path.basename(runDir),
    runDir,
    bundle,
    allocationPlan,
    ledger
  });

  return {
    status: 'completed',
    ...result
  };
}

module.exports = {
  writePeerProductReport,
  runPeerProductReportStep
};
