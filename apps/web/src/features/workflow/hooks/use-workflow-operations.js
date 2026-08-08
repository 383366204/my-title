import { useWorkflowCommands } from './use-workflow-commands.js';
import { useWorkflowLaunch } from './use-workflow-launch.js';

export { buildWorkflowDefinition } from './use-workflow-launch.js';

/**
 * Composite hook combining launch/validation and in-flight operations.
 * Maintains existing public interface for WorkflowStudio.
 * @param {object} options Operation dependencies and state callbacks.
 * @returns {object} handleCancelWorkflow, handleRunWorkflow, runRemoteOperation.
 */
export function useWorkflowOperations(options) {
  const { handleRunWorkflow } = useWorkflowLaunch(options);
  const { handleCancelWorkflow, runRemoteOperation } = useWorkflowCommands(options);

  return { handleCancelWorkflow, handleRunWorkflow, runRemoteOperation };
}
