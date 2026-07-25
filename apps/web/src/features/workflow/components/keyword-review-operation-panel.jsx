import { useMemo, useState } from 'react';
import { Check, CheckCircle2, Plus, RefreshCw, X } from 'lucide-react';

import { artifactItems, candidateKeyword } from '../workflow-data.js';

export const KeywordReviewOperationPanel = ({
  artifactState,
  onConfirmKeywordReview,
  onRetryMine,
  canConfirm,
  canRetryMine
}) => {
  const candidates = artifactItems(artifactState);
  const [decisions, setDecisions] = useState({});
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [manualKeywordDraft, setManualKeywordDraft] = useState('');
  const [manualKeywords, setManualKeywords] = useState([]);
  const candidateRows = useMemo(() => [...candidates, ...manualKeywords.map((keyword) => ({
    keyword,
    source: 'manual',
    reason: '用户手动添加',
    manualInput: true
  }))].map((item, index) => {
    const keyword = candidateKeyword(item);
    const key = `${keyword || 'candidate'}-${index}`;
    const persistedDecision = item.reviewStatus === 'rejected' ? 'rejected' : 'approved';
    return {
      ...item,
      keyword,
      key,
      reviewDecision: decisions[key] || persistedDecision
    };
  }), [candidates, decisions, manualKeywords]);
  const approvedCount = candidateRows.filter((item) => item.reviewDecision === 'approved').length;
  const rejectedCount = candidateRows.filter((item) => item.reviewDecision === 'rejected').length;
  const visibleRows = useMemo(() => candidateRows.filter((item) => {
    const text = `${item.keyword || ''} ${item.root || item.seed || ''} ${item.source || ''}`.toLowerCase();
    if (query.trim() && !text.includes(query.trim().toLowerCase())) return false;
    const marketScore = Number(item.marketScore ?? item.marketMetrics?.score ?? 0);
    const missing = Array.isArray(item.marketMetrics?.missing) ? item.marketMetrics.missing : [];
    if (filter === 'recommended') return marketScore >= 60 || Number(item.localScore || 0) >= 70;
    if (filter === 'missing') return missing.length > 0 || !item.sycmData;
    if (filter === 'high-confidence') return item.marketMetrics?.confidence === 'high' || item.confidence === 'high';
    if (filter === 'rejected') return item.reviewDecision === 'rejected';
    return true;
  }), [candidateRows, filter, query]);
  const setAllDecisions = (decision) => {
    setDecisions(Object.fromEntries(candidateRows.map((item) => [item.key, decision])));
  };
  const setDecision = (key, decision) => {
    setDecisions((current) => ({ ...current, [key]: decision }));
  };
  const addManualKeywords = () => {
    const incoming = manualKeywordDraft.split(/\r?\n|[,，]/).map((item) => item.trim()).filter(Boolean);
    if (incoming.length === 0) return;
    setManualKeywords((current) => [...new Set([...current, ...incoming])]);
    setManualKeywordDraft('');
  };

  return (
    <div className="node-embedded-workbench">
      <section className="node-workbench-section">
        <div className="node-workbench-head">
          <strong>候选词筛选</strong>
          <span>保留 {approvedCount} 个 · 筛除 {rejectedCount} 个</span>
        </div>
        <div className="keyword-review-manual-input">
          <input
            className="keyword-review-search"
            value={manualKeywordDraft}
            onChange={(event) => setManualKeywordDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addManualKeywords(); } }}
            placeholder="输入关键词后加入候选，可用逗号分隔"
            aria-label="手动输入关键词"
          />
          <button type="button" className="node-secondary-button" onClick={addManualKeywords} disabled={!manualKeywordDraft.trim()}>
            <Plus size={13} /> 加入候选词
          </button>
        </div>
        {manualKeywords.length > 0 && (
          <div className="node-chip-list keyword-review-manual-list">
            {manualKeywords.map((keyword) => <span className="workflow-template-chip" key={keyword}>{keyword}</span>)}
          </div>
        )}
        {candidateRows.length > 0 && (
          <div className="keyword-review-toolbar">
            <input className="keyword-review-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索关键词或词根" aria-label="搜索候选关键词" />
            <select className="keyword-review-filter" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="筛选候选词">
              <option value="all">全部候选词</option>
              <option value="recommended">优先推荐</option>
              <option value="high-confidence">高置信度</option>
              <option value="missing">有缺失指标</option>
              <option value="rejected">已筛除</option>
            </select>
            <button type="button" className="node-secondary-button success" onClick={() => setAllDecisions('approved')}>
              <Check size={13} /> 全部保留
            </button>
            <button type="button" className="node-secondary-button danger" onClick={() => setAllDecisions('rejected')}>
              <X size={13} /> 全部筛除
            </button>
          </div>
        )}
        <div className="node-candidate-list">
          {visibleRows.slice(0, 20).map((item) => (
            <div className={`node-candidate-row keyword-review-row ${item.reviewDecision === 'rejected' ? 'is-rejected' : 'is-approved'}`} key={item.key}>
              <div>
                <strong>{item.keyword || '未命名候选词'}</strong>
                <span>{item.root || item.seed ? `词根：${item.root || item.seed}` : ''} {item.source ? `· 来源：${item.source}` : ''}</span>
                <span>{item.reason || item.gateReason || item.tier || '人工判断是否进入生意参谋'}</span>
                {(item.marketMetrics?.missing?.length > 0 || item.marketMetrics?.breakdown) && (
                  <details className="keyword-review-detail">
                    <summary>查看评分依据</summary>
                    {item.marketMetrics?.missing?.length > 0 && <span>缺失：{item.marketMetrics.missing.join('、')}</span>}
                    {item.marketMetrics?.confidence && <span>置信度：{item.marketMetrics.confidence === 'high' ? '高' : item.marketMetrics.confidence === 'medium' ? '中' : '低'}</span>}
                    {item.marketMetrics?.breakdown && <span>评分：需求 {Math.round(item.marketMetrics.breakdown.demand || 0)} · 搜索 {Math.round(item.marketMetrics.breakdown.search || 0)} · 点击 {Math.round(item.marketMetrics.breakdown.click || 0)} · 转化 {Math.round(item.marketMetrics.breakdown.conversion || 0)}</span>}
                  </details>
                )}
              </div>
              <div className="keyword-review-actions">
                {item.localScore ? <small>本地分 {item.localScore}</small> : <small>{item.tier || ''}</small>}
                {item.sycmData?.searchPopularity != null && <small>人气 {item.sycmData.searchPopularity}</small>}
                {item.sycmData?.demandSupplyRatio != null && <small>供需 {item.sycmData.demandSupplyRatio}</small>}
                {item.marketScore != null && <small>市场分 {item.marketScore}</small>}
                <button
                  type="button"
                  className={`node-secondary-button success ${item.reviewDecision === 'approved' ? 'active' : ''}`}
                  onClick={() => setDecision(item.key, 'approved')}
                >
                  <Check size={13} /> 保留
                </button>
                <button
                  type="button"
                  className={`node-secondary-button danger ${item.reviewDecision === 'rejected' ? 'active' : ''}`}
                  onClick={() => setDecision(item.key, 'rejected')}
                >
                  <X size={13} /> 筛除
                </button>
              </div>
            </div>
          ))}
          {candidates.length === 0 && manualKeywords.length === 0 && <div className="artifact-empty">暂无候选词，可以先手动输入关键词。</div>}
        </div>
        <div className="node-product-actions">
          <button type="button" className="node-primary-button" onClick={() => onConfirmKeywordReview(candidateRows, manualKeywords)} disabled={!canConfirm || candidateRows.length === 0}>
            <CheckCircle2 size={14} /> 确认筛词结果
          </button>
          <button type="button" className="node-secondary-button" onClick={onRetryMine} disabled={!canRetryMine}>
            <RefreshCw size={13} /> 返回挖词重跑
          </button>
        </div>
        <p className="node-workbench-note">确认后，只有“保留”的关键词会进入生意参谋校验；“筛除”的关键词会写入记录但不继续请求平台。</p>
      </section>
    </div>
  );
};
