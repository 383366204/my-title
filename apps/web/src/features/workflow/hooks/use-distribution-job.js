import { useCallback, useEffect, useState } from 'react';

import {
  controlDistributionRun,
  getDistributionRun,
  startDistributionChrome,
  submitDistribution
} from '../../../api/distribution-api.js';

const FINISHED_STATUSES = new Set(['completed', 'completed_with_issues', 'failed', 'cancelled']);

export function useDistributionJob({ onJobChange } = {}) {
  const [job, setJobState] = useState(null);
  const [error, setError] = useState('');
  const [chromeStarting, setChromeStarting] = useState(false);
  const [chromeMessage, setChromeMessage] = useState('');
  const setJob = useCallback((nextJob) => {
    setJobState(nextJob);
    onJobChange?.(nextJob);
  }, [onJobChange]);

  useEffect(() => {
    if (!job?.jobId || FINISHED_STATUSES.has(job.status)) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const nextJob = await getDistributionRun(job.jobId);
        if (!cancelled) setJob(nextJob);
      } catch (pollError) {
        if (!cancelled) setError(pollError.message);
      }
    };
    poll();
    const timer = window.setInterval(poll, 1500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [job?.jobId, job?.status, setJob]);

  const submit = useCallback(async ({ input, runId }) => {
    setError('');
    try {
      const nextJob = await submitDistribution({ input, confirm: true, runId });
      setJob(nextJob);
      return nextJob;
    } catch (submitError) { setError(submitError.message); return null; }
  }, [setJob]);

  const control = useCallback(async (action) => {
    if (!job?.jobId) return null;
    try { const nextJob = await controlDistributionRun(job.jobId, action); setJob(nextJob); return nextJob; }
    catch (controlError) { setError(controlError.message); return null; }
  }, [job?.jobId, setJob]);

  const startChrome = useCallback(async () => {
    setChromeStarting(true); setError(''); setChromeMessage('');
    try { const result = await startDistributionChrome(); setChromeMessage(result.userMessage || '铺货 Chrome 已启动。'); }
    catch (startError) { setError(startError.message); }
    finally { setChromeStarting(false); }
  }, []);

  return { job, error, chromeStarting, chromeMessage, setError, setJob, setChromeStarting, setChromeMessage, submit, control, startChrome };
}
