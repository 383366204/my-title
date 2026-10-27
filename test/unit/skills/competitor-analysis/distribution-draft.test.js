const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initRun, getRun } = require('../../../../skills/pipeline-flow/src/run-store');
const { prepareCompetitorDistribution } = require('../../../../skills/competitor-analysis/src/distribution-draft');

function fixture(t, overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'distribution-draft-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const options = { dataDir, runId: '2026-10-28-120000' };
  const context = initRun(options);
  fs.writeFileSync(path.join(context.runDir, 'competitor-sourcing.json'), JSON.stringify({
    reviewConfirmed: true,
    decisions: [{ itemId: '1', action: 'select', offerId: '123' }, { itemId: '2', action: 'skip' }],
    results: [{ itemId: '1', results: [{ offerId: '123', title: '商品标题' }] }],
    ...overrides
  }));
  return options;
}

test('confirmed sources become reusable drafts without inventing categories or changing parent', t => {
  const options = fixture(t);
  const before = getRun(options).run;
  const draft = prepareCompetitorDistribution(options);
  assert.equal(draft.rows.length, 1);
  assert.equal(draft.rows[0].url, 'https://detail.1688.com/offer/123.html');
  assert.equal(draft.rows[0].category, undefined);
  assert.equal(draft.rows[0].titleSource, '1688-original');
  assert.deepEqual(getRun(options).run, before);
  const child = getRun({ ...options, runId: draft.runId });
  fs.writeFileSync(child.run.files.generatedProducts, JSON.stringify({ ...draft.rows[0], title: '已编辑标题' }) + '\n');
  assert.equal(prepareCompetitorDistribution(options).rows[0].title, '已编辑标题');
});

test('unconfirmed and empty selections cannot create a distribution draft', t => {
  assert.throws(() => prepareCompetitorDistribution(fixture(t, { reviewConfirmed: false })), /先确认/);
  assert.throws(() => prepareCompetitorDistribution(fixture(t, { decisions: [] })), /没有选中/);
});

test('invalid or rejected candidates cannot be distributed', t => {
  assert.throws(() => prepareCompetitorDistribution(fixture(t, { results: [] })), /无效/);
  assert.throws(() => prepareCompetitorDistribution(fixture(t, { results: [{ itemId: '1', results: [{ offerId: '123', title: '商品', verdict: { level: 'rejected' } }] }] })), /无效/);
});
