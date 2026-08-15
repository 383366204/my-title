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
      { rank: 1, itemId: '1001', title: '测试商品一', productUrl: 'https://item.taobao.com/item.htm?id=1001', paymentAmount: 30, paidItemCount: 2, cartItemCount: 4, visitorCount: 20, orderAmount: 18.8, storeName: '商品所属店铺' },
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
    assert.equal(orderSheet.getCell('C2').value, 18.8);
    assert.equal(orderSheet.getCell('F2').value, '商品所属店铺');
    assert.equal(orderSheet.getCell('G2').value, '');
    assert.equal(orderSheet.getCell('A2').isMerged, false);
    assert.equal(orderSheet.getCell('E2').font.color.argb, 'FFFF0000');
    assert.equal(orderSheet.getCell('A5').text, '测试商品二');
    assert.equal(rawSheet.getCell('K2').value, 20);
    assert.equal(rawSheet.getCell('P3').value, '商品访客数降序');
  });

  it('renders confirmed groups in user order while keeping raw rank rows unchanged', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grouped-order-sheet-'));
    const outputFile = path.join(tempDir, 'result.xlsx');
    const rows = [
      { rank: 1, itemId: '2001', title: '原始排行一', productUrl: 'https://item.taobao.com/item.htm?id=2001', visitorCount: 80, orderAmount: 20 },
      { rank: 2, itemId: '2002', title: '原始排行二', productUrl: 'https://item.taobao.com/item.htm?id=2002', visitorCount: 60, orderAmount: 30 }
    ];
    const groups = [{
      id: 'group-1',
      workRequirement: '先浏览主商品再加购搭配商品',
      mainProduct: { ...rows[1], title: '确认后的主商品' },
      subProducts: [{ ...rows[0], title: '确认后的搭配商品' }]
    }];

    await generateOrderSheet({ rows, groups, outputFile, rowSpan: 1, includeImages: false });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(outputFile);
    const orderSheet = workbook.getWorksheet('动销一拖多');
    const rawSheet = workbook.getWorksheet('商品排行原始数据');
    assert.equal(orderSheet.getCell('A2').text, '【主商品】确认后的主商品');
    assert.equal(orderSheet.getCell('A3').text, '【搭配商品】确认后的搭配商品');
    assert.equal(orderSheet.getCell('E2').value, '先浏览主商品再加购搭配商品');
    assert.equal(orderSheet.getCell('G3').border.bottom.style, 'medium');
    assert.equal(rawSheet.getCell('D2').value, '原始排行一');
    assert.equal(rawSheet.getCell('D3').value, '原始排行二');
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

  it('merges rank items and manual items with deduplication and field overrides', () => {
    const { mergeOrderSheetProducts } = require('../index');
    const rankRows = [
      { itemId: '1001', title: 'SYCM标题1', visitorCount: 100, paymentAmount: 200, paidItemCount: 2, storeName: 'SYCM店铺' },
      { itemId: '1002', title: 'SYCM标题2', visitorCount: 50, paymentAmount: 100, paidItemCount: 1, storeName: 'SYCM店铺' }
    ];
    const manualRows = [
      { itemId: '1001', title: '用户显式标题1', orderAmount: 99.5, storeName: '用户自定义店铺' },
      { itemId: '1003', title: '手工商品3', orderAmount: 60 }
    ];

    const merged = mergeOrderSheetProducts(rankRows, manualRows);
    assert.equal(merged.length, 3);

    assert.equal(merged[0].itemId, '1001');
    assert.equal(merged[0].title, '用户显式标题1');
    assert.equal(merged[0].storeName, '用户自定义店铺');
    assert.equal(merged[0].orderAmount, 99.5);
    assert.equal(merged[0].visitorCount, 100);
    assert.equal(merged[0].paymentAmount, 200);

    assert.equal(merged[1].itemId, '1002');
    assert.equal(merged[1].title, 'SYCM标题2');

    assert.equal(merged[2].itemId, '1003');
    assert.equal(merged[2].title, '手工商品3');
    assert.equal(merged[2].sourceType, 'manual');
    assert.equal(merged[2].visitorCount, null);
  });

  it('collects order sheet products in manual mode without calling SYCM rank', async () => {
    const { collectOrderSheetProducts } = require('../index');
    const { getRun, readJsonl } = require('../../pipeline-flow/src/run-store');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'order-sheet-manual-run-'));
    const runId = 'test_manual_run';

    const result = await collectOrderSheetProducts({
      dataDir: tempDir,
      runId,
      inputMode: 'manual',
      manualItemsText: '748392010293\nhttps://detail.tmall.com/item.htm?id=987654321',
      manualItems: [
        { id: '748392010293', title: '手工商品一', orderAmount: 88 }
      ],
      autoEnrichManualItems: false
    });

    assert.equal(result.count, 2);
    assert.equal(result.rankCount, 0);
    assert.equal(result.manualCount, 2);

    const runData = getRun({ dataDir: tempDir, runId });
    assert.equal(runData.run.counts.productRank, 2);
    assert.equal(runData.run.counts.rankCount, 0);
    assert.equal(runData.run.counts.manualCount, 2);
    assert.equal(runData.run.productRank.inputMode, 'manual');
    assert.equal(runData.run.productRank.manualCount, 2);

    const rows = readJsonl(runData.run.files.productRank);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].itemId, '748392010293');
    assert.equal(rows[0].title, '手工商品一');
    assert.equal(rows[0].orderAmount, 88);
    assert.equal(rows[0].sourceType, 'manual');
    assert.equal(rows[0].visitorCount, null);

    assert.equal(rows[1].itemId, '987654321');
    assert.equal(rows[1].title, '');
    assert.equal(rows[1].sourceType, 'manual');
  });

  it('requires at least one manual item in manual inputMode', async () => {
    const { collectOrderSheetProducts } = require('../index');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'order-sheet-empty-manual-'));
    const runId = 'test_empty_manual';

    await assert.rejects(
      collectOrderSheetProducts({
        dataDir: tempDir,
        runId,
        inputMode: 'manual',
        manualItemsText: ''
      }),
      /指定商品模式下必须包含至少 1 个淘宝或天猫商品 ID\/链接/
    );
  });

  it('saves missing manual product titles before sheet generation resumes', async () => {
    const { collectOrderSheetProducts, updateOrderSheetManualProducts } = require('../index');
    const { getRun, readJsonl } = require('../../pipeline-flow/src/run-store');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'order-sheet-manual-update-'));
    const runId = 'test_manual_update';

    const collected = await collectOrderSheetProducts({
      dataDir: tempDir,
      runId,
      inputMode: 'manual',
      manualItemsText: '778899',
      autoEnrichManualItems: false
    });
    assert.equal(collected.status, 'manual_action_required');
    assert.equal(collected.missingCount, 1);

    const updated = updateOrderSheetManualProducts({
      dataDir: tempDir,
      runId,
      items: [{ itemId: '778899', title: '用户补充标题', orderAmount: 26.5, storeName: '补充店铺' }]
    });
    assert.equal(updated.missingCount, 0);
    assert.equal(getRun({ dataDir: tempDir, runId }).run.status, 'product_rank_collected');
    const [row] = readJsonl(getRun({ dataDir: tempDir, runId }).run.files.productRank);
    assert.equal(row.title, '用户补充标题');
    assert.equal(row.orderAmount, 26.5);
    assert.equal(row.paymentAmount, null);

    updateOrderSheetManualProducts({
      dataDir: tempDir,
      runId,
      items: [{ itemId: '778899', title: '用户补充标题', orderAmount: null, storeName: '' }]
    });
    const [clearedRow] = readJsonl(getRun({ dataDir: tempDir, runId }).run.files.productRank);
    assert.equal(clearedRow.orderAmount, null);
    assert.equal(clearedRow.storeName, '');
  });
});
