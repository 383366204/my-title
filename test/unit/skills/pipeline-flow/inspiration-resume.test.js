const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { flowMine } = require('../../../../skills/pipeline-flow/src/keyword-mining-flow');
const { getRun } = require('../../../../skills/pipeline-flow/src/run-store');

test('partial mining resumes its saved roots and does not requery completed roots', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-resume-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const options = {
    dataDir, keywordDataDir: path.join(dataDir, 'keywords'), discoveryMode: 'inspiration',
    enabledDimensions: [], rootLimit: 2, inspirationUseLLM: false,
    newsFeedUrls: [], newsItems: [{ title: '高温防晒', inspirationWord: '高温' }], dictionaryWords: [],
    date: '2026-09-11'
  };
  const calls = [];
  const response = keyword => ({ data: [{ keyword: `${keyword}便携`, searchPopularity: 2000, demandSupplyRatio: 2 }] });
  const first = await flowMine({ ...options, sycmExtractor: async keyword => {
    calls.push(keyword);
    if (calls.length === 2) throw new Error('No Chrome tab found on port 9222');
    return response(keyword);
  } });
  assert.equal(first.ok, false, 'partial candidates cannot hide the failed query');
  assert.ok(first.candidates.length > 0);
  const retryCalls = [];
  const resumed = await flowMine({ ...options, runId: first.runId,
    newsItems: [{ title: '新新闻不能替换恢复中的词根', inspirationWord: '旅行' }],
    sycmExtractor: async keyword => { retryCalls.push(keyword); return response(keyword); }
  });
  assert.equal(resumed.ok, true);
  assert.deepEqual(retryCalls, [calls[1]]);
  assert.equal(getRun({ dataDir, runId: first.runId }).run.discovery.attempt, 1);
  assert.equal(resumed.stats.rootQueries.rows[0].reused, true);
});

test('pause before the query preserves the attempt for continuation', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-pause-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const result = await flowMine({ dataDir, keywordDataDir: path.join(dataDir, 'keywords'), discoveryMode: 'inspiration',
    newsFeedUrls: [], inspirationUseLLM: false, rootLimit: 1,
    shouldStop: () => 'pause', sycmExtractor: () => assert.fail('paused task must not query') });
  assert.equal(result.stepIncomplete, true);
  assert.equal(result.status, 'paused');
  assert.equal(getRun({ dataDir, runId: result.runId }).run.discovery.incomplete, true);
});

test('nonempty SYCM results filtered by mining retain diagnostics instead of claiming no data', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-diagnostics-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const result = await flowMine({ dataDir, keywordDataDir: path.join(dataDir, 'keywords'), discoveryMode: 'inspiration',
    enabledDimensions: [], rootLimit: 1, inspirationUseLLM: false,
    newsFeedUrls: [], newsItems: [{ title: '高温防晒', inspirationWord: '高温' }], dictionaryWords: [],
    sycmExtractor: async () => ({ data: [{ keyword: '便携收纳凳', searchPopularity: '0 ~ 10', demandSupplyRatio: 0 }] })
  });
  const { run } = getRun({ dataDir, runId: result.runId });
  assert.equal(result.ok, false);
  assert.match(run.discovery.blockerReason, /已返回 1 行数据/);
  assert.doesNotMatch(run.discovery.blockerReason, /没有查询到可用/);
  const diagnostics = JSON.parse(fs.readFileSync(run.discovery.files.miningDiagnostics, 'utf8'));
  assert.equal(diagnostics.summary.rawRows, 1);
  assert.equal(diagnostics.rows.length, 1);
  assert.equal(diagnostics.rows[0].sycmEvidence.raw.searchPopularity, '0 ~ 10');
  assert.equal(diagnostics.rows[0].sycmData.metrics.searchPopularity.upper, 10);
});
