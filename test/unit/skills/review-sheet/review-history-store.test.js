'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const {
  historyFile,
  readReviewHistory,
  recordReviewHistory
} = require('../../../../skills/review-sheet/src/review-history-store');

test('records exported reviews idempotently and tolerates malformed history lines', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-history-'));
  const rows = [{ id: 'draft-1', reviewContent: '包装完整，尺寸也合适。' }];
  const first = recordReviewHistory({ dataDir, runId: 'run-1', rows });
  const second = recordReviewHistory({ dataDir, runId: 'run-1', rows });
  fs.appendFileSync(historyFile(dataDir), 'not-json\n', 'utf8');

  assert.equal(first.recorded, 1);
  assert.equal(second.recorded, 0);
  const history = readReviewHistory({ dataDir });
  assert.equal(history.length, 1);
  assert.equal(history[0].draftId, 'draft-1');
  assert.match(history[0].fingerprint, /^[a-f0-9]{64}$/);
});
