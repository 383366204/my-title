'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const ExcelJS = require('exceljs');

function sanitizeText(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

/**
 * Write Excel and JSON reports for peer-analysis branch.
 * @param {object} options
 * @returns {Promise<object>}
 */
async function writePeerReport(options = {}) {
  const { runId, runDir } = options;
  if (!runDir) throw new Error('运行目录缺失');
  const outputDir = options.outputDir || runDir;

  const evaluations = Array.isArray(options.evaluations) ? options.evaluations : [];
  const candidateShops = Array.isArray(options.candidateShops) ? options.candidateShops : [];
  const errors = Array.isArray(options.errors) ? options.errors : [];

  const qualified = evaluations.filter(e => e.verdict === 'qualified');
  const unqualified = evaluations.filter(e => e.verdict === 'unqualified');
  const inconclusive = evaluations.filter(e => e.verdict === 'inconclusive');
  const blocked = evaluations.filter(e => e.verdict === 'blocked');

  // 1. JSON 报告
  const jsonReport = {
    runId: runId || path.basename(runDir),
    generatedAt: new Date().toISOString(),
    summary: {
      totalCandidates: candidateShops.length,
      evaluatedCount: evaluations.length,
      qualifiedCount: qualified.length,
      unqualifiedCount: unqualified.length,
      inconclusiveCount: inconclusive.length,
      blockedCount: blocked.length,
      errorCount: errors.length
    },
    qualifiedShops: qualified,
    unqualifiedShops: unqualified,
    inconclusiveShops: inconclusive,
    blockedShops: blocked,
    errors
  };

  const jsonPath = path.join(outputDir, 'peer-discovery-result.json');
  await fs.writeFile(jsonPath, JSON.stringify(jsonReport, null, 2), 'utf8');

  // 2. Excel 报告
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ecom-ai-tools';
  workbook.created = new Date();

  // 工作表 1: 同行店铺
  const ws1 = workbook.addWorksheet('同行店铺');
  ws1.columns = [
    { header: '店铺名', key: 'shopName', width: 25 },
    { header: '店铺链接', key: 'shopUrl', width: 35 },
    { header: '采集商品数', key: 'totalCollected', width: 14 },
    { header: '付款达标数', key: 'paymentQualifiedCount', width: 14 },
    { header: '货源已验证数', key: 'sourcingVerifiedCount', width: 14 },
    { header: '确认货源数', key: 'sourcingConfirmedCount', width: 14 },
    { header: '疑似货源数', key: 'sourcingSuspectedCount', width: 14 },
    { header: '判定结果', key: 'verdict', width: 14 }
  ];
  ws1.getRow(1).font = { bold: true };
  for (const q of qualified) {
    ws1.addRow({
      shopName: sanitizeText(q.shopName || q.shopKey),
      shopUrl: sanitizeText(q.shopUrl || ''),
      totalCollected: q.totalCollected || q.products?.length || 0,
      paymentQualifiedCount: q.paymentQualifiedCount || 0,
      sourcingVerifiedCount: q.sourcingVerifiedCount || 0,
      sourcingConfirmedCount: q.sourcingConfirmedCount || 0,
      sourcingSuspectedCount: q.sourcingSuspectedCount || 0,
      verdict: 'qualified'
    });
  }

  // 工作表 2: 达标商品清单
  const ws2 = workbook.addWorksheet('达标商品清单');
  ws2.columns = [
    { header: '所属店铺', key: 'shopName', width: 20 },
    { header: '商品标题', key: 'title', width: 35 },
    { header: '商品链接', key: 'productUrl', width: 35 },
    { header: '淘宝价', key: 'taobaoPrice', width: 12 },
    { header: '付款人数', key: 'paymentText', width: 14 },
    { header: '1688货源标题', key: 'aliTitle', width: 35 },
    { header: '1688比较单价', key: 'aliComparablePrice', width: 14 },
    { header: '价格比', key: 'priceRatio', width: 12 },
    { header: '相似度', key: 'similarity', width: 12 },
    { header: '货源级别', key: 'level', width: 14 }
  ];
  ws2.getRow(1).font = { bold: true };
  for (const eval_ of evaluations) {
    if (Array.isArray(eval_.products)) {
      for (const p of eval_.products) {
        if (p.sourcing) {
          ws2.addRow({
            shopName: sanitizeText(eval_.shopName || eval_.shopKey),
            title: sanitizeText(p.title),
            productUrl: sanitizeText(p.productUrl || ''),
            taobaoPrice: p.taobaoPrice ?? '',
            paymentText: sanitizeText(p.paymentText || ''),
            aliTitle: sanitizeText(p.sourcing.aliTitle || ''),
            aliComparablePrice: p.sourcing.aliComparablePrice ?? '',
            priceRatio: p.sourcing.priceRatio != null ? Number(p.sourcing.priceRatio.toFixed(2)) : '',
            similarity: p.sourcing.similarity != null ? Number(p.sourcing.similarity.toFixed(2)) : '',
            level: sanitizeText(p.sourcing.level || '')
          });
        }
      }
    }
  }

  // 工作表 3: 未达标与无法判定
  const ws3 = workbook.addWorksheet('未达标与无法判定');
  ws3.columns = [
    { header: '店铺名', key: 'shopName', width: 25 },
    { header: '判定结果', key: 'verdict', width: 15 },
    { header: '原因说明', key: 'reason', width: 45 },
    { header: '付款达标数', key: 'paymentQualifiedCount', width: 14 },
    { header: '确认货源数', key: 'sourcingConfirmedCount', width: 14 }
  ];
  ws3.getRow(1).font = { bold: true };
  for (const item of [...unqualified, ...inconclusive, ...blocked]) {
    ws3.addRow({
      shopName: sanitizeText(item.shopName || item.shopKey),
      verdict: sanitizeText(item.verdict),
      reason: sanitizeText(item.reason || ''),
      paymentQualifiedCount: item.paymentQualifiedCount || 0,
      sourcingConfirmedCount: item.sourcingConfirmedCount || 0
    });
  }

  // 工作表 4: 错误记录
  const ws4 = workbook.addWorksheet('错误记录');
  ws4.columns = [
    { header: '店铺键', key: 'shopKey', width: 25 },
    { header: '错误阶段', key: 'stage', width: 18 },
    { header: '错误信息', key: 'error', width: 45 }
  ];
  ws4.getRow(1).font = { bold: true };
  for (const err of errors) {
    ws4.addRow({
      shopKey: sanitizeText(err.shopKey || ''),
      stage: sanitizeText(err.stage || 'evaluateShops'),
      error: sanitizeText(err.error || err.message || '')
    });
  }

  const excelPath = path.join(outputDir, '同行发现报告.xlsx');
  await workbook.xlsx.writeFile(excelPath);

  return {
    jsonPath,
    excelPath,
    summary: jsonReport.summary
  };
}

/**
 * Runner step adapter for peerReport.
 * @param {object} options
 * @returns {Promise<object>}
 */
async function runPeerReportStep(options = {}) {
  const { runDir, runId } = options;
  if (!runDir) throw new Error('运行目录缺失');

  const evalsFile = path.join(runDir, 'shop-evaluations.jsonl');
  let evaluations = [];
  try {
    const content = await fs.readFile(evalsFile, 'utf8');
    evaluations = content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  } catch (_) {
    evaluations = [];
  }

  const candidatesFile = path.join(runDir, 'candidate-shops.jsonl');
  let candidateShops = [];
  try {
    const content = await fs.readFile(candidatesFile, 'utf8');
    candidateShops = content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  } catch (_) {
    candidateShops = [];
  }

  const result = await writePeerReport({
    runId: runId || path.basename(runDir),
    runDir,
    evaluations,
    candidateShops,
    errors: options.errors || []
  });

  return {
    status: 'completed',
    ...result
  };
}

module.exports = {
  writePeerReport,
  runPeerReportStep
};
