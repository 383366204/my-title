'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeManualOfferDetail,
  productCategory,
  productTitle,
  productUrl
} = require('../src/product-normalizer');
const {
  categoryAssessment,
  classifyExportStatus,
  distributionLine,
  validateGeneratedRow
} = require('../src/export-validator');

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

test('assesses matching and conflicting product categories', () => {
  const matched = categoryAssessment({
    recommendedCategory: '家居用品 > 收纳整理',
    product: { categoryName: '收纳整理 > 收纳盒' }
  });
  const conflict = categoryAssessment({
    recommendedCategory: '女装 > 连衣裙',
    product: { categoryName: '数码产品 > 手机配件' }
  });

  assert.equal(matched.confidence, 'high');
  assert.equal(conflict.confidence, 'low');
  assert.equal(conflict.reason, '生意参谋类目与商品类目疑似冲突');
});

test('keeps hot-tier limits and manual-review export classification stable', () => {
  const title = '桌面收纳盒抽屉式办公室学生文具透明塑料杂物整理储物盒大容量';
  const validation = validateGeneratedRow({
    keyword: '桌面收纳盒',
    url: 'https://detail.1688.com/offer/123.html',
    title,
    verifyMode: 'hot',
    recommendedCategory: '家居用品 > 收纳整理',
    product: { categoryName: '收纳整理 > 收纳盒' }
  }, { hotUsed: 2, hotExportLimit: 2 });

  assert.equal(validation.ok, false);
  assert.ok(validation.reasons.includes('hot_export_limit'));
  assert.equal(classifyExportStatus({ ok: false, reasons: ['product_opportunity_manual_review'] }), 'review_candidate');
  assert.equal(
    distributionLine({
      url: 'https://detail.1688.com/offer/123.html',
      title,
      recommendedCategory: '家居用品 > 收纳整理'
    }),
    `https://detail.1688.com/offer/123.html$$${title}$$家居用品 > 收纳整理`
  );
});
