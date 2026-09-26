import { useState } from 'react';
import { RefreshCw } from 'lucide-react';

/** @param {object} props 商品及后端类目操作。 @returns {import('react').JSX.Element} 类目选择与查询。 */
export function CategoryControl({ row }) {
  const record = row.categoryRecord;
  const control = row.categoryControl;
  const [query, setQuery] = useState('');
  const disabled = row.removed || !record || control?.busy || control?.state?.locked
    || control?.state?.job?.status === 'running' || control?.state?.job?.inFlight;
  return <div className="distribution-category-control">
    <label>
      <span>铺货类目（生意参谋）</span>
      <select aria-label="铺货类目（生意参谋）" disabled={disabled} value={record?.category || ''}
        onChange={event => control?.act({ action: 'select', url: record.url, category: event.target.value })}>
        <option value="">{record?.candidates?.length ? '请选择参谋候选类目' : '待获取参谋类目'}</option>
        {(record?.candidates || []).map(item => <option key={item.category} value={item.category}>{item.category}{item.clickRatio != null ? ` · 点击人数占比 ${item.clickRatio}%` : ''}{item.clickRate != null ? ` · 点击率 ${item.clickRate}%` : ''}</option>)}
      </select>
    </label>
    <small>{record?.source === 'sycm_manual' ? '已人工确认参谋候选' : record?.category ? '生意参谋指标推荐' : '尚未确定铺货类目'}{record?.queryWord ? ` · 查询词：${record.queryWord}` : ''}</small>
    {record?.source1688Category && <small>1688 原始类目：{record.source1688Category}（参考）</small>}
    {record?.collectedAt && <small>查询时间：{new Date(record.collectedAt).toLocaleString('zh-CN')}</small>}
    {record?.legacyCategory && <small>历史类目来源未确认：{record.legacyCategory}</small>}
    {record?.error && <small role="alert">{record.error}</small>}
    <div className="distribution-category-query">
      <input aria-label="类目查询词" placeholder={record?.keyword || '类目查询词'} value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} />
      <button type="button" className="node-secondary-button" disabled={disabled}
        onClick={() => control?.act({ action: 'query', urls: [record.url], queryWord: query.trim() || record.keyword })}>
        <RefreshCw size={13} />{record?.candidates?.length ? '重新获取' : '获取类目'}
      </button>
    </div>
  </div>;
}
