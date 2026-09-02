'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ExcelJS = require('exceljs');
const { createLLMClient, getLLMProviderInfo } = require('../../core/llm');
const { parseJsonFromLLM } = require('../../core/llm-utils');
const { isEmbeddableImage, sniffImageFormat } = require('../../core/image-format');
const { addThumbnailImage, hardenDrawingAnchors, pixelsToColumnWidth } = require('../../core/excel-image');
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

// 每条评价最多可附的截图数量，与上传面板的限制保持一致
const MAX_REVIEW_ATTACHMENTS = 4;
const REVIEW_ASSET_SUBDIR = 'review-assets';
const REVIEW_ASSET_CONTENT_TYPES = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif' };

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

// 没有订单号时的默认切分粒度：每 4 个商品一组，可选 1-4
const DEFAULT_REVIEW_GROUP_SIZE = 4;
const MAX_REVIEW_GROUP_SIZE = 4;

// 上传后必须补齐的字段。买家旺旺、手机号、订单号允许留空，
// 评价表对应列会输出空值，由人工事后补录，不阻断流程。
const REQUIRED_GROUP_FIELDS = ['orderDate', 'storeName'];
const GROUP_FIELD_LABELS = {
  orderDate: '刷单日期',
  storeName: '店铺名',
  buyerName: '买家旺旺',
  buyerPhone: '买家手机号',
  orderNumber: '订单号'
};

/**
 * 归一化每组商品数。
 * @param {unknown} value 用户提交的每组件数
 * @returns {number} 1 到 4 之间的整数，非法值回落为默认 4
 */
