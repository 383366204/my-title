import { Clock, RefreshCw, Trash2 } from 'lucide-react';

import { getUnifiedWorkflowHistoryItem } from '../workflow-history-view.js';

const statusStyles = {
  running: 'bg-blue-500/12 text-blue-400',
  completed: 'bg-emerald-500/14 text-emerald-300',
  ready: 'bg-teal-500/14 text-teal-300',
  paused: 'bg-amber-500/14 text-amber-400',
  failed: 'bg-rose-500/12 text-rose-400',
};

function formatDateTime(value) {
  if (!value) return '未知时间';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function WorkflowHistory({ currentRunId, deletingRunId, error, loading, runs = [], onDelete, onOpen, onRefresh }) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-2">
      <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
        <Clock size={12} /> 运行历史
      </h2>
      <button onClick={onRefresh} className="w-full py-2 rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 font-semibold flex items-center justify-center gap-1.5">
        <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> 刷新历史
      </button>
      {error && <div className="rounded-lg p-3 text-xs leading-[1.55] border border-rose-500/35 bg-red-900/20 text-rose-200">{error}</div>}
      {runs.length === 0 ? <div className="text-xs text-slate-500 italic p-2">暂无历史执行记录</div> : (
        <div className="space-y-1.5">
          {runs.map((run) => {
            const item = getUnifiedWorkflowHistoryItem(run);
            const isActive = currentRunId === item.runId;
            return (
              <div className="flex items-stretch gap-1.5" key={item.runId}>
                <button
                  type="button"
                  data-testid="monitor-run-card"
                  onClick={() => onOpen(item.runId)}
                  className={`flex-1 text-left p-2.5 rounded-lg border text-xs transition-all duration-[160ms] ease-in-out ${
                    isActive
                      ? 'bg-blue-700/[0.28] border-blue-500 text-slate-400'
                      : 'border-slate-800/90 bg-slate-800/[0.42] text-slate-400 hover:bg-blue-700/[0.28] hover:border-blue-500'
                  }`}
                >
                  <div className="flex justify-between items-center font-mono text-[10px] text-slate-400 mb-1">
                    <span className="truncate w-36">{item.runId}</span>
                    <span className={`inline-flex items-center min-h-[20px] max-w-[132px] px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase whitespace-nowrap overflow-hidden text-ellipsis ${statusStyles[item.visualState] || ''}`}>{item.statusLabel}</span>
                  </div>
                  <div className="font-semibold text-slate-200 truncate">{item.title}</div>
                  <div className="text-[11px] text-slate-500 mt-1">{item.subtitle}</div>
                  <div className="text-[10px] text-slate-500 mt-1">{formatDateTime(item.updatedAt)}</div>
                </button>
                <button type="button" className="workflow-history-delete-button" title="删除运行历史" aria-label={`删除运行历史 ${item.runId}`} disabled={deletingRunId === item.runId} onClick={() => onDelete(item.runId)}>
                  {deletingRunId === item.runId ? <RefreshCw size={14} className="mx-auto animate-spin" /> : <Trash2 size={14} className="mx-auto" />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
