import { useCallback, useEffect, useState } from 'react';

import { deleteWorkflowRun, listWorkflowRuns, listWorkflowTemplates } from '../../../api/workflow-api.js';

export function useWorkflowRunCatalog({ normalizeRuns, normalizeTemplates } = {}) {
  const [templates, setTemplates] = useState([]);
  const [historyRuns, setHistoryRuns] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [deletingRunId, setDeletingRunId] = useState('');

  const refreshTemplates = useCallback(async () => {
    try {
      const data = await listWorkflowTemplates();
      setTemplates(normalizeTemplates ? normalizeTemplates(data) : data);
    } catch (error) {
      setTemplates([]);
      throw error;
    }
  }, [normalizeTemplates]);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const data = await listWorkflowRuns();
      const runs = normalizeRuns ? normalizeRuns(data) : data;
      setHistoryRuns(runs);
      return runs;
    } catch (error) {
      setHistoryError(error.message);
      setHistoryRuns([]);
      throw error;
    } finally {
      setHistoryLoading(false);
    }
  }, [normalizeRuns]);

  const removeHistoryRun = useCallback(async (runId) => {
    setDeletingRunId(runId);
    setHistoryError('');
    try {
      await deleteWorkflowRun(runId);
      setHistoryRuns((runs) => runs.filter((run) => String(run.runId || run.id || '') !== String(runId)));
    } catch (error) {
      setHistoryError(error.message);
      throw error;
    } finally {
      setDeletingRunId('');
    }
  }, []);

  useEffect(() => {
    refreshTemplates().catch(() => {});
    refreshHistory().catch(() => {});
  }, [refreshHistory, refreshTemplates]);

  return {
    templates,
    historyRuns,
    historyLoading,
    historyError,
    deletingRunId,
    refreshTemplates,
    refreshHistory,
    removeHistoryRun
  };
}
