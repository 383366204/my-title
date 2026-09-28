import { useCallback, useRef } from 'react';

/**
 * Handles distribution job completion side effects in the workflow studio.
 *
 * When a distribution job reaches 'completed' status:
 *   1. Updates the export node's distributionJob data
 *   2. Closes any open overlay
 *   3. Appends a log entry
 *   4. Reloads the run snapshot and refreshes history
 *
 * Uses a ref-based dedup set to prevent duplicate completion processing
 * when the same job ID completes multiple times (e.g., polling + manual confirm).
 *
 * @param {object} options
 * @param {Function} options.setNodes React Flow setNodes setter.
 * @param {string|null} options.currentRunId
 * @param {Function} options.closeOverlay From useWorkflowOverlay.
 * @param {Function} options.setLogs From useWorkflowRuntime.
 * @param {Function} options.reloadRun Stable wrapper around loadHistoryRunRef (e.g. useCallback((...args) => ref.current?.(...args), [])).
 * @param {Function} options.fetchHistoryRuns From useWorkflowRunCatalog.
 * @returns {{ updateDistributionNodeJob: Function, completedJobsRef: React.MutableRefObject }}
 */
export function useDistributionCompletion({
  setNodes,
  currentRunId,
  closeOverlay,
  setLogs,
  reloadRun,
  fetchHistoryRuns
}) {
  const completedDistributionJobsRef = useRef(new Set());

  const updateDistributionNodeJob = useCallback((job) => {
    setNodes((currentNodes) => currentNodes.map((node) => (
      node.id === 'export'
        ? { ...node, data: { ...node.data, distributionJob: job || null } }
        : node
    )));
    const workflowRunId = job?.workflowRunId || currentRunId;
    if (job?.status === 'completed' && workflowRunId && !completedDistributionJobsRef.current.has(job.jobId)) {
      completedDistributionJobsRef.current.add(job.jobId);
      const manualMode = job.mode === 'manual';
      closeOverlay();
      setLogs((previous) => [...previous, {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: manualMode
          ? '人工铺货已确认完成，流水线正在进入完成节点。'
          : '自动铺货已确认完成，流水线正在进入完成节点。'
      }]);
      Promise.resolve().then(async () => {
        await reloadRun(workflowRunId, { preserveLogs: true });
        await fetchHistoryRuns();
      });
    }
  }, [closeOverlay, currentRunId, fetchHistoryRuns, reloadRun, setLogs, setNodes]);

  return { updateDistributionNodeJob, completedJobsRef: completedDistributionJobsRef };
}
