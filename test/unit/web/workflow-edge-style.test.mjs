import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { styleWorkflowEdge, styleWorkflowEdges } from '../../../apps/web/src/features/workflow/workflow-edge-style.js';

describe('styleWorkflowEdge', () => {
  it('applies standard stroke and marker to an edge', () => {
    const edge = { id: 'e1', source: 'a', target: 'b' };
    const styled = styleWorkflowEdge(edge);
    assert.equal(styled.id, 'e1');
    assert.equal(styled.source, 'a');
    assert.equal(styled.style.stroke, '#3b82f6');
    assert.equal(styled.style.strokeWidth, 2.5);
    assert.equal(styled.markerEnd.color, '#3b82f6');
    assert.ok(styled.markerEnd.type); // MarkerType.ArrowClosed
  });

  it('preserves extra edge properties', () => {
    const edge = { id: 'e2', source: 'a', target: 'b', type: 'straight', animated: true };
    const styled = styleWorkflowEdge(edge);
    assert.equal(styled.type, 'straight');
    assert.equal(styled.animated, true);
  });
});

describe('styleWorkflowEdges', () => {
  it('styles an array of edges', () => {
    const edges = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' }
    ];
    const styled = styleWorkflowEdges(edges);
    assert.equal(styled.length, 2);
    assert.equal(styled[0].style.stroke, '#3b82f6');
    assert.equal(styled[1].style.stroke, '#3b82f6');
  });

  it('handles null/undefined input', () => {
    assert.deepEqual(styleWorkflowEdges(null), []);
    assert.deepEqual(styleWorkflowEdges(undefined), []);
  });

  it('handles empty array', () => {
    assert.deepEqual(styleWorkflowEdges([]), []);
  });
});
