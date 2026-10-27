import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, RefreshCw, X } from 'lucide-react';

/** @param {object} props 当前同行商品及候选。 @returns {import('react').JSX.Element} 独立货源选择弹窗。 */
export function CompetitorSourcePicker({ product, result, decision, disabled, busy, base, reasons, onClose, onConfirm, onRetry }) {
  const dialog = useRef(null);
  const [offerId, setOfferId] = useState(decision?.action === 'select' ? decision.offerId : '');
  const [filter, setFilter] = useState('全部');
  const [sort, setSort] = useState('original');
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement;
    element.showModal();
    return () => { element.close(); if (trigger?.isConnected) trigger.focus(); };
  }, []);
  const candidates = result?.results || result?.candidates || [];
  const selected = candidates.find(c => c.offerId === offerId);
  const labels = ['疑似同款', '外观相似', '明显不同', '无法判断'];
  const comparison = c => result?.comparison?.results?.find(v => v.offerId === c.offerId);
  const label = c => comparison(c)?.label || '无法判断';
  const rows = candidates.filter(c => filter === '全部' || label(c) === filter);
  if (sort === 'recommendation') rows.sort((a, b) => labels.indexOf(label(a)) - labels.indexOf(label(b)));
  return createPortal(<dialog ref={dialog} aria-label="选择1688候选货源" onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
    className="rounded-lg border border-slate-600 p-0 text-xs text-[var(--text-primary,var(--text-body))] bg-[var(--bg-panel)] backdrop:bg-black/60"
    style={{ width: 'min(1000px, calc(100vw - 24px))', height: 'min(780px, calc(100dvh - 24px))', maxWidth: 'none', maxHeight: 'none', margin: 'auto', background: 'var(--bg-panel, #111827)' }}>
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-700 p-4">
        <h2 className="text-base font-semibold">选择1688候选货源</h2><span className="text-slate-400">{candidates.length} 个候选</span>
        <button type="button" className="ml-auto p-2 hover:bg-white/10 rounded" aria-label="关闭候选货源" title="关闭" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="flex shrink-0 items-center gap-3 px-4 py-3 border-b border-slate-700 min-w-0">
        {product.imageUrl && <img src={product.imageUrl} alt="同行商品" className="h-14 w-14 shrink-0 object-contain" />}
        <div className="min-w-0"><div className="text-slate-400">同行商品 · {product.itemId}</div><a href={product.productUrl} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline break-words">{product.title}</a></div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-4 py-2">
        <label>AI判断 <select value={filter} onChange={e => setFilter(e.target.value)}>{['全部', ...labels].map(v => <option key={v}>{v}</option>)}</select></label>
        <label>排序 <select value={sort} onChange={e => setSort(e.target.value)}><option value="original">1688原始顺序</option><option value="recommendation">疑似同款优先</option></select></label>
        {result?.snapshot && <><a className="text-sky-400 hover:underline" href={`${base}/snapshot/${encodeURIComponent(product.itemId)}`} target="_blank" rel="noreferrer">查看对比截图</a><button type="button" disabled={disabled || busy} onClick={() => onRetry(product.itemId)} className="inline-flex items-center gap-1"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} />重新分析截图</button></>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-3">
        {result?.error && <p role="alert" className="text-red-400 break-words">{typeof result.error === 'string' ? result.error : result.error.message}</p>}
        {(result?.snapshotError || result?.comparison?.message) && <p className="text-amber-400 break-words">{result.snapshotError || result.comparison.message}</p>}
        {result?.diagnostics && <details className="py-2 text-slate-400"><summary>查看失败详情</summary>{result.diagnosticsFromPreviousAttempt && <div>上一次上传诊断</div>}<div>{result.diagnostics.stage} · {Math.round(result.diagnostics.elapsedMs / 1000)} 秒</div><div>上传格式：{result.diagnostics.uploadFormat}</div></details>}
        {!rows.length && <p className="py-8 text-center text-slate-400">{candidates.length ? '该筛选条件下没有候选货源' : '暂无候选货源'}</p>}
        {rows.map(c => {
          const visual = comparison(c);
          return <label key={c.offerId} className={`grid grid-cols-[16px_64px_minmax(0,1fr)] gap-3 border-b border-slate-700 py-3 ${offerId === c.offerId ? 'bg-sky-500/10' : 'hover:bg-white/5'}`}>
            <input type="radio" name={`candidate-${product.itemId}`} aria-label={`选择货源 ${c.offerId}`} style={{ width: 16, height: 16, marginTop: 4 }} checked={offerId === c.offerId} disabled={disabled || busy || c.verdict?.level === 'rejected'} onChange={() => setOfferId(c.offerId)} />
            {c.imageUrl ? <img src={c.imageUrl} loading="lazy" alt="候选货源" className="w-16 h-16 object-contain" /> : <span className="text-slate-500">无图片</span>}
            <span className="min-w-0 break-words"><a href={`https://detail.1688.com/offer/${encodeURIComponent(c.offerId)}.html`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-sky-400 hover:underline">{c.title || c.offerId}</a>
              <span className="block mt-1">参考价：{c.priceText || c.displayPriceText || '待确认'} · 起订量：{c.minimumOrderQuantity ?? '待确认'} · {c.offerId}</span>
              <span className="block text-slate-400">{reasons[c.verdict?.reason] || '需人工核对'}</span>
              {visual && <span className="block mt-1"><strong>候选 {visual.number} · {visual.label}</strong> · AI辅助判断<span className="block">{visual.reason}</span><span className="block text-amber-400">{visual.differences}</span></span>}
            </span>
          </label>;
        })}
      </div>
      <footer className="shrink-0 border-t border-slate-700 p-4 flex flex-wrap items-center justify-end gap-3">
        {decision?.action === 'select' && <button type="button" disabled={disabled || busy} className="node-secondary-button" onClick={() => onConfirm({ itemId: product.itemId, action: 'skip' })}>清除已选货源</button>}
        <button type="button" className="node-secondary-button" onClick={onClose}>取消</button>
        <button type="button" className="node-primary-button inline-flex items-center gap-1" disabled={disabled || busy || !selected || selected.verdict?.level === 'rejected'} onClick={() => onConfirm({ itemId: product.itemId, action: 'select', offerId })}><Check size={14} />确认选择</button>
      </footer>
    </div>
  </dialog>, document.body);
}
