'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ExcelJS = require('exceljs');
const { createLLMClient, getLLMProviderInfo } = require('../../core/llm');
const { parseJsonFromLLM } = require('../../core/llm-utils');
const {
  DEFAULT_FLOW_DIR,
  appendJsonl,
  getRun,
  initRun,
  readJsonl,
  writeRun
} = require('../pipeline-flow/src/run-store');

const REVIEW_HEADERS = ['刷单日期', '店铺名', '买家旺旺', '买家手机号', '产品标题', '订单号', '评价内容', '对应文件'];
const UPLOAD_ID_PATTERN = /^[a-f0-9-]{20,64}$/i;
const HEADER_ALIASES = {
  title: ['标题', '产品标题', '商品标题', '宝贝标题'],
  storeName: ['店铺名', '店铺名称', '店名'],
  orderDate: ['刷单日期', '下单日期', '日期'],
  buyerName: ['买家旺旺', '旺旺', '买家账号', '买家昵称'],
  buyerPhone: ['买家手机号', '手机号', '手机号码'],
  orderNumber: ['订单号', '订单编号'],
  orderNote: ['下单备注', '备注'],
  correspondingFile: ['对应文件', '评价文件', '素材文件']
};

function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function cellText(cell) {
  if (!cell) return '';
  if (cell.value && typeof cell.value === 'object') {
    if (cell.value.text != null) return String(cell.value.text).trim();
    if (cell.value.result != null) return String(cell.value.result).trim();
  }
  return String(cell.text || cell.value || '').trim();
}

function normalizeOrderDateValue(value) {
  const candidate = value && typeof value === 'object' && value.result != null ? value.result : value;
  if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) return localIsoDate(candidate);
  if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(candidate * 86400000));
    if (!Number.isNaN(date.getTime())) {
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    }
  }
  const text = String(candidate == null ? '' : candidate).trim();
  const matched = text.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?$/);
  if (!matched) return text;
  return `${matched[1]}-${String(Number(matched[2])).padStart(2, '0')}-${String(Number(matched[3])).padStart(2, '0')}`;
}

function orderDateCellText(cell) {
  if (!cell) return '';
  const normalized = normalizeOrderDateValue(cell.value);
  return normalized || normalizeOrderDateValue(cellText(cell));
}

function normalizedHeader(value) {
  return String(value || '').replace(/[\s（）()：:，,。]/g, '').toLowerCase();
}

function headerKey(value) {
  const normalized = normalizedHeader(value);
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.some(alias => normalized === normalizedHeader(alias) || normalized.includes(normalizedHeader(alias)))) return key;
  }
  return '';
}

function findHeader(sheet) {
  const maxRows = Math.min(20, sheet.rowCount || sheet.actualRowCount || 20);
  const maxColumns = Math.min(30, sheet.actualColumnCount || 30);
  for (let rowNumber = 1; rowNumber <= maxRows; rowNumber += 1) {
    const columns = {};
    for (let column = 1; column <= maxColumns; column += 1) {
      const key = headerKey(cellText(sheet.getCell(rowNumber, column)));
      if (key && columns[key] == null) columns[key] = column;
    }
    if (columns.title) return { rowNumber, columns };
  }
  return null;
}

/**
 * Parse an uploaded order workbook into editable order groups.
 * @param {Buffer} buffer XLSX bytes.
 * @param {object} [options] Parse options.
 * @param {string} [options.fileName] Original file name.
 * @returns {Promise<object>} Parsed workbook summary and groups.
 */
