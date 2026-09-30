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
 * Safety guarantees:
 *   - Run ownership: only processes jobs whose workflowRunId matches the
 *     current run (or falls back to currentRunId when job has no runId).
 *     Stale callbacks from a previous run are silently ignored.
 *   - Failure rollback: if reloadRun or fetchHistoryRuns throws, the
 *     dedup entry is removed so the next completion notification retries.
 *
 * @param {object} options
 * @param {Function} options.setNodes React Flow setNodes setter.
 * @param {string|null} options.currentRunId
 * @param {Function} options.closeOverlay From useWorkflowOverlay.
 * @param {Function} options.setLogs From useWorkflowRuntime.
 * @param {Function} options.reloadRun Stable wrapper around loadHistoryRunRef.
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
  // Track which runId each callback was created for, to detect stale invocations.
  const currentRunIdRef = useRef(currentRunId);
  currentRunIdRef.current = currentRunId;

  const updateDistributionNodeJob = useCallback((job) => {
    // P1 fix: verify the job belongs to the current run before mutating state.
    const jobRunId = job?.workflowRunId || null;
    const activeRunId = currentRunIdRef.current;
    if (jobRunId && activeRunId && jobRunId !== activeRunId) return;

    setNodes((currentNodes) => currentNodes.map((node) => (
      node.id === 'export'
        ? { ...node, data: { ...node.data, distributionJob: job || null } }
        : node
    )));

    const workflowRunId = jobRunId || activeRunId;
    if (job?.status === 'completed' && workflowRunId && !completedDistributionJobsRef.current.has(job.jobId)) {
      // P2 fix: mark as processing, but remove on failure so retries work.
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
        try {
          await reloadRun(workflowRunId, { preserveLogs: true });
          await fetchHistoryRuns();
        } catch {
          // Rollback dedup so the next completion notification can retry.
          completedDistributionJobsRef.current.delete(job.jobId);
        }
      });
    }
  }, [closeOverlay, fetchHistoryRuns, reloadRun, setLogs, setNodes]);

  return { updateDistributionNodeJob, completedJobsRef: completedDistributionJobsRef };
}
