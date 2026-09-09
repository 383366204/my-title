import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWorkflowDefinition } from './use-workflow-launch.js';
import { patchCanvasNode, progressNodeFields, runtimeNodeFields, updateNodeById } from './use-workflow-runtime.js';

test('progress patches distinguish explicit clearing from missing fields', () => {
  const node = { id: 'verify', data: { blocker: 'cooling', actionHint: 'wait', cooldownRemainingMs: 5000, progress: { total: 3 } } };
  const cleared = patchCanvasNode(node, progressNodeFields(node.data, { blocker: null, cooldownRemainingMs: 0, current: 1 }));
  assert.equal(cleared.data.blocker, null);
  assert.equal(cleared.data.cooldownRemainingMs, 0);
  assert.equal(cleared.data.actionHint, 'wait');
  assert.equal(cleared.data.progress.total, 3);
  assert.equal(runtimeNodeFields(null).blocker, null);
  assert.equal(runtimeNodeFields({ durationMs: 0 }).durationMs, 0);
});

test('buildWorkflowDefinition builds standardized workflow payload', () => {
  const nodes = [
    { id: 'node-1', type: 'custom-type', position: { x: 0, y: 0 }, data: { label: 'Input', originalType: 'pipeline-mine' } },
    { id: 'node-2', type: 'pipeline-export', position: { x: 100, y: 100 }, data: { label: 'Export' } }
  ];
  const edges = [
    { id: 'e1-2', source: 'node-1', target: 'node-2' }
  ];

  const def = buildWorkflowDefinition(nodes, edges);

  assert.deepEqual(def.nodes, [
    { id: 'node-1', type: 'pipeline-mine', position: { x: 0, y: 0 }, data: { label: 'Input', originalType: 'pipeline-mine' } },
    { id: 'node-2', type: 'pipeline-export', position: { x: 100, y: 100 }, data: { label: 'Export' } }
  ]);
  assert.deepEqual(def.edges, [
    { id: 'e1-2', source: 'node-1', target: 'node-2' }
  ]);
});

test('buildWorkflowDefinition handles empty and null inputs safely', () => {
  const def = buildWorkflowDefinition(null, undefined);
  assert.deepEqual(def, { nodes: [], edges: [] });
});

test('runtime helpers patch node data and extract runtime fields', () => {
  const initialNode = { id: 'node-1', type: 'mine', data: { status: 'idle', label: 'Mine' } };
  const state = { status: 'completed', output: { count: 10 }, durationMs: 500 };

  const fields = runtimeNodeFields(state);
  assert.equal(fields.status, 'completed');
  assert.deepEqual(fields.output, { count: 10 });
  assert.equal(fields.durationMs, 500);

  const patched = patchCanvasNode(initialNode, fields);
  assert.equal(patched.id, 'node-1');
  assert.equal(patched.data.status, 'completed');
  assert.equal(patched.data.label, 'Mine');

  const nodesList = [initialNode, { id: 'node-2', data: { status: 'idle' } }];
  const updatedList = updateNodeById(nodesList, 'node-1', { status: 'running' });
  assert.equal(updatedList[0].data.status, 'running');
  assert.equal(updatedList[1].data.status, 'idle');
});