async function parseReviewSourceWorkbook(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error('上传文件不是有效的 XLSX 工作簿');
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const groups = [];
  const skippedSheets = [];

  for (const sheet of workbook.worksheets) {
    if (/原始数据|raw/i.test(sheet.name)) {
      skippedSheets.push({ sheetName: sheet.name, reason: '原始数据页' });
      continue;
    }
    const header = findHeader(sheet);
    if (!header) {
      skippedSheets.push({ sheetName: sheet.name, reason: '未识别到商品标题列' });
      continue;
    }
    const buckets = new Map();
    const inherited = {
      orderDate: '',
      storeName: '',
      buyerName: '',
      buyerPhone: '',
      orderNumber: ''
    };
    for (let rowNumber = header.rowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      for (const field of Object.keys(inherited)) {
        if (!header.columns[field]) continue;
        const cell = sheet.getCell(rowNumber, header.columns[field]);
        const value = field === 'orderDate' ? orderDateCellText(cell) : cellText(cell);
        if (value) inherited[field] = value;
      }
      const titleCell = sheet.getCell(rowNumber, header.columns.title);
      const title = cellText(titleCell);
      if (!title) continue;
      const bucketKey = inherited.orderNumber ? `order:${inherited.orderNumber}` : `sheet:${sheet.name}`;
      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, {
          sourceSheet: sheet.name,
          sourceSheetState: sheet.state || 'visible',
          inferred: !inherited.orderNumber,
          orderDate: inherited.orderDate || localIsoDate(),
          storeName: inherited.storeName,
          buyerName: inherited.buyerName,
          buyerPhone: inherited.buyerPhone,
          orderNumber: inherited.orderNumber,
          products: []
        });
      }
      buckets.get(bucketKey).products.push({
        title,
        productUrl: String(titleCell.hyperlink || '').trim(),
        orderNote: header.columns.orderNote ? cellText(sheet.getCell(rowNumber, header.columns.orderNote)) : '',
        correspondingFile: header.columns.correspondingFile ? cellText(sheet.getCell(rowNumber, header.columns.correspondingFile)) : '',
        sourceSheet: sheet.name,
        sourceRow: rowNumber
      });
    }
    if (buckets.size === 0) {
      skippedSheets.push({ sheetName: sheet.name, reason: '没有识别到商品行' });
      continue;
    }
    for (const bucket of buckets.values()) {
      const groupIndex = groups.length + 1;
      groups.push({
        id: `group-${groupIndex}`,
        ...bucket,
        products: bucket.products.map((product, productIndex) => ({
          id: `group-${groupIndex}-product-${productIndex + 1}`,
          ...product
        }))
      });
    }
  }

  if (groups.length === 0) throw new Error('没有从工作簿中识别到可用于评价表的商品');
  const productCount = groups.reduce((total, group) => total + group.products.length, 0);
  const missing = groups.reduce((result, group) => {
    for (const field of ['storeName', 'buyerName', 'buyerPhone', 'orderNumber']) {
      if (!group[field]) result[field] += 1;
    }
    return result;
  }, { storeName: 0, buyerName: 0, buyerPhone: 0, orderNumber: 0 });

  return {
    fileName: String(options.fileName || '刷单表.xlsx'),
    sheetCount: workbook.worksheets.length,
    parsedSheetCount: groups.length,
    productCount,
    groups,
    skippedSheets,
    missing
  };
}

function uploadRoot(dataDir = DEFAULT_FLOW_DIR) {
  return path.join(dataDir, 'uploads', 'review-sheets');
}

function uploadDir(dataDir, uploadId) {
  if (!UPLOAD_ID_PATTERN.test(String(uploadId || ''))) throw new Error('无效的评价表上传 ID');
  return path.join(uploadRoot(dataDir), uploadId);
}

/**
 * Save and parse a source order workbook.
 * @param {object} options Upload options.
 * @param {Buffer} options.buffer XLSX bytes.
 * @param {string} options.fileName Original file name.
 * @param {string} [options.dataDir] Pipeline data directory.
 * @returns {Promise<object>} Upload metadata.
 */
