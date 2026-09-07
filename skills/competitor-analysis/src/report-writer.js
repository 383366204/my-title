'use strict';

const ExcelJS = require('exceljs');

const HEADER_FILL = '1F4E78';

function setupSheet(sheet, columns) {
  sheet.columns = columns;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + Math.min(columns.length, 26))}1` };
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${HEADER_FILL}` } };
  header.alignment = { vertical: 'middle' };
}

function addProductRows(sheet, products, includePotential = false) {
  for (const item of products) {
    sheet.addRow({
      shopName: item.shopName,
      rank: item.rank,
      title: item.title,
      payment: item.paymentText,
      paymentLowerBound: item.paymentLowerBound,
      labels: (item.labels || []).join('、'),
      potential: includePotential ? item.potential?.level || '' : '',
      score: includePotential ? item.potential?.score ?? '' : '',
      reasons: includePotential ? (item.potential?.reasons || []).join('；') : '',
      itemId: item.itemId || '',
      productUrl: item.productUrl || ''
    });
  }
  sheet.getColumn('productUrl').eachCell((cell, rowNumber) => {
    if (rowNumber > 1 && cell.value) {
      cell.value = { text: '打开商品', hyperlink: String(cell.value) };
      cell.font = { color: { argb: 'FF0563C1' }, underline: true };
    }
  });
}

/**
 * Write the competitor analysis workbook.
 * @param {object} options Report options.
 * @param {string} options.file Output file.
 * @param {object[]} options.shops Shop profiles.
 * @param {object[]} options.hotProducts Hot products.
 * @param {object[]} options.newProducts Analyzed new products.
 * @param {object} options.analysis Analysis document.
 * @param {object[]} [options.errors] Collection errors.
 * @returns {Promise<object>} Report metadata.
 */
