import { useState } from 'react';
import { ClipboardList, RefreshCw } from 'lucide-react';
import { CompetitorDistributionDialog } from './competitor-distribution-dialog.jsx';

/** @param {object} props 来源运行与禁用状态。 @returns {import('react').JSX.Element} 铺货清单入口。 */
export function CompetitorDistributionButton({ runId, disabled = false }) {
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/workflows/runs/${encodeURIComponent(runId)}/competitor-sourcing/distribution`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || '打开铺货清单失败');
      setDraft(result.data);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return <div className="nodrag nowheel min-w-0" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <button type="button" className="node-primary-button" disabled={disabled || busy || !runId} onClick={open}>
      {busy ? <RefreshCw size={13} className="animate-spin" /> : <ClipboardList size={13} />}
      {busy ? '正在打开清单' : '铺货清单与复核'}
    </button>
    {error && <p role="alert" className="text-xs text-red-400 whitespace-normal break-words mt-1">{error}</p>}
    {draft && <CompetitorDistributionDialog draft={draft} onClose={() => setDraft(null)} />}
  </div>;
}
