import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectVerifiedRows } from '../../../apps/web/src/features/workflow/select-verified-rows.js';
import { artifactItems } from '../../../apps/web/src/features/workflow/workflow-data.js';

const noop = () => [];

describe('selectVerifiedRows', () => {
  it('returns verifiedKeywords from verify node output when present', () => {
    const nodes = [{ id: 'verify', data: { output: { verifiedKeywords: [{ keyword: 'a' }] } } }];
    const result = selectVerifiedRows({ nodes, verifiedArtifactRows: [], artifactState: {}, artifactItems: noop });
    assert.deepEqual(result, [{ keyword: 'a' }]);
  });

  it('falls through to output.items when verifiedKeywords is absent', () => {
    const nodes = [{ id: 'verify', data: { output: { items: [{ keyword: 'b' }] } } }];
    const result = selectVerifiedRows({ nodes, verifiedArtifactRows: [], artifactState: {}, artifactItems: noop });
    assert.deepEqual(result, [{ keyword: 'b' }]);
  });

  it('falls through to output.rows when items is absent', () => {
    const nodes = [{ id: 'verify', data: { output: { rows: [{ keyword: 'c' }] } } }];
    const result = selectVerifiedRows({ nodes, verifiedArtifactRows: [], artifactState: {}, artifactItems: noop });
    assert.deepEqual(result, [{ keyword: 'c' }]);
  });

  it('returns empty array immediately without falling through (empty array is valid)', () => {
    const nodes = [{ id: 'verify', data: { output: { verifiedKeywords: [] } } }];
    const result = selectVerifiedRows({
      nodes,
      verifiedArtifactRows: [{ keyword: 'should-not-appear' }],
      artifactState: {},
      artifactItems: noop
    });
    assert.deepEqual(result, [], 'empty verifiedKeywords should return [] not fall through');
  });

  it('uses verifiedArtifactRows when node output has no arrays', () => {
    const nodes = [{ id: 'verify', data: { output: {} } }];
    const verifiedArtifactRows = [{ keyword: 'from-artifact' }];
    const result = selectVerifiedRows({ nodes, verifiedArtifactRows, artifactState: {}, artifactItems: noop });
    assert.deepEqual(result, [{ keyword: 'from-artifact' }]);
  });

  it('uses artifactState items when viewing verify node', () => {
    const nodes = [{ id: 'other', data: {} }];
    const artifactState = { nodeId: 'verify', artifact: { items: [{ keyword: 'from-state' }] } };
    const result = selectVerifiedRows({ nodes, verifiedArtifactRows: [], artifactState, artifactItems });
    assert.deepEqual(result, [{ keyword: 'from-state' }]);
  });

  it('does not use artifactState items when viewing non-verify node', () => {
    const nodes = [{ id: 'other', data: {} }];
    const artifactState = { nodeId: 'mine', artifact: { items: [{ keyword: 'wrong' }] } };
    const result = selectVerifiedRows({ nodes, verifiedArtifactRows: [], artifactState, artifactItems });
    assert.deepEqual(result, []);
  });

  it('returns empty array when no source has data', () => {
    const result = selectVerifiedRows({ nodes: [], verifiedArtifactRows: [], artifactState: {}, artifactItems: noop });
    assert.deepEqual(result, []);
  });

  it('handles missing verify node gracefully', () => {
    const nodes = [{ id: 'mine', data: {} }];
    const result = selectVerifiedRows({ nodes, verifiedArtifactRows: [], artifactState: {}, artifactItems: noop });
    assert.deepEqual(result, []);
  });
});
