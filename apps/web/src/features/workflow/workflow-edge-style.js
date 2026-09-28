/**
 * Shared edge styling for workflow canvas edges.
 *
 * Used by use-workflow-session.js in both loadTemplate and loadHistoryRun
 * to ensure consistent edge appearance. Extracted to prevent DRY violation.
 */
import { MarkerType } from '@xyflow/react';

const EDGE_COLOR = '#3b82f6';

/**
 * Apply standard workflow edge styling to a raw edge object.
 * @param {object} edge Raw edge from workflow template or history.
 * @returns {object} Styled edge ready for React Flow canvas.
 */
export function styleWorkflowEdge(edge) {
  return {
    ...edge,
    markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOR },
    style: { stroke: EDGE_COLOR, strokeWidth: 2.5 }
  };
}

/**
 * Style an array of edges for the canvas.
 * @param {object[]} edges Raw edges array (may be undefined/null).
 * @returns {object[]} Styled edges.
 */
export function styleWorkflowEdges(edges) {
  return (edges || []).map(styleWorkflowEdge);
}
