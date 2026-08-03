'use strict';

const fs = require('fs');
const path = require('path');
const { checkBannedWords } = require('../../../core/banned-words');
const { ensureDir } = require('./run-store');
const { parseOfferId, productCategory } = require('./product-normalizer');

const DEFAULT_MIN_TITLE_LENGTH = 30;
const DEFAULT_HOT_EXPORT_LIMIT = 2;
const GENERIC_CATEGORY_TOKENS = new Set([
  '女', '男', '儿童', '宝宝', '新款', '爆款', '礼物', '用品', '商品',
  '饰品', '配饰', '玩具', '家居', '日用', '百货', '其他', '通用'
]);

function chineseTokens(value) {
  return String(value || '')
    .split(/[>\s,，/／、|｜;；:：\-—_]+/)
    .flatMap(part => {
      const text = part.trim();
      if (!text) return [];
      const matches = text.match(/[\u4e00-\u9fa5]{2,}/g) || [];
      return matches.flatMap(token => {
        const chunks = [token];
        for (let i = 0; i < token.length - 1; i += 1) chunks.push(token.slice(i, i + 2));
        return chunks;
      });
    })
    .map(token => token.trim())
    .filter(token => token.length >= 2 && !GENERIC_CATEGORY_TOKENS.has(token));
}

function hasTokenOverlap(a, b) {
  const left = new Set(chineseTokens(a));
  if (left.size === 0) return false;
  return chineseTokens(b).some(token => left.has(token));
}

/**
 * Compare a SYCM category with the category reported by a product.
 * @param {object} row Generated product row.
 * @returns {object} Category confidence and reason.
 */
function categoryAssessment(row) {
  const recommendedCategory = String(row.recommendedCategory || '').trim();
  const directCategory = productCategory(row.product, { recommendedCategory: '' });
  if (recommendedCategory && directCategory) {
    const matched = hasTokenOverlap(recommendedCategory, directCategory);
    return {
      confidence: matched ? 'high' : 'low',
      recommendedCategory,
      productCategory: directCategory,
      reason: matched ? '生意参谋类目与商品类目有交集' : '生意参谋类目与商品类目疑似冲突'
    };
  }
  if (recommendedCategory) {
    return {
      confidence: 'medium',
      recommendedCategory,
      productCategory: '',
      reason: '仅有生意参谋推荐类目，商品类目缺失'
    };
  }
  if (directCategory) {
    return {
      confidence: 'medium',
      recommendedCategory: '',
      productCategory: directCategory,
      reason: '仅有商品类目，生意参谋推荐类目缺失'
    };
  }
  return {
    confidence: 'unknown',
    recommendedCategory: '',
    productCategory: '',
    reason: '未获得类目数据'
  };
}

/**
 * Validate a generated row before it enters a distribution batch.
 * @param {object} row Generated product row.
 * @param {object} [context] Validation context and duplicate sets.
 * @returns {object} Validation result.
 */
