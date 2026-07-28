import { useEffect, useMemo, useState } from 'react';
import { Check, Link2, Plus, Trash2, X } from 'lucide-react';

function normalizeOfferUrl(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (parsed.hostname !== '1688.com' && !parsed.hostname.endsWith('.1688.com')) return null;
    const pathMatch = parsed.pathname.match(/\/offer\/(\d+)(?:\.html)?/i);
    const offerId = pathMatch?.[1] || parsed.searchParams.get('offerId') || parsed.searchParams.get('offer_id');
    if (!offerId || !/^\d+$/.test(offerId)) return null;
    return { offerId, url: `https://detail.1688.com/offer/${offerId}.html` };
  } catch {
    return null;
  }
}

function emptyRow(index = 0) {
  return { clientId: `manual-${Date.now()}-${index}`, keyword: '', url: '' };
}

export function ManualWorkflowInputPanel({ initialDefaultKeyword = '', initialItems = [], onCancel, onSave }) {
  const [defaultKeyword, setDefaultKeyword] = useState(initialDefaultKeyword);
  const [rows, setRows] = useState(initialItems.length > 0 ? initialItems : [emptyRow()]);
  const [bulkUrls, setBulkUrls] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    setDefaultKeyword(initialDefaultKeyword || '');
    setRows(initialItems.length > 0 ? initialItems : [emptyRow()]);
    setBulkUrls('');
    setMessage('');
  }, [initialDefaultKeyword, initialItems]);

  const validCount = useMemo(() => rows.filter((row) => normalizeOfferUrl(row.url) && String(row.keyword || defaultKeyword).trim()).length, [defaultKeyword, rows]);

  const updateRow = (clientId, key, value) => {
    setRows((current) => current.map((row) => row.clientId === clientId ? { ...row, [key]: value } : row));
  };

  const removeRow = (clientId) => {
    setRows((current) => {
      const next = current.filter((row) => row.clientId !== clientId);
      return next.length > 0 ? next : [emptyRow()];
    });
  };

  const applyDefaultKeyword = () => {
    const keyword = defaultKeyword.trim();
    if (!keyword) {
      setMessage('请先填写默认关键词。');
      return;
    }
    setRows((current) => current.map((row) => ({ ...row, keyword: row.keyword.trim() || keyword })));
    setMessage('默认关键词已应用到未填写关键词的商品。');
  };

  const appendBulkUrls = () => {
    const incoming = bulkUrls
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        const parts = line.split('$$').map((part) => part.trim());
        const urlPart = parts.find((part) => /1688\.com/i.test(part)) || line;
        const keywordPart = parts.length > 1 && parts[0] !== urlPart ? parts[0] : defaultKeyword;
        const normalized = normalizeOfferUrl(urlPart);
        return normalized ? {
          clientId: `manual-${normalized.offerId}-${Date.now()}-${index}`,
          keyword: String(keywordPart || '').trim(),
          url: normalized.url
        } : null;
      })
      .filter(Boolean);
    if (incoming.length === 0) {
      setMessage('没有识别到有效的 1688 商品链接。');
      return;
    }
    setRows((current) => {
      const usableCurrent = current.filter((row) => row.url.trim() || row.keyword.trim());
      const merged = [...usableCurrent, ...incoming];
      return [...new Map(merged.map((row) => [normalizeOfferUrl(row.url)?.offerId || row.clientId, row])).values()];
    });
    setBulkUrls('');
    setMessage(`已加入 ${incoming.length} 个商品链接。`);
  };

  const submit = () => {
    const normalizedRows = [];
    const seenOfferIds = new Set();
    for (const [index, row] of rows.entries()) {
      const keyword = String(row.keyword || defaultKeyword).trim();
      const normalized = normalizeOfferUrl(row.url);
      if (!row.url.trim() && !row.keyword.trim()) continue;
      if (!keyword) {
        setMessage(`第 ${index + 1} 行缺少关键词。`);
        return;
      }
      if (!normalized) {
        setMessage(`第 ${index + 1} 行不是有效的 1688 商品链接。`);
        return;
      }
      if (seenOfferIds.has(normalized.offerId)) {
        setMessage(`第 ${index + 1} 行的 1688 商品链接与前面的商品重复。`);
        return;
      }
      seenOfferIds.add(normalized.offerId);
      normalizedRows.push({
        clientId: row.clientId || `manual-${normalized.offerId}`,
        keyword,
        url: normalized.url
      });
    }
    if (normalizedRows.length === 0) {
      setMessage('请至少输入一个关键词和 1688 商品链接。');
      return;
    }
    onSave({ defaultKeyword: defaultKeyword.trim(), items: normalizedRows });
  };

  return (
    <section className="workflow-modal manual-workflow-input-modal" role="dialog" aria-modal="true" aria-label="录入关键词和1688货源" onClick={(event) => event.stopPropagation()}>
      <div className="workflow-modal-head">
        <div>
          <strong>录入关键词和1688货源</strong>
          <span>每个链接会绑定一个关键词，运行后直接获取商品资料并生成标题。</span>
        </div>
        <button type="button" className="node-icon-button" title="关闭" onClick={onCancel}><X size={14} /></button>
      </div>

      <div className="manual-input-body">
        <div className="manual-input-toolbar">
          <label className="node-field manual-default-keyword">
            <span>默认关键词</span>
            <input value={defaultKeyword} onChange={(event) => setDefaultKeyword(event.target.value)} placeholder="例如：法式复古连衣裙" />
          </label>
          <button type="button" className="node-secondary-button" onClick={applyDefaultKeyword}><Check size={13} /> 应用到空白行</button>
        </div>

        <div className="manual-input-table" role="table" aria-label="关键词与1688链接">
          <div className="manual-input-row is-head" role="row">
            <span>关键词</span><span>1688商品链接</span><span>操作</span>
          </div>
          {rows.map((row, index) => (
            <div className="manual-input-row" role="row" key={row.clientId}>
              <input value={row.keyword} onChange={(event) => updateRow(row.clientId, 'keyword', event.target.value)} placeholder={defaultKeyword || `第 ${index + 1} 个商品关键词`} />
              <input value={row.url} onChange={(event) => updateRow(row.clientId, 'url', event.target.value)} placeholder="https://detail.1688.com/offer/123456.html" />
              <button type="button" className="node-icon-button danger" title="删除此行" onClick={() => removeRow(row.clientId)}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>

        <button type="button" className="node-secondary-button" onClick={() => setRows((current) => [...current, emptyRow(current.length)])}><Plus size={13} /> 添加一行</button>

        <div className="manual-bulk-input">
          <div className="node-workbench-head"><strong>批量粘贴链接</strong><span>一行一个，也支持“关键词$$链接”</span></div>
          <textarea className="node-field-textarea" rows="4" value={bulkUrls} onChange={(event) => setBulkUrls(event.target.value)} placeholder="https://detail.1688.com/offer/123456.html\n法式连衣裙$$https://detail.1688.com/offer/789012.html" />
          <button type="button" className="node-secondary-button" disabled={!bulkUrls.trim()} onClick={appendBulkUrls}><Link2 size={13} /> 加入列表</button>
        </div>

        {message && <div className="manual-input-message">{message}</div>}
      </div>

      <div className="manual-input-footer">
        <span>已准备 {validCount} 个有效商品</span>
        <div>
          <button type="button" className="node-secondary-button" onClick={onCancel}>取消</button>
          <button type="button" className="node-primary-button" onClick={submit}><Check size={13} /> 保存并返回画布</button>
        </div>
      </div>
    </section>
  );
}
