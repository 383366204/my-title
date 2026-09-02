'use strict';

const axios = require('axios');
const ExcelJS = require('exceljs');
const { flattenOrderGroups } = require('./order-groups');
const { EMBEDDABLE_IMAGE_FORMATS, sniffImageFormat } = require('../../../core/image-format');
const { hardenDrawingAnchors } = require('../../../core/excel-image');

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

const EMU_PER_PIXEL = 9525;
const EMU_PER_POINT = 12700;

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

// 淘系 CDN 的图片地址带 `_.webp` 变换后缀，且会按 Accept 头二次协商格式。
// 之前只按 Content-Type/URL 后缀猜格式、拿不到就兜成 jpeg，结果把 WebP 字节标成 .jpeg 写进 xlsx：
// 新版 Excel 会嗅探字节所以本机正常，旧版 Excel、WPS、手机 Office 和微信/钉钉预览按 jpeg 解码失败，图片区域空白。
const IMAGE_ACCEPT = 'image/jpeg, image/png';
const CDN_RESIZE_HOSTS = /(^|\.)(alicdn|taobaocdn|tbcdn)\.com$/i;
const CDN_THUMBNAIL_SUFFIX = '_200x200q90.jpg';

/**
 * 去掉 CDN 强制输出 WebP 的变换后缀，拿回可嵌入的原始格式地址。
 * @param {string} imageUrl 原始图片地址
 * @returns {string} 归一化后的地址，无需处理时原样返回
 */
function normalizeImageUrl(imageUrl) {
  const raw = String(imageUrl || '').trim();
  if (!raw) return '';
  const queryIndex = raw.indexOf('?');
  const base = queryIndex >= 0 ? raw.slice(0, queryIndex) : raw;
  const query = queryIndex >= 0 ? raw.slice(queryIndex) : '';
  let next = base.replace(/_\.(webp|avif)$/i, '');
  if (next === base) next = base.replace(/\.(webp|avif)$/i, '.jpg');
  if (next === base) return raw;
  return `${next}${query}`;
}

/**
 * 生成候选下载地址：优先 CDN 缩放小图，其次归一化原图，最后回退原始地址。
 * @param {string} imageUrl 原始图片地址
 * @returns {string[]} 去重后的候选地址列表
 */
function imageUrlCandidates(imageUrl) {
  const raw = String(imageUrl || '').trim();
  if (!raw) return [];
  const normalized = normalizeImageUrl(raw);
  const withoutQuery = normalized.split('?')[0];
  const query = normalized.slice(withoutQuery.length);
  let hostname = '';
  try {
    hostname = new URL(normalized).hostname;
  } catch (_error) {
    hostname = '';
  }
  const candidates = [];
  // 表格只嵌 82px 见方，用 CDN 缩放图可避免 xlsx 体积膨胀十倍以上（真原图约 660KB/张）
  if (hostname && CDN_RESIZE_HOSTS.test(hostname) && /\.(jpe?g|png)$/i.test(withoutQuery)) {
    candidates.push(`${withoutQuery}${CDN_THUMBNAIL_SUFFIX}${query}`);
  }
  candidates.push(normalized, raw);
  return [...new Set(candidates.filter(Boolean))];
}

/**
 * 下载图片，且只接受能安全嵌入 Excel 的格式。
 * @param {string} imageUrl 商品主图地址
 * @param {object} [options] 选项
 * @param {Function} [options.request] 注入的下载函数，便于测试
 * @param {number} [options.timeout] 单次请求超时毫秒数
 * @returns {Promise<{buffer: Buffer, extension: string}|null>} 可嵌入的图片，拿不到时返回 null
 */
