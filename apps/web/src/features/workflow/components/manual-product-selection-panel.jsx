import { useEffect, useMemo, useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';

import { artifactItems } from '../workflow-data.js';

export const ManualProductSelectionPanel = ({ artifactState, currentRunId, onConfirm, onRetry, canRetry = false }) => {
  const rows = useMemo(() => artifactItems(artifactState), [artifactState]);
  const [selected, setSelected] = useState({});
  const [manual, setManual] = useState({ url: '', title: '', category: '', keyword: '' });
  const [directUrls, setDirectUrls] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    setSelected(Object.fromEntries(rows.map((row, index) => [
      `${row.url || row.product?.['产品链接'] || row.product?.url || index}`,
      false
    ])));
  }, [rows]);

  const rowKey = (row, index) => `${row.url || row.product?.['产品链接'] || row.product?.url || index}`;
  const toggle = (key) => setSelected((current) => ({ ...current, [key]: !current[key] }));
  const submit = async () => {
    const approvedProductIds = rows.filter((row, index) => selected[rowKey(row, index)]).map((row, index) => rowKey(row, index));
    const defaultKeyword = manual.keyword.trim() || rows.find((row) => row.keyword)?.keyword || '';
    const directProducts = directUrls
      .split(/\r?\n|[,，]/)
      .map((item) => item.trim())
      .filter((item) => /detail\.1688\.com\/offer\//i.test(item))
      .map((url) => ({ url, keyword: defaultKeyword }));
    const manualProducts = [
      ...(manual.url.trim() && manual.keyword.trim() ? [{ ...manual }] : []),
      ...directProducts
    ];
    if (approvedProductIds.length === 0 && manualProducts.length === 0) {
      setMessage('请至少勾选一个商品，或粘贴有效的 1688 商品 URL。');
      return;
    }
    setMessage('');
    await onConfirm({ approvedProductIds, manualProducts });
  };

  return (
    <div className="node-embedded-workbench">
      <section className="node-workbench-section">
        <div className="node-workbench-head">
          <strong>勾选 1688 货源</strong>
          <span>{rows.filter((row, index) => selected[rowKey(row, index)]).length} 个已选</span>
        </div>
        <div className="node-product-list">
          {rows.map((row, index) => {
            const product = row.product || row;
            const url = row.url || row.productUrl || product['产品链接'] || product.url || '';
            const title = row.sourceTitle || row.title || product['链接原标题'] || product.title || '未命名商品';
            const key = rowKey(row, index);
            return (
              <label className="node-product-row manual-product-choice" key={key}>
                <input type="checkbox" checked={Boolean(selected[key])} onChange={() => toggle(key)} />
                <div>
                  <strong>{title}</strong>
                  <span>{row.keyword || '手动货源'} · {row.recommendedCategory || product.category || '未设置类目'}</span>
                  <small>{url}</small>
                </div>
              </label>
            );
          })}
          {rows.length === 0 && <div className="artifact-empty">暂无 1688 搜索结果，请手动添加商品。</div>}
        </div>
      </section>
      <section className="node-workbench-section">
        <div className="node-workbench-head"><strong>直接粘贴 1688 链接</strong><span>一行一个</span></div>
        <textarea
          className="node-field-textarea"
          rows="4"
          value={directUrls}
          onChange={(event) => setDirectUrls(event.target.value)}
          placeholder="https://detail.1688.com/offer/123456.html\nhttps://detail.1688.com/offer/789012.html"
        />
        <p className="node-workbench-note">直接加入的商品会带着关联关键词进入 AI 标题生成；标题或类目信息不足时会在铺货复核中提示。</p>
      </section>
      <section className="node-workbench-section">
        <div className="node-workbench-head"><strong>手动添加商品</strong><span>URL + 标题 + 类目</span></div>
        <label className="node-field"><span>单个商品 URL</span><input value={manual.url} onChange={(event) => setManual({ ...manual, url: event.target.value })} placeholder="可只填 URL，也可继续补充信息" /></label>
        <label className="node-field"><span>商品标题</span><input value={manual.title} onChange={(event) => setManual({ ...manual, title: event.target.value })} placeholder="商品原标题或自定义商品名" /></label>
        <label className="node-field"><span>类目</span><input value={manual.category} onChange={(event) => setManual({ ...manual, category: event.target.value })} placeholder="例如：饰品 > 项链" /></label>
        <label className="node-field"><span>关联关键词</span><input value={manual.keyword} onChange={(event) => setManual({ ...manual, keyword: event.target.value })} placeholder="例如：纯银项链" /></label>
        <div className="keyword-review-actions">
          <button type="button" className="node-primary-button" disabled={!currentRunId} onClick={submit}>
            <Check size={13} /> 确认并继续生成标题
          </button>
          <button type="button" className="node-secondary-button" disabled={!canRetry} onClick={onRetry}>
            <RefreshCw size={13} /> 重新搜索货源
          </button>
        </div>
        {message && <div className="artifact-error">{message}</div>}
      </section>
    </div>
  );
};