function validateGeneratedRow(row, context = {}) {
  const reasons = [];
  const title = String(row.title || '').trim();
  const url = String(row.url || '').trim();
  const minTitleLength = Number(context.minTitleLength || DEFAULT_MIN_TITLE_LENGTH);
  const category = categoryAssessment(row);

  if (!url) reasons.push('missing_url');
  if (url && !parseOfferId(url)) reasons.push('invalid_1688_url');
  if (!title) reasons.push('missing_title');
  if (title && title.length < minTitleLength) reasons.push(`title_too_short:${title.length}<${minTitleLength}`);
  if (row.keyword && title && !title.includes(row.keyword)) reasons.push('title_missing_keyword');

  const banned = checkBannedWords(title);
  if (!banned.valid) reasons.push(`banned_words:${banned.words.join(',')}`);
  if (category.confidence === 'low') reasons.push('category_conflict');
  if (category.confidence === 'unknown') reasons.push('missing_category');
  if (context.seenUrls && context.seenUrls.has(url)) reasons.push('duplicate_url');
  if (context.seenTitles && context.seenTitles.has(title)) reasons.push('duplicate_title');
  if (row.verifyMode === 'hot' && Number(context.hotUsed || 0) >= Number(context.hotExportLimit || DEFAULT_HOT_EXPORT_LIMIT)) {
    reasons.push('hot_export_limit');
  }
  if (row.keywordOpportunity && row.keywordOpportunity.decision && row.keywordOpportunity.decision !== 'continue') {
    reasons.push(`legacy_keyword_opportunity_${row.keywordOpportunity.decision}`);
  }
  const humanSelected = context.manualMode === true || row.manualSelectionStatus === 'approved';
  if (!humanSelected && row.productOpportunity && row.productOpportunity.decision && row.productOpportunity.decision !== 'continue') {
    reasons.push(`product_opportunity_${row.productOpportunity.level || row.productOpportunity.decision}`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    categoryConfidence: category.confidence,
    categoryReason: category.reason,
    recommendedCategory: category.recommendedCategory,
    productCategory: category.productCategory
  };
}

function isReviewableExportReason(reason) {
  const value = String(reason || '');
  return /^product_opportunity_manual_review/.test(value)
    || /^keyword_opportunity_(observe|review)/.test(value)
    || /^legacy_keyword_opportunity_(observe|review)/.test(value);
}

/**
 * Classify a validation result for automatic or manual distribution review.
 * @param {object} validation Validation result.
 * @returns {string} Export status.
 */
function classifyExportStatus(validation) {
  const reasons = validation && Array.isArray(validation.reasons) ? validation.reasons : [];
  if (validation && validation.ok) return 'ready';
  if (reasons.length > 0 && reasons.every(isReviewableExportReason)) return 'review_candidate';
  return 'rejected_before_distribution';
}

/**
 * Format a product as URL, title, and optional category for distribution.
 * @param {object} row Generated product row.
 * @returns {string} Distribution line.
 */
function distributionLine(row) {
  const category = productCategory(row.product, row);
  return category ? `${row.url}$$${row.title}$$${category}` : `${row.url}$$${row.title}`;
}

function reviewLabel(row) {
  const usage = row.usage || (row.sycmScore && row.sycmScore.usage) || '';
  if (usage === 'title_core') return '严格蓝海，可作为标题核心词';
  if (usage === 'title_optional') return '放宽蓝海，可作为标题辅助词';
  if (usage === 'trend_reference') return '热搜趋势，仅作趋势参考，建议小量测试或人工复核';
  return '未标记';
}

/**
 * Write the human-readable distribution review report.
 * @param {string} file Output Markdown file.
 * @param {object[]} rows Reviewed product rows.
 * @returns {void}
 */
function writeDistributionReview(file, rows) {
  const readyRows = rows.filter(row => row.exportStatus === 'ready');
  const reviewRows = rows.filter(row => row.exportStatus === 'review_candidate');
  const rejectedRows = rows.filter(row => row.exportStatus === 'rejected_before_distribution');
  const lines = [
    '# Distribution Review',
    '',
    '人工铺货前请先检查本报告。Recommended Submit 会写入 distribution-batch.txt；Manual Review Candidates 不会自动铺货，需要人工决定是否补进批次。',
    '',
    '## Summary',
    '',
    `- Recommended Submit: ${readyRows.length}`,
    `- Review Candidates: ${reviewRows.length}`,
    `- Hard Rejected: ${rejectedRows.length}`,
    ''
  ];
  const appendRow = (row, index) => {
    lines.push(`### ${index + 1}. ${row.keyword}`);
    lines.push('');
    lines.push(`- Export Status: ${row.exportStatus || 'ready'}`);
    if (row.exportReasons && row.exportReasons.length) lines.push(`- Review Reasons: ${row.exportReasons.join(', ')}`);
    lines.push(`- URL: ${row.url}`);
    lines.push(`- Title: ${row.title}`);
    lines.push(`- Category: ${productCategory(row.product, row) || '-'}`);
    lines.push(`- Category Confidence: ${row.categoryConfidence || '-'}`);
    if (row.categoryReason) lines.push(`- Category Reason: ${row.categoryReason}`);
    lines.push(`- Verify Mode: ${row.verifyMode || (row.sycmScore && row.sycmScore.mode) || '-'}`);
    lines.push(`- Confidence: ${row.confidence || (row.sycmScore && row.sycmScore.confidence) || '-'}`);
    lines.push(`- Usage: ${row.usage || (row.sycmScore && row.sycmScore.usage) || '-'}`);
    if (row.keywordOpportunity) {
      lines.push(`- Keyword Opportunity: ${row.keywordOpportunity.score} / ${row.keywordOpportunity.decision} / ${row.keywordOpportunity.nextAction}`);
    }
    if (row.productOpportunity) {
      lines.push(`- Product Opportunity: ${row.productOpportunity.score} / ${row.productOpportunity.level} / ${row.productOpportunity.nextAction}`);
      if (row.productOpportunity.riskFlags && row.productOpportunity.riskFlags.length) {
        lines.push(`- Product Risk Flags: ${row.productOpportunity.riskFlags.join(', ')}`);
      }
    }
    lines.push(`- Decision: ${reviewLabel(row)}`);
    if ((row.usage || (row.sycmScore && row.sycmScore.usage)) === 'trend_reference') {
      lines.push('- Risk: 该词不是严格蓝海词，只能证明有热搜趋势，铺货前必须人工确认。');
    }
    lines.push(`- Fallback: ${row.fallbackUsed ? 'yes' : 'no'}${row.fallbackReason ? ` (${row.fallbackReason})` : ''}`);
    lines.push(`- SYCM Reason: ${row.sycmScore && row.sycmScore.reason ? row.sycmScore.reason : '-'}`);
    lines.push('');
  };
  lines.push('## Recommended Submit');
  lines.push('');
  if (readyRows.length === 0) lines.push('No rows.');
  readyRows.forEach(appendRow);
  lines.push('## Manual Review Candidates');
  lines.push('');
  if (reviewRows.length === 0) lines.push('No rows.');
  reviewRows.forEach(appendRow);
  lines.push('## Hard Rejected');
  lines.push('');
  if (rejectedRows.length === 0) lines.push('No rows.');
  rejectedRows.forEach(appendRow);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
}

module.exports = {
  DEFAULT_HOT_EXPORT_LIMIT,
  DEFAULT_MIN_TITLE_LENGTH,
  categoryAssessment,
  classifyExportStatus,
  distributionLine,
  validateGeneratedRow,
  writeDistributionReview
};
