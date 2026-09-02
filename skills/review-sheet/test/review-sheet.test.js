'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const ExcelJS = require('exceljs');
const { readJsonl } = require('../../pipeline-flow/src/run-store');
const {
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
} = require('..');

async function fixtureBuffer() {
  const workbook = new ExcelJS.Workbook();
  const first = workbook.addWorksheet('订单一');
  first.addRow(['标题', '主图', '价格', '加购件数', '做单要求', '店铺名', '备注']);
  first.addRow(['商品甲', '', 10, 1, '', '测试店铺', '']);
  first.getRow(5).values = ['商品乙'];
  const second = workbook.addWorksheet('订单二');
  second.state = 'hidden';
  second.addRow(['产品标题', '店铺名称']);
  second.addRow(['商品甲', '测试店铺']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test('parses worksheets as inferred order groups without removing duplicate titles', async () => {
  const parsed = await parseReviewSourceWorkbook(await fixtureBuffer(), { fileName: '刷单表.xlsx' });
  assert.equal(parsed.parsedSheetCount, 2);
  assert.equal(parsed.productCount, 3);
  assert.equal(parsed.groups[0].products.length, 2);
  assert.equal(parsed.groups[1].products[0].title, '商品甲');
  assert.equal(parsed.groups[0].storeName, '测试店铺');
});

test('prefers explicit order numbers when one worksheet contains multiple orders', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('混合订单');
  sheet.addRow(['产品标题', '店铺名', '买家旺旺', '买家手机号', '订单号']);
  sheet.addRow(['商品一', '测试店', '买家甲', '13800000001', 'ORDER-A']);
  sheet.addRow(['商品二', '', '', '', '']);
  sheet.addRow(['商品三', '测试店', '买家乙', '13800000002', 'ORDER-B']);
  const parsed = await parseReviewSourceWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()));
  assert.equal(parsed.parsedSheetCount, 2);
  assert.deepEqual(parsed.groups.map(group => group.orderNumber), ['ORDER-A', 'ORDER-B']);
  assert.deepEqual(parsed.groups.map(group => group.products.length), [2, 1]);
  assert.equal(parsed.groups[0].inferred, false);
});

test('normalizes typed Excel dates before showing editable order groups', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('日期订单');
  sheet.addRow(['产品标题', '刷单日期', '店铺名']);
  sheet.addRow(['商品一', new Date(2026, 7, 14, 12), '测试店']);
  sheet.getCell('B2').numFmt = 'yyyy-mm-dd';
  const parsed = await parseReviewSourceWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()));
  assert.equal(parsed.groups[0].orderDate, '2026-08-14');
});

test('imports, drafts, confirms and exports a review workbook', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-flow-'));
  const upload = await saveReviewSourceUpload({ buffer: await fixtureBuffer(), fileName: '刷单表.xlsx', dataDir });
  const groups = upload.groups.map((group, index) => ({
    ...group,
    buyerName: `买家${index + 1}`,
    buyerPhone: `1380000000${index}`,
    orderNumber: `ORDER-${index + 1}`
  }));
  await importReviewSource({ dataDir, runId: 'test-review', uploadId: upload.uploadId, groups });
  await generateReviewDrafts({ dataDir, runId: 'test-review', useAI: false });
  const confirmed = confirmReviewDrafts({ dataDir, runId: 'test-review', reviews: [] });
  assert.equal(confirmed.count, 3);
  const result = await buildReviewSheet({ dataDir, runId: 'test-review' });
  assert.equal(result.count, 3);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(result.file);
  const sheet = workbook.getWorksheet('1拖多评价');
  assert.equal(sheet.getCell('B2').value, '测试店铺');
  assert.equal(sheet.getCell('C2').value, '买家1');
  assert.equal(sheet.getCell('E2').value, '商品甲');
  assert.equal(sheet.getCell('E3').value, '商品乙');
  assert.equal(sheet.getCell('E5').value, '商品甲');
  // 评价内容不得复述商品标题
  assert.doesNotMatch(String(sheet.getCell('G2').value), /商品甲/);
});