async function fetchImage(imageUrl, options = {}) {
  const candidates = imageUrlCandidates(imageUrl);
  if (candidates.length === 0) return null;
  const request = typeof options.request === 'function' ? options.request : axios.get;
  for (const candidate of candidates) {
    try {
      const response = await request(candidate, {
        responseType: 'arraybuffer',
        timeout: Number(options.timeout || 10000),
        maxContentLength: 5 * 1024 * 1024,
        headers: {
          Referer: 'https://sycm.taobao.com/',
          Accept: IMAGE_ACCEPT,
          'User-Agent': String(options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
        }
      });
      const buffer = Buffer.from(response.data);
      const format = sniffImageFormat(buffer);
      // 拿到 WebP 或未知格式时绝不写盘：宁可降级成超链接，也不再产出谎报格式的文件
      if (EMBEDDABLE_IMAGE_FORMATS.includes(format)) return { buffer, extension: format };
    } catch (_error) {
      // 换下一个候选地址
    }
  }
  return null;
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
  // 与评价表链路的每组商品数保持一致：可选 1-4，默认 4
  const rawGroupSize = Number.parseInt(options.reviewGroupSize, 10);
  const groupSize = Number.isFinite(rawGroupSize) ? Math.min(4, Math.max(1, rawGroupSize)) : 4;
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

/**
 * 嵌入商品主图。
 * @param {ExcelJS.Workbook} workbook 目标工作簿
 * @param {object} sheet 目标工作表
 * @param {object} row 商品行
 * @param {number} startRow 该商品块的首行（1-based）
 * @param {number} endRow 该商品块的末行（1-based）
 * @param {Function} imageLoader 图片下载函数
 * @returns {Promise<boolean>} 是否成功嵌入
 */
async function addProductImage(workbook, sheet, row, startRow, endRow, imageLoader) {
  // 只嵌商品主图：规格图记录在 selectedSkuImageUrl，不参与制表。
  const image = await imageLoader(row.imageUrl);
  if (!image) {
    if (row.imageUrl) {
      sheet.getCell(startRow, 2).value = { text: '打开主图', hyperlink: row.imageUrl };
      sheet.getCell(startRow, 2).font = { name: '微软雅黑', size: 10, color: { argb: 'FF2563EB' }, underline: true };
    }
    return false;
  }
  const imageId = workbook.addImage(image);
  // 用 twoCellAnchor（from + to 两个角点）而不是 oneCellAnchor：
  // 手机 WPS/Excel 与多数轻量预览器只实现前者，oneCellAnchor 会让主图列整列空白。
  sheet.addImage(imageId, {
    tl: { nativeCol: 1, nativeColOff: 25599, nativeRow: startRow - 1, nativeRowOff: 12960 },
    br: { nativeCol: 2, nativeRow: endRow },
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
  const imageLabels = [];
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
    // 标题列只写纯文本：超链接会变成蓝色下划线，手机和微信预览里尤其影响阅读。
    // 商品链接仍保留在「商品排行原始数据」页的链接列，需要时去那里取。
    titleCell.value = displayTitle;
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
    if (includeImages && await addProductImage(workbook, sheet, row, startRow, endRow, imageLoader)) {
      imageCount += 1;
      // 给图片对象起名，Excel 的"选择窗格"里能认出这张图属于哪个商品
      imageLabels.push(String(row.title || row.imageUrl || `商品 ${index + 1}`));
    }
    onProgress({ current: index + 1, total: rows.length, message: `正在写入第 ${index + 1}/${rows.length} 个商品` });
  }
  // 回传布局，供写盘后把图片锚点换算成绝对 EMU 修补
  const layout = {
    columnWidths: sheet.columns.map(column => column.width),
    rowHeights: Array.from({ length: Math.max(1, sheet.rowCount) }, (_unused, i) => sheet.getRow(i + 1).height),
    labels: imageLabels
  };
  return { sheet, imageCount, layout };
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
  // 补齐 ExcelJS 写死的 xfrm/cstate，否则手机 WPS/Excel 打不开这些浮动图片
  if (order && order.imageCount > 0) await hardenDrawingAnchors(outputFile, order.layout);

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
  fetchImage,
  generateOrderSheet,
  hardenDrawingAnchors,
  imageUrlCandidates,
  normalizeImageUrl,
  normalizeSheetType,
  sniffImageFormat
};
