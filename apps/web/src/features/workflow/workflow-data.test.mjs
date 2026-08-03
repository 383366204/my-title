import assert from 'node:assert/strict';
import test from 'node:test';

import {
  effectiveCanvasNodeId,
  getCanvasNodeState,
  normalizeCanvasNode,
  normalizeRunList,
  normalizeTemplateList,
  normalizeWorkflowForCanvas
} from './workflow-data.js';

test('normalizes wrapped template and run API responses', () => {
  const validTemplate = { id: 'daily', workflow: { nodes: [], edges: [] } };
  assert.deepEqual(normalizeTemplateList({ data: { templates: [validTemplate, { id: 'invalid' }] } }), [validTemplate]);
  assert.deepEqual(normalizeRunList({ data: { history: [{ runId: 'run-1' }] } }), [{ runId: 'run-1' }]);
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
    { 'pipeline-mine': true }
  );

  assert.equal(node.type, 'pipeline-mine');
  assert.equal(node.data.status, 'idle');
  node.data.onSelect();
  node.data.onAction('retry-node');
  node.data.onViewArtifact();
  assert.deepEqual(events, ['select:mine', 'action:retry-node:mine', 'artifact:mine']);
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
