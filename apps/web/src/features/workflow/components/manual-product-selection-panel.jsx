import { useEffect, useMemo, useState } from 'react';
import { Check, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { resolve1688Share } from '../../../api/workflow-api.js';

import { artifactItems } from '../workflow-data.js';
import { productSelectionView } from '../product-selection-view.js';

export const ManualProductSelectionPanel = ({ artifactState, currentRunId, onConfirm, onRetry, canRetry = false }) => {
  const { products: rows, failures } = useMemo(() => productSelectionView(artifactItems(artifactState)), [artifactState]);
  const [selected, setSelected] = useState({});
  const [manualProducts, setManualProducts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [directUrls, setDirectUrls] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    setSelected(Object.fromEntries(rows.map((row, index) => [
      `${row.url || row.product?.['产品链接'] || row.product?.url || index}`,
      row.status === 'selected' || row.manualSelectionStatus === 'approved'
    ])));
  }, [rows]);

  const rowKey = (row, index) => `${row.url || row.product?.['产品链接'] || row.product?.url || index}`;
  const toggle = (key) => setSelected((current) => ({ ...current, [key]: !current[key] }));
  const updateProduct = (index, key, value) => setManualProducts(current => current.map((row, i) => i === index ? { ...row, [key]: value } : row));
  const importProducts = async () => {
    setBusy(true);
    setMessage('');
    const incoming = [];
    const failed = [];
    const seen = new Set(manualProducts.map(row => row.url));
    let duplicates = 0;
    const keywords = [...new Set(rows.map(row => row.keyword).filter(Boolean))];
    for (const line of directUrls.split(/\r?\n/).map(item => item.trim()).filter(Boolean)) {
      try {
        const product = await resolve1688Share(line);
        if (!product?.url) throw new Error('未识别到商品链接');
        if (seen.has(product.url)) { duplicates++; continue; }
        seen.add(product.url);
        incoming.push({ url: product.url, title: '', category: '', keyword: keywords.length === 1 ? keywords[0] : '' });
      } catch (error) {
        failed.push({ line, error: error.message });
      }
    }
    setManualProducts(current => [...current, ...incoming]);
    setDirectUrls(failed.map(item => item.line).join('\n'));
    setMessage(`已加入 ${incoming.length} 个商品${duplicates ? `，忽略 ${duplicates} 个重复链接` : ''}${failed.length ? `；${failed.length} 条解析失败，已保留：${failed.map(item => item.error).join('；')}` : ''}`);
    setBusy(false);
  };
  const submit = async () => {
    if (busy) return;
    if (directUrls.trim()) { setMessage('请先将输入的链接加入列表，再确认。'); return; }
    const approvedProductIds = rows.map(rowKey).filter(key => selected[key]);
    const incomplete = manualProducts.findIndex(row => !row.keyword.trim() || !row.title.trim() || !row.category.trim());
    if (incomplete >= 0) { setMessage(`请补全第 ${incomplete + 1} 个补充货源的标题、关联关键词和铺货类目。`); return; }
    if (approvedProductIds.length === 0 && manualProducts.length === 0) {
      setMessage('请至少勾选一个商品，或粘贴有效的 1688 商品 URL。');
      return;
    }
    setMessage('');
    setBusy(true);
    try { await onConfirm({ approvedProductIds, manualProducts }); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid gap-3">
      <section className="grid gap-2.5 p-3 border border-slate-800/90 rounded-lg bg-slate-950/[0.42]">
        <div className="flex items-center justify-between gap-2.5">
          <span className="shrink-0 text-[var(--text-muted)] text-[10px]">{rows.filter((row, index) => selected[rowKey(row, index)]).length} 个已选 / {rows.length} 个商品</span>
        </div>
        <div className="grid gap-[7px] max-h-[250px] overflow-auto">
          <div className="sticky top-0 z-[1] grid grid-cols-[18px_minmax(0,1fr)] gap-2 px-[9px] py-1.5 border border-transparent bg-[var(--bg-panel,#111827)] text-[var(--text-muted,#94a3b8)] text-[11px] font-semibold">
            <span aria-label="选择商品" />
            <div className="min-w-0 grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)] items-center gap-2.5 leading-5"><span>商品标题</span><span>关键词／类目</span><span>商品链接</span></div>
          </div>
          {rows.map((row, index) => {
            const product = row.product || row;
            const url = row.url || row.productUrl || product['产品链接'] || product.url || '';
            const title = row.sourceTitle || row.title || product['链接原标题'] || product.title || '未命名商品';
            const key = rowKey(row, index);
            return (
              <label data-testid="manual-product-choice" className="grid gap-2 p-[9px] border border-slate-800/[0.86] rounded-lg bg-slate-900/[0.62] grid-cols-[18px_minmax(0,1fr)] items-center px-[9px] py-1.5 cursor-pointer" key={key}>
                <input type="checkbox" checked={Boolean(selected[key])} onChange={() => toggle(key)} className="w-4 h-4 m-0 p-0 justify-self-start accent-blue-500" />
                <div className="min-w-0 grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)] items-center gap-2.5 leading-5">
                  <strong title={title} className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[var(--text-body)] text-xs">{title}</strong>
                  <span title={`关联关键词：${row.keyword || '手动货源'}；类目：${row.recommendedCategory || '未获取，铺货前需补充'}`} className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[var(--text-muted)] text-[10px]">{row.keyword || '手动货源'} · {row.recommendedCategory || '类目未获取'}</span>
                  <a href={url} title={url} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()} className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-blue-400 underline underline-offset-[3px] transition-colors duration-[120ms] hover:text-blue-300 focus-visible:text-blue-300 focus-visible:outline-2 focus-visible:outline-blue-400 focus-visible:-outline-offset-2">{url}</a>
                </div>
              </label>
            );
          })}
          {rows.length === 0 && <div className="artifact-empty">{failures.length ? '货源查询失败，尚未取得商品。下方是失败原因，不是商品清单。' : '暂无 1688 搜索结果，请手动添加商品。'}</div>}
        </div>
        {failures.length > 0 && <section className="artifact-error" aria-label="货源查询失败">
          <strong>{failures.length} 条查询或资料读取失败</strong>
          {failures.map((row, index) => <p key={`${row.keyword}-${index}`}>{row.keyword || '商品资料'}：{row.error}</p>)}
          <button type="button" className="node-secondary-button" disabled={!canRetry} onClick={onRetry}><RefreshCw size={13} />重试货源查询</button>
        </section>}
      </section>
      <section className="grid gap-2.5 p-3 border border-slate-800/90 rounded-lg bg-slate-950/[0.42]">
        <div className="flex items-center justify-between gap-2.5"><strong className="min-w-0 text-[var(--text-body)] text-xs">补充货源</strong><span className="shrink-0 text-[var(--text-muted)] text-[10px]">{manualProducts.length} 个商品</span></div>
        <textarea
          className="node-field-textarea"
          rows="4"
          value={directUrls}
          disabled={busy}
          onChange={(event) => setDirectUrls(event.target.value)}
          aria-label="补充货源链接"
          placeholder="1688 商品链接或手机分享口令，一行一个"
        />
        <button type="button" className="node-secondary-button" disabled={busy || !directUrls.trim()} onClick={importProducts}><Plus size={13} />{busy ? '处理中…' : '加入列表'}</button>
        <div className="max-h-[420px] overflow-y-auto min-h-0">
          {manualProducts.map((product, index) => <div data-testid="supplemental-product-row" className="py-3 border-b border-[var(--border-color,#374151)] [&_input]:min-w-0 [&_input]:w-full [&_input]:box-border" key={product.url}>
            <div className="flex items-center justify-between gap-2.5"><a href={product.url} target="_blank" rel="noreferrer" className="min-w-0 text-[var(--text-body)] text-xs">商品 {index + 1}</a><button type="button" className="node-icon-button danger" title={`移除补充货源 ${index + 1}`} disabled={busy} onClick={() => setManualProducts(current => current.filter((_, i) => i !== index))}><Trash2 size={14} /></button></div>
            {[[ 'title', '商品标题' ], [ 'keyword', '关联关键词' ], [ 'category', '铺货类目（淘宝／生意参谋）' ]].map(([key, label]) => <label className="node-field" key={key}><span>{label}</span><input disabled={busy} value={product[key]} onChange={event => updateProduct(index, key, event.target.value)} /></label>)}
          </div>)}
        </div>
        <div className="keyword-review-actions">
          <button type="button" className="node-primary-button" disabled={!currentRunId || busy} onClick={submit}>
            <Check size={13} /> 确认并继续生成标题
          </button>
          <button type="button" className="node-secondary-button" disabled={!canRetry} onClick={onRetry}>
            <RefreshCw size={13} /> 重新搜索货源
          </button>
        </div>
        {message && <div role="status" className="px-3 py-2.5 border border-[#355178] rounded-[5px] bg-[#10213a] text-[#bfdbfe] text-xs">{message}</div>}
      </section>
    </div>
  );
};
