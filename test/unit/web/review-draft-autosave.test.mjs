import assert from 'node:assert/strict';
import test from 'node:test';

import { collectChangedReviews, snapshotDraftRows } from '../../../apps/web/src/features/workflow/review-draft-autosave.js';

const rows = [
  { id: 'a', title: '商品甲', reviewContent: '初稿一' },
  { id: 'b', title: '商品乙', reviewContent: '初稿二' }
];

test('snapshot builds the autosave baseline keyed by draft id', () => {
  const baseline = snapshotDraftRows(rows);
  assert.equal(baseline.get('a'), '初稿一');
  assert.equal(baseline.get('b'), '初稿二');
  assert.equal(baseline.has('missing'), false);
});

test('collects only rows whose review content changed', () => {
  const baseline = snapshotDraftRows(rows);
  const next = [
    { ...rows[0], reviewContent: '人工改过的一' },
    rows[1]
  ];
  const changed = collectChangedReviews(next, baseline);
  assert.deepEqual(changed, [{ id: 'a', reviewContent: '人工改过的一' }]);
});

test('keeps editing state dirty when content is cleared mid-edit', () => {
  const baseline = snapshotDraftRows(rows);
  const changed = collectChangedReviews([{ ...rows[0], reviewContent: '' }], baseline);
  assert.deepEqual(changed, [{ id: 'a', reviewContent: '' }]);
});

test('saving mid-edit content back into the baseline stops further diffs', () => {
  const baseline = snapshotDraftRows(rows);
  const edited = [{ ...rows[0], reviewContent: '边改边存的文案' }];
  const changed = collectChangedReviews(edited, baseline);
  for (const item of changed) baseline.set(item.id, item.reviewContent);
  assert.deepEqual(collectChangedReviews(edited, baseline), []);
});