async function manyProductBuffer(count) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('动销一拖多');
  sheet.addRow(['标题', '主图', '价格（下单金额）', '加购件数', '做单要求', '店铺名', '下单备注（区分真实单暗号）']);
  for (let index = 1; index <= count; index += 1) {
    sheet.addRow([`商品${index}`, '', 10 + index, 1, '浏览后下单', '拾珀天晶', '']);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test('normalizes the group size option to 1-4', () => {
  assert.equal(normalizeReviewGroupSize(undefined), 4);
  assert.equal(normalizeReviewGroupSize('2'), 2);
  assert.equal(normalizeReviewGroupSize(3), 3);
  assert.equal(normalizeReviewGroupSize(0), 1);
  assert.equal(normalizeReviewGroupSize(9), 4);
  assert.equal(normalizeReviewGroupSize('abc'), 4);
});

test('splits products into groups of the configured size when there is no order number', async () => {
  const buffer = await manyProductBuffer(12);

  const defaults = await parseReviewSourceWorkbook(buffer, { fileName: '刷单表.xlsx' });
  assert.equal(defaults.parsedSheetCount, 3, '默认每 4 件一组');
  assert.deepEqual(defaults.groups.map(group => group.products.length), [4, 4, 4]);
  assert.equal(defaults.groups.every(group => group.inferred), true);
  assert.deepEqual(defaults.groups[1].products.map(product => product.title), ['商品5', '商品6', '商品7', '商品8']);

  const pairs = await parseReviewSourceWorkbook(buffer, { fileName: '刷单表.xlsx', groupSize: 2 });
  assert.deepEqual(pairs.groups.map(group => group.products.length), [2, 2, 2, 2, 2, 2]);

  const threes = await parseReviewSourceWorkbook(buffer, { fileName: '刷单表.xlsx', groupSize: 3 });
  assert.deepEqual(threes.groups.map(group => group.products.length), [3, 3, 3, 3]);

  const singles = await parseReviewSourceWorkbook(buffer, { fileName: '刷单表.xlsx', groupSize: 1 });
  assert.equal(singles.groups.length, 12);

  const clamped = await parseReviewSourceWorkbook(buffer, { fileName: '刷单表.xlsx', groupSize: 9 });
  assert.deepEqual(clamped.groups.map(group => group.products.length), [4, 4, 4]);
});

test('explicit order numbers still win over the fixed group size', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('执行表');
  sheet.addRow(['标题', '订单号', '店铺名', '买家旺旺', '买家手机号', '刷单日期']);
  sheet.addRow(['商品甲', 'A-1', '店铺', '旺旺1', '13800000000', '2026-09-01']);
  sheet.addRow(['商品乙', 'A-1', '店铺', '旺旺1', '13800000000', '2026-09-01']);
  sheet.addRow(['商品丙', 'A-2', '店铺', '旺旺2', '13800000001', '2026-09-01']);

  const parsed = await parseReviewSourceWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), {
    fileName: '刷单表.xlsx',
    groupSize: 1
  });

  assert.deepEqual(parsed.groups.map(group => [group.orderNumber, group.products.length]), [['A-1', 2], ['A-2', 1]]);
  assert.equal(parsed.groups.every(group => group.inferred === false), true);
});

test('regrouping an existing upload changes group count without re-uploading', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-regroup-'));
  const upload = await saveReviewSourceUpload({
    buffer: await manyProductBuffer(12),
    fileName: '刷单表.xlsx',
    dataDir
  });
  assert.equal(upload.groupSize, 4);
  assert.equal(upload.groups.length, 3);

  const regrouped = await regroupReviewSourceUpload({ uploadId: upload.uploadId, groupSize: 3, dataDir });
  assert.equal(regrouped.groupSize, 3);
  assert.deepEqual(regrouped.groups.map(group => group.products.length), [3, 3, 3, 3]);
  assert.equal(regrouped.productCount, 12);
  assert.equal(regrouped.sha256, upload.sha256, '应复用同一份源文件而不是重新上传');

  const stored = readReviewSourceUpload(upload.uploadId, dataDir);
  assert.equal(stored.groupSize, 3, '重分组结果要落盘，导入时才能沿用同一粒度');
});

