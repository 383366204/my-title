import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionModeTemplate, selectionSourceSummary } from '../../../apps/web/src/features/workflow/selection-modes.js';
import { getWorkflowLaunchBlocker } from '../../../apps/web/src/features/workflow/workflow-launch-params.js';
import { getWorkflowTemplateView } from '../../../apps/web/src/features/workflow/workflow-node-view.js';

test('selection mode swaps graph while restoring only target mode inputs', () => {
  const template = { id: 'selection-v1', mode: 'daily', selectionModes: [
    { mode: 'keyword', workflow: { nodes: [{ id: 'start', data: { selectionMode: 'keyword', length: 60 } }, { id: 'verify', data: {} }], edges: [{ source: 'start', target: 'verify' }] } }
  ] };
  const next = selectionModeTemplate(template, 'keyword', { keywordsText: '杯垫\n茶杯' });
  assert.equal(next.id, 'selection-v1');
  assert.equal(next.mode, 'keyword');
  assert.equal(next.workflow.nodes[0].data.keywordsText, '杯垫\n茶杯');
  assert.equal(next.workflow.nodes[0].data.length, 60);
  assert.equal(next.workflow.nodes[0].data.rootsText, undefined);
  assert.equal(template.selectionModes[0].workflow.nodes[0].data.keywordsText, undefined);
  assert.equal(selectionModeTemplate(template, 'unknown'), null);
});

test('selection summary deduplicates roots and exact keywords', () => {
  assert.equal(selectionSourceSummary({ selectionMode: 'root-keyword', rootsText: '杯垫\n杯垫\n收纳' }), '杯垫、收纳 · 共 2 个');
  assert.equal(selectionSourceSummary({ selectionMode: 'keyword', keywordsText: '' }), '尚未录入');
  assert.equal(selectionSourceSummary({ selectionMode: 'daily', enabledDimensions: ['persona', 'hobby'] }), '已选 2 个灵感方向');
});

test('exact keyword input has no count cap but cannot be empty', () => {
  const nodes = [{ id: 'start', data: { keywordsText: Array.from({ length: 100 }, (_, index) => `词${index}`).join('\n') } }];
  assert.equal(getWorkflowLaunchBlocker('keyword', nodes), null);
  assert.equal(getWorkflowLaunchBlocker('keyword', [{ id: 'start', data: { keywordsText: '' } }]).status, 'blocked');
});

test('unified template description follows selected mode instead of default metadata', () => {
  const view = getWorkflowTemplateView({ id: 'selection-v1', mode: 'keyword', flowSummary: '旧摘要' });
  assert.match(view.entryLabel, /精确关键词/);
  assert.doesNotMatch(view.flowSummary, /关键词确认|生意参谋校验/);
  assert.match(view.flowSummary, /精确关键词 → 货源选品/);
  assert.doesNotMatch(view.flowSummary, /旧摘要/);
});
