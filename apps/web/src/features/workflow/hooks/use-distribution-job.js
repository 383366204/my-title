import { useCallback, useEffect, useRef, useState } from 'react';

import {
  completeManualDistribution,
  controlDistributionRun,
  getDistributionRun,
  startDistributionChrome,
  submitDistribution
} from '../../../api/distribution-api.js';

const FINISHED_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export function useDistributionJob({ initialJobId = '', notifyCompletedOnRestore = false, onJobChange } = {}) {
  const [job, setJobState] = useState(null);
  const [error, setError] = useState('');
  const [chromeStarting, setChromeStarting] = useState(false);
  const [chromeMessage, setChromeMessage] = useState('');
  const onJobChangeRef = useRef(onJobChange);
  onJobChangeRef.current = onJobChange;
  const revision = useRef(0);
  const actionPending = useRef(false);
  const setJob = useCallback((nextJob) => {
    revision.current += 1;
    setJobState(nextJob);
    onJobChangeRef.current?.(nextJob);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const requestedRevision = ++revision.current;
    setJobState(null);
    setError('');
    if (!initialJobId) return () => { cancelled = true; };
    getDistributionRun(initialJobId)
      .then((persistedJob) => {
        if (cancelled || requestedRevision !== revision.current) return;
        // 已完成任务需要通知画布同步；否则用户在铺货中关闭弹窗后，重新打开仍会停在复核节点。
        if (notifyCompletedOnRestore && persistedJob?.status === 'completed') setJob(persistedJob);
        else setJobState(persistedJob);
      })
      .catch((loadError) => {
        if (!cancelled && !/未找到铺货任务|404/.test(String(loadError?.message || ''))) {
          setError(loadError.message);
        }
    });
    return () => { cancelled = true; };
  }, [initialJobId, notifyCompletedOnRestore, setJob]);

  useEffect(() => {
    if (!job?.jobId || FINISHED_STATUSES.has(job.status)) return undefined;
    let cancelled = false;
    let timer;
    const poll = async () => {
      const requestedRevision = revision.current;
      try {
        if (actionPending.current) return;
        const nextJob = await getDistributionRun(job.jobId);
        if (!cancelled && !actionPending.current && requestedRevision === revision.current) setJob(nextJob);
      } catch (pollError) {
        if (!cancelled && requestedRevision === revision.current) setError(pollError.message);
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, job.status === 'completed_with_issues' ? 3000 : 1500);
      }
    };
    poll();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [job?.jobId, job?.status, setJob]);

  const submit = useCallback(async ({ input, runId, shopId, shopRevision, shopIds, shopRevisions, distributionMode }) => {
    setError('');
    try {
      const nextJob = await submitDistribution({ input, confirm: true, runId, shopId, shopRevision, shopIds, shopRevisions, distributionMode });
      setJob(nextJob);
      return nextJob;
    } catch (submitError) { setError(submitError.message); return null; }
  }, [setJob]);

  const completeManual = useCallback(async ({ input, runId, shopId, shopRevision, shopIds, shopRevisions, distributionMode }) => {
    setError('');
    try {
      const nextJob = await completeManualDistribution({ input, runId, shopId, shopRevision, shopIds, shopRevisions, distributionMode, confirm: true });
      setJob(nextJob);
      return nextJob;
    } catch (completeError) {
      setError(completeError.message);
      return null;
    }
  }, [setJob]);

  const control = useCallback(async (action) => {
    if (!job?.jobId || actionPending.current) return null;
    actionPending.current = true;
    const requestedRevision = ++revision.current;
    setError('');
    try {
      const nextJob = await controlDistributionRun(job.jobId, action);
      if (requestedRevision === revision.current) setJob(nextJob);
      return nextJob;
    } catch (controlError) {
      if (requestedRevision === revision.current) setError(controlError.message);
      return null;
    } finally { actionPending.current = false; }
  }, [job?.jobId, setJob]);

  const startChrome = useCallback(async (input = {}) => {
    setChromeStarting(true); setError(''); setChromeMessage('');
    try { const result = await startDistributionChrome(input); setChromeMessage(result.userMessage || '铺货 Chrome 已启动。'); }
    catch (startError) { setError(startError.message); }
    finally { setChromeStarting(false); }
  }, []);

  return { job, error, chromeStarting, chromeMessage, setError, setJob, setChromeStarting, setChromeMessage, submit, completeManual, control, startChrome };
}
