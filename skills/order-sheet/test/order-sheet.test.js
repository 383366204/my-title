'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const ExcelJS = require('exceljs');

const {
  isDescending,
  isDescendingBy,
  normalizeCollectionOptions,
  parseNumber,
  validateCustomDateRange
} = require('../../sycm-research/src/product-rank');
const { averagePayment, generateOrderSheet } = require('../src/generate-order-sheet');

describe('order sheet workflow', () => {
  it('normalizes SYCM numbers and verifies visitor descending order', () => {
    assert.equal(parseNumber('1,234 +20.00%'), 1234);
    assert.equal(parseNumber('-'), 0);
    assert.equal(isDescending([{ visitorCount: 20 }, { visitorCount: 8 }, { visitorCount: 8 }]), true);
    assert.equal(isDescending([{ visitorCount: 8 }, { visitorCount: 20 }]), false);
    assert.equal(isDescendingBy([{ paymentAmount: 20 }, { paymentAmount: 8 }], 'payAmt'), true);
    assert.equal(normalizeCollectionOptions({ pages: 9, sortMetric: 'payAmt' }).pages, 5);
    assert.deepEqual(validateCustomDateRange('2026-08-05', '2026-08-09'), {
      startDate: '2026-08-05',
      endDate: '2026-08-09',
      days: 5
    });
    assert.throws(() => validateCustomDateRange('2026-07-01', '2026-08-09'), /最多选择 31 天/);
  });

  it('calculates average paid amount only when paid item count is available', () => {
    assert.equal(averagePayment({ paymentAmount: 66.6, paidItemCount: 2 }), 33.3);
    assert.equal(averagePayment({ paymentAmount: 10, paidItemCount: 0 }), null);
  });

  it('writes the 动销一拖多 order layout by default', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'order-sheet-'));
    const outputFile = path.join(tempDir, 'result.xlsx');
    const rows = [
      { rank: 1, itemId: '1001', title: '测试商品一', productUrl: 'https://item.taobao.com/item.htm?id=1001', paymentAmount: 30, paidItemCount: 2, cartItemCount: 4, visitorCount: 20 },
      { rank: 2, itemId: '1002', title: '测试商品二', productUrl: 'https://item.taobao.com/item.htm?id=1002', paymentAmount: 12, paidItemCount: 1, cartItemCount: 2, visitorCount: 8 }
    ];

    const result = await generateOrderSheet({
      rows,
      meta: { storeName: '测试店铺', statDate: '2026-08-10', orderDate: '2026-08-12', period: '日' },
      outputFile,
      imageLoader: async () => null
    });

    assert.equal(result.count, 2);
    assert.equal(result.imageCount, 0);
    assert.equal(result.sheetType, 'order');
    assert.equal(fs.existsSync(outputFile), true);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(outputFile);
    const orderSheet = workbook.getWorksheet('动销一拖多');
    const rawSheet = workbook.getWorksheet('商品排行原始数据');
    assert.equal(workbook.worksheets[0].name, '动销一拖多');
    assert.equal(workbook.getWorksheet('1拖多评价'), undefined);
    assert.equal(orderSheet.getCell('A1').value, '标题');
    assert.equal(orderSheet.getCell('A1').font.name, '宋体');
    assert.equal(orderSheet.getCell('A1').font.size, 12);
    assert.equal(orderSheet.getCell('A2').text, '测试商品一');
    assert.equal(orderSheet.getCell('C2').value, 15);
    assert.equal(orderSheet.getCell('F2').value, '测试店铺');
    assert.equal(orderSheet.getCell('G2').value, '');
    assert.equal(orderSheet.getCell('A2').isMerged, false);
    assert.equal(orderSheet.getCell('E2').font.color.argb, 'FFFF0000');
    assert.equal(orderSheet.getCell('A5').text, '测试商品二');
    assert.equal(rawSheet.getCell('K2').value, 20);
    assert.equal(rawSheet.getCell('P3').value, '商品访客数降序');
  });

  it('writes the 1拖多评价 layout when review is selected', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-sheet-'));
    const outputFile = path.join(tempDir, 'result.xlsx');
    const rows = [
      { rank: 1, title: '测试商品一' },
      { rank: 2, title: '测试商品二' }
    ];

    const result = await generateOrderSheet({
      rows,
      sheetType: 'review',
      meta: { storeName: '测试店铺', statDate: '2026-08-10', orderDate: '2026-08-12', period: '日' },
      outputFile,
      imageLoader: async () => null
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(outputFile);
    const reviewSheet = workbook.getWorksheet('1拖多评价');
    assert.equal(result.sheetType, 'review');
    assert.equal(result.reviewGroupCount, 1);
    assert.equal(workbook.worksheets[0].name, '1拖多评价');
    assert.equal(workbook.getWorksheet('动销一拖多'), undefined);
    assert.equal(reviewSheet.getCell('A1').value, '刷单日期');
    assert.equal(reviewSheet.getCell('B1').value, '店铺名');
    assert.equal(reviewSheet.getCell('E1').value, '产品标题');
    assert.equal(reviewSheet.getCell('B2').value, '测试店铺');
    assert.equal(reviewSheet.getCell('E2').value, '测试商品一');
    assert.equal(reviewSheet.getCell('E3').value, '测试商品二');
    assert.equal(reviewSheet.getCell('A2').isMerged, true);
    assert.equal(reviewSheet.getCell('A2').numFmt, 'm/d/yy');
    assert.equal(reviewSheet.getCell('A2').value.getUTCFullYear(), 2026);
    assert.equal(reviewSheet.getCell('A2').value.getUTCMonth(), 7);
    assert.equal(reviewSheet.getCell('A2').value.getUTCDate(), 12);
  });

  it('applies configurable order-sheet content and omits raw data', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'configured-order-sheet-'));
    const outputFile = path.join(tempDir, 'result.xlsx');
    const result = await generateOrderSheet({
      rows: [
        { title: '保留商品', paymentAmount: 88, paidItemCount: 0 },
        { title: '超出上限商品', paymentAmount: 20, paidItemCount: 1 }
      ],
      meta: { storeName: '配置店铺' },
      outputFile,
      productLimit: 1,
      includeRawData: false,
      includeImages: false,
      amountMode: 'payment',
      cartQuantity: 3,
      rowSpan: 2,
      workRequirement: '浏览两款后下单',
      orderNote: '暗号 8'
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(outputFile);
    const sheet = workbook.getWorksheet('动销一拖多');
    assert.equal(result.count, 1);
    assert.equal(result.includeRawData, false);
    assert.equal(workbook.worksheets.length, 1);
    assert.equal(sheet.getCell('A2').text, '保留商品');
    assert.equal(sheet.getCell('C2').value, 88);
    assert.equal(sheet.getCell('D2').value, 3);
    assert.equal(sheet.getCell('E2').value, '浏览两款后下单');
    assert.equal(sheet.getCell('G2').value, '暗号 8');
    assert.equal(sheet.getCell('A4').value, null);
  });

  it('marks or skips products with missing order amounts', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'missing-order-amount-'));
    const markFile = path.join(tempDir, 'mark.xlsx');
    const skipFile = path.join(tempDir, 'skip.xlsx');
    const rows = [
      { title: '缺金额', paymentAmount: 0, paidItemCount: 0 },
      { title: '有金额', paymentAmount: 20, paidItemCount: 2 }
    ];

    await generateOrderSheet({ rows, outputFile: markFile, includeImages: false, missingAmountPolicy: 'mark' });
    const marked = new ExcelJS.Workbook();
    await marked.xlsx.readFile(markFile);
    assert.equal(marked.getWorksheet('动销一拖多').getCell('C2').value, '待填写');

    const result = await generateOrderSheet({ rows, outputFile: skipFile, includeImages: false, missingAmountPolicy: 'skip' });
    const skipped = new ExcelJS.Workbook();
    await skipped.xlsx.readFile(skipFile);
    assert.equal(result.count, 1);
    assert.equal(result.skippedCount, 1);
    assert.equal(skipped.getWorksheet('动销一拖多').getCell('A2').text, '有金额');
  });
});
