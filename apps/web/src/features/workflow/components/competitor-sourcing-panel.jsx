import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Download, RefreshCw } from 'lucide-react';
import { CompetitorProductTransfer } from './competitor-product-transfer.jsx';

const SOURCE_REASONS = {
  evidence_needs_refresh: '价格或规格证据缺失、过期，需人工核对',
  missing_identity_or_image: '商品身份或主图证据不足',
  specification_mismatch: '规格不一致',
  missing_similarity: '缺少图片相似度证据',
  similarity_below_threshold: '图片相似度不足',
  source_unavailable: '货源不可用',
  availability_unknown: '库存状态未确认',
  price_not_comparable: '单件价格或计价单位未验证',
  missing_comparable_price: '缺少可比价格',
  price_ratio_not_below_threshold: '价格比例未低于设定值',
  specification_unknown: '规格仍需核对',
  comparable_source_confirmed: '同款规格与可比价格符合条件'
};

async function request(url, body) {
  const response = await fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || '请求失败');
  return result;
}

/**
 * 节点弹窗内选同行商品、确认图搜货源，禁止未确认直接铺货。
 * @param {object} props 运行标识与当前节点。
 * @returns {import('react').JSX.Element} 选品复核表格。
 */
export function CompetitorSourcingPanel({ runId, nodeId, onPrepareSourcing, onSourcingResumed }) {
  const [state, setState] = useState(null);
  const [selected, setSelected] = useState([]);
  const [decisions, setDecisions] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [shop, setShop] = useState('');
  const [ratio, setRatio] = useState('1');
  const base = `/api/workflows/runs/${encodeURIComponent(runId)}/competitor-sourcing`;
  const selecting = nodeId === 'collectCompetitors';
  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const result = await request(base);
      setState({ ...result.data, runtime: result.runtime });
      setSelected(result.data.selectedItemIds || []);
      setRatio(result.data.imagePriceRatioThreshold || '1');
      setDecisions(Object.fromEntries((result.data.decisions || []).map(d => [d.itemId, d])));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }, [base]);
  useEffect(() => { void load(); }, [load, nodeId]);
  const save = async (skip = false) => {
    setBusy(true); setError(''); setMessage('');
    try {
      if (!(selecting ? state?.selectionConfirmed : state?.reviewConfirmed)) await request(`${base}/${selecting ? 'selection' : 'decisions'}`, selecting
        ? { selectedItemIds: selected, skip, imagePriceRatioThreshold: ratio }
        : { decisions: Object.values(decisions) });
      await request(`/api/workflows/runs/${encodeURIComponent(runId)}/resume`, {});
      setMessage('已确认，流程正在继续。');
      if (onSourcingResumed) onSourcingResumed(runId);
      else await load();
    } catch (err) { await load(); setError(err.message); }
    finally { setBusy(false); }
  };
  const products = state?.products || [];
  const prepareSourcing = () => {
    const offers = [...new Set((state?.decisions || []).filter(d => d.action === 'select').map(d => d.offerId))];
    if (!offers.length) { setError('尚未选择货源'); return; }
    if (offers.length > 100) { setError('智能铺货单次最多100件，请先下载选货结果并分批导入'); return; }
    try {
      onPrepareSourcing(offers.map(id => ({ clientId: `competitor-${id}`, url: `https://detail.1688.com/offer/${id}.html`, keyword: '' })));
    } catch (err) { setError(err.message); }
  };
  const exportResults = () => {
    const records = (state?.decisions || []).map(d => {
      const product = products.find(p => p.itemId === d.itemId);
      const candidate = state.results.find(r => r.itemId === d.itemId)?.results?.find(c => c.offerId === d.offerId);
      return [product?.shopName, product?.title, product?.productUrl, d.action === 'skip' ? '已跳过' : '已选择', candidate ? `https://detail.1688.com/offer/${candidate.offerId}.html` : '', candidate?.title, candidate?.priceText, d.riskAccepted ? '人工确认' : ''];
    });
    const cell = value => `"${String(value ?? '').replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`;
    const csv = [['同行店铺', '同行商品', '同行链接', '处理结果', '1688链接', '货源标题', '货源价格', '确认方式'], ...records].map(row => row.map(cell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `同行选货-${runId}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const rows = selecting ? products : products.filter(p => state?.selectedItemIds?.includes(p.itemId));
  const editable = state?.runtime?.activeStep === nodeId && ['needs_review', 'paused', 'blocked', 'failed'].includes(state?.runtime?.status);
  return <div className="grid gap-3 text-xs min-w-0">
    <div className="flex flex-wrap items-center gap-2">
      <label>店铺 <select value={shop} onChange={e => setShop(e.target.value)}><option value="">全部店铺</option>{[...new Set(products.map(p => p.shopName).filter(Boolean))].map(name => <option key={name}>{name}</option>)}</select></label>
      {selecting && <label>货源／同行价格比例小于 <input aria-label="价格比例上限" type="number" min="0.01" step="0.01" value={ratio} disabled={!editable || busy} onChange={e => setRatio(e.target.value)} className="w-20" /></label>}
      <button type="button" title="刷新结果" disabled={busy} onClick={load}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /></button>
      {state?.reviewConfirmed && <button type="button" onClick={exportResults} className="inline-flex items-center gap-1 text-sky-400"><Download size={14} /> 下载选货结果</button>}
      {state?.reviewConfirmed && state?.runtime?.status === 'completed' && onPrepareSourcing && <button type="button" onClick={prepareSourcing} className="inline-flex items-center gap-1 text-sky-400"><ArrowRight size={14} /> 准备标题与铺货</button>}
      <a className="ml-auto inline-flex items-center gap-1 text-sky-400" href={`/api/workflows/runs/${encodeURIComponent(runId)}/artifacts/competitorReport/raw`} download><Download size={14} /> 下载分析报告</a>
    </div>
    {error && <div role="alert" className="text-red-400 break-words">{error}</div>}
    {message && <div role="status" className="text-emerald-400">{message}</div>}
    {selecting ? <CompetitorProductTransfer key={runId} products={products} selected={selected} shop={shop} disabled={!editable || busy || state?.selectionConfirmed} onChange={setSelected} /> : <div className="max-h-[420px] overflow-auto">
      <table className="w-full text-left border-collapse"><thead className="sticky top-0 bg-[var(--bg-panel)]"><tr><th className="p-2">{selecting ? '选择' : '处理'}</th><th className="p-2">同行商品</th><th className="p-2">{selecting ? '来源／价格' : '1688 候选货源'}</th></tr></thead>
        <tbody>{rows.filter(p => !shop || p.shopName === shop).map(p => {
          const result = (state?.results || []).find(r => r.itemId === p.itemId);
          const candidates = result?.results || result?.candidates || [];
          return <tr key={p.itemId} className="border-t border-slate-700 align-top">
            <td className="p-2">{selecting ? <input type="checkbox" aria-label={`选择${p.title}`} style={{ width: 16, height: 16 }} checked={selected.includes(p.itemId)} disabled={!editable || busy || state?.selectionConfirmed || !/^\d+$/.test(p.itemId) || !p.imageUrl || !p.productUrl} onChange={e => setSelected(prev => e.target.checked ? [...prev, p.itemId] : prev.filter(id => id !== p.itemId))} /> : <button disabled={!editable || busy || state?.reviewConfirmed} className="node-secondary-button" onClick={() => setDecisions(prev => ({ ...prev, [p.itemId]: { itemId: p.itemId, action: 'skip' } }))}>{decisions[p.itemId]?.action === 'skip' ? '已跳过' : '跳过'}</button>}</td>
            <td className="p-2 max-w-[320px]">{p.imageUrl && <img src={p.imageUrl} alt="" className="w-14 h-14 object-contain float-left mr-2" />}<a href={p.productUrl} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline break-words">{p.title}</a><div className="text-slate-400 mt-1">{p.shopName} · {p.itemId}</div>{!p.imageUrl && <div className="text-amber-400">缺少主图，不能搜图</div>}</td>
            <td className="p-2">{selecting ? <>{p.sortType === 'new' ? '新品' : '爆款'} · {p.displayPriceText || p.price || '价格待确认'}<div>{p.paymentText || '付款人数未采集'}</div></> : <>
              {result?.error && <div className="text-red-400 break-words">{typeof result.error === 'string' ? result.error : result.error.message}</div>}
              {result?.batchReady && !result.complete && <div className="text-slate-400">当前已加载 {candidates.length} 条候选，非全部搜索结果</div>}
              {candidates.map(c => <div key={c.offerId} className="border-b border-slate-700 py-2">
                <label className="flex items-start gap-2"><input type="radio" style={{ width: 16, height: 16, flexShrink: 0 }} name={`source-${p.itemId}`} disabled={!editable || busy || c.verdict?.level === 'rejected'} checked={decisions[p.itemId]?.offerId === c.offerId && decisions[p.itemId]?.action === 'select'} onChange={() => setDecisions(prev => ({ ...prev, [p.itemId]: { itemId: p.itemId, action: 'select', offerId: c.offerId, riskAccepted: false } }))} />
                  <span><a href={`https://detail.1688.com/offer/${encodeURIComponent(c.offerId)}.html`} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">{c.title || c.offerId}</a><div>{c.priceText || c.displayPriceText || '价格待确认'} · {({ confirmed: '条件通过', suspected: '疑似同款', inconclusive: '待确认', rejected: '不符合' })[c.verdict?.level] || '待确认'}</div><div className="text-slate-400">{SOURCE_REASONS[c.verdict?.reason] || '需人工核对'}</div></span></label>
              </div>)}
              {decisions[p.itemId]?.action === 'select' && <label className="flex items-start gap-2 mt-2"><input type="checkbox" style={{ width: 16, height: 16, flexShrink: 0 }} checked={Boolean(decisions[p.itemId].riskAccepted)} disabled={!editable || busy} onChange={e => setDecisions(prev => ({ ...prev, [p.itemId]: { ...prev[p.itemId], riskAccepted: e.target.checked } }))} />已人工核对规格、起订量与价格，接受未验证风险</label>}
              {!candidates.length && !result?.error && <span>暂无候选结果</span>}
            </>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
    {editable && <div className="sticky bottom-0 bg-[var(--bg-panel)] border-t border-slate-700 pt-3 flex justify-end items-center gap-2">
      {selecting && <><span>已选 {selected.length} 件</span><button disabled={busy} className="node-secondary-button" onClick={() => save(true)}>仅完成分析</button></>}
      <button disabled={busy || (selecting && !state?.selectionConfirmed && selected.length === 0)} className="node-primary-button" onClick={() => save()}>{busy ? '处理中…' : (selecting ? state?.selectionConfirmed : state?.reviewConfirmed) ? '继续流程' : selecting ? '确认并寻找货源' : '确认货源并完成'}</button>
    </div>}
  </div>;
}
