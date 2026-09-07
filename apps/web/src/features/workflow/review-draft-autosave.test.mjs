import assert from 'node:assert/strict';
import test from 'node:test';

import { collectChangedReviews, snapshotDraftRows } from './review-draft-autosave.js';

const rows = [
  { id: 'a', title: '商品甲', reviewContent: '初稿一', correspondingFile: '' },
  { id: 'b', title: '商品乙', reviewContent: '初稿二', correspondingFile: '旧文件.png' }
];

test('snapshot builds the autosave baseline keyed by draft id', () => {
  const baseline = snapshotDraftRows(rows);
  assert.deepEqual(baseline.get('a'), { reviewContent: '初稿一', correspondingFile: '' });
  assert.deepEqual(baseline.get('b'), { reviewContent: '初稿二', correspondingFile: '旧文件.png' });
  assert.equal(baseline.has('missing'), false);
});

test('collects only rows whose review content or file changed', () => {
  const baseline = snapshotDraftRows(rows);
  const next = [
    { ...rows[0], reviewContent: '人工改过的一' },
    rows[1]
  ];
  const changed = collectChangedReviews(next, baseline);
  assert.equal(changed.length, 1);
  assert.deepEqual(changed[0], { id: 'a', reviewContent: '人工改过的一', correspondingFile: '' });
});

test('keeps editing state dirty when content is cleared mid-edit', () => {
  const baseline = snapshotDraftRows(rows);
  const changed = collectChangedReviews([{ ...rows[0], reviewContent: '' }], baseline);
  assert.deepEqual(changed, [{ id: 'a', reviewContent: '', correspondingFile: '' }]);
});

test('saving mid-edit content back into the baseline stops further diffs', () => {
  const baseline = snapshotDraftRows(rows);
  const edited = [{ ...rows[0], reviewContent: '边改边存的文案' }];
  const changed = collectChangedReviews(edited, baseline);
  for (const item of changed) baseline.set(item.id, { reviewContent: item.reviewContent, correspondingFile: item.correspondingFile });
  assert.deepEqual(collectChangedReviews(edited, baseline), []);
});