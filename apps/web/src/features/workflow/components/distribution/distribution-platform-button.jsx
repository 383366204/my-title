import { useId, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

/** @param {object} props 主按钮、平台值与切换事件。 @returns {import('react').JSX.Element} 平台分裂按钮。 */
export function DistributionPlatformButton({ children, value, onChange, disabled }) {
  const id = useId();
  const menu = useRef(null);
  const trigger = useRef(null);
  const group = useRef(null);
  const options = [{ value: 'zhangfei', label: '张飞搬家' }, { value: '1688', label: '1688官方铺货' }];
  const open = () => {
    if (menu.current.matches(':popover-open')) return menu.current.hidePopover();
    const rect = group.current.getBoundingClientRect();
    const width = Math.min(rect.width, window.innerWidth - 24);
    Object.assign(menu.current.style, { width: `${width}px`, left: `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`, top: `${Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 110))}px` });
    menu.current.showPopover();
    menu.current.querySelector('[aria-checked="true"]')?.focus();
  };
  return <div ref={group} className="distribution-copy-split">
    {children}
    <button ref={trigger} type="button" className="node-primary-button danger distribution-copy-toggle" disabled={disabled}
      aria-label="选择铺货平台" title={`铺货平台：${options.find(option => option.value === value)?.label}`} aria-haspopup="menu" aria-controls={id} aria-expanded="false" onClick={open}>
      <ChevronDown size={14} />
    </button>
    <div ref={menu} id={id} popover="auto" role="menu" aria-label="铺货平台" className="distribution-copy-menu"
      onToggle={event => trigger.current?.setAttribute('aria-expanded', String(event.newState === 'open'))}
      onKeyDown={event => {
        const items = [...menu.current.querySelectorAll('[role="menuitemradio"]')];
        const index = items.indexOf(document.activeElement);
        const next = { ArrowDown: (index + 1) % items.length, ArrowUp: (index + items.length - 1) % items.length, Home: 0, End: items.length - 1 }[event.key];
        if (next !== undefined) { event.preventDefault(); items[next].focus(); }
      }}>
      {options.map(option => <button key={option.value} type="button" role="menuitemradio" aria-checked={value === option.value}
        onClick={() => { onChange(option.value); menu.current.hidePopover(); trigger.current.focus(); }}>{option.label}</button>)}
    </div>
  </div>;
}
