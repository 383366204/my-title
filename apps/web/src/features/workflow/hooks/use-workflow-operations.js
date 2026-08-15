import { useWorkflowCommands } from './use-workflow-commands.js';
import { useWorkflowLaunch } from './use-workflow-launch.js';

export { buildWorkflowDefinition } from './use-workflow-launch.js';

/**
 * Composite hook combining launch/validation and in-flight operations.
 * Maintains existing public interface for WorkflowStudio.
 * @param {object} options Operation dependencies and state callbacks.
 * @returns {object} Workflow launch, repeat-launch, cancellation, and node operation callbacks.
 */
export function useWorkflowOperations(options) {
  const { handleRunWorkflow, launchWorkflow } = useWorkflowLaunch(options);
  const { handleCancelWorkflow, runRemoteOperation } = useWorkflowCommands(options);

  return { handleCancelWorkflow, handleRunWorkflow, launchWorkflow, runRemoteOperation };
}
