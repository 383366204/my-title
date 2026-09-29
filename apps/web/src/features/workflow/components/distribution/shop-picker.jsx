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
      if (value === null && !lockedShops) onChange(rows.filter(row => row.enabled));
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
  return <section className="min-w-0 py-2.5 border-b border-[var(--border-default)] [&_label]:grid [&_label]:gap-1.5 [&_label]:text-[var(--text-body)] [&_label]:text-xs [&_strong]:break-words [&_input:not([type=checkbox]):not([type=radio])]:min-w-0 [&_input:not([type=checkbox]):not([type=radio])]:w-full [&_input:not([type=checkbox]):not([type=radio])]:box-border [&_input:not([type=checkbox]):not([type=radio])]:p-2 [&_input:not([type=checkbox]):not([type=radio])]:text-slate-50 [&_input:not([type=checkbox]):not([type=radio])]:bg-[#0b1220] [&_input:not([type=checkbox]):not([type=radio])]:border [&_input:not([type=checkbox]):not([type=radio])]:border-slate-600 [&_input:not([type=checkbox]):not([type=radio])]:rounded [&_select]:min-w-0 [&_select]:w-full [&_select]:box-border [&_select]:p-2 [&_select]:text-slate-50 [&_select]:bg-[#0b1220] [&_select]:border [&_select]:border-slate-600 [&_select]:rounded [&_small]:block [&_small]:text-[var(--text-muted)] [&_small]:mt-1.5 [&_small]:break-words" aria-label="铺货店铺">
    <div className="flex items-center flex-wrap gap-2">
      <strong>目标店铺 · 已选 {(lockedShops || value || []).length} 家</strong>
      {!lockedShops && <>
        <button type="button" className="node-secondary-button" disabled={blocked} onClick={() => { setDraft({ ...emptyShop }); setError(''); }}><Plus size={13} />新增店铺</button>
      </>}
    </div>
    <div className="max-h-[180px] overflow-y-auto my-2" role="group" aria-label="目标店铺">
      {(lockedShops || shops).map(shop => <div className="flex items-center gap-2 py-1.5" key={shop.id}>
        <label className="flex items-center gap-1.5 flex-1 min-w-0 cursor-pointer [&_input[type=checkbox]]:w-4 [&_input[type=checkbox]]:h-4 [&_input[type=checkbox]]:shrink-0 [&_input[type=checkbox]]:m-0 [&_input[type=checkbox]]:p-0 [&_input[type=checkbox]]:accent-green-500">
          <input type="checkbox" checked={Boolean(lockedShops || (value || []).some(row => row.id === shop.id))} disabled={blocked || Boolean(draft) || !shop.enabled}
            onChange={event => onChange(event.target.checked ? [...(value || []), shop] : (value || []).filter(row => row.id !== shop.id))} />
          <span className="min-w-0 break-words text-[11px] leading-[1.4]">{shop.name}{shop.enabled ? '' : '（已停用）'}{shop.isDefault ? '（默认）' : ''} <small className="text-slate-400 text-[10px]">平台店铺：{shop.platformShopName} · Chrome 端口：{shop.port}</small></span>
        </label>
        {!lockedShops && <>
          <button type="button" className="node-secondary-button" title={`配置店铺 ${shop.name}`} aria-label={`配置店铺 ${shop.name}`} disabled={blocked || Boolean(draft)} onClick={() => { setDraft({ ...shop }); setError(''); }}><Settings2 size={13} /></button>
          <button type="button" className="node-secondary-button danger" title={`删除店铺 ${shop.name}`} aria-label={`删除店铺 ${shop.name}`} disabled={blocked || Boolean(draft)} onClick={() => remove(shop)}><Trash2 size={13} /></button>
        </>}
      </div>)}
      {!lockedShops && !shops.length && <small>{busy ? '正在加载店铺…' : '暂无店铺配置'}</small>}
    </div>
    <div className="flex items-center flex-wrap gap-x-4 gap-y-1.5 mt-2 min-w-0 text-[11px]">
      <span className="shrink-0 text-slate-400 font-bold whitespace-nowrap">商品分配方式</span>
      {distributionModes.map(option => <label className="inline-flex items-center gap-1.5 cursor-pointer [&_input]:w-3.5 [&_input]:h-3.5 [&_input]:shrink-0 [&_input]:m-0 [&_input]:p-0 [&_input]:accent-green-500" key={option.value}>
        <input type="radio" name="distribution-mode" value={option.value} checked={mode === option.value} onChange={() => onModeChange(option.value)} disabled={blocked || Boolean(draft)} />{option.label}
      </label>)}
    </div>
    {error && <p role="alert" className="!text-red-200">{error}</p>}
    {draft && <form className="grid gap-3 mt-3 [&_fieldset]:grid [&_fieldset]:grid-cols-2 [&_fieldset]:gap-3 [&_fieldset]:p-0 [&_fieldset]:border-0 [&_fieldset]:min-w-0 max-sm:[&_fieldset]:grid-cols-1" onSubmit={save}>
      <fieldset disabled={busy || disabled}>
        <label>显示名称<input required maxLength={80} value={draft.name} onChange={event => field('name', event.target.value)} /></label>
        <label>铺货平台店铺名称<input required maxLength={160} placeholder="与铺货平台显示的店铺名完全一致" value={draft.platformShopName} onChange={event => field('platformShopName', event.target.value)} /></label>
        <label>Chrome 调试端口<input required type="number" min="1" max="65535" value={draft.port} onChange={event => field('port', event.target.value)} /></label>
        <label className="flex items-center justify-start whitespace-nowrap [&_input[type=checkbox]]:shrink-0 [&_input[type=checkbox]]:w-4 [&_input[type=checkbox]]:h-4 [&_input[type=checkbox]]:m-0 [&_input[type=checkbox]]:p-0"><input type="checkbox" checked={draft.enabled} onChange={event => field('enabled', event.target.checked)} />启用</label>
        <label className="flex items-center justify-start whitespace-nowrap [&_input[type=checkbox]]:shrink-0 [&_input[type=checkbox]]:w-4 [&_input[type=checkbox]]:h-4 [&_input[type=checkbox]]:m-0 [&_input[type=checkbox]]:p-0"><input type="checkbox" checked={draft.isDefault} disabled={!draft.enabled} onChange={event => field('isDefault', event.target.checked)} />默认店铺</label>
      </fieldset>
      <div className="flex items-center flex-wrap gap-2">
        <button type="submit" className="node-primary-button" disabled={busy || disabled}><Save size={13} />{busy ? '保存中…' : '保存店铺'}</button>
        <button type="button" className="node-secondary-button" disabled={busy} onClick={() => setDraft(null)}><X size={13} />取消</button>
      </div>
    </form>}
  </section>;
}
