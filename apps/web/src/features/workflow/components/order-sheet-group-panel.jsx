import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, ExternalLink, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';

import { getOrderSheetDraft, saveOrderSheetDraft } from '../../../api/workflow-api.js';

const itemKey = (item, fallback = '') => String(item?.itemId || item?.sourceKey || item?.productUrl || fallback).trim();

const groupItems = (group) => [group.mainProduct, ...(group.subProducts || [])].filter(Boolean);

const makeGroup = (items, index) => ({
  id: `group_${Date.now()}_${index}`,
  name: `第 ${index + 1} 组`,
  mainProduct: { ...items[0], role: 'main' },
  subProducts: items.slice(1).map((item) => ({ ...item, role: 'sub' }))
});

const autoGroup = (items, dragCount) => {
  const size = Math.max(1, Number(dragCount) + 1);
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(makeGroup(items.slice(index, index + size), result.length));
  }
  return result;
};

const uniqueItems = (items) => {
  const seen = new Set();
  return items.filter((item, index) => {
    const key = itemKey(item, `position-${index}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const rebuildGroup = (group, items) => items.length === 0 ? null : ({
  ...group,
  mainProduct: { ...items[0], role: 'main' },
  subProducts: items.slice(1).map((item) => ({ ...item, role: 'sub' }))
});

const detachItem = (groups, groupIndex, itemIndex) => {
  const next = groups.map((group) => ({ ...group, subProducts: [...(group.subProducts || [])] }));
  const items = groupItems(next[groupIndex]);
  const [item] = items.splice(itemIndex, 1);
  const rebuilt = rebuildGroup(next[groupIndex], items);
  if (rebuilt) next[groupIndex] = rebuilt;
  else next.splice(groupIndex, 1);
  return { groups: next, item };
};

function ProductEditor({ item, itemIndex, groupIndex, groupCount, onChange, onMoveGroup, onMoveToPool, onReorder, onSetMain }) {
  return (
    <div className={`order-group-product-row ${itemIndex === 0 ? 'is-main' : ''}`}>
      <div className="order-group-product-role">
        <strong>{itemIndex === 0 ? '主商品' : `搭配 ${itemIndex}`}</strong>
        <span>{item.sourceType === 'manual' ? '指定商品' : '排行商品'}</span>
        {item.productUrl && <a href={item.productUrl} target="_blank" rel="noreferrer"><ExternalLink size={11} /> 打开商品</a>}
      </div>
      <div className="order-group-product-fields">
        <label>
          <span>商品标题</span>
          <input value={item.title || ''} onChange={(event) => onChange({ title: event.target.value })} />
        </label>
        <label className="is-compact">
          <span>下单金额</span>
          <input type="number" min="0" step="0.01" value={item.orderAmount ?? ''} onChange={(event) => onChange({ orderAmount: event.target.value === '' ? null : Number(event.target.value) })} />
        </label>
        <label className="is-compact">
          <span>店铺名</span>
          <input value={item.storeName || ''} onChange={(event) => onChange({ storeName: event.target.value })} />
        </label>
      </div>
      <div className="order-group-product-actions">
        <button type="button" title="上移" disabled={itemIndex === 0} onClick={() => onReorder(-1)}><ChevronUp size={14} /></button>
        <button type="button" title="下移" onClick={() => onReorder(1)}><ChevronDown size={14} /></button>
        {itemIndex > 0 && <button type="button" onClick={onSetMain}>设为主商品</button>}
        {groupCount > 1 && (
          <select aria-label="移动到其他任务组" defaultValue="" onChange={(event) => {
            if (event.target.value !== '') onMoveGroup(Number(event.target.value));
            event.target.value = '';
          }}>
            <option value="">移到其他组</option>
            {Array.from({ length: groupCount }, (_, index) => index).filter((index) => index !== groupIndex).map((index) => (
              <option key={index} value={index}>第 {index + 1} 组</option>
            ))}
          </select>
        )}
        <button type="button" onClick={onMoveToPool}>移到备选池</button>
      </div>
    </div>
  );
}

export function OrderSheetGroupPanel({ currentRunId, confirming = false, onConfirm }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const [dragCount, setDragCount] = useState(0);
  const [groups, setGroups] = useState([]);
  const [unassignedItems, setUnassignedItems] = useState([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage('');
    getOrderSheetDraft(currentRunId)
      .then((draft) => {
        if (cancelled) return;
        setRevision(Number(draft.revision) || 0);
        setDragCount(Math.max(0, Number(draft.dragCount) || 0));
        setGroups(Array.isArray(draft.groups) ? draft.groups : []);
        const assigned = new Set((draft.groups || []).flatMap(groupItems).map((item) => itemKey(item)).filter(Boolean));
        const inferredPool = (draft.items || []).filter((item) => !assigned.has(itemKey(item)));
        setUnassignedItems(uniqueItems([...(draft.unassignedItems || []), ...inferredPool]));
      })
      .catch((error) => setMessage(`加载组合草稿失败：${error.message}`))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentRunId]);

  const productCount = useMemo(() => groups.reduce((total, group) => total + groupItems(group).length, 0), [groups]);
  const validationErrors = useMemo(() => {
    const errors = [];
    if (groups.length === 0) errors.push('至少需要保留一个任务组');
    groups.forEach((group, groupIndex) => {
      const seen = new Set();
      groupItems(group).forEach((item, itemIndex) => {
        const key = itemKey(item);
        if (!key) errors.push(`第 ${groupIndex + 1} 组第 ${itemIndex + 1} 个商品缺少链接或商品 ID`);
        if (!String(item.title || '').trim()) errors.push(`第 ${groupIndex + 1} 组第 ${itemIndex + 1} 个商品缺少标题`);
        if (key && seen.has(key)) errors.push(`第 ${groupIndex + 1} 组存在重复商品`);
        if (key) seen.add(key);
      });
    });
    return errors;
  }, [groups]);

  const payload = () => ({ revision, dragCount, groups, unassignedItems });

  const saveDraft = async () => {
    setSaving(true);
    setMessage('');
    try {
      const saved = await saveOrderSheetDraft(currentRunId, payload());
      setRevision(Number(saved.revision) || revision + 1);
      setMessage('组合草稿已保存，流水线仍停留在当前节点。');
    } catch (error) {
      setMessage(`保存草稿失败：${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const confirm = async () => {
    if (validationErrors.length > 0 || confirming) return;
    setMessage('');
    const confirmed = await onConfirm?.(payload());
    if (!confirmed) setMessage('确认失败，请根据提示检查商品资料和组合。');
  };

  const regroup = () => {
    const items = uniqueItems([...groups.flatMap(groupItems), ...unassignedItems]);
    setGroups(autoGroup(items, dragCount));
    setUnassignedItems([]);
    setMessage(`已按 1拖${dragCount} 重新编组，每组最多 ${dragCount + 1} 件商品。`);
  };

  const updateItem = (groupIndex, itemIndex, patch) => {
    setGroups((current) => current.map((group, index) => {
      if (index !== groupIndex) return group;
      const items = groupItems(group).map((item, position) => position === itemIndex ? { ...item, ...patch } : item);
      return rebuildGroup(group, items);
    }));
  };

  const reorderItem = (groupIndex, itemIndex, offset) => {
    setGroups((current) => current.map((group, index) => {
      if (index !== groupIndex) return group;
      const items = groupItems(group);
      const target = itemIndex + offset;
      if (target < 0 || target >= items.length) return group;
      [items[itemIndex], items[target]] = [items[target], items[itemIndex]];
      return rebuildGroup(group, items);
    }));
  };

  const setMainItem = (groupIndex, itemIndex) => {
    setGroups((current) => current.map((group, index) => {
      if (index !== groupIndex || itemIndex === 0) return group;
      const items = groupItems(group);
      const [item] = items.splice(itemIndex, 1);
      return rebuildGroup(group, [item, ...items]);
    }));
  };

  const moveAcrossGroups = (sourceGroup, itemIndex, targetGroup) => {
    setGroups((current) => {
      const detached = detachItem(current, sourceGroup, itemIndex);
      const adjustedTarget = sourceGroup < targetGroup && detached.groups.length < current.length ? targetGroup - 1 : targetGroup;
      return detached.groups.map((group, index) => index === adjustedTarget
        ? rebuildGroup(group, [...groupItems(group), detached.item])
        : group);
    });
  };

  const moveToPool = (groupIndex, itemIndex) => {
    setGroups((current) => {
      const detached = detachItem(current, groupIndex, itemIndex);
      setUnassignedItems((pool) => uniqueItems([...pool, detached.item]));
      return detached.groups;
    });
  };

  const addPoolItem = (poolIndex, targetGroup) => {
    const item = unassignedItems[poolIndex];
    if (!item) return;
    if (targetGroup === 'new' || groups.length === 0) {
      setGroups((current) => [...current, makeGroup([item], current.length)]);
    } else {
      setGroups((current) => current.map((group, index) => index === Number(targetGroup)
        ? rebuildGroup(group, [...groupItems(group), item])
        : group));
    }
    setUnassignedItems((pool) => pool.filter((_, index) => index !== poolIndex));
  };

  if (loading) return <div className="artifact-loading"><RefreshCw size={15} className="animate-spin" /> 正在加载商品组合…</div>;

  return (
    <div className="order-sheet-group-panel">
      <div className="order-sheet-group-toolbar">
        <div className="order-sheet-group-stats">
          <strong>{productCount} 个已选商品</strong>
          <span>{groups.length} 个任务组</span>
          <span>{unassignedItems.length} 个备选商品</span>
        </div>
        <label>
          <span>组合方式</span>
          <select value={dragCount} onChange={(event) => setDragCount(Number(event.target.value))}>
            {[0, 1, 2, 3, 4].map((count) => <option key={count} value={count}>1拖{count}（每组 {count + 1} 件）</option>)}
          </select>
        </label>
        <button type="button" className="node-secondary-button" onClick={regroup}><RefreshCw size={13} /> 按当前顺序重新编组</button>
      </div>

      {validationErrors.length > 0 && (
        <div className="order-sheet-group-validation" role="alert">
          <strong>还有 {validationErrors.length} 个问题需要处理</strong>
          <span>{validationErrors.slice(0, 3).join('；')}</span>
        </div>
      )}

      <div className="order-sheet-group-workspace">
        <div className="order-sheet-group-list">
          {groups.map((group, groupIndex) => (
            <section className="order-sheet-task-group" key={group.id || groupIndex}>
              <div className="order-sheet-task-group-head">
                <div><strong>第 {groupIndex + 1} 组</strong><span>{groupItems(group).length} 件商品</span></div>
                <button type="button" title="解散该组" onClick={() => {
                  setUnassignedItems((pool) => uniqueItems([...pool, ...groupItems(group)]));
                  setGroups((current) => current.filter((_, index) => index !== groupIndex));
                }}><Trash2 size={14} /> 解散</button>
              </div>
              {groupItems(group).map((item, itemIndex) => (
                <ProductEditor
                  key={`${itemKey(item, itemIndex)}-${itemIndex}`}
                  item={item}
                  itemIndex={itemIndex}
                  groupIndex={groupIndex}
                  groupCount={groups.length}
                  onChange={(patch) => updateItem(groupIndex, itemIndex, patch)}
                  onMoveGroup={(targetGroup) => moveAcrossGroups(groupIndex, itemIndex, targetGroup)}
                  onMoveToPool={() => moveToPool(groupIndex, itemIndex)}
                  onReorder={(offset) => reorderItem(groupIndex, itemIndex, offset)}
                  onSetMain={() => setMainItem(groupIndex, itemIndex)}
                />
              ))}
            </section>
          ))}
          <button type="button" className="order-sheet-add-group" disabled={unassignedItems.length === 0} onClick={() => addPoolItem(0, 'new')}><Plus size={14} /> 用首个备选商品新建任务组</button>
        </div>

        <aside className="order-sheet-unassigned-pool">
          <div><strong>备选商品</strong><span>移出组合的商品会保留在这里</span></div>
          {unassignedItems.length === 0 && <p>暂无备选商品</p>}
          {unassignedItems.map((item, index) => (
            <div className="order-sheet-pool-item" key={`${itemKey(item, index)}-${index}`}>
              <strong>{item.title || '未填写标题'}</strong>
              <span>{item.itemId || item.productUrl || '缺少商品链接'}</span>
              <select defaultValue="" onChange={(event) => {
                if (event.target.value !== '') addPoolItem(index, event.target.value);
              }}>
                <option value="">选择加入位置</option>
                {groups.map((_, groupIndex) => <option key={groupIndex} value={groupIndex}>加入第 {groupIndex + 1} 组</option>)}
                <option value="new">新建任务组</option>
              </select>
            </div>
          ))}
        </aside>
      </div>

      {message && <div className="order-sheet-group-message" role="status">{message}</div>}
      <div className="order-sheet-group-footer">
        <span>保存草稿不会继续流水线；确认后才会生成 Excel。</span>
        <button type="button" className="node-secondary-button" disabled={saving || confirming} onClick={saveDraft}><Save size={13} /> {saving ? '保存中…' : '保存草稿'}</button>
        <button type="button" className="node-primary-button" disabled={validationErrors.length > 0 || saving || confirming} onClick={confirm}><Check size={13} /> {confirming ? '正在生成…' : '确认并生成表格'}</button>
      </div>
    </div>
  );
}
