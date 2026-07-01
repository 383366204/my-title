'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  WORKFLOW_NODE_IDS,
  listProductionWorkflowTemplates,
  sanitizeWorkflowParams,
  buildPipelineCliArgs,
  pipelineSummaryToWorkflowRun,
  listWorkflowRuns,
  getWorkflowRun,
  readWorkflowNodeArtifact
} = require('../workflow/pipeline-adapter');

function tempPipelineDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-pipeline-adapter-'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

describe('workflow pipeline adapter', () => {
  it('lists the fixed production workflow templates', () => {
    assert.deepEqual(WORKFLOW_NODE_IDS, {
      start: 'start',
      mine: 'mine',
      verify: 'verify',
      generate: 'generate',
      export: 'export',
      review: 'review',
      end: 'end'
    });

    const templates = listProductionWorkflowTemplates();

    assert.deepEqual(templates.map(template => template.id), ['daily-selection-v1', 'exact-keyword-v1']);
    for (const template of templates) {
      assert.equal(template.production, true);
      assert.deepEqual(template.nodes.map(node => node.id), Object.values(WORKFLOW_NODE_IDS));
      assert.deepEqual(template.edges.map(edge => `${edge.source}->${edge.target}`), [
        'start->mine',
        'mine->verify',
        'verify->generate',
        'generate->export',
        'export->review',
        'review->end'
      ]);
    }
  });

  it('sanitizes daily and exact keyword parameters with range limits', () => {
    assert.deepEqual(sanitizeWorkflowParams('daily', {
      mine: '999',
      verify: '0',
      generate: 'abc',
      export: 200,
      productsPerKeyword: -1,
      length: 120,
      port: '9223',
      pages: 9,
      minBlueRows: '-5',
      fallbackHot: false
    }), {
      mine: 200,
      verify: 1,
      generate: 10,
      export: 100,
      productsPerKeyword: 1,
      length: 80,
      port: 9223,
      pages: 5,
      minBlueRows: 0,
      fallbackHot: false
    });

    assert.deepEqual(sanitizeWorkflowParams('keyword', {
      keyword: '  纯银项链女  ',
      export: 0,
      productsPerKeyword: 18,
      length: 20,
      port: '9222',
      pages: 2,
      minBlueRows: 3,
      fallbackHot: true
    }), {
      keyword: '纯银项链女',
      export: 1,
      productsPerKeyword: 18,
      length: 30,
      port: 9222,
      pages: 2,
      minBlueRows: 3,
      fallbackHot: true
    });

    assert.throws(() => sanitizeWorkflowParams('keyword', { keyword: '   ' }), /关键词不能为空/);
    assert.throws(() => sanitizeWorkflowParams('unknown', {}), /未知 workflow mode/);
  });

  it('builds shell-free CLI args for production pipeline modes', () => {
    assert.deepEqual(buildPipelineCliArgs('daily', sanitizeWorkflowParams('daily', {
      mine: 20,
      verify: 5,
      generate: 3,
      export: 8,
      productsPerKeyword: 4,
      length: 60,
      port: 9222,
      pages: 1,
      minBlueRows: 1,
      fallbackHot: false
    })), [
      'bin/cli.js',
      'flow',
      'daily',
      '--mine', '20',
      '--verify', '5',
      '--generate', '3',
      '--export', '8',
      '--products-per-keyword', '4',
      '--length', '60',
      '--port', '9222',
      '--pages', '1',
      '--min-blue-rows', '1',
      '--no-hot-fallback',
      '--json'
    ]);

    assert.deepEqual(buildPipelineCliArgs('keyword', sanitizeWorkflowParams('keyword', {
      keyword: '纯银 项链',
      export: 8,
      productsPerKeyword: 4,
      length: 60,
      port: 9222,
      pages: 1,
      minBlueRows: 1
    })), [
      'bin/cli.js',
      'flow',
      'keyword',
      '纯银 项链',
      '--export', '8',
      '--products-per-keyword', '4',
      '--length', '60',
      '--port', '9222',
      '--pages', '1',
      '--min-blue-rows', '1',
      '--json'
    ]);
  });

  it('maps pipeline summary into workflow run node states and action metadata', () => {
    const summary = {
      runId: 'review_run',
      status: 'needs_review',
      stage: 'review',
      startedAt: '2026-06-29T04:00:00.000Z',
      updatedAt: '2026-06-29T04:10:00.000Z',
      counts: {
        candidates: 2,
        sycmVerified: 1,
        generatedProducts: 1,
        readyToDistribute: 1,
        reviewCandidates: 1
      },
      files: {
        candidates: '/tmp/candidates.jsonl',
        verifiedKeywords: '/tmp/verified-keywords.jsonl',
        generatedProducts: '/tmp/generated-products.jsonl',
        distributionBatch: '/tmp/distribution-batch.txt',
        distributionReview: '/tmp/distribution-review.md'
      },
      batchCount: 1,
      requiresUserAction: true,
      blockers: ['review_rejected_rows'],
      nextCommand: 'Review /tmp/distribution-review.md',
      nextActionCode: 'review_required'
    };

    const run = pipelineSummaryToWorkflowRun(summary);

    assert.equal(run.runId, 'review_run');
    assert.equal(run.status, 'needs_review');
    assert.equal(run.workflow.id, 'daily-selection-v1');
    assert.equal(run.requiresUserAction, true);
    assert.deepEqual(run.blockers, ['review_rejected_rows']);
    assert.equal(run.nodeStates.start.status, 'completed');
    assert.equal(run.nodeStates.mine.status, 'completed');
    assert.equal(run.nodeStates.verify.status, 'completed');
    assert.equal(run.nodeStates.generate.status, 'completed');
    assert.equal(run.nodeStates.export.status, 'completed');
    assert.equal(run.nodeStates.review.status, 'running');
    assert.equal(run.nodeStates.end.status, 'idle');
    assert.equal(run.nodeStates.mine.output.count, 2);
    assert.equal(run.nodeStates.review.output.reviewFile, '/tmp/distribution-review.md');
  });

  it('lists, gets, and reads workflow node artifacts from pipeline runs', () => {
    const dataDir = tempPipelineDir();
    const runId = 'artifact_run';
    const runDir = path.join(dataDir, 'runs', runId);
    writeJson(path.join(runDir, 'run.json'), {
      runId,
      status: 'generated',
      startedAt: '2026-06-29T04:00:00.000Z',
      updatedAt: '2026-06-29T04:10:00.000Z',
      counts: { candidates: 2, sycmVerified: 1, generatedProducts: 1 },
      files: {
        candidates: path.join(runDir, 'candidates.jsonl'),
        verifiedKeywords: path.join(runDir, 'verified-keywords.jsonl'),
        generatedProducts: path.join(runDir, 'generated-products.jsonl')
      }
    });
    writeText(path.join(runDir, 'candidates.jsonl'), '{"keyword":"项链"}\n{"keyword":"耳环"}\n');
    writeText(path.join(runDir, 'verified-keywords.jsonl'), '{"keyword":"项链","status":"verified"}\n');
    writeText(path.join(runDir, 'generated-products.jsonl'), '{"title":"纯银项链"}\n');

    const listed = listWorkflowRuns({ dataDir });
    const run = getWorkflowRun(runId, { dataDir });
    const mineArtifact = readWorkflowNodeArtifact(runId, WORKFLOW_NODE_IDS.mine, { dataDir });
    const generateArtifact = readWorkflowNodeArtifact(runId, WORKFLOW_NODE_IDS.generate, { dataDir });

    assert.equal(listed.latest.runId, runId);
    assert.equal(run.nodeStates.generate.status, 'completed');
    assert.equal(run.nodeStates.export.status, 'running');
    assert.deepEqual(mineArtifact.rows.map(row => row.keyword), ['项链', '耳环']);
    assert.deepEqual(generateArtifact.rows, [{ title: '纯银项链' }]);
    assert.equal(readWorkflowNodeArtifact(runId, WORKFLOW_NODE_IDS.end, { dataDir }), null);
  });
});
