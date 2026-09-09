import { useCallback, useEffect, useRef, useState } from 'react';

import { deleteWorkflowRun, listWorkflowRuns, listWorkflowTemplates } from '../../../api/workflow-api.js';

export function useWorkflowRunCatalog({ normalizeRuns, normalizeTemplates } = {}) {
  const [templates, setTemplates] = useState([]);
  const [historyRuns, setHistoryRuns] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [deletingRunId, setDeletingRunId] = useState('');
  const historyRequest = useRef(0);
  const templateRequest = useRef(0);
  const deleteRequest = useRef(0);
  const lifecycle = useRef(0);

  const refreshTemplates = useCallback(async () => {
    const request = ++templateRequest.current;
    try {
      const data = await listWorkflowTemplates();
      if (request !== templateRequest.current) return;
      setTemplates(normalizeTemplates ? normalizeTemplates(data) : data);
    } catch (error) {
      if (request !== templateRequest.current) return;
      setTemplates([]);
      throw error;
    }
  }, [normalizeTemplates]);

  const refreshHistory = useCallback(async () => {
    const request = ++historyRequest.current;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const data = await listWorkflowRuns();
      const runs = normalizeRuns ? normalizeRuns(data) : data;
      if (request !== historyRequest.current) return runs;
      setHistoryRuns(runs);
      return runs;
    } catch (error) {
      if (request === historyRequest.current) setHistoryError(error.message);
      // 历史刷新失败不代表启动或恢复流程失败，保留上次成功列表。
      return [];
    } finally {
      if (request === historyRequest.current) setHistoryLoading(false);
    }
  }, [normalizeRuns]);

  const removeHistoryRun = useCallback(async (runId) => {
    const request = ++deleteRequest.current;
    const owner = lifecycle.current;
    setDeletingRunId(runId);
    setHistoryError('');
    try {
      await deleteWorkflowRun(runId);
      if (owner !== lifecycle.current) return;
      historyRequest.current++;
      setHistoryLoading(false);
      setHistoryRuns((runs) => runs.filter((run) => String(run.runId || run.id || '') !== String(runId)));
    } catch (error) {
      if (request === deleteRequest.current) setHistoryError(error.message);
      throw error;
    } finally {
      if (request === deleteRequest.current) setDeletingRunId('');
    }
  }, []);

  useEffect(() => {
    refreshTemplates().catch(() => {});
    refreshHistory().catch(() => {});
    return () => {
      lifecycle.current++;
      historyRequest.current++;
      templateRequest.current++;
      deleteRequest.current++;
    };
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