test('buyer name, phone and order number may stay empty all the way to export', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-optional-'));
  const runId = 'test-optional-fields';
  const upload = await saveReviewSourceUpload({
    buffer: await manyProductBuffer(4),
    fileName: '刷单表.xlsx',
    dataDir
  });

  const imported = await importReviewSource({
    dataDir,
    runId,
    uploadId: upload.uploadId,
    groups: upload.groups.map(group => ({ id: group.id }))
  });
  assert.equal(imported.status, 'review_source_imported');

  await generateReviewDrafts({ dataDir, runId, useAI: false });
  confirmReviewDrafts({ dataDir, runId, reviews: [] });
  const built = await buildReviewSheet({ dataDir, runId });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(built.file);
  const sheet = workbook.getWorksheet('1拖多评价');
  assert.equal(sheet.getCell('B2').value, '拾珀天晶', '从表里读到的店铺名仍应写入');
  assert.ok([undefined, null, ''].includes(sheet.getCell('C2').value), '旺旺留空不应阻断导出');
  assert.ok([undefined, null, ''].includes(sheet.getCell('D2').value), '手机号留空不应阻断导出');
  assert.ok([undefined, null, ''].includes(sheet.getCell('F2').value), '订单号留空不应阻断导出');
  assert.ok(sheet.getCell('A2').value instanceof Date, '刷单日期由服务端兜底为当天');
});

test('store name is still required and optional fields are not reported as missing', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('执行表');
  sheet.addRow(['标题']);
  sheet.addRow(['只有标题的商品甲']);
  sheet.addRow(['只有标题的商品乙']);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-nostore-'));
  const upload = await saveReviewSourceUpload({
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    fileName: '刷单表.xlsx',
    dataDir,
    groupSize: 2
  });

  await assert.rejects(
    () => importReviewSource({
      dataDir,
      runId: 'test-no-store',
      uploadId: upload.uploadId,
      groups: upload.groups.map(group => ({ id: group.id }))
    }),
    (error) => {
      assert.match(error.message, /缺少店铺名/);
      assert.doesNotMatch(error.message, /旺旺|手机号|订单号/, '选填字段不应再出现在报错里');
      return true;
    }
  );
});

const TITLE_A = '天然紫水晶吊坠男女士款巴西原石水滴刻面吊坠饰品情侣配饰包车挂';
const TITLE_B = '花开见佛嘎乌盒吊坠锆石琉璃随身药师佛像佛龛守护神香囊项链菩萨';

async function twoProductUpload(dataDir) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('动销一拖多');
  sheet.addRow(['标题', '店铺名']);
  sheet.addRow([TITLE_A, '拾珀天晶']);
  sheet.addRow([TITLE_B, '拾珀天晶']);
  const upload = await saveReviewSourceUpload({
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    fileName: '刷单表.xlsx',
    dataDir
  });
  await importReviewSource({
    dataDir,
    runId: 'draft-run',
    uploadId: upload.uploadId,
    groups: upload.groups.map(group => ({ id: group.id, storeName: '拾珀天晶' }))
  });
  return upload;
}

test('detects title echoes without false-positiving on short or unrelated text', () => {
  assert.equal(mentionsTitle(`“${TITLE_A}”收到后和描述一致。`, TITLE_A), true);
  assert.equal(mentionsTitle(`${TITLE_A.slice(0, 12)}的做工真不错`, TITLE_A), true, '截取标题前缀也算复述');
  assert.equal(mentionsTitle('东西收到后和描述一致，做工细致。', TITLE_A), false);
  assert.equal(mentionsTitle('短标题不判定', '短标题'), false, '过短标题不应误判');
  assert.equal(mentionsTitle('', TITLE_A), false);

  for (let index = 0; index < 12; index += 1) {
    const text = titleFreeReview(index);
    assert.doesNotMatch(text, /[“」]/, '模板不应带引用符号');
    assert.equal(mentionsTitle(text, TITLE_A), false);
  }
});

test('template fallback never quotes the product title', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-notitle-'));
  await twoProductUpload(dataDir);

  const result = await generateReviewDrafts({ dataDir, runId: 'draft-run', useAI: false });
  assert.equal(result.count, 2);
  const drafts = readJsonl(path.join(result.runDir, 'review-drafts.jsonl'));
  assert.equal(drafts.length, 2);
  for (const draft of drafts) {
    assert.equal(mentionsTitle(draft.reviewContent, draft.title), false, '降级文案同样不得引用标题');
    assert.equal(draft.origin, 'template');
  }
});

