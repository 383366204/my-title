'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const ExcelJS = require('exceljs');
const {
  buildReviewSheet,
  confirmReviewDrafts,
  generateReviewDrafts,
  importReviewSource,
  parseReviewSourceWorkbook,
  saveReviewSourceUpload
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
  assert.match(sheet.getCell('G2').value, /商品甲/);
});
