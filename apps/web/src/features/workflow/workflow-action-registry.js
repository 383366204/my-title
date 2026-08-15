export const WORKFLOW_ACTION_KINDS = Object.freeze({
  COMMAND: 'command',
  OVERLAY: 'overlay',
  SELECT: 'select'
});

export const WORKFLOW_OVERLAYS = Object.freeze({
  ARTIFACT: 'artifact',
  DISTRIBUTION: 'distribution',
  NODE_WORKBENCH: 'node-workbench',
  PRODUCT_SELECT: 'product-select',
  SHEET_CONFIG: 'sheet-config',
  START_CONFIG: 'start-config'
});

const command = Object.freeze({ kind: WORKFLOW_ACTION_KINDS.COMMAND });
const select = Object.freeze({ kind: WORKFLOW_ACTION_KINDS.SELECT });
const overlay = (target) => Object.freeze({ kind: WORKFLOW_ACTION_KINDS.OVERLAY, overlay: target });

export const WORKFLOW_ACTION_ROUTES = Object.freeze({
  'manual-input': overlay(WORKFLOW_OVERLAYS.START_CONFIG),
  'configure-sheet': overlay(WORKFLOW_OVERLAYS.SHEET_CONFIG),
  'keyword-review': overlay(WORKFLOW_OVERLAYS.NODE_WORKBENCH),
  'confirm-keyword-review': overlay(WORKFLOW_OVERLAYS.NODE_WORKBENCH),
  'complete-order-sheet-products': overlay(WORKFLOW_OVERLAYS.NODE_WORKBENCH),
  'confirm-order-sheet-products': overlay(WORKFLOW_OVERLAYS.NODE_WORKBENCH),
  'product-review': overlay(WORKFLOW_OVERLAYS.PRODUCT_SELECT),
  'open-review': overlay(WORKFLOW_OVERLAYS.DISTRIBUTION),
  'confirm-distribution': overlay(WORKFLOW_OVERLAYS.DISTRIBUTION),
  'review-drafts': overlay(WORKFLOW_OVERLAYS.NODE_WORKBENCH),
  artifact: overlay(WORKFLOW_OVERLAYS.ARTIFACT),
  blocked: overlay(WORKFLOW_OVERLAYS.NODE_WORKBENCH),
  review: overlay(WORKFLOW_OVERLAYS.NODE_WORKBENCH),
  inspect: select,
  pause: command,
  resume: command,
  'resume-after-manual': command,
  'continue-or-fix-sycm': command,
  'mine-more': command,
  'retry-node': command,
  'start-sycm-chrome': command,
  'pause-distribution': command
});

/**
 * Resolve how a node action should be handled by the workflow studio.
 * @param {string} action Workflow action key.
 * @returns {{kind: string, overlay?: string}} Action routing metadata.
 */
export function getWorkflowActionRoute(action) {
  return WORKFLOW_ACTION_ROUTES[action] || select;
}

/**
 * Normalize backend recommendation names to executable workflow commands.
 * @param {string} action Workflow action key.
 * @returns {string} Executable action key.
 */
export function getWorkflowCommandAction(action) {
  if (action === 'resume-after-manual' || action === 'continue-or-fix-sycm') return 'resume';
  return action;
}