test('replaces model output that still quotes the product title', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-echo-'));
  await twoProductUpload(dataDir);

  const previousKey = process.env.LLM_API_KEY;
  process.env.LLM_API_KEY = 'test-key-for-draft-generation';
  try {
    const requests = [];
    const result = await generateReviewDrafts({
      dataDir,
      runId: 'draft-run',
      llmProvider: 'openai-compatible',
      request: async (url) => {
        requests.push(url);
        return {
          data: {
            choices: [{
              message: {
                content: JSON.stringify([
                  `“${TITLE_A}”收到后和描述一致，很惊喜。`,
                  '东西做工细致，包装也很用心，会考虑回购。'
                ])
              }
            }]
          }
        };
      }
    });

    assert.equal(requests.length, 1);
    assert.equal(result.titleEchoFixed, 1);
    const drafts = readJsonl(path.join(result.runDir, 'review-drafts.jsonl'));
    assert.equal(drafts[0].origin, 'replaced', '复述标题的那条应被换成模板');
    assert.equal(mentionsTitle(drafts[0].reviewContent, drafts[0].title), false);
    assert.equal(drafts[1].origin, 'llm', '正常文案保持模型原文');
    assert.equal(drafts[1].reviewContent, '东西做工细致，包装也很用心，会考虑回购。');
  } finally {
    if (previousKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = previousKey;
  }
});

/**
 * 构造只带 PNG 文件头的最小图片，用于让嵌入逻辑读到指定的像素尺寸。
 * @param {number} width 像素宽
 * @param {number} height 像素高
 * @returns {Buffer} PNG 字节
 */
function fakePng(width, height) {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf[28] = 8;
  buf[29] = 2;
  return buf;
}

async function draftRunFixture(dataDir, runId) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('动销一拖多');
  sheet.addRow(['标题', '店铺名']);
  sheet.addRow([TITLE_A, '拾珀天晶']);
  const upload = await saveReviewSourceUpload({
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    fileName: '刷单表.xlsx',
    dataDir,
    groupSize: 1
  });
  await importReviewSource({
    dataDir,
    runId,
    uploadId: upload.uploadId,
    groups: upload.groups.map(group => ({ id: group.id, storeName: '拾珀天晶' }))
  });
  const drafts = await generateReviewDrafts({ dataDir, runId, useAI: false });
  const rows = readJsonl(path.join(drafts.runDir, 'review-drafts.jsonl'));
  return { runDir: drafts.runDir, draftId: rows[0].id };
}

test('attachments allow up to four embeddable images per draft and reject the rest', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-assets-'));
  const runId = 'test-assets';
  const { runDir, draftId } = await draftRunFixture(dataDir, runId);
  const jpeg = Buffer.from('ffd8ffe000104a46494600010100', 'hex');
  const png = Buffer.from('89504e470d0a1a0a0000000d', 'hex');
  const webp = Buffer.from('52494646523f30005745425056503820', 'hex');

  const first = await addReviewAttachment({ dataDir, runId, draftId, buffer: jpeg, fileName: 'a.jpg' });
  assert.equal(first.remaining, 3);
  await addReviewAttachment({ dataDir, runId, draftId, buffer: png, fileName: 'b.png' });
  await addReviewAttachment({ dataDir, runId, draftId, buffer: jpeg, fileName: 'c.jpg' });
  const fourth = await addReviewAttachment({ dataDir, runId, draftId, buffer: jpeg, fileName: 'd.jpg' });
  assert.equal(fourth.remaining, 0);
  assert.equal(fourth.attachments.length, 4);

  await assert.rejects(
    () => addReviewAttachment({ dataDir, runId, draftId, buffer: jpeg, fileName: 'e.jpg' }),
    /最多 4 张图片/
  );
  await assert.rejects(
    () => addReviewAttachment({ dataDir, runId, draftId, buffer: webp, fileName: 'x.webp' }),
    /不支持 WebP/
  );
  await assert.rejects(
    () => addReviewAttachment({ dataDir, runId, draftId, buffer: Buffer.from('<html>x</html>', 'utf8'), fileName: 'x.jpg' }),
    /只支持 JPG/
  );
  await assert.rejects(
    () => addReviewAttachment({ dataDir, runId, draftId: 'missing-draft', buffer: jpeg }),
    /评价草稿不存在/
  );

  const listed = listReviewAttachments({ dataDir, runId });
  assert.equal(listed.limit, 4);
  assert.equal(listed.items[draftId].length, 4);

  const asset = readReviewAttachment({ dataDir, runId, attachmentId: first.attachment.id });
  assert.equal(asset.contentType, 'image/jpeg');
  assert.ok(fs.existsSync(asset.absolutePath));
  assert.ok(asset.absolutePath.startsWith(path.join(runDir, 'review-assets')));

  const removed = removeReviewAttachment({ dataDir, runId, draftId, attachmentId: first.attachment.id });
  assert.equal(removed.attachments.length, 3);
  assert.equal(fs.existsSync(asset.absolutePath), false, '删除配图要同时清掉磁盘文件');
  assert.throws(() => readReviewAttachment({ dataDir, runId, attachmentId: first.attachment.id }), /不存在或已被删除/);
});

