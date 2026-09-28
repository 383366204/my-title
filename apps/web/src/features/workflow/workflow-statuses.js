/**
 * Canonical workflow status constants.
 *
 * Four status layers exist (see PHASE-0.1-BASELINE.md):
 *   1. Business summary status — set by skills/pipeline-flow flows
 *   2. Runtime execution status — set by runner.js
 *   3. API run.status — mapped by pipelineSummaryToWorkflowRun
 *   4. Node status — built by pipeline-node-state.js
 *
 * This module defines the FRONTEND consumption sets used to judge
 * whether a run is active, pausable, or in a terminal/review state.
 * It does NOT enumerate every backend business status; those are
 * mapped through the runtime/API layer before reaching the frontend.
 */

/**
 * Run statuses where the UI should show the run as actively executing.
 * Used by WorkflowStudio.isRunActive to gate cancel/pause buttons.
 *
 * Source of truth: workflow-data.js ACTIVE_RUN_STATUSES
 */
export const ACTIVE_RUN_STATUSES = Object.freeze(new Set([
  'pending',
  'running',
  'created',
  'mined',
  'verified',
  'products_selected',
  'generated',
  'resuming',
  'retrying',
  'awaiting_keyword_review',
  'awaiting_product_review'
]));

/**
 * Run statuses where the pause button should be shown.
 * Subset of ACTIVE_RUN_STATUSES plus keywords_reviewed.
 *
 * Source of truth: workflow-node-actions.js getWorkflowRuntimeActions
 */
export const PAUSABLE_RUN_STATUSES = Object.freeze(new Set([
  'pending',
  'running',
  'created',
  'mined',
  'awaiting_keyword_review',
  'keywords_reviewed',
  'verified',
  'generated',
  'resuming',
  'retrying'
]));

/**
 * Node statuses that indicate the node needs user attention.
 * Used by getCanvasNodeTone (warn tone) and getWorkflowBlockerActions (gate).
 */
export const ATTENTION_NODE_STATUSES = Object.freeze(new Set([
  'needs_review',
  'waiting_confirmation',
  'waiting_manual',
  'paused',
  'retryable'
]));

/**
 * Node statuses that block progress and show blocker actions.
 * Used by getWorkflowBlockerActions gate check.
 */
export const BLOCKED_NODE_STATUSES = Object.freeze(new Set([
  'blocked',
  'failed',
  'retryable',
  'waiting_manual',
  'paused'
]));

/**
 * Node statuses that indicate active execution.
 * Used by getWorkflowRuntimeActions to determine if pause is available.
 */
export const ACTIVE_NODE_STATUSES = Object.freeze(new Set([
  'running',
  'resuming',
  'retrying'
]));

/**
 * Terminal run statuses where no further action is expected.
 */
export const TERMINAL_RUN_STATUSES = Object.freeze(new Set([
  'completed',
  'failed',
  'cancelled',
  'workflow_complete'
]));
