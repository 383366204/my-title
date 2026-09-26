'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const evidence = (queryWord, category) => ({ source: 'sycm', queryWord, recommended: category, candidates: [{ category, clickRatio: 80, clickRate: 30 }] });
const {
  normalizeManualOfferDetail,
  productCategory,
  productTitle,
  productUrl
} = require('../../../../skills/pipeline-flow/src/product-normalizer');
const {
  categoryAssessment,
  classifyExportStatus,
  distributionLine,
  validateGeneratedRow
} = require('../../../../skills/pipeline-flow/src/export-validator');

test('normalizes nested 1688 detail payloads and common product fields', () => {
  const detail = normalizeManualOfferDetail({
    model: {
      bizData: JSON.stringify({
        result: {
          subject: '桌面抽屉收纳盒',
          categoryName: '家居用品 > 收纳整理 > 收纳盒',
          mainPic: 'https://img.example.com/box.webp',
          offerPrice: '12.80'
        }
      })
    }
  }, { offerId: '123' });

  assert.equal(detail.offerId, '123');
  assert.equal(detail.title, '桌面抽屉收纳盒');
  assert.equal(detail.category, '家居用品 > 收纳整理 > 收纳盒');
  assert.equal(detail.imageUrl, 'https://img.example.com/box.webp');
  assert.equal(detail.price, '12.80');
  assert.equal(productUrl({ offerId: '123' }), 'https://detail.1688.com/offer/123.html');
  assert.equal(productTitle({ generatedTitle: '生成标题' }), '生成标题');
  assert.equal(productCategory({ stats: { categoryName: '收纳盒' } }), '收纳盒');
});

test('normalizes offer_detail all_info markdown keyed by offer id', () => {
  const detail = normalizeManualOfferDetail({
    success: true,
    model: {
      bizData: {
        993531162503: {
          all_info: '# 商品ID\n993531162503\n\n# 商品标题\n双层叠戴十字架海星项链女\n\n# 商品价格\n1.48元\n\n# 商品类目\n|类目级别|类目名称|\n|--|--|\n|一级类目|服饰配件、饰品|\n|二级类目|项饰|\n|三级类目|项链|'
        }
      }
    }
  }, { offerId: '993531162503' });

  assert.equal(detail.title, '双层叠戴十字架海星项链女');
  assert.equal(detail.category, '项链');
  assert.equal(detail.price, '1.48元');
});

test('uses SYCM evidence regardless of cross-platform category names', () => {
  const matched = categoryAssessment({
    keyword: '收纳盒', sycmCategoryEvidence: evidence('收纳盒', '家居用品 > 收纳整理'),
    recommendedCategory: '家居用品 > 收纳整理',
    product: { categoryName: '收纳整理 > 收纳盒' }
  });
  const conflict = categoryAssessment({
    keyword: '连衣裙', sycmCategoryEvidence: evidence('连衣裙', '女装 > 连衣裙'),
    recommendedCategory: '女装 > 连衣裙',
    product: { categoryName: '数码产品 > 手机配件' }
  });

  assert.equal(matched.confidence, 'high');
  assert.equal(conflict.confidence, 'high');
  assert.equal(conflict.recommendedCategory, '女装 > 连衣裙');
});

test('hot-source products are not blocked by legacy export quotas', () => {
  const title = '桌面收纳盒抽屉式办公室学生文具透明塑料杂物整理储物盒大容量家用';
  const validation = validateGeneratedRow({
    sycmCategoryEvidence: evidence('桌面收纳盒', '家居用品 > 收纳整理'),
    keyword: '桌面收纳盒',
    url: 'https://detail.1688.com/offer/123.html',
    title,
    verifyMode: 'hot',
    recommendedCategory: '家居用品 > 收纳整理',
    product: { categoryName: '收纳整理 > 收纳盒' }
  }, { hotUsed: 2, hotExportLimit: 2 });

  assert.equal(validation.ok, true);
  assert.deepEqual(validation.reasons, []);
  assert.equal(classifyExportStatus(validation), 'ready');
  assert.equal(classifyExportStatus({ ok: false, reasons: ['product_opportunity_manual_review'] }), 'review_candidate');
  assert.equal(
    distributionLine({
      keyword: '桌面收纳盒', sycmCategoryEvidence: evidence('桌面收纳盒', '家居用品 > 收纳整理'),
      url: 'https://detail.1688.com/offer/123.html',
      title,
      recommendedCategory: '家居用品 > 收纳整理'
    }),
    `https://detail.1688.com/offer/123.html$$${title}$$家居用品 > 收纳整理`
  );
});

test('exports more than two hot-source products while preserving overall limits and validation', async t => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { initRun, appendJsonl } = require('../../../../skills/pipeline-flow/src/run-store');
  const { flowExport } = require('../../../../skills/pipeline-flow/src/export-flow');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hot-export-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const { run } = initRun({ dataDir, runId: 'hot-export' });
  const rows = Array.from({ length: 5 }, (_, index) => ({
    status: 'generated', keyword: '桌面收纳盒', verifyMode: 'hot',
    sycmCategoryEvidence: evidence('桌面收纳盒', '家居用品 > 收纳整理'),
    url: `https://detail.1688.com/offer/${100 + index}.html`,
    title: `桌面收纳盒抽屉式办公室学生文具透明塑料杂物整理储物盒大容量${index}`,
    product: { categoryName: '收纳整理 > 收纳盒' }
  }));
  appendJsonl(run.files.generatedProducts, [...rows, { ...rows[0], url: 'https://detail.1688.com/offer/999.html', title: '短标题' }]);
  const options = { dataDir, runId: run.runId, hotExportLimit: 2 };
  const all = await flowExport(options);
  assert.equal(all.count, 5);
  assert.equal(all.rejected, 1);
  assert.equal(fs.readFileSync(all.file, 'utf8').trim().split('\n').length, 5);
  assert.ok(!fs.readFileSync(all.reviewFile, 'utf8').includes('hot_export_limit'));
  const limited = await flowExport({ ...options, limit: 3 });
  assert.equal(limited.count, 3);
  assert.equal(limited.rejected, 1);
});