test('confirm fills 对应文件 with attachment names and keeps typed text authoritative', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-asset-confirm-'));
  const runId = 'test-asset-confirm';
  const { draftId } = await draftRunFixture(dataDir, runId);
  const jpeg = Buffer.from('ffd8ffe000104a46494600010100', 'hex');
  await addReviewAttachment({ dataDir, runId, draftId, buffer: jpeg, fileName: '../../截图 1.jpg' });
  await addReviewAttachment({ dataDir, runId, draftId, buffer: jpeg, fileName: '评价截图2.jpg' });

  const filled = confirmReviewDrafts({ dataDir, runId, reviews: [{ id: draftId, correspondingFile: '' }] });
  assert.equal(filled.drafts[0].attachments.length, 2);
  assert.equal(filled.drafts[0].correspondingFile, '截图 1.jpg、评价截图2.jpg', '留空时自动填入配图文件名');

  const typed = confirmReviewDrafts({ dataDir, runId, reviews: [{ id: draftId, correspondingFile: '人工填写的名称' }] });
  assert.equal(typed.drafts[0].correspondingFile, '人工填写的名称', '人工填写优先于自动填充');
});

test('review workbook embeds attachments as individually named thumbnails', async () => {
  const JSZip = require('jszip');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-embed-'));
  const runId = 'test-embed';
  const { draftId } = await draftRunFixture(dataDir, runId);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
  await addReviewAttachment({ dataDir, runId, draftId, buffer: fakePng(800, 600), fileName: '评价截图A.png' });
  await addReviewAttachment({ dataDir, runId, draftId, buffer: fakePng(600, 800), fileName: '评价截图B.png' });
  confirmReviewDrafts({ dataDir, runId, reviews: [{ id: draftId, correspondingFile: '' }] });

  const built = await buildReviewSheet({ dataDir, runId });
  assert.equal(built.imageCount, 2);

  const zip = await JSZip.loadAsync(fs.readFileSync(built.file));
  const media = Object.keys(zip.files).filter(name => name.startsWith('xl/media/') && !name.endsWith('/'));
  assert.equal(media.length, 2, '两张配图都应嵌进 xlsx');
  const xml = await zip.file('xl/drawings/drawing1.xml').async('string');
  assert.equal((xml.match(/<xdr:twoCellAnchor/g) || []).length, 2);
  assert.equal(xml.includes('<xdr:oneCellAnchor'), false);
  assert.equal(xml.includes('cstate='), false);
  assert.match(xml, /name="评价截图A\.png"/, '图片对象应带原始文件名，便于单独复制时辨认');
  assert.match(xml, /name="评价截图B\.png"/);

  const boxes = [...xml.matchAll(/<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/g)];
  assert.equal(boxes.length, 2);
  const [boxA, boxB] = boxes;
  const px = (emu) => Number(emu) / 9525;
  // 800x600 横图按宽撑满 110，600x800 竖图按高撑满 96，两者都必须保持原比例
  assert.ok(Math.abs(px(boxA[3]) - 110) < 0.01);
  assert.ok(Math.abs(px(boxA[3]) / px(boxA[4]) - 800 / 600) < 1e-3, '横图必须保持 4:3，不能被压成方形');
  assert.ok(Math.abs(px(boxB[4]) - 96) < 0.01);
  assert.ok(Math.abs(px(boxB[3]) / px(boxB[4]) - 600 / 800) < 1e-3, '竖图必须保持 3:4');
  assert.ok(Number(boxB[1]) > Number(boxA[1]), '两张图应横向错开而不是叠在一起');
  assert.ok(Number(boxA[2]) > 0 && Number(boxB[2]) > 0);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(built.file);
  const sheet = workbook.getWorksheet('1拖多评价');
  assert.ok([undefined, null, ''].includes(sheet.getCell('H2').value), '嵌图后对应文件列不应再堆文件名');
  assert.equal(sheet.getColumn(8).width > 20.875, true, '对应文件列应按缩略图数量加宽');
});
