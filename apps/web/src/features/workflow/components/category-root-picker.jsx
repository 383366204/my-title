import { useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, X } from 'lucide-react';
import snapshot from '../data/1688-categories.json';
import { flattenCategoryRoots, indexCategoryRoots, previewCategoryRoots } from '../category-root-utils.js';
import { parseRootKeywords } from '../workflow-launch-params.js';

const tree = indexCategoryRoots(snapshot.categories);
const all = flattenCategoryRoots(tree);

/** @param {object} props Current roots and append/cancel callbacks. @returns {import('react').JSX.Element} Category selection view. */
export function CategoryRootPicker({ rootsText, onCancel, onAdd }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [expanded, setExpanded] = useState(new Set());
  const [tab, setTab] = useState('tree');
  const [shown, setShown] = useState(100);
  const chosen = useMemo(() => all.filter(node => selected.has(node.key)), [selected]);
  const preview = useMemo(() => previewCategoryRoots(rootsText, chosen), [rootsText, chosen]);
  const existing = useMemo(() => new Set(parseRootKeywords(rootsText).map(word => word.replace(/\s+/g, '').toLowerCase())), [rootsText]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return null;
    const keys = new Set();
    all.filter(node => node.path.join(' / ').toLowerCase().includes(needle)).forEach(node => {
      let key = node.key;
      while (key) { keys.add(key); key = key.slice(0, key.lastIndexOf('/')); }
    });
    return keys;
  }, [query]);
  const toggle = (keys, checked) => setSelected(previous => {
    const next = new Set(previous);
    keys.forEach(key => checked ? next.add(key) : next.delete(key));
    return next;
  });
  const renderNodes = nodes => nodes.filter(node => !visible || visible.has(node.key)).map(node => {
    const descendants = flattenCategoryRoots(node.children);
    const count = descendants.filter(child => selected.has(child.key)).length;
    const open = expanded.has(node.key);
    return <li key={node.key}>
      <div className="category-root-row">
        <input type="checkbox" aria-label={node.path.join(' / ')} checked={selected.has(node.key)} onChange={event => toggle([node.key], event.target.checked)} />
        {node.children.length > 0 ? <button type="button" aria-label={`${open ? '收起' : '展开'}${node.path.join(' / ')}`} aria-expanded={open}
          onClick={() => setExpanded(previous => { const next = new Set(previous); next.has(node.key) ? next.delete(node.key) : next.add(node.key); return next; })}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button> : <span className="category-root-spacer" />}
        <span>{node.name}</span>
        {parseRootKeywords(node.name).every(word => existing.has(word.replace(/\s+/g, '').toLowerCase())) && <small>已在输入框</small>}
      </div>
      {node.children.length > 0 && open && <>
        <button type="button" className="category-root-bulk" onClick={() => toggle(descendants.map(child => child.key), count !== descendants.length)}>
          {count === descendants.length ? '取消全选' : '全选子类目'}（{count}/{descendants.length}）
        </button>
        <ul>{renderNodes(node.children)}</ul>
      </>}
    </li>;
  });
  return <section className="category-root-picker" aria-label="类目词选择">
    <header><button type="button" className="node-secondary-button" onClick={onCancel}><ArrowLeft size={14} />返回</button><strong>类目词</strong><small>快照 {snapshot.snapshotDate}</small></header>
    <input autoFocus className="node-field-input" aria-label="搜索类目" placeholder="搜索类目或路径" value={query} onChange={event => {
      setQuery(event.target.value);
      if (event.target.value.trim()) setExpanded(new Set(all.filter(node => node.children.length).map(node => node.key)));
      else setExpanded(new Set());
    }} />
    <div className="category-root-tabs" role="tablist" aria-label="类目视图">
      <button type="button" role="tab" aria-selected={tab === 'tree'} onClick={() => setTab('tree')}>类目</button>
      <button type="button" role="tab" aria-selected={tab === 'selected'} onClick={() => setTab('selected')}>已选 {chosen.length}</button>
    </div>
    <div className="category-root-columns" data-tab={tab}>
      <div className="category-root-tree"><ul>{renderNodes(tree)}</ul>{visible?.size === 0 && <p>没有匹配的类目</p>}</div>
      <div className="category-root-selected"><header><strong>已选 {chosen.length}</strong><button type="button" className="node-secondary-button" disabled={!chosen.length} onClick={() => setSelected(new Set())}>清空选择</button></header>
        {chosen.slice(0, shown).map(node => <div className="category-root-row" key={node.key}><span>{node.path.join(' / ')}</span><button type="button" aria-label={`移除${node.path.join(' / ')}`} onClick={() => toggle([node.key], false)}><X size={14} /></button></div>)}
        {chosen.length > shown && <button type="button" className="node-secondary-button" onClick={() => setShown(shown + 100)}>显示更多</button>}
      </div>
    </div>
    <div className="category-root-preview"><strong>新增 {preview.added.length} 个词根 · 已有 {preview.duplicateCount} 个重复词根</strong>
      {preview.split.length > 0 && <p role="status">{preview.split.length} 个组合名称将按现有分隔规则拆分，请核对下方词根。</p>}
      <textarea aria-label="将添加的词根" readOnly value={preview.added.join('\n')} rows={3} />
    </div>
    <footer><button type="button" className="node-secondary-button" onClick={onCancel}>取消</button><button type="button" className="node-primary-button" disabled={!chosen.length} onClick={() => onAdd(chosen)}>添加到词根</button></footer>
  </section>;
}
