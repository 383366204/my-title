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
  validateProductionWorkflow,
  resolveProductionWorkflowLaunch,
  pipelineSummaryToWorkflowRun,
  listWorkflowRuns,
  getWorkflowRun,
  readWorkflowNodeArtifact,
  writeWorkflowDefinition,
  appendWorkflowEvent,
  readWorkflowEvents
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
    const dailyStart = templates[0].workflow.nodes.find(node => node.id === WORKFLOW_NODE_IDS.start);
    const keywordStart = templates[1].workflow.nodes.find(node => node.id === WORKFLOW_NODE_IDS.start);
    assert.deepEqual(Object.keys(dailyStart.data).sort(), [
      'export',
      'generate',
      'label',
      'length',
      'mine',
      'pages',
      'productsPerKeyword',
      'verify'
    ]);
    assert.equal(keywordStart.data.keyword, '');
    for (const template of templates) {
      assert.equal(template.production, true);
      assert.ok(template.workflow);
      assert.deepEqual(template.workflow.nodes.map(node => node.id), Object.values(WORKFLOW_NODE_IDS));
      assert.deepEqual(template.workflow.edges.map(edge => `${edge.source}->${edge.target}`), [
        'start->mine',
        'mine->verify',
        'verify->generate',
        'generate->export',
        'export->review',
        'review->end'
      ]);
    }
  });

  it('validates production workflow graphs without the legacy node registry', () => {
    const [template] = listProductionWorkflowTemplates();

    assert.deepEqual(validateProductionWorkflow(template.workflow), {
      ok: true,
      errors: [],
      production: true,
      templateId: 'daily-selection-v1'
    });

    const invalid = validateProductionWorkflow({
      nodes: [{ id: 'start', type: 'production-start', data: {} }],
      edges: []
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.production, true);
    assert.ok(invalid.errors.some(error => error.code === 'production_template_mismatch'));
  });

  it('resolves legacy workflow launch from template or keyword-bearing nodes', () => {
    const templates = listProductionWorkflowTemplates();
    assert.deepEqual(resolveProductionWorkflowLaunch({
      templateId: 'daily-selection-v1',
      params: { mine: 3 }
    }), {
      mode: 'daily',
      params: { mine: 3 }
    });

    assert.deepEqual(resolveProductionWorkflowLaunch({
      workflow: {
        nodes: [
          { id: 'node_1', type: 'keyword-input', data: { keyword: '  纯银耳环  ' } }
        ],
        edges: []
      }
    }), {
      mode: 'keyword',
      params: { keyword: '纯银耳环' }
    });

    assert.deepEqual(resolveProductionWorkflowLaunch({
      workflow: templates[0].workflow
    }), {
      mode: 'daily',
      params: {}
    });

    assert.throws(() => resolveProductionWorkflowLaunch({
      workflow: { nodes: [{ id: 'node_1', type: 'keyword-input', data: {} }], edges: [] }
    }), /无法从工作流解析启动模式/);
    assert.throws(() => resolveProductionWorkflowLaunch({ templateId: 'missing-template' }), /未知 workflow template/);
  });

  it('prefers extracted keyword mode for legacy production workflow launch without explicit mode or template', () => {
    const [template] = listProductionWorkflowTemplates();
    const workflow = JSON.parse(JSON.stringify(template.workflow));
    workflow.nodes.find(node => node.id === WORKFLOW_NODE_IDS.start).data.keyword = '纯银项链';

    const launch = resolveProductionWorkflowLaunch({ workflow });
    const args = buildPipelineCliArgs(launch.mode, launch.params);

    assert.deepEqual(launch, {
      mode: 'keyword',
      params: { keyword: '纯银项链' }
    });
    assert.deepEqual(args.slice(0, 4), ['bin/cli.js', 'flow', 'keyword', '纯银项链']);
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

  it('rejects unknown modes and never emits shell-like numeric params in CLI args', () => {
    assert.throws(() => buildPipelineCliArgs('unknown', {}), /未知 workflow mode/);

    const args = buildPipelineCliArgs('daily', {
      mine: '20; touch /tmp/pwned',
      verify: '5 && whoami',
      generate: '3$(whoami)',
      export: '`id`',
      productsPerKeyword: '4 | cat',
      length: '60',
      port: '9222',
      pages: '1',
      minBlueRows: '1'
    });

    assert.equal(args.some(arg => /[;&|`$()]/.test(arg)), false);
    for (const flag of ['--mine', '--verify', '--generate', '--export', '--products-per-keyword']) {
      const value = args[args.indexOf(flag) + 1];
      assert.match(value, /^\d+$/, `${flag} should be a plain numeric spawn argument`);
    }
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
    assert.equal(run.nodeStates.review.status, 'needs_review');
    assert.equal(run.nodeStates.end.status, 'idle');
    assert.equal(run.nodeStates.mine.output.count, 2);
    assert.equal(run.nodeStates.review.output.reviewFile, '/tmp/distribution-review.md');
  });

  it('maps explicit pipeline statuses to production node states', () => {
    const cases = [
      {
        status: 'manual_action_required',
        stage: 'verified',
        expected: { verify: 'blocked', generate: 'idle', export: 'idle', review: 'idle', end: 'idle' }
      },
      {
        status: 'verified_partial_manual_required',
        stage: 'verified',
        expected: { verify: 'blocked', generate: 'idle', export: 'idle', review: 'idle', end: 'idle' }
      },
      {
        status: 'verified_empty',
        stage: 'verified',
        expected: { verify: 'blocked', generate: 'idle', export: 'idle', review: 'idle', end: 'idle' }
      },
      {
        status: 'generate_failed',
        stage: 'generated',
        expected: { verify: 'completed', generate: 'failed', export: 'idle', review: 'idle', end: 'idle' }
      },
      {
        status: 'needs_review',
        stage: 'review',
        expected: { export: 'completed', review: 'needs_review', end: 'idle' }
      },
      {
        status: 'ready_to_distribute',
        stage: 'ready',
        expected: { export: 'completed', review: 'waiting_confirmation', end: 'idle' }
      },
      {
        status: 'awaiting_user_confirmation',
        stage: 'ready',
        expected: { export: 'completed', review: 'waiting_confirmation', end: 'idle' }
      },
      {
        status: 'workflow_complete',
        stage: 'submitted',
        expected: {
          start: 'completed',
          mine: 'completed',
          verify: 'completed',
          generate: 'completed',
          export: 'completed',
          review: 'completed',
          end: 'completed'
        }
      }
    ];

    for (const item of cases) {
      const run = pipelineSummaryToWorkflowRun({
        runId: `${item.status}_run`,
        status: item.status,
        stage: item.stage,
        startedAt: '2026-06-29T04:00:00.000Z',
        updatedAt: '2026-06-29T04:10:00.000Z',
        counts: { candidates: 2, sycmVerified: 1, generatedProducts: 1, readyToDistribute: 1 },
        files: {}
      });

      for (const [nodeId, expectedStatus] of Object.entries(item.expected)) {
        assert.equal(run.nodeStates[nodeId].status, expectedStatus, `${item.status} maps ${nodeId}`);
      }
    }
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
    const run = getWorkflowRun({ dataDir, runId });
    const legacyRun = getWorkflowRun(runId, { dataDir });
    const mineArtifact = readWorkflowNodeArtifact({ dataDir, runId, nodeId: WORKFLOW_NODE_IDS.mine });
    const generateArtifact = readWorkflowNodeArtifact({ dataDir, runId, nodeId: WORKFLOW_NODE_IDS.generate });

    assert.equal(listed.latest.runId, runId);
    assert.equal(legacyRun.runId, runId);
    assert.equal(run.nodeStates.generate.status, 'completed');
    assert.equal(run.nodeStates.export.status, 'running');
    assert.deepEqual(mineArtifact.rows.map(row => row.keyword), ['项链', '耳环']);
    assert.deepEqual(generateArtifact.rows, [{ title: '纯银项链' }]);
    assert.equal(readWorkflowNodeArtifact({ dataDir, runId, nodeId: WORKFLOW_NODE_IDS.end }), null);
  });

  it('persists workflow definitions and events next to pipeline runs', () => {
    const dataDir = tempPipelineDir();
    const runId = 'snapshot_run-1';
    const definition = {
      nodes: [{ id: WORKFLOW_NODE_IDS.start, type: 'production-start', data: { label: '开始' } }],
      edges: []
    };
    const event = {
      type: 'node_moved',
      nodeId: WORKFLOW_NODE_IDS.start,
      position: { x: 24, y: 48 }
    };

    const definitionFile = writeWorkflowDefinition({ dataDir, runId, definition });
    const eventFile = appendWorkflowEvent({ dataDir, runId, event });

    assert.equal(definitionFile, path.join(dataDir, 'runs', runId, 'workflow-definition.json'));
    assert.equal(eventFile, path.join(dataDir, 'runs', runId, 'workflow-events.jsonl'));
    assert.deepEqual(JSON.parse(fs.readFileSync(definitionFile, 'utf8')), definition);
    assert.deepEqual(readWorkflowEvents({ dataDir, runId }), [event]);
  });

  it('rejects unsafe workflow run ids for snapshots and events', () => {
    const dataDir = tempPipelineDir();

    assert.throws(() => writeWorkflowDefinition({
      dataDir,
      runId: '../outside',
      definition: { nodes: [], edges: [] }
    }), /Invalid workflow run id/);
    assert.throws(() => appendWorkflowEvent({
      dataDir,
      runId: 'bad/run',
      event: { type: 'node_moved' }
    }), /Invalid workflow run id/);
    assert.throws(() => readWorkflowEvents({
      dataDir,
      runId: 'bad.run'
    }), /Invalid workflow run id/);
  });

  it('attaches persisted workflow events to workflow run details', () => {
    const dataDir = tempPipelineDir();
    const runId = 'eventful_run';
    const runDir = path.join(dataDir, 'runs', runId);
    writeJson(path.join(runDir, 'run.json'), {
      runId,
      status: 'created',
      startedAt: '2026-06-29T04:00:00.000Z',
      updatedAt: '2026-06-29T04:01:00.000Z',
      counts: {},
      files: {}
    });
    appendWorkflowEvent({ dataDir, runId, event: { type: 'node_selected', nodeId: WORKFLOW_NODE_IDS.mine } });
    appendWorkflowEvent({ dataDir, runId, event: { type: 'viewport_changed', zoom: 0.8 } });

    const run = getWorkflowRun({ dataDir, runId });

    assert.deepEqual(run.workflowEvents, [
      { type: 'node_selected', nodeId: WORKFLOW_NODE_IDS.mine },
      { type: 'viewport_changed', zoom: 0.8 }
    ]);
  });
});