function normalizeReviewGroupSize(value) {
  const size = Number.parseInt(value, 10);
  if (!Number.isFinite(size)) return DEFAULT_REVIEW_GROUP_SIZE;
  return Math.min(MAX_REVIEW_GROUP_SIZE, Math.max(1, size));
}

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

  const groupSize = normalizeReviewGroupSize(options.groupSize);

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
    // 有订单号的桶保持一组；没有订单号时按每组 groupSize 件切分，
    // 而不是像以前那样整个工作表挤成一组（12 件 3 单会被误判成 1 单 12 件）。
    const bucketList = [];
    for (const bucket of buckets.values()) {
      if (!bucket.inferred) {
        bucketList.push(bucket);
        continue;
      }
      for (let start = 0; start < bucket.products.length; start += groupSize) {
        bucketList.push({ ...bucket, products: bucket.products.slice(start, start + groupSize) });
      }
    }
    for (const bucket of bucketList) {
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
    for (const field of REQUIRED_GROUP_FIELDS) {
      if (!group[field]) result[field] += 1;
    }
    return result;
  }, Object.fromEntries(REQUIRED_GROUP_FIELDS.map(field => [field, 0])));

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
async function saveReviewSourceUpload({ buffer, fileName, groupSize, dataDir = DEFAULT_FLOW_DIR } = {}) {
  const safeFileName = path.basename(String(fileName || '刷单表.xlsx'));
  if (!/\.xlsx$/i.test(safeFileName)) throw new Error('仅支持上传 .xlsx 刷单表');
  const uploadId = crypto.randomUUID();
  const dir = uploadDir(dataDir, uploadId);
  fs.mkdirSync(dir, { recursive: true });
  const parsed = await parseReviewSourceWorkbook(buffer, { fileName: safeFileName, groupSize });
  const sourceFile = path.join(dir, 'source.xlsx');
  const metadata = {
    uploadId,
    ...parsed,
    groupSize: normalizeReviewGroupSize(groupSize),
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

/**
 * 用新的每组商品数重新解析已上传的刷单表，免去重新选文件。
 * 分组数量会变，因此之前人工填写的订单信息会被重置。
 * @param {object} [options] 重分组选项。
 * @param {string} options.uploadId 已保存的上传 ID。
 * @param {number} options.groupSize 每组商品数，可选 1-4。
 * @param {string} [options.dataDir] pipeline 数据目录。
 * @returns {Promise<object>} 重新解析后的上传元数据。
 */
async function regroupReviewSourceUpload({ uploadId, groupSize, dataDir = DEFAULT_FLOW_DIR } = {}) {
  const dir = uploadDir(dataDir, uploadId);
  const sourceFile = path.join(dir, 'source.xlsx');
  if (!fs.existsSync(sourceFile)) throw new Error('上传的刷单表不存在或已被清理，请重新上传');
  const metadata = readReviewSourceUpload(uploadId, dataDir);
  const parsed = await parseReviewSourceWorkbook(fs.readFileSync(sourceFile), {
    fileName: metadata.fileName || '刷单表.xlsx',
    groupSize
  });
  const next = {
    ...metadata,
    ...parsed,
    groupSize: normalizeReviewGroupSize(groupSize),
    sourceFile,
    regroupedAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(dir, 'metadata.json'), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
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
  for (const [index, group] of sanitized.entries()) {
    const missing = REQUIRED_GROUP_FIELDS.filter(field => !group[field]);
    if (missing.length > 0) {
      throw new Error(`订单组 ${index + 1} 缺少${missing.map(field => GROUP_FIELD_LABELS[field]).join('、')}`);
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
  run.files.reviewAssets = run.files.reviewAssets || path.join(runDir, 'review-assets.json');
  return run.files;
}

function reviewAssetDir(runDir) {
  return path.join(runDir, REVIEW_ASSET_SUBDIR);
}

/**
 * 读取评价配图清单。清单独立于草稿文件，重新生成评价草稿不会丢掉已上传的图片。
 * @param {string} file 清单文件路径
 * @returns {{version:number, items:Object<string, Array<object>>}} 配图清单
 */
function readReviewAssetManifest(file) {
  if (!fs.existsSync(file)) return { version: 1, items: {} };
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    return { version: 1, items: value.items && typeof value.items === 'object' ? value.items : {} };
  } catch (_error) {
    return { version: 1, items: {} };
  }
}

function writeReviewAssetManifest(file, manifest) {
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function safeAttachmentName(fileName, fallback) {
  const base = path.basename(String(fileName || '')).replace(/[\\/:*?"<>|]/g, '-').trim();
  return base ? base.slice(0, 80) : fallback;
}

/**
 * 把清单里的相对路径（相对 runDir）解析成绝对路径，并确认它没有逃出 review-assets 目录。
 * @param {string} runDir 运行目录
 * @param {string} relativeFile 清单记录的相对路径
 * @returns {string} 绝对路径
 */
function resolveReviewAssetPath(runDir, relativeFile) {
  const assetsDir = path.resolve(reviewAssetDir(runDir));
  const absolute = path.resolve(path.resolve(runDir), String(relativeFile || ''));
  if (!absolute.startsWith(assetsDir + path.sep)) throw new Error('评价配图路径不合法');
  return absolute;
}

/**
 * 列出某次运行的全部评价配图。
 * @param {object} [options] 选项
 * @param {string} options.runId 运行 ID
 * @param {string} [options.dataDir] pipeline 数据目录
 * @returns {{items: Object<string, Array<object>>, limit: number}} 按草稿 ID 分组的配图
 */
function listReviewAttachments({ dataDir = DEFAULT_FLOW_DIR, runId } = {}) {
  const context = getRun({ dataDir, runId });
  const files = ensureReviewRunFiles(context.run, context.runDir);
  return { items: readReviewAssetManifest(files.reviewAssets).items, limit: MAX_REVIEW_ATTACHMENTS };
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
  fs.writeFileSync(files.reviewGroups, `${JSON.stringify({ uploadId: upload.uploadId, fileName: upload.fileName, sha256: upload.sha256, groupSize: normalizeReviewGroupSize(upload.groupSize), groups }, null, 2)}\n`, 'utf8');
  context.run.status = 'review_source_imported';
  context.run.options = {
    ...(context.run.options || {}),
    mode: 'review-sheet',
    uploadId: upload.uploadId,
    fileName: options.fileName || '',
    groupSize: normalizeReviewGroupSize(upload.groupSize)
  };
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

/**
 * 为一条评价草稿追加一张配图。只接受魔数确认的 JPG/PNG/GIF，
 * WebP 会被拒——它写进 xlsx 后旧版 Excel 和手机端会显示空白。
 * @param {object} [options] 选项
 * @param {string} options.runId 运行 ID
 * @param {string} options.draftId 评价草稿 ID
 * @param {Buffer} options.buffer 图片字节
 * @param {string} [options.fileName] 原始文件名，仅用于展示
 * @param {string} [options.dataDir] pipeline 数据目录
 * @returns {Promise<object>} 新配图与该草稿当前的配图列表
 */
async function addReviewAttachment({ dataDir = DEFAULT_FLOW_DIR, runId, draftId, buffer, fileName } = {}) {
  const context = getRun({ dataDir, runId });
  const files = ensureReviewRunFiles(context.run, context.runDir);
  const targetDraftId = String(draftId || '').trim();
  if (!readJsonl(files.reviewDrafts).some(row => String(row.id) === targetDraftId)) {
    throw new Error('评价草稿不存在，请刷新后重试');
  }

  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (bytes.length === 0) throw new Error('图片内容为空');
  const format = sniffImageFormat(bytes);
  if (!isEmbeddableImage(bytes)) {
    throw new Error(format === 'webp' ? '不支持 WebP 图片，请转成 JPG 或 PNG 后上传' : '只支持 JPG、PNG、GIF 图片');
  }

  const manifest = readReviewAssetManifest(files.reviewAssets);
  const current = Array.isArray(manifest.items[targetDraftId]) ? manifest.items[targetDraftId] : [];
  if (current.length >= MAX_REVIEW_ATTACHMENTS) {
    throw new Error(`每条评价最多 ${MAX_REVIEW_ATTACHMENTS} 张图片，请先删除再上传`);
  }

  const id = crypto.randomUUID();
  const storedName = `${id}.${format === 'jpeg' ? 'jpg' : format}`;
  fs.mkdirSync(reviewAssetDir(context.runDir), { recursive: true });
  fs.writeFileSync(path.join(reviewAssetDir(context.runDir), storedName), bytes);

  const attachment = {
    id,
    draftId: targetDraftId,
    name: safeAttachmentName(fileName, storedName),
    file: `${REVIEW_ASSET_SUBDIR}/${storedName}`,
    format,
    size: bytes.length,
    uploadedAt: new Date().toISOString()
  };
  manifest.items[targetDraftId] = [...current, attachment];
  writeReviewAssetManifest(files.reviewAssets, manifest);

  const attachments = manifest.items[targetDraftId];
  return {
    runId: context.runId,
    attachment,
    attachments,
    limit: MAX_REVIEW_ATTACHMENTS,
    remaining: MAX_REVIEW_ATTACHMENTS - attachments.length
  };
}

/**
 * 删除一条评价配图并清理磁盘文件。
 * @param {object} [options] 选项
 * @param {string} options.runId 运行 ID
 * @param {string} options.draftId 评价草稿 ID
 * @param {string} options.attachmentId 配图 ID
 * @param {string} [options.dataDir] pipeline 数据目录
 * @returns {object} 剩余配图
 */
function removeReviewAttachment({ dataDir = DEFAULT_FLOW_DIR, runId, draftId, attachmentId } = {}) {
  const context = getRun({ dataDir, runId });
  const files = ensureReviewRunFiles(context.run, context.runDir);
  const targetDraftId = String(draftId || '').trim();
  const manifest = readReviewAssetManifest(files.reviewAssets);
  const current = Array.isArray(manifest.items[targetDraftId]) ? manifest.items[targetDraftId] : [];
  const target = current.find(item => String(item.id) === String(attachmentId || ''));
  if (!target) throw new Error('评价配图不存在或已被删除');

  const absolute = resolveReviewAssetPath(context.runDir, target.file);
  if (fs.existsSync(absolute)) fs.rmSync(absolute, { force: true });
  const remaining = current.filter(item => String(item.id) !== String(target.id));
  if (remaining.length > 0) manifest.items[targetDraftId] = remaining;
  else delete manifest.items[targetDraftId];
  writeReviewAssetManifest(files.reviewAssets, manifest);
  return { runId: context.runId, draftId: targetDraftId, attachments: remaining, limit: MAX_REVIEW_ATTACHMENTS };
}

/**
 * 按配图 ID 取出文件绝对路径与 Content-Type，供接口回图。
 * @param {object} [options] 选项
 * @param {string} options.runId 运行 ID
 * @param {string} options.attachmentId 配图 ID
 * @param {string} [options.dataDir] pipeline 数据目录
 * @returns {{absolutePath: string, contentType: string, attachment: object}} 读取结果
 */
function readReviewAttachment({ dataDir = DEFAULT_FLOW_DIR, runId, attachmentId } = {}) {
  const context = getRun({ dataDir, runId });
  const files = ensureReviewRunFiles(context.run, context.runDir);
  const manifest = readReviewAssetManifest(files.reviewAssets);
  for (const attachments of Object.values(manifest.items)) {
    const found = (Array.isArray(attachments) ? attachments : []).find(item => String(item.id) === String(attachmentId || ''));
    if (!found) continue;
    const absolutePath = resolveReviewAssetPath(context.runDir, found.file);
    if (!fs.existsSync(absolutePath)) throw new Error('评价配图文件已丢失，请重新上传');
    const extension = path.extname(absolutePath).replace('.', '').toLowerCase();
    return {
      absolutePath,
      contentType: REVIEW_ASSET_CONTENT_TYPES[extension] || 'application/octet-stream',
      attachment: found
    };
  }
  throw new Error('评价配图不存在或已被删除');
}

// 淘宝商品标题是关键词堆砌，评价里复述它既不通顺也像刷单模板，所以模板一律不带标题。
const LOCAL_REVIEW_TEMPLATES = [
  '收到后和描述一致，细节处理得不错，日常使用很方便。',
  '整体质感可以，包装也很仔细，实际效果符合预期。',
  '款式耐看，用起来顺手，尺寸和页面介绍基本一致。',
  '实物没有明显色差，做工比较细致，这次购买体验不错。',
  '卖家发货前会确认细节，东西和详情页描述对得上。',
  '这个价位能拿到这种成色，超出预期，会考虑回购。'
];

/**
 * 取一条不带商品标题的评价模板。
 * @param {number} index 商品序号，用于轮转模板避免整批雷同
 * @returns {string} 评价文案
 */
function titleFreeReview(index) {
  return LOCAL_REVIEW_TEMPLATES[Math.max(0, Number(index) || 0) % LOCAL_REVIEW_TEMPLATES.length];
}

/**
 * 判断评价是否复述了商品标题（整段引用或截取前缀都算）。
 * @param {string} text 评价内容
 * @param {string} title 商品标题
 * @returns {boolean} true 表示引用了标题
 */
function mentionsTitle(text, title) {
  const review = String(text || '').replace(/\s+/g, '');
  const subject = String(title || '').replace(/\s+/g, '');
  if (!review || subject.length < 10) return false;
  if (review.includes(subject)) return true;
  return review.includes(subject.slice(0, 12));
}

async function llmReviews(products, options = {}) {
  const llmInfo = getLLMProviderInfo({ provider: options.llmProvider });
  if (!llmInfo.configured || options.useAI === false) return null;
  const client = createLLMClient({ provider: options.llmProvider });
  const titles = products.map((product, index) => `${index + 1}. ${product.title}`).join('\n');
  const request = typeof options.request === 'function' ? options.request : axios.post;
  const response = await request(
    `${client.apiBase}/chat/completions`,
    client._buildChatPayload({
      messages: [
        { role: 'system', content: '你负责为已购买商品生成自然、克制、互不重复的中文评价。不要使用绝对化宣传，不虚构物流速度、材质或功效。严禁复述或引用商品标题原文，包括加引号、截取片段或把关键词串进句子里；请改用「东西」「宝贝」「这款」「卖家」「店家」等自然指代。只返回 JSON 数组，数组长度必须和商品数相同。格式：["评价1","评价2"]。' },
        { role: 'user', content: `评价语气：${options.reviewTone || '自然真实'}\n每条约 ${Number(options.reviewLength || 35)} 字。\n下面这些标题只用于理解商品品类，不要出现在评价里：\n${titles}` }
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
  const replaced = new Array(products.length).fill(false);
  let degraded = false;
  let titleEchoFixed = 0;
  const batchSize = 20;
  for (let start = 0; start < products.length; start += batchSize) {
    const batch = products.slice(start, start + batchSize);
    try {
      const batchReviews = await llmReviews(batch, options);
      if (!batchReviews) {
        if (options.useAI !== false) degraded = true;
        continue;
      }
      batchReviews.forEach((review, offset) => {
        const index = start + offset;
        const text = String(review || '').trim();
        // 模型仍然复述标题时不采纳该条，换成无标题模板并标记，供人工复核时留意
        if (!text || mentionsTitle(text, batch[offset].title)) {
          generated[index] = titleFreeReview(index);
          replaced[index] = true;
          titleEchoFixed += 1;
          return;
        }
        generated[index] = text;
      });
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
    reviewContent: generated[index] || titleFreeReview(index),
    correspondingFile: product.correspondingFile || '',
    origin: replaced[index] ? 'replaced' : (generated[index] ? 'llm' : 'template'),
    status: 'pending_review'
  }));
  appendJsonl(files.reviewDrafts, drafts);
  context.run.status = 'needs_review';
  context.run.requiresUserAction = true;
  context.run.mustReview = true;
  context.run.counts.reviewDrafts = drafts.length;
  context.run.reviewGeneration = {
    degraded,
    titleEchoFixed,
    provider: getLLMProviderInfo({ provider: options.llmProvider }).provider
  };
  writeRun(context.runDir, context.run);
  return {
    runId: context.runId,
    runDir: context.runDir,
    status: 'needs_review',
    count: drafts.length,
    degraded,
    titleEchoFixed
  };
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
  const manifest = readReviewAssetManifest(files.reviewAssets);
  const drafts = readJsonl(files.reviewDrafts).map(row => {
    const edit = edits.get(row.id) || {};
    const reviewContent = String(edit.reviewContent ?? row.reviewContent ?? '').trim().slice(0, 500);
    if (!reviewContent) throw new Error(`商品“${row.title}”缺少评价内容`);
    const attachments = Array.isArray(manifest.items[row.id]) ? manifest.items[row.id] : [];
    const typed = String(edit.correspondingFile ?? row.correspondingFile ?? '').trim();
    // 人工没填对应文件时，自动用上传的配图文件名顶上
    const correspondingFile = (typed || attachments.map(item => item.name).join('、')).slice(0, 200);
    return {
      ...row,
      reviewContent,
      correspondingFile,
      attachments: attachments.map(item => item.file),
      status: 'approved'
    };
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
  const manifest = readReviewAssetManifest(files.reviewAssets);
  const attachmentLists = new Map();
  let maxAttachments = 0;
  for (const group of source.groups) {
    for (const product of group.products) {
      const list = Array.isArray(manifest.items[product.id]) ? manifest.items[product.id] : [];
      attachmentLists.set(product.id, list);
      maxAttachments = Math.max(maxAttachments, list.length);
    }
  }
  // 显示框上限：横图竖图都按原图比例等比缩进这个框，不拉伸变形
  const thumbnailMaxWidth = 110;
  const thumbnailMaxHeight = 96;
  const thumbnailGap = 6;
  const columnWidths = [15.375, 18.125, 21.625, 21.625, 73.125, 21.5, 50.5, 20.875];
  if (maxAttachments > 0) {
    // 对应文件列按缩略图数量加宽，保证最多 4 张能并排放下
    columnWidths[7] = pixelsToColumnWidth(maxAttachments * (thumbnailMaxWidth + thumbnailGap) - thumbnailGap + 8);
  }
  let imageCount = 0;
  const imageLabels = [];
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('1拖多评价', { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
  sheet.columns = columnWidths.map(width => ({ width }));
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
      const targetRow = startRow + offset;
      sheet.getCell(targetRow, 5).value = product.title || '';
      sheet.getCell(targetRow, 7).value = draft.reviewContent || '';
      const attachments = attachmentLists.get(product.id) || [];
      let embeddedForRow = 0;
      for (const [slot, attachment] of attachments.entries()) {
        try {
          const buffer = fs.readFileSync(resolveReviewAssetPath(context.runDir, attachment.file));
          addThumbnailImage(workbook, sheet, { buffer, extension: attachment.format || 'jpeg' }, {
            col: 7, row: targetRow, slot, maxWidth: thumbnailMaxWidth, maxHeight: thumbnailMaxHeight, gap: thumbnailGap
          });
          // 图片对象以原始文件名命名，Excel 选择窗格里能认出并单独复制某一张
          imageLabels.push(String(attachment.name || `配图 ${slot + 1}`));
          imageCount += 1;
          embeddedForRow += 1;
        } catch (_error) {
          // 图片文件丢失时跳过这张，不阻断出表
        }
      }
      // 嵌图成功就不再堆文件名；一张都没嵌上才退回文件名文本
      sheet.getCell(targetRow, 8).value = embeddedForRow > 0 ? null : (draft.correspondingFile || product.correspondingFile || null);
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
  // 补齐锚点与 xfrm，否则手机 WPS/Excel 和旧版 Excel 看不到这些缩略图
  if (imageCount > 0) {
    await hardenDrawingAnchors(files.orderSheet, {
      columnWidths,
      rowHeights: Array.from({ length: Math.max(1, sheet.rowCount) }, (_unused, i) => sheet.getRow(i + 1).height),
      labels: imageLabels
    });
  }
  context.run.status = 'workflow_complete';
  context.run.requiresUserAction = false;
  context.run.mustReview = false;
  context.run.files = files;
  context.run.counts.orderSheetRows = drafts.length;
  context.run.counts.orderSheetImages = imageCount;
  context.run.options = { ...(context.run.options || {}), mode: 'review-sheet', sheetType: 'review', includeSpacerRow: options.includeSpacerRow !== false };
  writeRun(context.runDir, context.run);
  return {
    runId: context.runId,
    runDir: context.runDir,
    status: 'workflow_complete',
    file: files.orderSheet,
    count: drafts.length,
    sheetType: 'review',
    imageCount
  };
}

module.exports = {
  DEFAULT_REVIEW_GROUP_SIZE,
  MAX_REVIEW_ATTACHMENTS,
  REVIEW_HEADERS,
  REQUIRED_GROUP_FIELDS,
  addReviewAttachment,
  buildReviewSheet,
  confirmReviewDrafts,
  generateReviewDrafts,
  importReviewSource,
  listReviewAttachments,
  mentionsTitle,
  normalizeReviewGroupSize,
  parseReviewSourceWorkbook,
  readReviewAttachment,
  readReviewSourceUpload,
  removeReviewAttachment,
  regroupReviewSourceUpload,
  saveReviewSourceUpload,
  titleFreeReview
};
