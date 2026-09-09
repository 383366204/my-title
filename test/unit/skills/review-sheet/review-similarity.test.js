'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assessReviewQuality,
  normalizeReviewText,
  reviewFingerprint,
  scoreReviewSimilarity
} = require('../../../../skills/review-sheet/src/review-similarity');

test('normalizes punctuation and full-width forms before exact comparison', () => {
  assert.equal(normalizeReviewText(' 包装完整，大小合适！ '), '包装完整大小合适');
  assert.equal(scoreReviewSimilarity('包装完整，大小合适！', '包装完整 大小合适'), 1);
  assert.equal(reviewFingerprint('包装完整，大小合适！'), reviewFingerprint('包装完整 大小合适'));
});

test('protects unrelated short reviews from fuzzy false positives', () => {
  assert.equal(scoreReviewSimilarity('大小合适', '手感合适'), 0);
  assert.equal(scoreReviewSimilarity('大小合适', '大小合适'), 1);
});

test('treats a short passage contained in a much longer review as a warning, not a block', () => {
  const short = '包装完整，实际使用起来很顺手，大小也很合适。';
  const long = `${short}另外我实际比较了放置位置，记录了清洁方式和连续使用后的变化，整体描述只保留亲自确认过的细节。`;
  const result = assessReviewQuality([
    { id: 'short', reviewContent: short },
    { id: 'long', reviewContent: long }
  ]);
  assert.equal(result.rows[1].quality.level, 'warning');
  assert.equal(result.rows[1].quality.scope, 'batch');
});

test('blocks high similarity inside a batch and only warns on history matches', () => {
  const batch = assessReviewQuality([
    { id: 'a', reviewContent: '包装完整，实际使用起来很顺手，大小也很合适。' },
    { id: 'b', reviewContent: '包装完整，实际使用起来很顺手，大小很合适。' }
  ]);
  assert.equal(batch.rows[0].quality.level, 'none');
  assert.equal(batch.rows[1].quality.level, 'blocked');
  assert.equal(batch.rows[1].quality.scope, 'batch');
  assert.equal(batch.summary.blocked, 1);

  const history = assessReviewQuality([
    { id: 'c', reviewContent: '包装完整，实际使用起来很顺手，大小也很合适。' }
  ], {
    runId: 'new-run',
    history: [{ runId: 'old-run', draftId: 'old', reviewContent: '包装完整实际使用起来很顺手大小也很合适' }]
  });
  assert.equal(history.rows[0].quality.level, 'warning');
  assert.equal(history.rows[0].quality.scope, 'history');
  assert.equal(history.summary.historyWarnings, 1);
});

test('marks empty content as a blocking completeness issue', () => {
  const result = assessReviewQuality([{ id: 'empty', reviewContent: '' }]);
  assert.equal(result.summary.missing, 1);
  assert.equal(result.rows[0].quality.level, 'blocked');
  assert.match(result.rows[0].quality.reason, /为空/);
});
