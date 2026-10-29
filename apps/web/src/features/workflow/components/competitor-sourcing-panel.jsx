import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Download, RefreshCw } from 'lucide-react';
import { CompetitorProductTransfer } from './competitor-product-transfer.jsx';
import { CompetitorSourcePicker } from './competitor-source-picker.jsx';
import { CompetitorDistributionDialog } from './competitor-distribution-dialog.jsx';

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
  const [pickerItemId, setPickerItemId] = useState(null);
  const [distributionDraft, setDistributionDraft] = useState(null);
  const base = `/api/workflows/runs/${encodeURIComponent(runId)}/competitor-sourcing`;
  const selecting = nodeId === 'collectCompetitors';
  const load = useCallback(async ({ preserveDecisions = false } = {}) => {
    setBusy(true); setError('');
    try {
      const result = await request(base);
      setState({ ...result.data, runtime: result.runtime });
      setSelected(result.data.selectedItemIds || []);
      setRatio(result.data.imagePriceRatioThreshold || '1');
      setDecisions(prev => preserveDecisions ? prev : Object.fromEntries((result.data.decisions || []).map(d => [d.itemId, d])));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }, [base]);
  useEffect(() => { void load(); }, [load, nodeId]);
  const save = async (skip = false) => {
    setBusy(true); setError(''); setMessage('');
    try {
      if (!(selecting ? state?.selectionConfirmed : state?.reviewConfirmed)) await request(`${base}/${selecting ? 'selection' : 'decisions'}`, selecting
        ? { selectedItemIds: selected, skip, imagePriceRatioThreshold: ratio }
        : { decisions: (state?.selectedItemIds || []).map(itemId => decisions[itemId]?.action === 'select'
          ? decisions[itemId] : { itemId, action: 'skip' }) });
      await request(`/api/workflows/runs/${encodeURIComponent(runId)}/resume`, {});
      setMessage('已确认，流程正在继续。');
      if (onSourcingResumed) onSourcingResumed(runId);
      else await load();
    } catch (err) { await load(); setError(err.message); }
    finally { setBusy(false); }
  };
  const retrySourcing = async () => {
    setBusy(true); setError('');
    try {
      await request(`/api/workflows/runs/${encodeURIComponent(runId)}/resume`, {});
      if (onSourcingResumed) onSourcingResumed(runId);
      else await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const retryComparison = async itemId => {
    setBusy(true); setError('');
    try { await request(`${base}/compare/${encodeURIComponent(itemId)}`, {}); await load({ preserveDecisions: true }); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const products = state?.products || [];
  const openDistribution = async () => {
    setBusy(true); setError('');
    try { const response = await request(`${base}/distribution`, {}); setDistributionDraft(response.data); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const pickerProduct = products.find(p => p.itemId === pickerItemId);
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
  const chosenCount = rows.filter(p => decisions[p.itemId]?.action === 'select').length;
  return <div className="grid gap-3 text-xs min-w-0">
    <div className="flex flex-wrap items-center gap-2">
      <label>店铺 <select value={shop} onChange={e => setShop(e.target.value)}><option value="">全部店铺</option>{[...new Set(products.map(p => p.shopName).filter(Boolean))].map(name => <option key={name}>{name}</option>)}</select></label>
      {selecting && <label>货源／同行价格比例小于 <input aria-label="价格比例上限" type="number" min="0.01" step="0.01" value={ratio} disabled={!editable || busy} onChange={e => setRatio(e.target.value)} className="w-20" /></label>}
      <button type="button" title="刷新结果" disabled={busy} onClick={load}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /></button>
      {state?.reviewConfirmed && <button type="button" onClick={exportResults} className="inline-flex items-center gap-1 text-sky-400"><Download size={14} /> 下载选货结果</button>}
      {state?.reviewConfirmed && state?.runtime?.status === 'completed' && onPrepareSourcing && <button type="button" onClick={prepareSourcing} className="inline-flex items-center gap-1 text-sky-400"><ArrowRight size={14} /> 准备标题与铺货</button>}
      {state?.reviewConfirmed && <button type="button" disabled={busy || !(state.decisions || []).some(d => d.action === 'select')} className="node-primary-button ml-auto" onClick={openDistribution}>铺货清单与复核</button>}
    </div>
    {error && <div role="alert" className="text-red-400 break-words">{error}</div>}
    {message && <div role="status" className="text-emerald-400">{message}</div>}
    {selecting ? <CompetitorProductTransfer key={runId} products={products} selected={selected} shop={shop} disabled={!editable || busy || state?.selectionConfirmed} onChange={setSelected} /> : <div className="max-h-[420px] overflow-auto">
      <table className="w-full text-left border-collapse" style={{ minWidth: 640, tableLayout: 'fixed' }}>
        <thead className="sticky top-0 bg-[var(--bg-panel)]"><tr><th className="p-2 w-[40%]">同行商品</th><th className="p-2 w-[35%]">已选货源</th><th className="p-2 w-[25%] text-right">操作</th></tr></thead>
        <tbody>{rows.filter(p => !shop || p.shopName === shop).map(p => {
          const result = state?.results?.find(r => r.itemId === p.itemId);
          const candidates = result?.results || result?.candidates || [];
          const decision = decisions[p.itemId];
          const chosen = decision?.action === 'select' ? candidates.find(c => c.offerId === decision.offerId) : null;
          return <tr key={p.itemId} className="border-t border-slate-700 align-top">
            <td className="p-2"><div className="flex gap-2 min-w-0">{p.imageUrl && <img src={p.imageUrl} alt="" className="w-12 h-12 shrink-0 object-contain" />}<div className="min-w-0 break-words"><a href={p.productUrl} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">{p.title}</a><div className="text-slate-400 mt-1">{p.shopName} · {p.itemId}</div><div>参考价：{p.displayPriceText || p.price || '待确认'}</div></div></div></td>
            <td className="p-2">{chosen ? <div className="flex gap-2 min-w-0">{chosen.imageUrl && <img src={chosen.imageUrl} alt="已选货源" className="w-12 h-12 shrink-0 object-contain" />}<div className="min-w-0 break-words"><a className="text-sky-400 hover:underline" href={`https://detail.1688.com/offer/${encodeURIComponent(chosen.offerId)}.html`} target="_blank" rel="noreferrer">{chosen.title || chosen.offerId}</a><div>参考价：{chosen.priceText || chosen.displayPriceText || '待确认'}</div><div className="text-emerald-400">已选择{state?.reviewConfirmed ? '' : ' · 待提交'}</div></div></div> : <span className="text-slate-400">{decision?.action === 'skip' ? '已跳过' : '尚未选择'}</span>}
              {result?.error && <div className="text-red-400 mt-1 break-words">寻源异常，请查看候选货源详情</div>}
            </td>
            <td className="p-2 align-middle"><div className="flex justify-end"><button type="button" className="node-primary-button" disabled={busy} onClick={() => setPickerItemId(p.itemId)}>{state?.reviewConfirmed || !editable ? '查看候选货源' : chosen ? '更换候选货源' : '选择候选货源'}（{candidates.length}）</button></div></td>
          </tr>;
        })}</tbody>
      </table>
      {!rows.length && <p className="p-6 text-center text-slate-400">暂无同行商品</p>}
    </div>}
    {pickerProduct && <CompetitorSourcePicker key={`${runId}-${pickerProduct.itemId}`} product={pickerProduct} result={state?.results?.find(r => r.itemId === pickerProduct.itemId)} decision={decisions[pickerProduct.itemId]} disabled={!editable || Boolean(state?.reviewConfirmed)} busy={busy} base={base} reasons={SOURCE_REASONS} onRetry={retryComparison} onClose={() => setPickerItemId(null)} onConfirm={decision => { setDecisions(prev => ({ ...prev, [decision.itemId]: decision })); setPickerItemId(null); }} />}
    {distributionDraft && <CompetitorDistributionDialog draft={distributionDraft} onClose={() => setDistributionDraft(null)} />}
    {editable && <div className="sticky bottom-0 bg-[var(--bg-panel)] border-t border-slate-700 pt-3 flex justify-end items-center gap-2">
      {!selecting && <span className="mr-auto text-slate-400">已选 {chosenCount} 件 · 未选 {rows.length - chosenCount} 件（确认时跳过）</span>}
      {!selecting && ['blocked', 'failed', 'paused'].includes(state?.runtime?.status) && <button disabled={busy} className="node-secondary-button inline-flex items-center gap-1" onClick={retrySourcing}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} />重试当前商品</button>}
      {selecting && <><span>已选 {selected.length} 件</span><button disabled={busy} className="node-secondary-button" onClick={() => save(true)}>仅完成分析</button></>}
      <button disabled={busy || (selecting && !state?.selectionConfirmed && selected.length === 0)} className="node-primary-button" onClick={() => save()}>{busy ? '处理中…' : (selecting ? state?.selectionConfirmed : state?.reviewConfirmed) ? '继续流程' : selecting ? '确认并寻找货源' : '确认货源并完成'}</button>
    </div>}
  </div>;
}
