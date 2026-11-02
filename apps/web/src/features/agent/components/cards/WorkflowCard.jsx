import { CheckCircle2, Clock, Play, Square, ExternalLink } from 'lucide-react';

export function WorkflowCard({ card, onSelectStep }) {
  if (!card) return null;

  const { runId, status, currentStep, message, summary } = card;
  const isNeedsReview = status === 'needs_review';
  const isCompleted = status === 'completed';
  const isRunning = status === 'running';

  return (
    <div className="my-2.5 rounded-lg border border-slate-700 bg-slate-900/80 p-3 shadow-md">
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2 mb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
          <Clock size={14} className="text-blue-400" />
          <span>选品工作流状态</span>
        </div>
        <span
          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${
            isNeedsReview
              ? 'bg-amber-950 text-amber-300 border border-amber-800'
              : isCompleted
              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
              : 'bg-blue-950 text-blue-300 border border-blue-800'
          }`}
        >
          {isNeedsReview ? '待人工复核' : isCompleted ? '执行完成' : isRunning ? '正在运行' : status}
        </span>
      </div>

      <div className="grid gap-1.5 text-xs text-slate-300">
        {runId && (
          <div className="flex items-center justify-between">
            <span className="text-slate-400">运行 ID:</span>
            <span className="font-mono text-[11px] text-slate-200">{runId}</span>
          </div>
        )}
        {currentStep && (
          <div className="flex items-center justify-between">
            <span className="text-slate-400">当前步骤:</span>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 hover:underline cursor-pointer"
              onClick={() => onSelectStep?.(currentStep)}
              title="在中间画布定位此节点"
            >
              <span>{currentStep}</span>
              <ExternalLink size={11} />
            </button>
          </div>
        )}
        {(message || summary) && (
          <div className="mt-1 text-[11px] text-slate-300 leading-relaxed bg-slate-800/50 p-2 rounded">
            {message || summary}
          </div>
        )}
      </div>
    </div>
  );
}
