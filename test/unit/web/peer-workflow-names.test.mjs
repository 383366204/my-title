import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { inferRunTitle } from '../../../apps/web/src/features/workflow/workflow-history-view.js';

const require = createRequire(import.meta.url);
const { listProductionWorkflowTemplates } = require('../../../core/workflow/pipeline-templates');

test('peer templates distinguish discovery from known-shop analysis without changing IDs', () => {
  const templates = listProductionWorkflowTemplates();
  const peer = templates.find(item => item.id === 'peer-discovery-v1');
  const competitor = templates.find(item => item.id === 'competitor-analysis-v1');
  assert.equal(peer.name, '以货找店');
  assert.equal(competitor.name, '指定店铺分析');
});

test('history titles distinguish both discovery branches and retain explicit user titles', () => {
  assert.equal(inferRunTitle({ mode: 'competitor-analysis' }), '指定店铺分析');
  assert.equal(inferRunTitle({ mode: 'peer-discovery' }), '以货找店');
  assert.equal(inferRunTitle({ mode: 'peer-discovery', params: { discoveryBranch: 'image-selection' } }), '图搜选货');
  assert.equal(inferRunTitle({ mode: 'peer-discovery', workflow: { nodes: [{ id: 'start', data: { discoveryBranch: 'image-selection' } }] } }), '图搜选货');
  assert.equal(inferRunTitle({ mode: 'peer-discovery', title: '我的测试' }), '我的测试');
});
