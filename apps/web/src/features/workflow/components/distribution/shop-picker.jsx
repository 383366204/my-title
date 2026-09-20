import { useEffect, useState } from 'react';
import { Plus, Settings2, Trash2, Save, X } from 'lucide-react';
import { listDistributionShops, saveDistributionShop, deleteDistributionShop } from '../../../../api/distribution-api.js';
import distributionModes from '../../../../../../../core/distribution-modes.json';

const emptyShop = { name: '', platformShopName: '', port: 9222, enabled: true, isDefault: false };

/**
 * 铺货目标与本机店铺管理；已创建任务使用不可变店铺快照。
 * @param {object} props 选择、锁定快照与提交状态。
 * @returns {import('react').JSX.Element} 店铺配置区域。
 */
export function DistributionShopPicker({ value, onChange, onEditingChange, disabled, lockedShops, mode, onModeChange }) {
  const [shops, setShops] = useState([]);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  useEffect(() => { onEditingChange?.(Boolean(draft)); }, [draft, onEditingChange]);
  useEffect(() => () => onEditingChange?.(false), [onEditingChange]);
  useEffect(() => {
    let alive = true;
    listDistributionShops().then(rows => {
      if (!alive) return;
      if (!Array.isArray(rows)) throw new Error('店铺配置返回格式异常');
      setShops(rows);
      if (value === null) onChange(rows.filter(row => row.enabled && row.isDefault));
    }).catch(err => { if (alive) setError(err.message); }).finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [onChange]);
  const save = async event => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const shop = await saveDistributionShop(draft);
      const rows = await listDistributionShops();
      setShops(rows);
      const selectedIds = new Set((value || []).map(row => row.id));
      if (shop.enabled) selectedIds.add(shop.id);
      onChange(rows.filter(row => row.enabled && selectedIds.has(row.id)));
      setDraft(null);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const remove = async shop => {
    if (!window.confirm(`确认删除店铺配置「${shop.name}」？历史铺货记录不会删除。`)) return;
    setBusy(true); setError('');
    try {
      await deleteDistributionShop(shop.id);
      setShops(await listDistributionShops()); onChange((value || []).filter(row => row.id !== shop.id)); setDraft(null);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const blocked = busy || disabled || Boolean(lockedShops);
  const field = (key, next) => setDraft(current => ({ ...current, [key]: next }));
  return <section className="distribution-shop-picker" aria-label="铺货店铺">
    <div className="distribution-shop-toolbar">
      <strong>目标店铺 · 已选 {(lockedShops || value || []).length} 家</strong>
      {!lockedShops && <>
        <button type="button" className="node-secondary-button" disabled={blocked} onClick={() => { setDraft({ ...emptyShop }); setError(''); }}><Plus size={13} />新增店铺</button>
      </>}
    </div>
    <div className="distribution-shop-list" role="group" aria-label="目标店铺">
      {(lockedShops || shops).map(shop => <div className="distribution-shop-row" key={shop.id}>
        <label className="distribution-choice">
          <input type="checkbox" checked={Boolean(lockedShops || (value || []).some(row => row.id === shop.id))} disabled={blocked || Boolean(draft) || !shop.enabled}
            onChange={event => onChange(event.target.checked ? [...(value || []), shop] : (value || []).filter(row => row.id !== shop.id))} />
          <span>{shop.name}{shop.enabled ? '' : '（已停用）'}{shop.isDefault ? '（默认）' : ''}<small>平台店铺：{shop.platformShopName} · Chrome 端口：{shop.port}</small></span>
        </label>
        {!lockedShops && <>
          <button type="button" className="node-secondary-button" title={`配置店铺 ${shop.name}`} aria-label={`配置店铺 ${shop.name}`} disabled={blocked || Boolean(draft)} onClick={() => { setDraft({ ...shop }); setError(''); }}><Settings2 size={13} /></button>
          <button type="button" className="node-secondary-button danger" title={`删除店铺 ${shop.name}`} aria-label={`删除店铺 ${shop.name}`} disabled={blocked || Boolean(draft)} onClick={() => remove(shop)}><Trash2 size={13} /></button>
        </>}
      </div>)}
      {!lockedShops && !shops.length && <small>{busy ? '正在加载店铺…' : '暂无店铺配置'}</small>}
    </div>
    <fieldset className="distribution-mode-options" disabled={blocked || Boolean(draft)}>
      <legend>商品分配方式</legend>
      {distributionModes.map(option => <label className="distribution-choice" key={option.value}>
        <input type="radio" name="distribution-mode" value={option.value} checked={mode === option.value} onChange={() => onModeChange(option.value)} />{option.label}
      </label>)}
    </fieldset>
    {error && <p role="alert" className="distribution-error-text">{error}</p>}
    {draft && <form className="distribution-shop-form" onSubmit={save}>
      <fieldset disabled={busy || disabled}>
        <label>显示名称<input required maxLength={80} value={draft.name} onChange={event => field('name', event.target.value)} /></label>
        <label>铺货平台店铺名称<input required maxLength={160} placeholder="与铺货平台显示的店铺名完全一致" value={draft.platformShopName} onChange={event => field('platformShopName', event.target.value)} /></label>
        <label>Chrome 调试端口<input required type="number" min="1" max="65535" value={draft.port} onChange={event => field('port', event.target.value)} /></label>
        <label className="distribution-shop-toggle"><input type="checkbox" checked={draft.enabled} onChange={event => field('enabled', event.target.checked)} />启用</label>
        <label className="distribution-shop-toggle"><input type="checkbox" checked={draft.isDefault} disabled={!draft.enabled} onChange={event => field('isDefault', event.target.checked)} />默认店铺</label>
      </fieldset>
      <div className="distribution-shop-toolbar">
        <button type="submit" className="node-primary-button" disabled={busy || disabled}><Save size={13} />{busy ? '保存中…' : '保存店铺'}</button>
        <button type="button" className="node-secondary-button" disabled={busy} onClick={() => setDraft(null)}><X size={13} />取消</button>
      </div>
    </form>}
  </section>;
}