async function saveReviewSourceUpload({ buffer, fileName, dataDir = DEFAULT_FLOW_DIR }) {
  const safeFileName = path.basename(String(fileName || '刷单表.xlsx'));
  if (!/\.xlsx$/i.test(safeFileName)) throw new Error('仅支持上传 .xlsx 刷单表');
  const uploadId = crypto.randomUUID();
  const dir = uploadDir(dataDir, uploadId);
  fs.mkdirSync(dir, { recursive: true });
  const parsed = await parseReviewSourceWorkbook(buffer, { fileName: safeFileName });
  const sourceFile = path.join(dir, 'source.xlsx');
  const metadata = {
    uploadId,
    ...parsed,
    sourceFile,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    uploadedAt: new Date().toISOString()
  };
  fs.writeFileSync(sourceFile, buffer);
  fs.writeFileSync(path.join(dir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  return metadata;
}

/**
 * Read metadata for a previously saved review-source upload.
 * @param {string} uploadId Saved upload ID.
 * @param {string} [dataDir] Pipeline data directory.
 * @returns {object} Stored upload metadata.
 */
function readReviewSourceUpload(uploadId, dataDir = DEFAULT_FLOW_DIR) {
  const file = path.join(uploadDir(dataDir, uploadId), 'metadata.json');
  if (!fs.existsSync(file)) throw new Error('上传的刷单表不存在或已被清理，请重新上传');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sanitizeGroupEdits(groups, originalGroups) {
  const edits = new Map((Array.isArray(groups) ? groups : []).map(group => [String(group.id || ''), group]));
  const sanitized = originalGroups.map(group => {
    const edit = edits.get(group.id) || {};
    return {
      ...group,
      orderDate: normalizeOrderDateValue(edit.orderDate || group.orderDate || localIsoDate()).slice(0, 10),
      storeName: String(edit.storeName ?? group.storeName ?? '').trim().slice(0, 50),
      buyerName: String(edit.buyerName ?? group.buyerName ?? '').trim().slice(0, 80),
      buyerPhone: String(edit.buyerPhone ?? group.buyerPhone ?? '').trim().slice(0, 30),
      orderNumber: String(edit.orderNumber ?? group.orderNumber ?? '').trim().slice(0, 80)
    };
  });
  const labels = {
    orderDate: '刷单日期',
    storeName: '店铺名',
    buyerName: '买家旺旺',
    buyerPhone: '买家手机号',
    orderNumber: '订单号'
  };
  for (const [index, group] of sanitized.entries()) {
    const missing = Object.keys(labels).filter(field => !group[field]);
    if (missing.length > 0) {
      throw new Error(`订单组 ${index + 1} 缺少${missing.map(field => labels[field]).join('、')}`);
    }
  }
  return sanitized;
}

function ensureReviewRunFiles(run, runDir) {
  run.files = run.files || {};
  run.files.reviewSource = run.files.reviewSource || path.join(runDir, 'uploaded-order-sheet.xlsx');
  run.files.reviewGroups = run.files.reviewGroups || path.join(runDir, 'review-order-groups.json');
  run.files.reviewDrafts = run.files.reviewDrafts || path.join(runDir, 'review-drafts.jsonl');
  run.files.orderSheet = run.files.orderSheet || path.join(runDir, '商品评价表.xlsx');
  return run.files;
}

/**
 * Copy an uploaded workbook into a workflow run and persist edited order groups.
 * @param {object} [options] Import options.
 * @param {string} options.uploadId Saved upload ID.
 * @param {string} [options.runId] Workflow run ID.
 * @param {Array<object>} [options.groups] User-confirmed order group fields.
 * @param {string} [options.dataDir] Pipeline data directory.
 * @returns {Promise<object>} Import result.
 */
async function importReviewSource(options = {}) {
  const upload = readReviewSourceUpload(options.uploadId, options.dataDir || DEFAULT_FLOW_DIR);
  const context = initRun({
    dataDir: options.dataDir || DEFAULT_FLOW_DIR,
    runId: options.runId,
    options: { ...options, mode: 'review-sheet', workflowVersion: 1 }
  });
  const files = ensureReviewRunFiles(context.run, context.runDir);
  const groups = sanitizeGroupEdits(options.groups, upload.groups);
  fs.copyFileSync(upload.sourceFile, files.reviewSource);
  fs.writeFileSync(files.reviewGroups, `${JSON.stringify({ uploadId: upload.uploadId, fileName: upload.fileName, sha256: upload.sha256, groups }, null, 2)}\n`, 'utf8');
  context.run.status = 'review_source_imported';
  context.run.options = { ...(context.run.options || {}), mode: 'review-sheet', uploadId: upload.uploadId, fileName: options.fileName || '' };
  context.run.counts = {
    ...(context.run.counts || {}),
    reviewGroups: groups.length,
    reviewSourceProducts: groups.reduce((total, group) => total + group.products.length, 0),
    reviewDrafts: 0
  };
  context.run.files = files;
  writeRun(context.runDir, context.run);
  return { runId: context.runId, runDir: context.runDir, status: context.run.status, count: context.run.counts.reviewSourceProducts };
}

function localReview(title, index) {
  const subject = String(title || '商品').replace(/[\r\n]+/g, ' ').trim().slice(0, 24);
  const templates = [
    `“${subject}”收到后和描述一致，细节处理得不错，日常使用很方便。`,
    `“${subject}”整体质感可以，包装也很仔细，实际效果符合预期。`,
    `“${subject}”款式耐看，使用起来顺手，尺寸和页面介绍基本一致。`,
    `“${subject}”实物没有明显色差，做工比较细致，这次购买体验不错。`
  ];
  return templates[index % templates.length];
}

async function llmReviews(products, options = {}) {
  const llmInfo = getLLMProviderInfo({ provider: options.llmProvider });
  if (!llmInfo.configured || options.useAI === false) return null;
  const client = createLLMClient({ provider: options.llmProvider });
  const titles = products.map((product, index) => `${index + 1}. ${product.title}`).join('\n');
  const response = await axios.post(
    `${client.apiBase}/chat/completions`,
    client._buildChatPayload({
      messages: [
        { role: 'system', content: '你负责为已购买商品生成自然、克制、互不重复的中文评价。不要使用绝对化宣传，不虚构物流速度、材质或功效。只返回 JSON 数组，数组长度必须和商品数相同。格式：["评价1","评价2"]。' },
        { role: 'user', content: `评价语气：${options.reviewTone || '自然真实'}\n每条约 ${Number(options.reviewLength || 35)} 字。\n商品：\n${titles}` }
      ],
      temperature: 0.7
    }),
    {
      headers: { Authorization: `Bearer ${client.apiKey}`, 'Content-Type': 'application/json' },
      timeout: client._longTimeout || 60000
    }
  );
  const parsed = parseJsonFromLLM(response.data?.choices?.[0]?.message?.content || '');
  if (!Array.isArray(parsed) || parsed.length !== products.length) throw new Error('评价生成数量与商品数量不一致');
  return parsed.map(value => String(value || '').trim());
}

/**
 * Generate editable review drafts for every uploaded product row.
 * @param {object} [options] Generation options.
 * @param {string} options.runId Workflow run ID.
 * @param {boolean} [options.useAI] Whether to use the configured LLM.
 * @param {string} [options.dataDir] Pipeline data directory.
 * @returns {Promise<object>} Draft generation result.
 */
async function generateReviewDrafts(options = {}) {
  const context = getRun({ dataDir: options.dataDir || DEFAULT_FLOW_DIR, runId: options.runId });
  const files = ensureReviewRunFiles(context.run, context.runDir);
  const source = JSON.parse(fs.readFileSync(files.reviewGroups, 'utf8'));
  const products = source.groups.flatMap(group => group.products.map(product => ({ ...product, groupId: group.id })));
  const generated = new Array(products.length).fill(null);
  let degraded = false;
  const batchSize = 20;
  for (let start = 0; start < products.length; start += batchSize) {
    const batch = products.slice(start, start + batchSize);
    try {
      const batchReviews = await llmReviews(batch, options);
      if (!batchReviews) {
        if (options.useAI !== false) degraded = true;
        continue;
      }
      batchReviews.forEach((review, offset) => { generated[start + offset] = review; });
    } catch (_error) {
      degraded = true;
    }
  }
  fs.writeFileSync(files.reviewDrafts, '', 'utf8');
  const drafts = products.map((product, index) => ({
    id: product.id,
    groupId: product.groupId,
    title: product.title,
    sourceSheet: product.sourceSheet,
    sourceRow: product.sourceRow,
    reviewContent: generated[index] || localReview(product.title, index),
    correspondingFile: product.correspondingFile || '',
    status: 'pending_review'
  }));
  appendJsonl(files.reviewDrafts, drafts);
  context.run.status = 'needs_review';
  context.run.requiresUserAction = true;
  context.run.mustReview = true;
  context.run.counts.reviewDrafts = drafts.length;
  context.run.reviewGeneration = { degraded, provider: getLLMProviderInfo({ provider: options.llmProvider }).provider };
  writeRun(context.runDir, context.run);
  return { runId: context.runId, runDir: context.runDir, status: 'needs_review', count: drafts.length, degraded };
}

/**
 * Apply user edits and approve all review drafts.
 * @param {object} [options] Confirmation options.
 * @param {string} options.runId Workflow run ID.
 * @param {Array<object>} [options.reviews] Edited review rows.
 * @param {string} [options.dataDir] Pipeline data directory.
 * @returns {object} Confirmation result.
 */
function confirmReviewDrafts({ dataDir = DEFAULT_FLOW_DIR, runId, reviews = [] } = {}) {
  const context = getRun({ dataDir, runId });
  const files = ensureReviewRunFiles(context.run, context.runDir);
  const edits = new Map((Array.isArray(reviews) ? reviews : []).map(row => [String(row.id || ''), row]));
  const drafts = readJsonl(files.reviewDrafts).map(row => {
    const edit = edits.get(row.id) || {};
    const reviewContent = String(edit.reviewContent ?? row.reviewContent ?? '').trim().slice(0, 500);
    if (!reviewContent) throw new Error(`商品“${row.title}”缺少评价内容`);
    return { ...row, reviewContent, correspondingFile: String(edit.correspondingFile ?? row.correspondingFile ?? '').trim().slice(0, 200), status: 'approved' };
  });
  fs.writeFileSync(files.reviewDrafts, '', 'utf8');
  appendJsonl(files.reviewDrafts, drafts);
  context.run.status = 'review_approved';
  context.run.requiresUserAction = false;
  context.run.mustReview = false;
  writeRun(context.runDir, context.run);
  return { count: drafts.length, drafts };
}

function thinBorder() {
  return {
    top: { style: 'thin', color: { argb: 'FF808080' } },
    left: { style: 'thin', color: { argb: 'FF808080' } },
    bottom: { style: 'thin', color: { argb: 'FF808080' } },
    right: { style: 'thin', color: { argb: 'FF808080' } }
  };
}

function excelDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
}

/**
 * Export approved review rows to the dedicated evaluation workbook format.
 * @param {object} [options] Export options.
 * @param {string} options.runId Workflow run ID.
 * @param {string} [options.fileName] Output workbook name.
 * @param {boolean} [options.includeSpacerRow] Insert a blank row between orders.
 * @param {string} [options.dataDir] Pipeline data directory.
 * @returns {Promise<object>} Workbook export result.
 */
async function buildReviewSheet(options = {}) {
  const context = getRun({ dataDir: options.dataDir || DEFAULT_FLOW_DIR, runId: options.runId });
  const files = ensureReviewRunFiles(context.run, context.runDir);
  const source = JSON.parse(fs.readFileSync(files.reviewGroups, 'utf8'));
  const drafts = readJsonl(files.reviewDrafts);
  const draftMap = new Map(drafts.map(row => [row.id, row]));
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('1拖多评价', { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
  sheet.columns = [{ width: 15.375 }, { width: 18.125 }, { width: 21.625 }, { width: 21.625 }, { width: 73.125 }, { width: 21.5 }, { width: 50.5 }, { width: 20.875 }];
  sheet.getRow(1).values = REVIEW_HEADERS;
  sheet.getRow(1).height = 18;
  sheet.getRow(1).eachCell(cell => {
    cell.font = { name: '宋体', size: 11, bold: true, color: { argb: 'FF000000' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thinBorder();
  });
  let rowNumber = 2;
  for (const [groupIndex, group] of source.groups.entries()) {
    const startRow = rowNumber;
    const endRow = startRow + group.products.length - 1;
    for (let current = startRow; current <= endRow; current += 1) {
      sheet.getRow(current).height = 84;
      for (let column = 1; column <= REVIEW_HEADERS.length; column += 1) {
        const cell = sheet.getCell(current, column);
        cell.font = { name: '宋体', size: 11, color: { argb: 'FF000000' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = thinBorder();
      }
    }
    if (endRow > startRow) for (const column of [1, 2, 3, 4, 6]) sheet.mergeCells(startRow, column, endRow, column);
    sheet.getCell(startRow, 1).value = excelDate(group.orderDate);
    sheet.getCell(startRow, 1).numFmt = 'm/d/yy';
    sheet.getCell(startRow, 2).value = group.storeName || '';
    sheet.getCell(startRow, 3).value = group.buyerName || '';
    sheet.getCell(startRow, 4).value = group.buyerPhone || '';
    sheet.getCell(startRow, 6).value = group.orderNumber || '';
    group.products.forEach((product, offset) => {
      const draft = draftMap.get(product.id) || {};
      sheet.getCell(startRow + offset, 5).value = product.title || '';
      sheet.getCell(startRow + offset, 7).value = draft.reviewContent || '';
      sheet.getCell(startRow + offset, 8).value = draft.correspondingFile || product.correspondingFile || null;
    });
    rowNumber = endRow + 1;
    if (options.includeSpacerRow !== false && groupIndex < source.groups.length - 1) {
      sheet.getRow(rowNumber).height = 27;
      for (let column = 1; column <= REVIEW_HEADERS.length; column += 1) sheet.getCell(rowNumber, column).border = thinBorder();
      rowNumber += 1;
    }
  }
  sheet.autoFilter = { from: 'A1', to: `H${Math.max(2, rowNumber - 1)}` };
  const customName = String(options.fileName || '').trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\.xlsx$/i, '');
  files.orderSheet = path.join(context.runDir, `${customName || '商品评价表'}.xlsx`);
  await workbook.xlsx.writeFile(files.orderSheet);
  context.run.status = 'workflow_complete';
  context.run.requiresUserAction = false;
  context.run.mustReview = false;
  context.run.files = files;
  context.run.counts.orderSheetRows = drafts.length;
  context.run.counts.orderSheetImages = 0;
  context.run.options = { ...(context.run.options || {}), mode: 'review-sheet', sheetType: 'review', includeSpacerRow: options.includeSpacerRow !== false };
  writeRun(context.runDir, context.run);
  return { runId: context.runId, runDir: context.runDir, status: 'workflow_complete', file: files.orderSheet, count: drafts.length, sheetType: 'review', imageCount: 0 };
}

module.exports = {
  REVIEW_HEADERS,
  buildReviewSheet,
  confirmReviewDrafts,
  generateReviewDrafts,
  importReviewSource,
  parseReviewSourceWorkbook,
  readReviewSourceUpload,
  saveReviewSourceUpload
};
