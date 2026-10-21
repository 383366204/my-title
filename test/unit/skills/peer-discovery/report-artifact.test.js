'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { writePeerReport } = require('../../../../skills/peer-discovery/src/peer-report-writer');
const { readWorkflowNodeArtifact } = require('../../../../core/workflow/pipeline-artifacts');

test('report and completion expose latest shops and downloadable workbook', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-report-artifact-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const runDir = path.join(dataDir, 'runs', 'peer-test');
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'runtime.json'), JSON.stringify({ mode: 'peer-discovery', status: 'completed', startedAt: new Date().toISOString(), params: { discoveryBranch: 'peer-analysis' } }));
  const report = await writePeerReport({ runDir, candidateShops: [{}], evaluations: [
    { shopKey: 'shop1', shopName: '测试店铺', verdict: 'blocked', evaluatedAt: '2026-10-20T00:00:00Z' },
    { shopKey: 'shop1', shopName: '测试店铺', shopUrl: 'https://shop123.taobao.com/', verdict: 'inconclusive', reason: '需要登录', evaluatedAt: '2026-10-21T00:00:00Z' },
  ] });
  assert.equal(report.summary.evaluatedCount, 1);
  for (const nodeId of ['peerReport', 'end']) {
    const artifact = readWorkflowNodeArtifact('peer-test', nodeId, { dataDir });
    assert.equal(artifact.peerShopReport, true);
    assert.equal(artifact.count, 1);
    assert.equal(artifact.rows[0].reason, '需要登录');
    assert.ok(artifact.downloadUrl.endsWith(`/${nodeId}/raw`));
  }
});
