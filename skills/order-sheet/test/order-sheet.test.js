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
const {
  averagePayment,
  fetchImage,
  generateOrderSheet,
  imageUrlCandidates,
  normalizeImageUrl,
  sniffImageFormat
} = require('../src/generate-order-sheet');

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
    assert.equal(typeof orderSheet.getCell('A2').value, 'string', '标题列应为纯文本');
    assert.ok(!orderSheet.getCell('A2').hyperlink, '标题列不应再带超链接');
    assert.equal(orderSheet.getCell('C2').value, 18.8);
    assert.equal(orderSheet.getCell('F2').value, '商品所属店铺');
    assert.equal(orderSheet.getCell('G2').value, '');
    assert.equal(orderSheet.getCell('A2').isMerged, false);
    assert.equal(orderSheet.getCell('E2').font.color.argb, 'FFFF0000');
    assert.equal(orderSheet.getCell('A5').text, '测试商品二');
    assert.equal(rawSheet.getCell('K2').value, 20);
    assert.equal(rawSheet.getCell('P3').value, '商品访客数降序');
  });

  it('embeds the product main image even when a SKU image is selected', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'order-sheet-main-image-'));
    const outputFile = path.join(tempDir, 'main-image.xlsx');
    const requested = [];
    const rows = [
      {
        rank: 1,
        itemId: '2001',
        title: '主图商品',
        productUrl: 'https://item.taobao.com/item.htm?id=2001',
        imageUrl: 'https://img.alicdn.com/main.jpg',
        selectedSkuImageUrl: 'https://img.alicdn.com/sku-red.jpg',
        selectedSkuName: '颜色：酒红',
        orderAmount: 25,
        visitorCount: 30
      }
    ];

    const result = await generateOrderSheet({
      rows,
      meta: { storeName: '测试店铺', statDate: '2026-08-10', orderDate: '2026-08-12', period: '日' },
      outputFile,
      imageLoader: async (imageUrl) => {
        requested.push(imageUrl);
        return null;
      }
    });

    assert.deepEqual(requested, ['https://img.alicdn.com/main.jpg']);
    assert.equal(result.imageCount, 0);
  });

  it('writes selected SKU and defaults amount to the lowest SKU price', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'order-sheet-sku-'));
    const outputFile = path.join(tempDir, 'result.xlsx');
    await generateOrderSheet({
      rows: [{
        itemId: 'sku-item',
        title: '多规格商品',
        productUrl: 'https://item.taobao.com/item.htm?id=1001',
        selectedSkuName: '颜色：蓝色 / 尺码：M',
        selectedSkuPrice: 19.9,
        lowestSkuPrice: 19.9,
        orderAmount: null
      }],
      outputFile,
      includeImages: false,
      includeRawData: false,
      orderNote: '浏览后下单'
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(outputFile);
    const sheet = workbook.getWorksheet('动销一拖多');
    assert.equal(sheet.getCell('C2').value, '19.9（颜色：蓝色 / 尺码：M）');
    assert.equal(sheet.getCell('G2').value, '浏览后下单');
  });

  it('renders confirmed groups in user order while keeping raw rank rows unchanged', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grouped-order-sheet-'));
    const outputFile = path.join(tempDir, 'result.xlsx');
    const rows = [
      { rank: 1, itemId: '2001', title: '原始排行一', productUrl: 'https://item.taobao.com/item.htm?id=2001', visitorCount: 80, orderAmount: 20 },
      { rank: 2, itemId: '2002', title: '原始排行二', productUrl: 'https://item.taobao.com/item.htm?id=2002', visitorCount: 60, orderAmount: 30 },
      { rank: 3, itemId: '2003', title: '原始排行三', productUrl: 'https://item.taobao.com/item.htm?id=2003', visitorCount: 40, orderAmount: 40 }
    ];
    const groups = [
      {
        id: 'group-1',
        workRequirement: '先浏览主商品再加购搭配商品',
        mainProduct: { ...rows[1], title: '确认后的主商品' },
        subProducts: [{ ...rows[0], title: '确认后的搭配商品' }]
      },
      {
        id: 'group-2',
        mainProduct: { ...rows[2], title: '下一组商品' },
        subProducts: []
      }
    ];

    await generateOrderSheet({ rows, groups, outputFile, rowSpan: 3, dragCount: 2, includeImages: false });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(outputFile);
    const orderSheet = workbook.getWorksheet('动销一拖多');
    const rawSheet = workbook.getWorksheet('商品排行原始数据');
    assert.equal(orderSheet.getCell('A2').text, '确认后的主商品');
    assert.equal(orderSheet.getCell('A3').text, '确认后的搭配商品');
    assert.ok(!orderSheet.getCell('A2').hyperlink, '编组渲染下标题同样不应带超链接');
    assert.ok(!orderSheet.getCell('A3').hyperlink, '编组渲染下标题同样不应带超链接');
    assert.equal(orderSheet.getCell('E2').value, '先浏览主商品再加购搭配商品');
    assert.equal(orderSheet.getCell('G2').value, '');
    assert.equal(orderSheet.getCell('A4').value, null);
    assert.equal(orderSheet.getCell('A5').value, null);
    assert.equal(orderSheet.getCell('A6').text, '下一组商品');
    assert.equal(orderSheet.getRow(2).height, 72);
    assert.equal(orderSheet.getRow(3).height, 72);
    assert.equal(orderSheet.getRow(4).height, 15);
    assert.equal(orderSheet.getRow(5).height, 15);
    assert.equal(rawSheet.getCell('D2').value, '原始排行一');
    assert.equal(rawSheet.getCell('D3').value, '原始排行二');
    assert.equal(rawSheet.getCell('D4').value, '原始排行三');
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

  it('sniffs the real image format from bytes instead of trusting the URL suffix', () => {
    assert.equal(sniffImageFormat(Buffer.from('ffd8ffe000104a464946', 'hex')), 'jpeg');
    assert.equal(sniffImageFormat(Buffer.from('89504e470d0a1a0a0000000d', 'hex')), 'png');
    assert.equal(sniffImageFormat(Buffer.from('474946383961000000000000', 'hex')), 'gif');
    assert.equal(sniffImageFormat(Buffer.from('52494646523f300057454250', 'hex')), 'webp');
    assert.equal(sniffImageFormat(Buffer.from('<html>error</html>', 'utf8')), '');
    assert.equal(sniffImageFormat(Buffer.alloc(4)), '');
  });

  it('normalizes alicdn webp transform suffixes back to embeddable sources', () => {
    assert.equal(
      normalizeImageUrl('https://img.alicdn.com/i2/394/O1CN01abc_!!394.jpg_.webp'),
      'https://img.alicdn.com/i2/394/O1CN01abc_!!394.jpg'
    );
    assert.equal(
      normalizeImageUrl('https://img.alicdn.com/i2/394/O1CN01abc_!!394.jpg_400x400q90.jpg_.webp'),
      'https://img.alicdn.com/i2/394/O1CN01abc_!!394.jpg_400x400q90.jpg'
    );
    assert.equal(normalizeImageUrl('https://cdn.example.com/a.webp'), 'https://cdn.example.com/a.jpg');
    assert.equal(normalizeImageUrl('https://cdn.example.com/a.jpg'), 'https://cdn.example.com/a.jpg');
    assert.equal(normalizeImageUrl(''), '');

    assert.deepEqual(
      imageUrlCandidates('https://img.alicdn.com/i2/394/O1CN01abc_!!394.jpg_.webp'),
      [
        'https://img.alicdn.com/i2/394/O1CN01abc_!!394.jpg_200x200q90.jpg',
        'https://img.alicdn.com/i2/394/O1CN01abc_!!394.jpg',
        'https://img.alicdn.com/i2/394/O1CN01abc_!!394.jpg_.webp'
      ]
    );
    // 非淘系 CDN 不追加缩放后缀，避免无谓的 404
    assert.deepEqual(imageUrlCandidates('https://cdn.example.com/p.webp'), [
      'https://cdn.example.com/p.jpg',
      'https://cdn.example.com/p.webp'
    ]);
  });

  it('never embeds a webp payload even when the CDN answers with one', async () => {
    const webp = Buffer.from('52494646523f30005745425056503820', 'hex');
    const jpeg = Buffer.from('ffd8ffe000104a46494600010100', 'hex');

    // 最坏情况：CDN 完全无视协商，任何地址都回 WebP —— 必须返回 null 走超链接降级
    const attempted = [];
    const alwaysWebp = async (url) => {
      attempted.push(url);
      return { data: webp, headers: { 'content-type': 'image/webp' } };
    };
    assert.equal(await fetchImage('https://img.alicdn.com/x/O1CN01.jpg_.webp', { request: alwaysWebp }), null);
    assert.equal(attempted.length, 3);

    // 真实 CDN 行为：缩放后缀给真 JPEG，首个候选即命中，不必再请求大图
    const hits = [];
    const realistic = async (url) => {
      hits.push(url);
      const isJpeg = url.endsWith('_200x200q90.jpg');
      return {
        data: isJpeg ? jpeg : webp,
        headers: { 'content-type': isJpeg ? 'image/jpeg' : 'image/webp' }
      };
    };
    const result = await fetchImage('https://img.alicdn.com/x/O1CN01.jpg_.webp', { request: realistic });
    assert.deepEqual(hits, ['https://img.alicdn.com/x/O1CN01.jpg_200x200q90.jpg']);
    assert.equal(result.extension, 'jpeg');
    assert.equal(Buffer.compare(result.buffer, jpeg), 0);
  });

  it('writes media files named after the format the loader reported', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'order-sheet-media-name-'));
    const outputFile = path.join(tempDir, 'media.xlsx');
    await generateOrderSheet({
      rows: [{ rank: 1, itemId: '3001', title: 'PNG 商品', imageUrl: 'https://img.alicdn.com/x.png', visitorCount: 5 }],
      meta: { storeName: '测试店铺', statDate: '2026-08-31', orderDate: '2026-08-31', period: '日' },
      outputFile,
      includeRawData: false,
      imageLoader: async () => ({ buffer: Buffer.from('89504e470d0a1a0a0000000d', 'hex'), extension: 'png' })
    });
    const packed = fs.readFileSync(outputFile).toString('latin1');
    assert.ok(packed.includes('xl/media/image1.png'), '媒体文件名应跟随真实格式，不能硬写 .jpeg');
    assert.equal(packed.includes('image1.jpeg'), false);
  });

  it('writes picture anchors that mobile renderers can actually draw', async () => {
    const JSZip = require('jszip');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'order-sheet-anchor-'));
    const outputFile = path.join(tempDir, 'anchor.xlsx');
    const jpeg = Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex');
    const rows = [
      { rank: 1, itemId: '4001', title: '锚点商品一', productUrl: 'https://item.taobao.com/item.htm?id=4001', imageUrl: 'https://img.alicdn.com/a.jpg', visitorCount: 30 },
      { rank: 2, itemId: '4002', title: '锚点商品二', productUrl: 'https://item.taobao.com/item.htm?id=4002', imageUrl: 'https://img.alicdn.com/b.jpg', visitorCount: 20 }
    ];

    const result = await generateOrderSheet({
      rows,
      meta: { storeName: '测试店铺', statDate: '2026-08-31', orderDate: '2026-08-31', period: '日' },
      outputFile,
      imageLoader: async () => ({ buffer: jpeg, extension: 'jpeg' })
    });
    assert.equal(result.imageCount, 2);

    const zip = await JSZip.loadAsync(fs.readFileSync(outputFile));
    const xml = await zip.file('xl/drawings/drawing1.xml').async('string');
    assert.equal((xml.match(/<xdr:twoCellAnchor/g) || []).length, 2, '应改用 twoCellAnchor 两角点锚定');
    assert.equal(xml.includes('<xdr:oneCellAnchor'), false);
    assert.equal(xml.includes('cstate='), false, '纯内嵌图片不应带 cstate 标记');

    const boxes = [...xml.matchAll(/<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/g)];
    assert.equal(boxes.length, 2, '每个锚点都应回填真实 xfrm');
    for (const [, offX, offY, cx, cy] of boxes) {
      assert.ok(Number(cx) > 0 && Number(cy) > 0, 'xfrm 尺寸不能为 0');
      assert.ok(Number(offY) > 0, 'xfrm 偏移需要换算成绝对 EMU');
    }
  });

  it('restores static product fields when the client sends a trimmed draft payload', async () => {
    const { collectOrderSheetProducts, prepareOrderSheetDraft, saveOrderSheetDraft, getOrderSheetDraft } = require('../index');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'order-sheet-trim-'));
    const runId = 'test_trimmed_draft';

    await collectOrderSheetProducts({
      dataDir: tempDir,
      runId,
      inputMode: 'manual',
      autoEnrichManualItems: false,
      manualItems: [
        {
          itemId: '7001',
          title: '商品甲',
          orderAmount: 30,
          storeName: '甲店',
          imageUrl: 'https://img.alicdn.com/a.jpg',
          skuOptions: [
            { skuId: 'a1', name: '规格一', price: 30, quantity: 5, available: true },
            { skuId: 'a2', name: '规格二', price: 31, quantity: 5, available: true }
          ]
        },
        {
          itemId: '7002',
          title: '商品乙',
          orderAmount: 40,
          storeName: '乙店',
          imageUrl: 'https://img.alicdn.com/b.jpg',
          skuOptions: [{ skuId: 'b1', name: '黑色', price: 40, quantity: 2, available: true }]
        }
      ]
    });

    const prepared = await prepareOrderSheetDraft({ dataDir: tempDir, runId, dragCount: 2 });
    assert.equal(prepared.groups[0].mainProduct.skuOptions.length, 2);

    // 模拟前端最小负载：只有身份字段和可编辑字段，没有 skuOptions / 主图 / 排行指标
    const trimmedGroups = prepared.groups.map(group => ({
      id: group.id,
      name: group.name,
      mainProduct: {
        itemId: group.mainProduct.itemId,
        role: 'main',
        title: '改过的甲标题',
        orderAmount: 66,
        selectedSkuId: 'a2',
        selectedSkuName: '规格二',
        selectedSkuPrice: 31,
        skuSelectionMode: 'manual'
      },
      subProducts: group.subProducts.map(item => ({ itemId: item.itemId, role: 'sub', title: item.title }))
    }));
    const trimmedSize = JSON.stringify(trimmedGroups).length;

    saveOrderSheetDraft({
      dataDir: tempDir,
      runId,
      expectedRevision: prepared.revision,
      dragCount: 2,
      groups: trimmedGroups,
      unassignedItems: []
    });

    const persisted = getOrderSheetDraft({ dataDir: tempDir, runId });
    const main = persisted.groups[0].mainProduct;
    // 客户端提交的可编辑字段生效
    assert.equal(main.title, '改过的甲标题');
    assert.equal(main.orderAmount, 66);
    assert.equal(main.selectedSkuId, 'a2');
    assert.equal(main.skuSelectionMode, 'manual');
    // 未提交的静态字段由服务端补齐，规格下拉框和主图都不会丢
    assert.equal(main.skuOptions.length, 2);
    assert.equal(main.imageUrl, 'https://img.alicdn.com/a.jpg');
    assert.equal(main.storeName, '甲店');
    assert.equal(main.productUrl, 'https://item.taobao.com/item.htm?id=7001');
    assert.ok(JSON.stringify(persisted.groups).length > trimmedSize, '落盘数据应比回传负载更完整');
  });
});
