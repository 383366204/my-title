import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  rowSelectedKeyword,
  distributionRowUrl,
  distributionRowCategory,
  buildDistributionText,
  labelExportValue,
  labelDistributionBlocker,
  labelExportStatus,
  labelExportReasons,
  labelOpportunitySummary,
  exportReviewRowToDistributionRow
} from '../apps/web/src/features/workflow/components/distribution/distribution-view-model.js';

describe('distribution-view-model', () => {
  describe('rowSelectedKeyword', () => {
    test('extracts selectedKeyword from various fallbacks', () => {
      assert.equal(rowSelectedKeyword({ selectedKeyword: '关键词1' }), '关键词1');
      assert.equal(rowSelectedKeyword({ keyword: '关键词2' }), '关键词2');
      assert.equal(rowSelectedKeyword({ blueOceanWord: '蓝海1' }), '蓝海1');
      assert.equal(rowSelectedKeyword({ product: { 蓝海词: '蓝海2' } }), '蓝海2');
      assert.equal(rowSelectedKeyword({ 蓝海词: '蓝海3' }), '蓝海3');
      assert.equal(rowSelectedKeyword({}), '');
    });
  });

  describe('distributionRowUrl', () => {
    test('extracts url with fallbacks', () => {
      assert.equal(distributionRowUrl({ url: 'https://1688.com/1' }), 'https://1688.com/1');
      assert.equal(distributionRowUrl({ raw: { url: 'https://1688.com/2' } }), 'https://1688.com/2');
      assert.equal(distributionRowUrl({ raw: { productUrl: 'https://1688.com/3' } }), 'https://1688.com/3');
      assert.equal(distributionRowUrl({ raw: { 产品链接: 'https://1688.com/4' } }), 'https://1688.com/4');
      assert.equal(distributionRowUrl({ raw: { product: { 产品链接: 'https://1688.com/5' } } }), 'https://1688.com/5');
      assert.equal(distributionRowUrl({ description: 'https://1688.com/6' }), 'https://1688.com/6');
      assert.equal(distributionRowUrl({ description: 'http://1688.com/7' }), 'http://1688.com/7');
      assert.equal(distributionRowUrl({ description: '缺少 1688 货源链接' }), '');
      assert.equal(distributionRowUrl({ description: '标题过短（5）' }), '');
      assert.equal(distributionRowUrl({ description: 'URL$$标题$$类目' }), '');
      assert.equal(distributionRowUrl({}), '');
    });
  });

  describe('distributionRowCategory', () => {
    test('extracts category with fallbacks', () => {
      assert.equal(distributionRowCategory({ category: '女装' }), '女装');
      assert.equal(distributionRowCategory({ raw: { category: '男装' } }), '男装');
      assert.equal(distributionRowCategory({ raw: { recommendedCategory: '鞋包' } }), '鞋包');
      assert.equal(distributionRowCategory({ raw: { productCategory: '童装' } }), '童装');
      assert.equal(distributionRowCategory({ raw: { product: { 类目: '美妆' } } }), '美妆');
      assert.equal(distributionRowCategory({}), '');
    });
  });

  describe('buildDistributionText', () => {
    test('builds text formatted with url$$title$$category', () => {
      const rows = [
        { url: 'https://1688.com/1', title: '商品标题1', category: '家居' },
        { url: 'https://1688.com/2', title: '商品标题2', category: '-' },
        { url: 'https://1688.com/3', title: '商品标题3' }
      ];
      const result = buildDistributionText(rows);
      assert.equal(result, 'https://1688.com/1$$商品标题1$$家居\nhttps://1688.com/2$$商品标题2$$\nhttps://1688.com/3$$商品标题3$$');
    });

    test('filters empty/invalid lines', () => {
      const rows = [{ title: '' }, { url: '', title: '', category: '' }];
      assert.equal(buildDistributionText(rows), '');
    });
  });

  describe('label mapping helpers', () => {
    test('labelExportValue maps known values or returns raw string', () => {
      assert.equal(labelExportValue('reject'), '未通过');
      assert.equal(labelExportValue('candidate'), '候选');
      assert.equal(labelExportValue('custom_val'), 'custom_val');
    });

    test('labelDistributionBlocker maps known blocker reasons', () => {
      assert.equal(labelDistributionBlocker('browser_cdp_unavailable'), 'Chrome 调试连接不可用');
      assert.equal(labelDistributionBlocker('unknown_blocker'), 'unknown_blocker');
    });

    test('labelExportStatus maps known status values', () => {
      assert.equal(labelExportStatus('ready'), '可直接导出');
      assert.equal(labelExportStatus('review_candidate'), '待人工复核');
      assert.equal(labelExportStatus(null), '待处理');
    });

    test('labelExportReasons handles comma-separated reasons and dynamic patterns', () => {
      assert.equal(labelExportReasons('missing_url, duplicate_title'), '缺少 1688 货源链接，标题重复');
      assert.equal(labelExportReasons('title_too_short:5, banned_words:违规词'), '标题过短（5），包含违禁词：违规词');
    });

    test('labelOpportunitySummary handles score/verdict/next step formats', () => {
      assert.equal(labelOpportunitySummary('85 / strong_recommend / continue'), '评分 85，判断 强推荐，下一步 继续');
      assert.equal(labelOpportunitySummary('manual_review'), '人工复核');
    });
  });

  describe('exportReviewRowToDistributionRow', () => {
    test('converts review row to distribution row format', () => {
      const reviewRow = {
        title: '测试商品',
        url: 'https://1688.com/test',
        group: 'rejected',
        status: 'rejected_before_distribution',
        reason: 'missing_category',
        category: '数码',
        confidence: 'high',
        usage: 'title_core',
        productOpportunity: '90 / strong_recommend / continue',
        selectedKeyword: '数码配件'
      };

      const result = exportReviewRowToDistributionRow(reviewRow, 0);
      assert.equal(result.key, 'blocked:https://1688.com/test:0');
      assert.equal(result.title, '测试商品');
      assert.equal(result.meta, '系统拦截 · 导出前拦截');
      assert.equal(result.fromReview, true);
      assert.ok(result.metrics.includes('选词：数码配件'));
      assert.ok(result.metrics.includes('类目 数码'));
      assert.ok(result.metrics.includes('置信度 高'));
      assert.equal(result.description, '缺少商品或推荐类目');
    });
  });
});
