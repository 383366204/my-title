import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Save } from 'lucide-react';
import { getPeerReview, savePeerReview, allocatePeerReview } from '../../../api/peer-review-api.js';
import { listDistributionShops } from '../../../api/distribution-api.js';
import './peer-review-panel.css';

/**
 * 同行选货草稿复核和本地分配预览。
 * @param {object} props 运行标识。
 * @returns {import('react').ReactNode} 复核面板。
 */
export function PeerReviewPanel({ runId }) {
  const [review, setReview] = useState(null);
  const [shops, setShops] = useState([]);
  const [shopIds, setShopIds] = useState([]);
  const [offerIds, setOfferIds] = useState([]);
  const [edits, setEdits] = useState({});
  const [mode, setMode] = useState('sequential-average');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const load = async () => {
    const data = await getPeerReview(runId);
    const configured = (await listDistributionShops()).filter(shop => shop.enabled);
    if (!mounted.current) return;
    setReview(data);
    setShops(configured);
    setShopIds(configured.map(shop => shop.id));
    setOfferIds([...new Set(data.bundle.activeDrafts.map(draft => draft.offerId))]);
    setEdits({});
  };
  useEffect(() => {
    mounted.current = true;
    load().catch(err => { if (mounted.current) setError(err.message); })
      .finally(() => { if (mounted.current) setBusy(false); });
    return () => { mounted.current = false; };
  }, [runId]);
  const perform = async operation => {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    setBusy(true); setError(''); setNotice('');
    try { await operation(); }
    catch (err) { if (mounted.current) setError(err.message); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const toggle = (set, id) => set(values => values.includes(id) ? values.filter(value => value !== id) : [...values, id]);
  const change = (key, field, value) => {
    setEdits(previous => ({ ...previous, [key]: { ...previous[key], [field]: value } }));
    setReview(previous => ({ ...previous, allocationPlan: null }));
  };
  const save = () => perform(async () => {
    const result = await savePeerReview(runId, { expectedDraftRevision: review.bundle.draftRevision, edits });
    if (!mounted.current) return;
    setReview(previous => ({ ...previous, bundle: result.bundle, allocationPlan: null }));
    setEdits({}); setNotice('草稿已保存');
  });
  const allocate = () => perform(async () => {
    const result = await allocatePeerReview(runId, {
      expectedDraftRevision: review.bundle.draftRevision, offerIds, shopIds, mode,
      shopRevisions: Object.fromEntries(shops.map(shop => [shop.id, shop.revision])),
    });
    if (mounted.current) setReview(previous => ({ ...previous, allocationPlan: result.plan }));
  });
  const invalidatePlan = () => setReview(previous => previous ? { ...previous, allocationPlan: null } : previous);
  return <div className="peer-review-panel" aria-busy={busy}>
    <div className="peer-review-toolbar">
      <button type="button" disabled={busy} onClick={() => perform(load)} title="重新加载草稿，放弃未保存修改"><RefreshCw size={14} /> 刷新</button>
      <span role="status">{busy ? '处理中…' : notice}</span>
    </div>
    {error && <p role="alert" className="peer-review-error">{error}</p>}
    {review && <>
      <div className="peer-review-table-wrap"><table>
        <thead><tr><th>选择</th><th>商品</th><th>铺货标题</th><th>淘宝类目</th><th>复核</th></tr></thead>
        <tbody>{review.bundle.activeDrafts.map(draft => <tr key={draft.draftKey}>
          <td><input type="checkbox" aria-label={`选择商品 ${draft.offerId}`} disabled={busy} checked={offerIds.includes(draft.offerId)} onChange={() => { toggle(setOfferIds, draft.offerId); invalidatePlan(); }} /></td>
          <td><a href={`https://detail.1688.com/offer/${encodeURIComponent(draft.offerId)}.html`} target="_blank" rel="noreferrer">{draft.offerId}</a></td>
          <td><input aria-label={`标题 ${draft.offerId}`} disabled={busy} value={edits[draft.draftKey]?.title ?? draft.title ?? ''} onChange={event => change(draft.draftKey, 'title', event.target.value)} /></td>
          <td><input aria-label={`类目 ${draft.offerId}`} disabled={busy} value={edits[draft.draftKey]?.category ?? draft.category ?? ''} onChange={event => change(draft.draftKey, 'category', event.target.value)} /></td>
          <td>{draft.needsInput ? <button disabled={busy} type="button" onClick={() => change(draft.draftKey, 'title', edits[draft.draftKey]?.title ?? draft.title ?? '')}>{edits[draft.draftKey] ? '待保存确认' : '确认内容'}</button> : '已确认'}</td>
        </tr>)}</tbody>
      </table></div>
      <fieldset disabled={busy}><legend>目标店铺</legend>
        {!shops.length && <p>暂无已启用店铺，请先配置铺货店铺。</p>}
        {shops.map(shop => <label key={shop.id}><input type="checkbox" checked={shopIds.includes(shop.id)} onChange={() => { toggle(setShopIds, shop.id); invalidatePlan(); }} />{shop.name || shop.platformShopName}</label>)}
      </fieldset>
      <fieldset disabled={busy}><legend>商品分配方式</legend>
        {[['sequential-average', '顺序平均分配'], ['random-average', '随机平均分配'], ['random', '随机分配'], ['repeat', '重复分配']].map(([value, label]) => <label key={value}><input type="radio" name="peer-allocation-mode" value={value} checked={mode === value} onChange={() => { setMode(value); invalidatePlan(); }} />{label}</label>)}
      </fieldset>
      {review.allocationPlan && <section aria-label="分配预览"><strong>分配预览</strong>{review.allocationPlan.counts.map(row => <p key={row.targetShopId}>{shops.find(shop => shop.id === row.targetShopId)?.name || row.targetShopId}：{row.count} 件</p>)}</section>}
      <footer>
        <span>已选 {offerIds.length} 件商品 · {shopIds.length} 家店铺</span>
        <button type="button" disabled={busy || !Object.keys(edits).length} onClick={save}><Save size={14} /> 保存复核</button>
        <button type="button" disabled={busy || Object.keys(edits).length > 0 || !offerIds.length || !shopIds.length} onClick={allocate}>生成分配预览</button>
      </footer>
    </>}
  </div>;
}