async function writeCompetitorReport(options = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ecom-ai-tools';
  workbook.created = new Date();

  const summary = workbook.addWorksheet('分析摘要');
  summary.columns = [{ key: 'label', width: 24 }, { key: 'value', width: 90 }];
  summary.addRows([
    { label: '店铺数量', value: options.analysis.totals.shops },
    { label: '销量排序商品', value: options.analysis.totals.hotProducts },
    { label: '新品排序商品', value: options.analysis.totals.newProducts },
    { label: '已有付款新品', value: options.analysis.totals.newWithPayment },
    { label: '同时进入销量榜和新品榜', value: options.analysis.totals.hotNewOverlap },
    { label: '证据说明', value: options.analysis.evidenceNotice },
    { label: '爆款高频词', value: options.analysis.hotKeywords.map(item => `${item.keyword}(${item.productCount})`).join('、') },
    { label: '新品高频词', value: options.analysis.newKeywords.map(item => `${item.keyword}(${item.productCount})`).join('、') },
    {
      label: '历史对比',
      value: options.analysis.historyComparison?.status === 'compared'
        ? `对比运行 ${options.analysis.historyComparison.baselineRunId}：新增爆款样本 ${options.analysis.historyComparison.newlyObservedHot.length} 个，新增新品样本 ${options.analysis.historyComparison.newlyObservedNew.length} 个`
        : options.analysis.historyComparison?.evidenceNotice || '未启用历史对比'
    }
  ]);
  summary.getColumn('label').font = { bold: true };
  summary.getColumn('value').alignment = { wrapText: true, vertical: 'top' };

  const shopsSheet = workbook.addWorksheet('店铺概览');
  setupSheet(shopsSheet, [
    { header: '店铺', key: 'shopName', width: 28 },
    { header: '粉丝', key: 'followerText', width: 16 },
    { header: '爆款样本', key: 'hotCount', width: 12 },
    { header: '新品样本', key: 'newCount', width: 12 },
    { header: '已有付款新品', key: 'newWithPaymentCount', width: 16 },
    { header: '新品进入销量榜', key: 'newHotOverlapCount', width: 16 },
    { header: '商品分类', key: 'categories', width: 45 },
    { header: '店铺链接', key: 'shopUrl', width: 18 }
  ]);
  for (const shop of options.analysis.shopSummaries) {
    shopsSheet.addRow({ ...shop, categories: (shop.categories || []).join('、') });
  }
  shopsSheet.getColumn('shopUrl').eachCell((cell, rowNumber) => {
    if (rowNumber > 1 && cell.value) cell.value = { text: '打开店铺', hyperlink: String(cell.value) };
  });

  const productColumns = [
    { header: '店铺', key: 'shopName', width: 24 },
    { header: '排序', key: 'rank', width: 9 },
    { header: '商品标题', key: 'title', width: 62 },
    { header: '付款表现', key: 'payment', width: 16 },
    { header: '付款人数下限', key: 'paymentLowerBound', width: 16 },
    { header: '页面标签', key: 'labels', width: 30 },
    { header: '商品ID', key: 'itemId', width: 18 },
    { header: '商品链接', key: 'productUrl', width: 16 }
  ];
  const hotSheet = workbook.addWorksheet('爆款商品');
  setupSheet(hotSheet, productColumns);
  addProductRows(hotSheet, options.hotProducts || []);

  const newSheet = workbook.addWorksheet('新品商品');
  setupSheet(newSheet, [
    ...productColumns.slice(0, 6),
    { header: '潜力判断', key: 'potential', width: 14 },
    { header: '潜力分', key: 'score', width: 10 },
    { header: '判断依据', key: 'reasons', width: 44 },
    ...productColumns.slice(6)
  ]);
  addProductRows(newSheet, options.newProducts || [], true);

  const keywordSheet = workbook.addWorksheet('机会关键词');
  setupSheet(keywordSheet, [
    { header: '关键词', key: 'keyword', width: 24 },
    { header: '覆盖商品数', key: 'productCount', width: 14 },
    { header: '建议', key: 'suggestion', width: 50 }
  ]);
  for (const item of options.analysis.opportunityKeywords) {
    keywordSheet.addRow({ ...item, suggestion: '建议加入候选词后进入生意参谋验真，不直接视为市场机会。' });
  }

  const historySheet = workbook.addWorksheet('历史变化');
  setupSheet(historySheet, [
    { header: '变化类型', key: 'changeType', width: 20 },
    { header: '店铺', key: 'shopName', width: 24 },
    { header: '商品标题', key: 'title', width: 62 },
    { header: '上次付款下限', key: 'previousPaymentLowerBound', width: 16 },
    { header: '本次付款下限', key: 'currentPaymentLowerBound', width: 16 },
    { header: '变化', key: 'deltaLowerBound', width: 12 },
    { header: '商品链接', key: 'productUrl', width: 18 }
  ]);
  const history = options.analysis.historyComparison || {};
  historySheet.addRows([
    ...(history.newlyObservedHot || []).map(item => ({ ...item, changeType: '本次新进入销量榜样本' })),
    ...(history.newlyObservedNew || []).map(item => ({ ...item, changeType: '本次新进入新品榜样本' })),
    ...(history.noLongerObservedHot || []).map(item => ({ ...item, changeType: '本次未出现在销量榜样本' })),
    ...(history.noLongerObservedNew || []).map(item => ({ ...item, changeType: '本次未出现在新品榜样本' })),
    ...(history.paymentChanges || []).map(item => ({ ...item, changeType: '付款展示下限变化' }))
  ]);
  historySheet.getColumn('productUrl').eachCell((cell, rowNumber) => {
    if (rowNumber > 1 && cell.value) cell.value = { text: '打开商品', hyperlink: String(cell.value) };
  });

  const errorSheet = workbook.addWorksheet('采集异常');
  setupSheet(errorSheet, [
    { header: '阶段', key: 'stage', width: 18 },
    { header: '店铺或链接', key: 'target', width: 45 },
    { header: '错误代码', key: 'code', width: 28 },
    { header: '原因', key: 'message', width: 80 }
  ]);
  errorSheet.addRows(options.errors || []);

  for (const sheet of workbook.worksheets) {
    sheet.eachRow(row => { row.alignment = { ...row.alignment, vertical: 'top', wrapText: true }; });
  }
  await workbook.xlsx.writeFile(options.file);
  return { file: options.file, sheetCount: workbook.worksheets.length };
}

module.exports = { writeCompetitorReport };
