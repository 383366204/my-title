const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initRun } = require('../../../skills/pipeline-flow/src/run-store');
const { initRuntimeState } = require('../../../skills/pipeline-flow/runtime/store');
const { readWorkflowNodeArtifact } = require('../../../core/workflow/pipeline-artifacts');

test('competitor artifacts use runtime steps rather than business summary fields', t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'competitor-artifact-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  for (const [runId, steps, expected] of [
    ['new-run', ['collectCompetitors', 'findCompetitorSources'], 'competitor-sourcing'],
    ['old-run', ['collectCompetitors', 'competitorReport'], 'competitor-products']
  ]) {
    initRun({ dataDir, runId, options: { mode: 'competitor-analysis' } });
    initRuntimeState({ dataDir, runId, mode: 'competitor-analysis', steps });
    assert.equal(readWorkflowNodeArtifact({ dataDir, runId, nodeId: 'collectCompetitors' }).type, expected);
    if (expected === 'competitor-sourcing') {
      for (const nodeId of ['findCompetitorSources', 'end']) assert.equal(readWorkflowNodeArtifact({ dataDir, runId, nodeId }).type, expected);
    }
  }
});
