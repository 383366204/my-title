import { useState } from 'react';
import { ShieldAlert, CheckCircle2, XCircle, ExternalLink, Loader2, KeyRound } from 'lucide-react';

/**
 * @file ApprovalCard.jsx
 * @description 高危外部副作用授权卡片 (ADR D8 ExecutionApproval)
 * 绑定精确输入摘要 (inputDigest) 与权限令牌 (grantToken)，严禁模型自批自决
 */
export function ApprovalCard({ card, onGrantApproval, onRejectApproval, onInspectStep }) {
  const [submitting, setSubmitting] = useState(false);
  const [decision, setDecision] = useState(null); // 'granted' | 'rejected' | null

  if (!card) return null;

  const {
    runId,
    approvalId,
    actionType = 'distribution.publish',
    inputDigest,
    title,
    summary,
    productCount,
    shopName,
    stepId = 'distribution'
  } = card;

  const handleGrant = async () => {
    if (submitting || decision) return;
    setSubmitting(true);
    try {
      await onGrantApproval?.(card);
      setDecision('granted');
    } catch (_) {
      // 错误由外层全局 toast 捕获
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (submitting || decision) return;
    setSubmitting(true);
    try {
      await onRejectApproval?.(card);
      setDecision('rejected');
    } catch (_) {
      // 错误由外层全局 toast 捕获
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="my-3 rounded-lg border border-rose-500/40 bg-rose-950/20 p-3.5 shadow-lg">
      <div className="flex items-center justify-between gap-2 mb-2 border-b border-rose-900/40 pb-2">
        <div className="flex items-center gap-2 text-rose-400 font-semibold text-xs">
          <ShieldAlert size={15} />
          <span>{title || '高危外部操作授权确认'}</span>
        </div>
        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-rose-950/80 text-rose-300 border border-rose-800">
          <KeyRound size={10} />
          <span>待签署授权</span>
        </span>
      </div>

      <p className="text-xs text-slate-300 leading-relaxed mb-3">
        {summary || '工作流准备向外部店铺提交铺货发布。由于属于不可逆外部写操作，必须由人工显式签署授权令牌后继续。'}
      </p>

      <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-900/60 p-2 rounded mb-3 border border-white/5">
        <div>
          <span className="text-slate-400">操作类型: </span>
          <span className="text-slate-200 font-mono">{actionType}</span>
        </div>
        {productCount !== undefined && (
          <div>
            <span className="text-slate-400">影响商品: </span>
            <span className="text-rose-300 font-bold">{productCount} 件</span>
          </div>
        )}
        {shopName && (
          <div className="col-span-2">
            <span className="text-slate-400">目标店铺: </span>
            <span className="text-slate-200">{shopName}</span>
          </div>
        )}
        {inputDigest && (
          <div className="col-span-2 flex items-center justify-between">
            <span className="text-slate-400">输入指纹: </span>
            <span className="font-mono text-[10px] text-slate-400 truncate max-w-[200px]" title={inputDigest}>
              {inputDigest}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        {decision === 'granted' ? (
          <div className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-xs font-semibold">
            <CheckCircle2 size={13} />
            <span>已授权执行</span>
          </div>
        ) : decision === 'rejected' ? (
          <div className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded bg-rose-900/30 text-rose-400 border border-rose-800/40 text-xs font-semibold">
            <XCircle size={13} />
            <span>已拒绝授权</span>
          </div>
        ) : (
          <>
            <button
              type="button"
              disabled={submitting}
              onClick={handleGrant}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded bg-rose-600 hover:bg-rose-500 text-white active:bg-rose-700 text-xs font-semibold cursor-pointer transition-colors disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>处理中...</span>
                </>
              ) : (
                <>
                  <ShieldAlert size={13} />
                  <span>签署并授权发布</span>
                </>
              )}
            </button>

            <button
              type="button"
              disabled={submitting}
              onClick={handleReject}
              className="py-1.5 px-3 rounded border border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white text-xs cursor-pointer transition-colors disabled:opacity-50"
            >
              拒绝
            </button>
          </>
        )}

        <button
          type="button"
          onClick={() => onInspectStep?.(stepId)}
          className="flex items-center gap-1 py-1.5 px-2.5 rounded border border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white text-xs cursor-pointer transition-colors"
          title="在画布中查看步骤详情"
        >
          <span>查看</span>
          <ExternalLink size={12} />
        </button>
      </div>
    </div>
  );
}
