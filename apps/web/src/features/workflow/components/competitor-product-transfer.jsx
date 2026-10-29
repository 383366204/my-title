import { useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';

/**
 * 商品穿梭选择；全选和批量移动仅作用于当前筛选结果。
 * @param {object} props 商品、已选ID及选择更新回调。
 * @returns {import('react').JSX.Element} 待选和已选商品列表。
 */
export function CompetitorProductTransfer({ products, selected, shop, disabled, onChange }) {
  const [marked, setMarked] = useState(new Set());
  const [query, setQuery] = useState('');
  const selectedIds = new Set(selected);
  const eligible = product => /^\d+$/.test(product.itemId) && Boolean(product.imageUrl && product.productUrl);
  const move = (ids, keep) => {
    const next = new Set(selected);
    for (const id of ids) {
      if (keep) next.add(id); else next.delete(id);
    }
    onChange([...next]);
    setMarked(new Set());
  };
  const toggle = id => setMarked(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return <div className="grid gap-3 min-w-0">
    <input type="search" aria-label="搜索同行商品" placeholder="搜索商品标题或ID" value={query} onChange={event => setQuery(event.target.value)} />
    <div className="keyword-transfer">
      {[false, true].map(kept => {
        const name = kept ? '已选商品' : '待选商品';
        const side = products.filter(product => selectedIds.has(product.itemId) === kept);
        const visible = side.filter(product => (!shop || product.shopName === shop)
          && `${product.title || ''} ${product.itemId}`.toLowerCase().includes(query.trim().toLowerCase()));
        const movable = visible.filter(product => kept || eligible(product));
        const checked = movable.filter(product => marked.has(product.itemId)).map(product => product.itemId);
        const all = movable.length > 0 && checked.length === movable.length;
        const Icon = kept ? ArrowLeft : ArrowRight;
        return <section key={name} className={`keyword-transfer-pane ${kept ? 'is-approved' : ''}`} aria-label={name}>
          <header><strong>{name}</strong><span>{side.length} 件</span></header>
          <div className="keyword-transfer-toolbar">
            <label className="keyword-filter-toggle"><input type="checkbox" aria-label={`全选${name}当前结果`} checked={all} disabled={disabled || !movable.length}
              ref={element => { if (element) element.indeterminate = checked.length > 0 && !all; }}
              onChange={() => setMarked(current => {
                const next = new Set(current);
                for (const product of movable) if (all) next.delete(product.itemId); else next.add(product.itemId);
                return next;
              })} /><span>全选当前结果 {movable.length}</span></label>
            <button type="button" className="node-secondary-button" disabled={disabled || !checked.length} onClick={() => move(checked, !kept)}>
              <Icon size={14} />{kept ? '移出' : '移入'}所选 {checked.length}
            </button>
          </div>
          <div className="keyword-transfer-list">
            {visible.map(product => {
              const unavailable = !kept && !eligible(product);
              const reason = !/^\d+$/.test(product.itemId) || !product.productUrl ? '缺少有效商品链接，不能寻源' : !product.imageUrl ? '缺少主图，不能寻源' : '';
              return <div className="keyword-transfer-row" key={product.itemId}>
                <input type="checkbox" aria-label={`选择 ${product.title}`} checked={marked.has(product.itemId)} disabled={disabled || unavailable} onChange={() => toggle(product.itemId)} />
                <div className="keyword-transfer-content">
                  <div className="flex items-start gap-2 min-w-0">
                    {product.imageUrl && <img src={product.imageUrl} alt="" loading="lazy" className="w-10 h-10 shrink-0 object-contain rounded" />}
                    <div className="min-w-0"><a href={product.productUrl || undefined} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline break-words">{product.title || '未命名商品'}</a><div className="text-slate-400">{product.shopName} · {product.itemId}</div></div>
                  </div>
                  <div>{[...new Set(product.lists || [product.sortType])].filter(Boolean).map(type => type === 'new' ? '新品' : '爆款').join(' / ')} · {product.displayPriceText || product.price || '价格待确认'}</div>
                  <div className="text-slate-400">{product.paymentText || '付款人数未采集'}</div>
                  {reason && <div className="text-amber-400">{reason}</div>}
                </div>
                <button type="button" className="keyword-transfer-arrow" title={kept ? '移出已选商品' : '移入已选商品'} aria-label={`${kept ? '移出' : '移入'} ${product.title}`} disabled={disabled || unavailable} onClick={() => move([product.itemId], !kept)}><Icon size={16} /></button>
              </div>;
            })}
            {!visible.length && <p className="artifact-empty">{side.length ? '没有匹配的商品' : kept ? '暂无已选商品' : '暂无待选商品'}</p>}
          </div>
        </section>;
      })}
    </div>
  </div>;
}
