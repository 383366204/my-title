import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, RotateCcw, Save, X } from 'lucide-react';
import { getKeywordFilter, saveKeywordFilter, recollectKeywordFilter } from '../../../api/workflow-api.js';
import { KEYWORD_FILTER_FIELDS, keywordFilterDraft } from '../keyword-filter-fields.js';

/** @param {object} props 本次运行、草稿配置和保存回调。 @returns {import('react').JSX.Element} 节点筛选弹窗。 */
export function KeywordFilterModal({ runId, initialConfig, decisions, onSaveDraft, onApplied, onRecollected, onClose }) {
  const [draft, setDraft] = useState(() => keywordFilterDraft(initialConfig));
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(Boolean(runId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [confirmRecollect, setConfirmRecollect] = useState(false);
  const dialog = useRef(null);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const editable = !loading && (!runId || snapshot?.editable === true);
  const dirty = snapshot && JSON.stringify(keywordFilterDraft(snapshot.config)) !== JSON.stringify(draft);
  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => { alive.current = false; previous?.focus?.(); };
  }, []);
  useEffect(() => {
    const onKeyDown = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (!inFlight.current) onClose();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    getKeywordFilter(runId).then(data => {
      if (cancelled) return;
      setSnapshot(data);
      setDraft(keywordFilterDraft(data.config));
    }).catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [runId]);
  const close = () => { if (!inFlight.current) onClose(); };
  const recollect = async () => {
    if (!editable || inFlight.current || dirty) return;
    inFlight.current = true;
    setSaving(true);
    setError('');
    try {
      const result = await recollectKeywordFilter(runId, snapshot.version, decisions);
      if (alive.current) await onRecollected?.(result);
    } catch (err) {
      if (alive.current) setError(err.message);
    } finally {
      inFlight.current = false;
      if (alive.current) { setSaving(false); setConfirmRecollect(false); }
    }
  };
  const save = async event => {
    event.preventDefault();
    if (!editable || inFlight.current) return;
    const config = keywordFilterDraft(draft);
    for (const field of KEYWORD_FILTER_FIELDS) {
      const input = config[field.key];
      if (!input.enabled && String(input.value).trim() === '') input.value = field.value;
      const value = Number(input.value);
      if (String(input.value).trim() === '' || !Number.isFinite(value) || value < 0 || (field.max != null && value > field.max)) {
        setError(`${field.label}请输入${field.max ? `0 至 ${field.max}` : '大于或等于 0'}的有效数值`);
        return;
      }
      input.value = value;
    }
    inFlight.current = true;
    setSaving(true);
    setError('');
    try {
      if (!runId) {
        onSaveDraft(config);
        onClose();
      } else {
        const result = await saveKeywordFilter(runId, { config, version: snapshot.version, decisions });
        if (!alive.current) return;
        setSnapshot(result);
        setDraft(keywordFilterDraft(result.config));
        await onApplied?.(result);
        if (alive.current) setSaved(true);
      }
    } catch (err) {
      if (alive.current) setError(err.message);
    } finally {
      inFlight.current = false;
      if (alive.current) setSaving(false);
    }
  };
  const trapFocus = event => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
    if (event.key !== 'Tab') return;
    const controls = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')];
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  return createPortal(<div className="workflow-modal-backdrop z-[110] max-[480px]:!p-3" onClick={close}>
    <section className="workflow-modal w-[min(560px,100%)] grid grid-rows-[auto_minmax(0,1fr)] rounded-lg text-[var(--text-primary,var(--text-body))]" role="dialog" aria-modal="true" aria-label="关键词筛选条件"
      tabIndex={-1} ref={dialog} onKeyDown={trapFocus} onClick={event => event.stopPropagation()}>
      <header className="workflow-modal-head"><strong>关键词筛选条件</strong>
        <button type="button" className="workflow-modal-close" aria-label="关闭筛选条件" disabled={saving} onClick={close}><X size={16} /></button>
      </header>
      {loading ? <p role="status">正在读取本次运行的筛选条件…</p> : <form className="min-h-0 overflow-y-auto" onSubmit={save}>
        <fieldset className="border-0 p-0 m-0 min-w-0" disabled={!editable || saving}>
          {KEYWORD_FILTER_FIELDS.map(field => <div className="grid grid-cols-[minmax(0,1fr)_32px_minmax(90px,120px)] items-center gap-3 py-3.5 border-b border-[var(--border-color,var(--border-default))] text-[13px] max-[480px]:grid-cols-[minmax(0,1fr)_28px_88px] max-[480px]:gap-1.5" key={field.key}>
            <label className="keyword-filter-toggle"><input type="checkbox" aria-label={`启用${field.label}`} checked={draft[field.key].enabled}
              onChange={event => { setSaved(false); setDraft(current => ({ ...current, [field.key]: { ...current[field.key], enabled: event.target.checked } })); }} /><span>{field.label}</span></label>
            <span>{field.operator === '>' ? '大于' : '小于'}</span>
            <div className="flex items-center gap-1"><input type="number" className="w-full min-w-0 p-2 rounded-md bg-[var(--bg-secondary,#111c31)] text-inherit border border-[var(--border-color,#475569)] disabled:opacity-55" aria-label={field.label} min="0" max={field.max} step={field.step}
              required disabled={!draft[field.key].enabled} value={draft[field.key].value}
              onChange={event => { setSaved(false); setDraft(current => ({ ...current, [field.key]: { ...current[field.key], value: event.target.value } })); }} />
              {field.unit && <span>{field.unit}</span>}
            </div>
          </div>)}
        </fieldset>
        {!editable && snapshot && <p className="node-workbench-note">{snapshot.readOnlyReason || '本次运行配置只读；正在采集或已进入后续步骤。'}</p>}
        {snapshot?.requiresRecollection && <p className="text-[#d99a28] text-xs break-words" role="status">{snapshot.recollectionReason || '之前的平台预筛可能排除了部分关键词，当前筛选仅覆盖已采集数据。需要完整结果时，请重新采集。'}</p>}
        {snapshot?.requiresRecollection && snapshot.recollectionSupported && editable && onRecollected && <div>
          <button type="button" className="node-secondary-button" disabled={saving || Boolean(dirty)} onClick={() => setConfirmRecollect(true)}><RefreshCw size={14} />重新采集</button>
          {dirty && <p className="node-workbench-note">先应用筛选条件，再重新采集。</p>}
          {confirmRecollect && <div role="alertdialog" aria-label="确认重新采集">
            <p>将按已保存条件新建采集运行，保留原运行记录和人工选择。仍按当前页数和限流设置执行，不会自动铺货。</p>
            <div className="node-product-actions">
              <button type="button" className="node-secondary-button" disabled={saving} onClick={() => setConfirmRecollect(false)}>返回调整</button>
              <button type="button" className="node-primary-button" disabled={saving || Boolean(dirty)} onClick={recollect}>确认重新采集</button>
            </div>
          </div>}
        </div>}
        {saved && <p className="text-[#22a779] text-xs" role="status">筛选条件已保存，已有数据已重新筛选；流程未继续。</p>}
        {error && <p className="text-[#e65b64] text-xs break-words" role="alert">{error}</p>}
        <footer className="node-product-actions flex items-center gap-2 pt-4 flex-wrap [&>button]:m-0">
          {editable && <button type="button" className="node-secondary-button" disabled={saving} onClick={() => { setDraft(keywordFilterDraft()); setSaved(false); }}><RotateCcw size={14} />恢复默认</button>}
          <button type="button" className="node-secondary-button" disabled={saving} onClick={close}>{saved || !editable ? '关闭' : '取消'}</button>
          {editable && <button type="submit" className="node-primary-button" disabled={saving}><Save size={14} />{saving ? '正在保存' : runId ? '应用并重新筛选' : '保存条件'}</button>}
        </footer>
      </form>}
      {loading && error && <p role="alert">{error}</p>}
    </section>
  </div>, document.body);
}
