import { ExternalLink, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { artifactItems } from '../workflow-data.js';
import { AUTO_LOWEST_SKU, applySkuSelection, availableSkuOptions, skuOptionLabel, skuSelectionValue } from '../order-sheet-sku.js';
import { ArtifactPanel } from './artifact-panel.jsx';

export function OrderSheetProductPanel({ artifactState, canConfirm, confirming, onConfirm }) {
  const artifactRows = useMemo(() => artifactItems(artifactState), [artifactState]);
  const manualRows = useMemo(() => artifactRows.filter(row => row.sourceType === 'manual'), [artifactRows]);
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setRows(manualRows.map(row => ({
      ...row,
      title: String(row.title || ''),
      storeName: String(row.storeName || ''),
      orderAmount: row.orderAmount ?? ''
    })));
    setMessage('');
  }, [manualRows]);

  const missingCount = rows.filter(row => !row.title.trim()).length;
  const updateRow = (index, field, value) => {
    setRows(current => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
    setMessage('');
  };
  const submit = async () => {
    if (missingCount > 0) {
      setMessage(`还有 ${missingCount} 个商品缺少标题，补充后才能生成表格。`);
      return;
    }
    const ok = await onConfirm?.(rows.map(row => ({
      itemId: row.itemId || '',
      productUrl: row.productUrl || '',
      title: row.title.trim(),
      storeName: row.storeName.trim(),
      orderAmount: row.orderAmount === '' ? null : Number(row.orderAmount),
      skuOptions: row.skuOptions || [],
      selectedSkuId: row.selectedSkuId || '',
      selectedSkuName: row.selectedSkuName || '',
      selectedSkuPrice: row.selectedSkuPrice ?? null,
      lowestSkuId: row.lowestSkuId || '',
      lowestSkuName: row.lowestSkuName || '',
      lowestSkuPrice: row.lowestSkuPrice ?? null,
      skuSelectionMode: row.skuSelectionMode || 'lowest'
    })));
    if (!ok) setMessage('保存失败，请查看页面下方日志后重试。');
  };

  if (artifactState.status !== 'ready' || manualRows.length === 0) {
    return <ArtifactPanel state={artifactState} />;
  }

  return (
    <div className="order-sheet-product-panel">
      <div className="order-sheet-product-summary">
        <div><span>指定商品</span><strong>{rows.length} 个</strong></div>
        <div><span>待补标题</span><strong className={missingCount > 0 ? 'is-warning' : ''}>{missingCount} 个</strong></div>
        <p>系统会尝试读取淘宝或天猫商品资料；读取失败时只需补充标题，下单金额可以按实际任务填写。</p>
      </div>
      <div className="order-sheet-product-list">
        {rows.map((row, index) => (
          <section className={row.title.trim() ? '' : 'is-incomplete'} key={row.itemId || row.sourceKey || row.productUrl || index}>
            <header>
              <div>
                <strong>商品 {index + 1}</strong>
                <span>{row.itemId ? `ID ${row.itemId}` : '短链接商品'}</span>
              </div>
              {row.productUrl && <a href={row.productUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> 打开商品</a>}
            </header>
            {row.enrichmentError && <p className="order-sheet-product-error">自动读取失败：{row.enrichmentError}</p>}
            <label>
              <span>商品标题 <b>必填</b></span>
              <input value={row.title} placeholder="请输入淘宝商品标题" onChange={event => updateRow(index, 'title', event.target.value)} />
            </label>
            <label className="order-sheet-sku-field">
              <span>购买规格</span>
              {availableSkuOptions(row).length > 0 ? (
                <select value={skuSelectionValue(row)} onChange={(event) => {
                  const patch = applySkuSelection(row, event.target.value);
                  setRows(current => current.map((item, rowIndex) => rowIndex === index ? { ...item, ...patch } : item));
                  setMessage('');
                }}>
                  <option value={AUTO_LOWEST_SKU}>自动选择最低价 · ¥{Number(row.lowestSkuPrice ?? availableSkuOptions(row)[0]?.price).toFixed(2)}</option>
                  {availableSkuOptions(row).map(option => <option key={option.skuId} value={option.skuId}>{skuOptionLabel(option)}</option>)}
                </select>
              ) : (
                <input value={row.selectedSkuName || ''} placeholder="手动填写规格" onChange={event => {
                  setRows(current => current.map((item, rowIndex) => rowIndex === index
                    ? { ...item, selectedSkuName: event.target.value, skuSelectionMode: 'manual' }
                    : item));
                  setMessage('');
                }} />
              )}
            </label>
            <div className="order-sheet-product-fields">
              <label>
                <span>下单金额</span>
                <input type="number" min="0" step="0.01" value={row.orderAmount} placeholder="可稍后填写" onChange={event => updateRow(index, 'orderAmount', event.target.value)} />
              </label>
              <label>
                <span>店铺名</span>
                <input value={row.storeName} placeholder="默认使用表格设置" onChange={event => updateRow(index, 'storeName', event.target.value)} />
              </label>
            </div>
          </section>
        ))}
      </div>
      {message && <p className="order-sheet-product-message">{message}</p>}
      <div className="order-sheet-product-footer">
        <span>{missingCount > 0 ? `请补充 ${missingCount} 个标题` : '商品资料已齐，可以继续生成 Excel'}</span>
        <button type="button" className="primary-button" disabled={!canConfirm || confirming || missingCount > 0} onClick={submit}>
          <Save size={14} /> {confirming ? '正在保存...' : '保存并继续生成表格'}
        </button>
      </div>
    </div>
  );
}
