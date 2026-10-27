import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { DistributionExportPanel } from './distribution-export-panel.jsx';

/** @param {object} props 已确认选货清单。 @returns {import('react').JSX.Element} 复用铺货复核的弹窗。 */
export function CompetitorDistributionDialog({ draft, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const trigger = document.activeElement;
    const dialog = ref.current;
    dialog.showModal();
    return () => { dialog.close(); if (trigger?.isConnected) trigger.focus(); };
  }, []);
  return createPortal(<dialog ref={ref} aria-label="铺货清单与复核" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} onCancel={e => { e.preventDefault(); e.stopPropagation(); onClose(); }}
    className="rounded-lg border border-slate-600 p-0 text-[var(--text-primary,var(--text-body))] backdrop:bg-black/60"
    style={{ width: 'min(1100px, calc(100vw - 24px))', height: 'min(850px, calc(100dvh - 24px))', maxWidth: 'none', maxHeight: 'none', margin: 'auto', background: 'var(--bg-panel, #111827)' }}>
    <div className="flex h-full min-h-0 flex-col"><header className="p-4 border-b border-slate-700 flex items-center justify-between"><h2 className="text-base font-semibold">铺货清单与复核</h2><button type="button" aria-label="关闭铺货清单" title="关闭" onClick={onClose}><X size={18} /></button></header>
      <div className="min-h-0 flex-1 overflow-auto p-4"><DistributionExportPanel key={draft.runId} currentRunId={draft.runId} sourceNodeId="generate" useDraftRows directPreview
        artifactState={{ status: 'ready', artifact: { type: 'jsonl', nodeId: 'generate', runId: draft.runId, rows: draft.rows } }}
        workflowRunStatus={draft.status === 'workflow_complete' ? 'completed' : 'needs_review'}
        onCopyText={text => navigator.clipboard.writeText(text)} onManualComplete={onClose} />
      </div>
    </div>
  </dialog>, document.body);
}
