import assert from 'node:assert/strict';
import test from 'node:test';

import {
  effectiveCanvasNodeId,
  getCanvasNodeState,
  normalizeCanvasNode,
  normalizeRunList,
  normalizeTemplateList,
  normalizeWorkflowForCanvas,
  resetWorkflowNodeData
} from './workflow-data.js';

test('clears prior runtime state while preserving inputs for a repeated run', () => {
  const data = resetWorkflowNodeData({
    pages: 3,
    dateMode: 'custom',
    uploadId: 'upload-1',
    workflowReadOnly: true,
    workflowRunId: 'run-old',
    status: 'completed',
    output: { count: 20 },
    durationMs: 900,
    distributionJob: { jobId: 'job-old' }
  }, { pages: 5 });

  assert.equal(data.pages, 5);
  assert.equal(data.dateMode, 'custom');
  assert.equal(data.uploadId, 'upload-1');
  assert.equal(data.workflowReadOnly, false);
  assert.equal(data.workflowRunId, null);
  assert.equal(data.workflowRunStatus, 'idle');
  assert.equal(data.status, 'idle');
  assert.equal(data.output, null);
  assert.equal(data.durationMs, null);
  assert.equal(data.distributionJob, null);
});

test('normalizes wrapped template and run API responses', () => {
  const validTemplate = { id: 'daily', workflow: { nodes: [], edges: [] } };
  assert.deepEqual(normalizeTemplateList({ data: { templates: [validTemplate, { id: 'invalid' }] } }), [validTemplate]);
  assert.deepEqual(normalizeRunList({ data: { history: [{ runId: 'run-1' }] } }), [{ runId: 'run-1' }]);
  assert.deepEqual(normalizeRunList({ runs: [null, {}, { id: 'legacy-run' }, { runId: 'run-2' }] }), [
    { id: 'legacy-run' },
    { runId: 'run-2' }
  ]);
});

test('removes retired review nodes and repairs the export edge', () => {
  const workflow = normalizeWorkflowForCanvas({
    nodes: [
      { id: 'export', data: {} },
      { id: 'review', data: {} },
      { id: 'end', data: {} }
    ],
    edges: [
      { id: 'export-review', source: 'export', target: 'review' },
      { id: 'review-end', source: 'review', target: 'end' }
    ]
  });

  assert.deepEqual(workflow.nodes.map((node) => node.id), ['export', 'end']);
  assert.deepEqual(workflow.nodes.map((node) => node.data.stepIndex), [1, 2]);
  assert.deepEqual(workflow.edges, [{ id: 'export-end', source: 'export', target: 'end', type: 'straight' }]);
});

test('normalizes node rendering and delegates interactions', () => {
  const events = [];
  const node = normalizeCanvasNode(
    { id: 'mine', type: 'pipeline-mine', data: { label: '灵感选词' } },
    (nodeId) => events.push(`select:${nodeId}`),
    (action, nodeId) => events.push(`action:${action}:${nodeId}`),
    (nodeId) => events.push(`artifact:${nodeId}`),
    { 'pipeline-mine': true },
    (nodeId, field, value) => events.push(`update:${nodeId}:${field}:${value}`)
  );

  assert.equal(node.type, 'pipeline-mine');
  assert.equal(node.data.status, 'idle');
  node.data.onSelect();
  node.data.onAction('retry-node');
  node.data.onViewArtifact();
  node.data.onUpdate('sheetType', 'review');
  assert.deepEqual(events, ['select:mine', 'action:retry-node:mine', 'artifact:mine', 'update:mine:sheetType:review']);
});

test('adds sheet controls to legacy order-sheet snapshots', () => {
  const workflow = normalizeWorkflowForCanvas({
    nodes: [
      { id: 'start', data: { sheetType: 'review', storeName: '竹里人' } },
      { id: 'collectRank', data: {} },
      { id: 'generateSheet', data: {} },
      { id: 'end', data: {} }
    ],
    edges: []
  });
  const generateSheet = workflow.nodes.find((node) => node.id === 'generateSheet');
  const end = workflow.nodes.find((node) => node.id === 'end');

  assert.equal(generateSheet.data.sheetConfig, true);
  assert.equal(generateSheet.data.sheetType, 'review');
  assert.equal(generateSheet.data.storeName, '竹里人');
  assert.equal(generateSheet.data.reviewGroupSize, 4);
  assert.equal(end.data.orderSheetDownload, true);
});

test('does not add Excel download capability to ordinary selection workflows', () => {
  const workflow = normalizeWorkflowForCanvas({
    nodes: [
      { id: 'start', data: {} },
      { id: 'generate', data: {} },
      { id: 'end', data: {} }
    ],
    edges: []
  });

  assert.equal(workflow.nodes.find((node) => node.id === 'end').data.orderSheetDownload, undefined);
});

test('merges active legacy review state into the export node', () => {
  const state = getCanvasNodeState({
    export: { status: 'completed', output: { ready: 2 } },
    review: { status: 'needs_review', output: { blocked: 1 } }
  }, 'export');

  assert.equal(effectiveCanvasNodeId('review'), 'export');
  assert.equal(state.status, 'needs_review');
  assert.deepEqual(state.output, { ready: 2, blocked: 1 });
});
