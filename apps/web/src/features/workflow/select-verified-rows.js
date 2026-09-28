/**
 * Pure selector: extract verified keyword rows from multiple sources.
 *
 * Returns the first source that is a non-null, non-undefined array.
 * An empty array [] IS a valid result and will be returned immediately
 * without falling through to lower-priority sources. Only null/undefined
 * triggers fallback to the next source.
 *
 * Priority order:
 *   1. verify node output.verifiedKeywords (if array)
 *   2. verify node output.items (if array)
 *   3. verify node output.rows (if array)
 *   4. verifiedArtifactRows (if non-empty array)
 *   5. artifactState items when viewing verify node (if array)
 *   6. empty array fallback
 *
 * This is a pure function with no side effects. Memoization is the
 * caller's responsibility since it depends on React state identity.
 *
 * @param {object} options
 * @param {object[]} options.nodes Canvas nodes array.
 * @param {object[]} options.verifiedArtifactRows Rows from title generation hook.
 * @param {object} options.artifactState Current artifact state.
 * @param {Function} options.artifactItems Helper to extract items from artifact state.
 * @returns {object[]} Verified keyword rows.
 */
export function selectVerifiedRows({ nodes, verifiedArtifactRows, artifactState, artifactItems }) {
  const verifyNode = nodes.find((node) => node.id === 'verify');
  const output = verifyNode?.data?.output;
  if (Array.isArray(output?.verifiedKeywords)) return output.verifiedKeywords;
  if (Array.isArray(output?.items)) return output.items;
  if (Array.isArray(output?.rows)) return output.rows;
  if (verifiedArtifactRows.length > 0) return verifiedArtifactRows;
  if (artifactState.nodeId === 'verify') return artifactItems(artifactState);
  return [];
}
