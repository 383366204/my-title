import { useEffect, useRef, useState } from 'react';
import { getCategories, updateCategories } from '../../../api/category-api.js';
import { runWorkflowOperation } from '../../../api/workflow-api.js';

/** @param {string} runId 当前运行。 @returns {object} 类目轮询状态与操作。 */
export function useDistributionCategories(runId) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [busy, setBusy] = useState(false);
  const current = useRef(runId);
  current.current = runId;
  const accept = (data, id) => {
    if (current.current !== id) return;
    setState(old => !old || data.version >= old.version ? { ...old, ...data } : old);
  };
  useEffect(() => {
    let cancelled = false;
    let timer;
    setState(null); setError(''); setRefreshError(''); setBusy(false);
    const poll = async () => {
      try { const data = await getCategories(runId); if (!cancelled) { accept(data, runId); setRefreshError(''); } }
      catch (err) { if (!cancelled) setRefreshError(err.message); }
      finally { if (!cancelled) timer = setTimeout(poll, 2000); }
    };
    if (runId) poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [runId]);
  const act = async input => {
    if (!state || busy) return;
    const id = runId;
    setBusy(true); setError('');
    try { const data = await updateCategories(id, { ...input, version: state.version }); accept(data, id); }
    catch (err) { if (current.current === id) setError(err.message); }
    finally { if (current.current === id) setBusy(false); }
  };
  const startChrome = async () => {
    if (busy) return;
    const id = runId;
    setBusy(true); setError('');
    try {
      await runWorkflowOperation('/api/workflows/sycm/chrome/start', { runId: id, nodeId: 'export', port: state?.port || 9222 });
    } catch (err) { if (current.current === id) setError(err.message); }
    finally { if (current.current === id) setBusy(false); }
  };
  return { state, error: error || refreshError, busy, act, startChrome };
}
