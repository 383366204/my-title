import { useState } from 'react';
import { AlertCircle, CheckCircle, ExternalLink, Loader2, Sparkles } from 'lucide-react';

export function ReviewCard({ card, onConfirmReview, onInspectStep }) {
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  if (!card) return null;

  const { runId, stepId, version, title, summary, candidateCount, draftDecisions } = card;

  const handleConfirm = async () => {
    if (confirming || confirmed) return;
    setConfirming(true);
    try {
      await onConfirmReview?.(card);
      setConfirmed(true);
    } catch (_) {
      // 错误由外层全局 toast 处理
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="my-3 rounded-lg border border-amber-500/40 bg-amber-950/20 p-3.5 shadow-lg">
      <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs mb-2">
        <AlertCircle size={15} />
        <span>{title || `业务阶段复核待确认 (${stepId})`}</span>
      </div>

      <p className="text-xs text-slate-300 leading-relaxed mb-3">
        {summary || '工作流已在关键复核检查点暂停，等待人工核验与决策。'}
      </p>

      <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-900/60 p-2 rounded mb-3 border border-white/5">
        <div>
          <span className="text-slate-400">复核步骤: </span>
          <span className="text-slate-200 font-medium">{stepId}</span>
        </div>
        {candidateCount !== undefined && (
          <div>
            <span className="text-slate-400">候选数量: </span>
            <span className="text-amber-300 font-bold">{candidateCount} 个</span>
          </div>
        )}
      </div>

      {draftDecisions && Object.keys(draftDecisions).length > 0 && (
        <div className="mb-3 text-[11px] text-slate-400 bg-slate-900/40 p-2 rounded border border-white/5">
          <div className="flex items-center gap-1 text-sky-400 mb-1 font-medium">
            <Sparkles size={12} />
            <span>AI 初筛建议已就绪</span>
          </div>
          <span>已根据市场竞争度与搜索量初筛最佳候选，可直接确认采用。</span>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          disabled={confirming || confirmed}
          onClick={handleConfirm}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded text-xs font-semibold cursor-pointer transition-colors ${
            confirmed
              ? 'bg-emerald-600 text-white cursor-default'
              : 'bg-amber-600 hover:bg-amber-500 text-white active:bg-amber-700 disabled:opacity-50'
          }`}
        >
          {confirming ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              <span>正在推进...</span>
            </>
          ) : confirmed ? (
            <>
              <CheckCircle size={13} />
              <span>复核已确认通过</span>
            </>
          ) : (
            <>
              <Sparkles size={13} />
              <span>采纳建议并推进</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={() => onInspectStep?.(stepId)}
          className="flex items-center gap-1 py-1.5 px-2.5 rounded border border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white text-xs cursor-pointer transition-colors"
          title="在中间画布打开该步骤查看完整数据"
        >
          <span>在画布中查看</span>
          <ExternalLink size={12} />
        </button>
      </div>
    </div>
  );
}
