const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeMiningDiagnostics, emptyMiningReason } = require('../../../../skills/keyword-mining/src/mining-diagnostics');

test('diagnostics distinguish raw rows, unique words, and filtering from real empty data', () => {
  const diagnostics = summarizeMiningDiagnostics({
    stats: { rootQueries: { rows: [{ candidateCount: 3 }] } },
    candidates: [],
    screeningRows: [
      { keyword: '便携充电宝', screeningReason: 'local_below_threshold' },
      { keyword: '便携充电宝', screeningReason: 'local_below_threshold' },
      { keyword: '维修教程', screeningReason: 'local_rejected' }
    ]
  });
  assert.equal(diagnostics.rawRows, 3);
  assert.equal(diagnostics.uniqueKeywords, 2);
  assert.equal(diagnostics.reasons.local_below_threshold, 2);
  assert.match(emptyMiningReason(diagnostics), /已返回 3 行数据/);
  assert.doesNotMatch(emptyMiningReason(diagnostics), /没有返回关联词/);
  assert.match(emptyMiningReason(summarizeMiningDiagnostics({})), /没有返回关联词/);
});
