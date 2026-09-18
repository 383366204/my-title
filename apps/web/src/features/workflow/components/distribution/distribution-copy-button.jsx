import { useId, useRef } from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';
import { DISTRIBUTION_COPY_FORMATS } from './distribution-view-model.js';

/**
 * @param {object} props Copy action and selected format.
 * @returns {import('react').JSX.Element} Split copy button with a format menu.
 */
export function DistributionCopyButton({ label, primary = false, disabled, onCopy, format, onFormatChange, successMessage }) {
  const id = useId();
  const menu = useRef(null);
  const trigger = useRef(null);
  const group = useRef(null);
  const successDialog = useRef(null);
  const openMenu = () => {
    if (menu.current.matches(':popover-open')) {
      menu.current.hidePopover();
      return;
    }
    const rect = group.current.getBoundingClientRect();
    const width = Math.min(rect.width, window.innerWidth - 24);
    Object.assign(menu.current.style, {
      width: `${width}px`,
      left: `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`,
      top: `${Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 150))}px`
    });
    menu.current.showPopover();
    menu.current.querySelector('[aria-checked="true"]')?.focus();
  };
  const moveFocus = event => {
    const items = [...menu.current.querySelectorAll('[role="menuitemradio"]')];
    const index = items.indexOf(document.activeElement);
    const next = { ArrowDown: (index + 1) % items.length, ArrowUp: (index + items.length - 1) % items.length, Home: 0, End: items.length - 1 }[event.key];
    if (next !== undefined) { event.preventDefault(); items[next].focus(); }
  };
  const buttonClass = primary ? 'node-primary-button' : 'node-secondary-button';
  return (
    <div ref={group} className="distribution-copy-split">
      <button type="button" className={buttonClass} disabled={disabled} onClick={async () => {
        const copied = await onCopy();
        if (copied && successDialog.current && !successDialog.current.open) successDialog.current.showModal();
      }} title={`当前格式：${format.label}`}>
        <Copy size={13} /> {label}
      </button>
      <button ref={trigger} type="button" className={`${buttonClass} distribution-copy-toggle`} aria-label="铺货复制格式"
        title={`铺货复制格式：${format.label}`} aria-haspopup="menu" aria-controls={id} aria-expanded="false" onClick={openMenu}>
        <ChevronDown size={14} />
      </button>
      <div ref={menu} id={id} popover="auto" role="menu" aria-label="铺货复制格式" className="distribution-copy-menu"
        onKeyDown={moveFocus} onToggle={event => trigger.current?.setAttribute('aria-expanded', String(event.newState === 'open'))}>
        {DISTRIBUTION_COPY_FORMATS.map(option => (
          <button key={option.value} type="button" role="menuitemradio" aria-checked={format.value === option.value}
            onClick={() => { onFormatChange(option.value); menu.current.hidePopover(); trigger.current.focus(); }}>
            {option.label}
          </button>
        ))}
      </div>
      <dialog ref={successDialog} className="distribution-copy-success" aria-label="复制成功" onCancel={event => event.stopPropagation()}>
        <h3><Check size={18} />复制成功</h3>
        <p>{successMessage || `已复制铺货内容，格式：${format.label}`}</p>
        <button type="button" className="node-primary-button" autoFocus onClick={() => successDialog.current.close()}>知道了</button>
      </dialog>
    </div>
  );
}
