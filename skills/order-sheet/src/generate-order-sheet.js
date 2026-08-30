'use strict';

const path = require('path');
const axios = require('axios');
const ExcelJS = require('exceljs');
const { flattenOrderGroups } = require('./order-groups');

const REVIEW_HEADERS = [
  '刷单日期',
  '店铺名',
  '买家旺旺',
  '买家手机号',
  '产品标题',
  '订单号',
  '评价内容',
  '对应文件'
];

const ORDER_HEADERS = [
  '标题',
  '主图',
  '价格（下单金额）',
  '加购件数',
  '做单要求（例如：进店浏览，假聊，。间隔时间下单）',
  '店铺名',
  '下单备注（区分真实单暗号）'
];

const RAW_HEADERS = [
  '排名',
  '来源页码',
  '商品ID',
  '商品标题',
  '商品链接',
  '主图链接',
  '支付金额',
  '成功退款金额',
  '支付件数',
  '商品加购件数',
  '商品访客数',
  '访客环比',
  '平均实付金额',
  '统计日期',
  '统计周期',
  '页面排序'
];

/**
 * Calculate average paid amount per item.
 * @param {object} row Product-rank row.
 * @returns {number|null} Average amount, or null when unavailable.
 */
function averagePayment(row) {
  const amount = Number(row.paymentAmount || 0);
  const count = Number(row.paidItemCount || 0);
  if (!Number.isFinite(amount) || !Number.isFinite(count) || count <= 0) return null;
  return Math.round((amount / count) * 100) / 100;
}

function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseOrderDate(value) {
  const isoDate = String(value || '').trim() || localIsoDate();
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('刷单日期格式无效');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day, 12));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error('刷单日期无效');
  }
  return parsed;
}

function imageExtension(contentType, imageUrl) {
  const normalized = String(contentType || '').toLowerCase();
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('gif')) return 'gif';
  const extension = path.extname(String(imageUrl || '').split('?')[0]).replace('.', '').toLowerCase();
  return ['png', 'gif', 'jpeg', 'jpg'].includes(extension) ? (extension === 'jpg' ? 'jpeg' : extension) : 'jpeg';
}

async function fetchImage(imageUrl) {
  if (!imageUrl) return null;
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      maxContentLength: 5 * 1024 * 1024,
      headers: { Referer: 'https://sycm.taobao.com/' }
    });
    return {
      buffer: Buffer.from(response.data),
      extension: imageExtension(response.headers['content-type'], imageUrl)
    };
  } catch (_error) {
    return null;
  }
}

function styleHeader(row) {
  row.height = 27;
  row.eachCell(cell => {
    cell.font = { name: '宋体', size: 12, bold: true, color: { argb: 'FF000000' } };
    if (cell.col <= 6) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thinBorder();
  });
}

function thinBorder() {
  return {
    top: { style: 'thin', color: { argb: 'FF808080' } },
    left: { style: 'thin', color: { argb: 'FF808080' } },
    bottom: { style: 'thin', color: { argb: 'FF808080' } },
    right: { style: 'thin', color: { argb: 'FF808080' } }
  };
}

