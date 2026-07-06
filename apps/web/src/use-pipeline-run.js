import { useCallback, useEffect, useState } from 'react';
import {
  appendPipelineCandidates,
  getCurrentPipelineRun,
  pausePipelineRun,
  resumePipelineRun,
  retryPipelineStep,
  runPipelineStep,
  startPipelineRun
} from './pipeline-client.js';

export function usePipelineRun({ autoLoad = true, limit = 12 } = {}) {
  const [currentRun, setCurrentRun] = useState(null);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const applyPipelinePayload = useCallback((payload = {}) => {
    const nextRun = payload.currentRun || payload.latest || null;
    if (nextRun) setCurrentRun(nextRun);
    if (Array.isArray(payload.runs)) setRuns(payload.runs);
    return payload;
  }, []);

  const refreshRun = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      return applyPipelinePayload(await getCurrentPipelineRun({ limit }));
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [applyPipelinePayload, limit]);

  const startRun = useCallback(async (payload) => {
    setError('');
    const result = await startPipelineRun(payload);
    applyPipelinePayload(result);
    await refreshRun().catch(() => {});
    return result;
  }, [applyPipelinePayload, refreshRun]);

  const runStep = useCallback(async (step, payload = {}) => {
    const runId = payload.runId || (currentRun && currentRun.runId);
    if (!runId) throw new Error('请先创建或选择一个当前流程。');
    setError('');
    const result = await runPipelineStep(runId, step, payload);
    applyPipelinePayload(result);
    await refreshRun().catch(() => {});
    return result;
  }, [applyPipelinePayload, currentRun, refreshRun]);

  const appendCandidates = useCallback(async (candidates, payload = {}) => {
    const runId = payload.runId || (currentRun && currentRun.runId);
    if (!runId) throw new Error('请先创建或选择一个当前流程。');
    setError('');
    const result = await appendPipelineCandidates(runId, candidates, payload);
    applyPipelinePayload(result);
    await refreshRun().catch(() => {});
    return result;
  }, [applyPipelinePayload, currentRun, refreshRun]);

  const pauseRun = useCallback(async (payload = {}) => {
    const runId = payload.runId || (currentRun && currentRun.runId);
    if (!runId) throw new Error('请先创建或选择一个当前流程。');
    setError('');
    const result = await pausePipelineRun(runId, payload);
    applyPipelinePayload(result);
    await refreshRun().catch(() => {});
    return result;
  }, [applyPipelinePayload, currentRun, refreshRun]);

  const resumeRun = useCallback(async (payload = {}) => {
    const runId = payload.runId || (currentRun && currentRun.runId);
    if (!runId) throw new Error('请先创建或选择一个当前流程。');
    setError('');
    const result = await resumePipelineRun(runId, payload);
    applyPipelinePayload(result);
    await refreshRun().catch(() => {});
    return result;
  }, [applyPipelinePayload, currentRun, refreshRun]);

  const retryStep = useCallback(async (step, payload = {}) => {
    const runId = payload.runId || (currentRun && currentRun.runId);
    if (!runId) throw new Error('请先创建或选择一个当前流程。');
    if (!step) throw new Error('请选择要重试的流程节点。');
    setError('');
    const result = await retryPipelineStep(runId, step, payload);
    applyPipelinePayload(result);
    await refreshRun().catch(() => {});
    return result;
  }, [applyPipelinePayload, currentRun, refreshRun]);

  useEffect(() => {
    if (!autoLoad) return undefined;
    refreshRun().catch(() => {});
    return undefined;
  }, [autoLoad, refreshRun]);

  return {
    currentRun,
    runs,
    loading,
    error,
    refreshRun,
    startRun,
    runStep,
    appendCandidates,
    pauseRun,
    resumeRun,
    retryStep
  };
}