function styleReviewHeader(row) {
  row.height = 18;
  row.eachCell(cell => {
    cell.font = { name: '宋体', size: 11, bold: true, color: { argb: 'FF000000' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thinBorder();
  });
}

function styleReviewRows(sheet, startRow, endRow) {
  for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.height = 84;
    for (let column = 1; column <= REVIEW_HEADERS.length; column += 1) {
      const cell = row.getCell(column);
      cell.font = { name: '宋体', size: 11, color: { argb: 'FF000000' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = thinBorder();
    }
  }
}

/**
 * Create the legacy rank-based evaluation worksheet.
 * @param {ExcelJS.Workbook} workbook Target workbook.
 * @param {object[]} rows Product rows.
 * @param {object} meta Workbook metadata.
 * @param {object} [options] Layout options.
 * @returns {{sheet: object, groupCount: number}} Created sheet metadata.
 */
function createReviewSheet(workbook, rows, meta, options = {}) {
  const groupSize = [1, 2, 4].includes(Number(options.reviewGroupSize)) ? Number(options.reviewGroupSize) : 4;
  const includeSpacerRow = options.includeSpacerRow !== false;
  const sheet = workbook.addWorksheet('1拖多评价', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });
  sheet.columns = [
    { width: 15.375 },
    { width: 18.125 },
    { width: 21.625 },
    { width: 21.625 },
    { width: 73.125 },
    { width: 21.5 },
    { width: 50.5 },
    { width: 20.875 }
  ];
  sheet.getRow(1).values = REVIEW_HEADERS;
  styleReviewHeader(sheet.getRow(1));
  sheet.autoFilter = { from: 'A1', to: 'H1' };

  const orderDate = parseOrderDate(meta.orderDate);
  const storeName = String(meta.storeName || '');
  const groupCount = Math.ceil(rows.length / groupSize);
  for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
    const groupRows = rows.slice(groupIndex * groupSize, (groupIndex + 1) * groupSize);
    const startRow = 2 + groupIndex * (groupSize + (includeSpacerRow ? 1 : 0));
    const endRow = startRow + groupRows.length - 1;
    styleReviewRows(sheet, startRow, endRow);
    for (const column of [1, 2, 3, 4, 6]) {
      if (endRow > startRow) sheet.mergeCells(startRow, column, endRow, column);
    }
    const dateCell = sheet.getCell(startRow, 1);
    dateCell.value = orderDate;
    dateCell.numFmt = 'm/d/yy';
    sheet.getCell(startRow, 2).value = storeName;
    groupRows.forEach((item, offset) => {
      const titleCell = sheet.getCell(startRow + offset, 5);
      titleCell.value = String(item.title || '');
      titleCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    if (includeSpacerRow && groupIndex < groupCount - 1) {
      const spacer = sheet.getRow(endRow + 1);
      spacer.height = 27;
      for (let column = 1; column <= REVIEW_HEADERS.length; column += 1) spacer.getCell(column).border = thinBorder();
    }
  }
  return { sheet, groupCount };
}

function styleBlock(sheet, startRow, endRow) {
  for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
    sheet.getRow(rowNumber).height = 32;
  }
  const rangeCells = [];
  for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
    for (let col = 1; col <= ORDER_HEADERS.length; col += 1) rangeCells.push(sheet.getCell(rowNumber, col));
  }
  for (const cell of rangeCells) {
    cell.font = { name: '宋体', size: 11, color: { argb: 'FF000000' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = thinBorder();
  }
}

/**
 * Normalize a sheet type to a supported value.
 * @param {unknown} value Raw sheet type.
 * @returns {'order'|'review'} Normalized sheet type.
 */
function normalizeSheetType(value) {
  return String(value || '').trim().toLowerCase() === 'review' ? 'review' : 'order';
}

function orderAmount(row, mode) {
  const explicitAmount = Number(row.orderAmount);
  if (Number.isFinite(explicitAmount) && explicitAmount > 0) return Math.round(explicitAmount * 100) / 100;
  const skuAmount = Number(row.selectedSkuPrice ?? row.lowestSkuPrice ?? row.referencePrice);
  if (Number.isFinite(skuAmount) && skuAmount > 0) return Math.round(skuAmount * 100) / 100;
  if (mode === 'blank') return null;
  if (mode === 'payment') {
    const value = Number(row.paymentAmount);
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
  }
  return averagePayment(row);
}

async function addProductImage(workbook, sheet, row, startRow, imageLoader) {
  const image = await imageLoader(row.imageUrl);
  if (!image) {
    if (row.imageUrl) {
      sheet.getCell(startRow, 2).value = { text: '打开主图', hyperlink: row.imageUrl };
      sheet.getCell(startRow, 2).font = { name: '微软雅黑', size: 10, color: { argb: 'FF2563EB' }, underline: true };
    }
    return false;
  }
  const imageId = workbook.addImage(image);
  sheet.addImage(imageId, {
    tl: { col: 1.16, row: startRow - 0.82 },
    ext: { width: 82, height: 82 },
    editAs: 'oneCell'
  });
  return true;
}

/**
 * Create the order worksheet and optionally embed product images.
 * @param {ExcelJS.Workbook} workbook Target workbook.
 * @param {object[]} rows Product rows.
 * @param {object} meta Workbook metadata.
 * @param {object} [options] Layout and image options.
 * @returns {Promise<{sheet: object, imageCount: number}>} Created sheet metadata.
 */
async function createOrderSheet(workbook, rows, meta, options = {}) {
  const workRequirement = String(options.workRequirement || '点一两款其他店同行的产品看一下，然后再下单').trim();
  const orderNote = String(options.orderNote || '').trim();
  const amountMode = ['average', 'payment', 'blank'].includes(options.amountMode) ? options.amountMode : 'average';
  const missingAmountPolicy = ['blank', 'mark', 'skip'].includes(options.missingAmountPolicy) ? options.missingAmountPolicy : 'blank';
  const cartQuantity = Math.min(20, Math.max(1, Number.parseInt(options.cartQuantity, 10) || 1));
  const rowSpan = Math.min(5, Math.max(1, Number.parseInt(options.rowSpan, 10) || 3));
  const includeImages = options.includeImages !== false;
  const imageLoader = options.imageLoader || fetchImage;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const sheet = workbook.addWorksheet('动销一拖多', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });
  sheet.columns = [
    { width: 42 },
    { width: 16 },
    { width: 24 },
    { width: 12 },
    { width: 46 },
    { width: 16 },
    { width: 28 }
  ];
  sheet.getRow(1).values = ORDER_HEADERS;
  styleHeader(sheet.getRow(1));
  sheet.autoFilter = { from: 'A1', to: 'G1' };

  let imageCount = 0;
  let nextStartRow = 2;
  for (const [index, row] of rows.entries()) {
    const isGrouped = Boolean(row.groupId);
    const itemRowSpan = isGrouped ? 1 : rowSpan;
    const startRow = nextStartRow;
    const endRow = startRow + itemRowSpan - 1;
    styleBlock(sheet, startRow, endRow);
    if (isGrouped) sheet.getRow(startRow).height = Math.max(32, rowSpan * 24);
    const titleCell = sheet.getCell(startRow, 1);
    const displayTitle = String(row.title || '');
    titleCell.value = row.productUrl
      ? { text: displayTitle, hyperlink: String(row.productUrl) }
      : displayTitle;
    titleCell.font = { name: '宋体', size: 11, bold: row.role === 'main', color: { argb: 'FF000000' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    const amountCell = sheet.getCell(startRow, 3);
    const amount = orderAmount(row, amountMode);
    const selectedSkuName = String(row.selectedSkuName || '').trim();
    amountCell.value = amount == null && missingAmountPolicy === 'mark'
      ? '待填写'
      : (amount != null && selectedSkuName ? `${Number(amount)}（${selectedSkuName}）` : amount);
    if (amount != null && !selectedSkuName) amountCell.numFmt = '0.00';
    if (amount == null && missingAmountPolicy === 'mark') {
      amountCell.font = { name: '宋体', size: 11, bold: true, color: { argb: 'FFB45309' } };
      amountCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
    }
    amountCell.alignment = { vertical: 'middle', horizontal: 'right', wrapText: true };
    sheet.getCell(startRow, 4).value = cartQuantity;
    sheet.getCell(startRow, 4).alignment = { vertical: 'middle', horizontal: 'right' };
    const requirementCell = sheet.getCell(startRow, 5);
    requirementCell.value = String(row.workRequirement || workRequirement);
    requirementCell.font = { name: '宋体', size: 11, bold: true, color: { argb: 'FFFF0000' } };
    requirementCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    sheet.getCell(startRow, 6).value = String(row.storeName || meta.storeName || '');
    sheet.getCell(startRow, 6).alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getCell(startRow, 7).value = String(row.orderNote || orderNote).trim();
    const nextRow = rows[index + 1];
    const hasNextGroup = isGrouped && nextRow && nextRow.groupId !== row.groupId;
    nextStartRow = endRow + 1;
    if (hasNextGroup) {
      for (let spacerIndex = 0; spacerIndex < 2; spacerIndex += 1) {
        sheet.getRow(nextStartRow + spacerIndex).height = 15;
      }
      nextStartRow += 2;
    }
    if (includeImages && await addProductImage(workbook, sheet, row, startRow, imageLoader)) imageCount += 1;
    onProgress({ current: index + 1, total: rows.length, message: `正在写入第 ${index + 1}/${rows.length} 个商品` });
  }
  return { sheet, imageCount };
}

/**
 * 按选择的“动销一拖多”刷单表或“1拖多评价”评价表生成工作簿。
 * @param {object} options 生成选项。
 * @param {object[]} options.rows 商品排行数据。
 * @param {object} [options.meta] 商品排行元数据。
 * @param {string} options.outputFile 输出文件路径。
 * @param {'order'|'review'} [options.sheetType] 表格类型。
 * @param {string} [options.workRequirement] 默认做单要求。
 * @param {number} [options.productLimit] 输出商品上限，0 表示全部。
 * @param {boolean} [options.includeRawData] 是否附带原始数据工作表。
 * @param {boolean} [options.includeImages] 是否下载主图。
 * @param {'average'|'payment'|'blank'} [options.amountMode] 下单金额来源。
 * @param {'blank'|'mark'|'skip'} [options.missingAmountPolicy] 金额缺失处理方式。
 * @param {number} [options.cartQuantity] 默认加购件数。
 * @param {number} [options.rowSpan] 每个商品占用行数。
 * @param {number} [options.dragCount] 1 拖 N 的每组商品数。
 * @param {string} [options.orderNote] 默认下单备注。
 * @param {number} [options.reviewGroupSize] 评价表每组商品数。
 * @param {boolean} [options.includeSpacerRow] 评价组之间是否保留空行。
 * @param {Function} [options.imageLoader] 主图下载函数，测试时可替换。
 * @param {Function} [options.onProgress] 进度回调。
 * @returns {Promise<{file:string,count:number,imageCount:number}>} 生成结果。
 */
async function generateOrderSheet(options) {
  const sourceRows = Array.isArray(options?.groups) && options.groups.length > 0
    ? flattenOrderGroups(options.groups)
    : (Array.isArray(options?.rows) ? options.rows : []);
  if (sourceRows.length === 0) throw new Error('没有商品排行数据，无法生成表格');
  const meta = options.meta || {};
  const outputFile = String(options.outputFile || '').trim();
  if (!outputFile) throw new Error('缺少表格输出路径');
  const sheetType = normalizeSheetType(options.sheetType);
  const productLimit = Math.min(500, Math.max(0, Number.parseInt(options.productLimit, 10) || 0));
  const amountMode = ['average', 'payment', 'blank'].includes(options.amountMode) ? options.amountMode : 'average';
  const missingAmountPolicy = ['blank', 'mark', 'skip'].includes(options.missingAmountPolicy) ? options.missingAmountPolicy : 'blank';
  const eligibleRows = sheetType === 'order' && missingAmountPolicy === 'skip'
    ? sourceRows.filter((row) => orderAmount(row, amountMode) != null)
    : sourceRows;
  const rows = productLimit > 0 ? eligibleRows.slice(0, productLimit) : eligibleRows;
  const skippedCount = sourceRows.length - eligibleRows.length;
  if (rows.length === 0) throw new Error('没有符合制表条件的商品，请调整金额缺失处理方式');

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ecom-ai-tools';
  workbook.created = new Date();

  const review = sheetType === 'review' ? createReviewSheet(workbook, rows, meta, options) : null;
  const order = sheetType === 'order'
    ? await createOrderSheet(workbook, rows, meta, options)
    : null;
  const rawRows = Array.isArray(options?.rows) && options.rows.length > 0 ? options.rows : sourceRows;

  const rawSheet = options.includeRawData === false ? null : workbook.addWorksheet('商品排行原始数据', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: false }]
  });
  if (rawSheet) rawSheet.columns = [
    { width: 8 }, { width: 10 }, { width: 18 }, { width: 48 }, { width: 42 }, { width: 42 },
    { width: 14 }, { width: 16 }, { width: 12 }, { width: 16 }, { width: 14 },
    { width: 14 }, { width: 16 }, { width: 22 }, { width: 12 }, { width: 18 }
  ];
  if (rawSheet) rawSheet.getRow(1).values = RAW_HEADERS;
  if (rawSheet) styleHeader(rawSheet.getRow(1));
  if (rawSheet) rawSheet.autoFilter = { from: 'A1', to: `P${rawRows.length + 1}` };
  if (rawSheet) rawRows.forEach((row, index) => {
    const dataRow = rawSheet.getRow(index + 2);
    dataRow.values = [
      row.rank || index + 1,
      row.sourcePage || Math.floor(index / 10) + 1,
      row.itemId || '',
      row.title || '',
      row.productUrl || '',
      row.imageUrl || '',
      Number(row.paymentAmount || 0),
      Number(row.refundAmount || 0),
      Number(row.paidItemCount || 0),
      Number(row.cartItemCount || 0),
      Number(row.visitorCount || 0),
      row.visitorChange || '',
      averagePayment(row),
      meta.statDate || '',
      meta.period || '日',
      `${meta.sortLabel || row.sortLabel || '商品访客数'}降序`
    ];
    dataRow.alignment = { vertical: 'middle', wrapText: true };
    dataRow.height = 24;
    dataRow.getCell(5).value = row.productUrl ? { text: row.productUrl, hyperlink: row.productUrl } : '';
    dataRow.getCell(6).value = row.imageUrl ? { text: row.imageUrl, hyperlink: row.imageUrl } : '';
    dataRow.getCell(7).numFmt = '0.00';
    dataRow.getCell(8).numFmt = '0.00';
    dataRow.getCell(13).numFmt = '0.00';
  });
  if (rawSheet) rawSheet.getColumn(5).font = { color: { argb: 'FF2563EB' }, underline: true };
  if (rawSheet) rawSheet.getColumn(6).font = { color: { argb: 'FF2563EB' }, underline: true };

  await workbook.xlsx.writeFile(outputFile);
  return {
    file: outputFile,
    count: rows.length,
    imageCount: order?.imageCount || 0,
    reviewGroupCount: review?.groupCount || 0,
    skippedCount,
    includeRawData: Boolean(rawSheet),
    sheetType,
    sheetLabel: sheetType === 'review' ? '评价表' : '刷单表'
  };
}

module.exports = {
  ORDER_HEADERS,
  RAW_HEADERS,
  REVIEW_HEADERS,
  averagePayment,
  createOrderSheet,
  createReviewSheet,
  generateOrderSheet,
  normalizeSheetType
};
