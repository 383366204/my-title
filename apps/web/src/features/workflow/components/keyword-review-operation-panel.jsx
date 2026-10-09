import { useEffect, useMemo, useState } from 'react';
import { Check, CheckCircle2, Plus, RefreshCw, Settings2, X } from 'lucide-react';
import { KeywordFilterModal } from './keyword-filter-modal.jsx';
import { KeywordReviewTransfer } from './keyword-review-transfer.jsx';

import { artifactItems, candidateKeyword } from '../workflow-data.js';

export const KeywordReviewOperationPanel = ({
  artifactState,
  currentRunId,
  onKeywordFilterApplied,
  onKeywordFilterRecollected,
  onConfirmKeywordReview,
  onQueryKeywords,
  onRetryMine,
  canConfirm,
  canRetryMine,
  retryLabel = '重试查询'
}) => {
  const candidates = artifactItems(artifactState);
  const combined = artifactState.artifact?.combinedOpportunityReview === true || candidates.some(row => row.combinedOpportunityReview);
  const [decisions, setDecisions] = useState({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [manualKeywordDraft, setManualKeywordDraft] = useState('');
  const [manualKeywords, setManualKeywords] = useState([]);
  const [visibleLimit, setVisibleLimit] = useState(50);
  const candidateRows = useMemo(() => [...candidates, ...manualKeywords.map((keyword) => ({
    keyword,
    source: 'manual',
    reason: '用户手动添加',
    manualInput: true
  }))].map((item, index) => {
    const keyword = candidateKeyword(item);
    const key = keyword || `candidate-${index}`;
    const persistedDecision = item.reviewDraft || (item.reviewStatus === 'approved' ? 'approved' : item.reviewStatus === 'rejected' ? 'rejected'
      : combined && !item.reviewRecommended ? 'rejected' : 'approved');
    return {
      ...item,
      keyword,
      key,
      reviewDecision: decisions[key] || persistedDecision
    };
  }), [candidates, decisions, manualKeywords, combined]);
  const [confirming, setConfirming] = useState(false);
  const [riskConfirmation, setRiskConfirmation] = useState(false);
  const riskyCount = candidateRows.filter(row => row.reviewDecision === 'approved' && !row.reviewRecommended).length;
  const submitSelection = async () => {
    setConfirming(true);
    try { await onConfirmKeywordReview(candidateRows, manualKeywords, artifactState.artifact?.keywordFilterVersion); } finally { setConfirming(false); setRiskConfirmation(false); }
  };
  const confirmSelection = () => {
    if (combined && riskyCount) setRiskConfirmation(true);
    else return submitSelection();
  };
  useEffect(() => setRiskConfirmation(false), [decisions, manualKeywords]);
  const approvedCount = candidateRows.filter((item) => item.reviewDecision === 'approved').length;
  const rejectedCount = candidateRows.filter((item) => item.reviewDecision === 'rejected').length;
  const visibleRows = useMemo(() => candidateRows.filter((item) => {
    const text = `${item.keyword || ''} ${item.root || item.seed || ''} ${item.source || ''}`.toLowerCase();
    if (query.trim() && !text.includes(query.trim().toLowerCase())) return false;
    const marketScore = Number(item.marketScore ?? item.marketMetrics?.score ?? 0);
    const missing = Array.isArray(item.marketMetrics?.missing) ? item.marketMetrics.missing : [];
    if (filter === 'recommended') return combined ? item.reviewRecommended === true : marketScore >= 60 || Number(item.localScore || 0) >= 70;
    if (filter === 'pending') return item.metricFilter?.status === 'review';
    if (filter === 'failed') return item.metricFilter?.status === 'failed';
    if (filter === 'missing') return item.metricFilter?.checks?.some(check => check.status === 'review') || missing.length > 0 || !item.sycmData;
    if (filter === 'high-confidence') return item.marketMetrics?.confidence === 'high' || item.confidence === 'high';
    if (filter === 'rejected') return item.reviewDecision === 'rejected';
    return true;
  }), [candidateRows, filter, query, combined]);
  useEffect(() => setVisibleLimit(50), [filter, query]);
  const setAllDecisions = (decision) => {
    setDecisions(Object.fromEntries(candidateRows.map((item) => [item.key, decision])));
  };
  const setDecision = (key, decision) => {
    setDecisions((current) => ({ ...current, [key]: decision }));
  };
  const addManualKeywords = () => {
    const incoming = manualKeywordDraft.split(/\r?\n|[,，]/).map((item) => item.trim()).filter(Boolean);
    if (incoming.length === 0) return;
    const existing = new Set(candidates.map(candidateKeyword));
    setManualKeywords((current) => [...new Set([...current, ...incoming])].filter(word => !existing.has(word)));
    setManualKeywordDraft('');
  };
  const querySupplement = async () => {
    const keywords = [...new Set([...manualKeywords, ...manualKeywordDraft.split(/\r?\n|[,，]/).map(word => word.trim()).filter(Boolean)])];
    setConfirming(true);
    try {
      await onQueryKeywords({ keywords, decisions: Object.fromEntries(candidateRows.map(row => [row.key, row.reviewDecision])) });
    } finally { setConfirming(false); }
  };

  return (
    <div className="grid gap-3">
      <section className="grid gap-2.5 min-w-0">
        <div className="flex items-center justify-between gap-2.5">
          <strong>{combined ? '关键词确认' : '候选词筛选'}</strong>
          <span>已选 {approvedCount} / 共 {candidateRows.length} 个 · 排除 {rejectedCount} 个</span>
        </div>
        {combined && <div className="mt-2 rounded-lg border border-emerald-500/28 bg-emerald-900/18 text-emerald-200 text-[11px] font-extrabold leading-[1.35] px-2 py-[7px]">
          符合 {candidates.filter(row => row.metricFilter?.passed).length} · 待确认 {candidates.filter(row => row.metricFilter?.status === 'review').length} · 不符合 {candidates.filter(row => row.metricFilter?.status === 'failed').length}
        </div>}
        <div className="flex flex-wrap gap-2 items-center my-2.5">
          {combined && currentRunId && <button type="button" className="node-secondary-button" disabled={confirming} onClick={() => setFilterOpen(true)}>
            <Settings2 size={13} /> 筛选条件
          </button>}
          <input
            className="flex-1 min-h-8 px-2.5 bg-[#090f1f] border border-slate-600 rounded-md text-slate-200 min-w-[160px]"
            value={manualKeywordDraft}
            onChange={(event) => setManualKeywordDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addManualKeywords(); } }}
            placeholder="输入关键词后加入候选，可用逗号分隔"
            aria-label="手动输入关键词"
            disabled={!canConfirm || confirming}
          />
          <button type="button" className="node-secondary-button" onClick={addManualKeywords} disabled={!canConfirm || confirming || !manualKeywordDraft.trim()}>
            <Plus size={13} /> 加入候选词
          </button>
          {combined && onQueryKeywords && <button type="button" className="node-secondary-button" onClick={querySupplement}
            disabled={!canConfirm || confirming || (!manualKeywordDraft.trim() && !manualKeywords.length)}>
            <RefreshCw size={13} /> 查询补充词
          </button>}
        </div>
        {manualKeywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5 max-h-[150px] overflow-auto mb-2.5">
            {manualKeywords.map((keyword) => <span className="inline-flex items-center min-h-5 max-w-full px-[7px] py-0.5 rounded-full border border-slate-700/92 bg-slate-900/68 text-slate-300 text-[10px]" key={keyword}>{keyword}</span>)}
          </div>
        )}
        {candidateRows.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <input className="flex-1 min-h-8 px-2.5 bg-[#090f1f] border border-slate-600 rounded-md text-slate-200 min-w-[160px]" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索关键词或词根" aria-label="搜索候选关键词" />
            {!combined && <select className="min-h-8 px-2.5 bg-[#090f1f] border border-slate-600 rounded-md text-slate-200" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="筛选候选词">
              <option value="all">全部候选词</option>
              <option value="recommended">{combined ? '符合筛选条件' : '推荐采用'}</option>
              {combined && <option value="pending">待人工判断</option>}
              {combined && <option value="failed">不符合条件</option>}
              {!combined && <option value="high-confidence">高置信度</option>}
              <option value="missing">有缺失指标</option>
              <option value="rejected">已筛除</option>
            </select>}
            {combined && <button type="button" className="node-secondary-button success" disabled={!canConfirm || confirming}
              onClick={() => setDecisions(Object.fromEntries(candidateRows.map(item => [item.key, item.reviewRecommended ? 'approved' : 'rejected'])))}>
              <Check size={13} /> 选择符合条件项
            </button>}
            {!combined && <button type="button" className="node-secondary-button success" disabled={!canConfirm || confirming} onClick={() => setAllDecisions('approved')}>
              <Check size={13} /> 全部保留
            </button>}
            {!combined && <button type="button" className="node-secondary-button danger" disabled={!canConfirm || confirming} onClick={() => setAllDecisions('rejected')}>
              <X size={13} /> 全部筛除
            </button>}
          </div>
        )}
        {combined ? <KeywordReviewTransfer rows={candidateRows} visibleRows={visibleRows} disabled={!canConfirm || confirming}
          onMove={(keys, decision) => setDecisions(current => ({ ...current, ...Object.fromEntries(keys.map(key => [key, decision])) }))} /> : <div className="grid gap-[7px] max-h-[250px] overflow-auto">
          {visibleRows.slice(0, visibleLimit).map((item) => (
            <div className={`node-candidate-row keyword-review-row ${item.reviewDecision === 'rejected' ? 'is-rejected' : 'is-approved'}`} key={item.key}>
              <input type="checkbox" aria-label={`采用 ${item.keyword}`} checked={item.reviewDecision === 'approved'} disabled={!canConfirm || confirming}
                onChange={event => setDecision(item.key, event.target.checked ? 'approved' : 'rejected')} />
              <div>
                <strong>{item.keyword || '未命名候选词'}</strong>
                <span>{item.root || item.seed ? `词根：${item.root || item.seed}` : ''} {item.source ? `· 来源：${item.source}` : ''}</span>
                <span>{item.reason || item.gateReason || item.tier || '人工判断是否用于选品'}</span>
                {combined && <>
                  <span>{item.reviewRecommended ? '符合全部筛选条件' : '未通过筛选，需人工判断'}</span>
                  {!item.reviewRecommended && item.reviewDecision === 'approved' && <span className="text-[#d99a28] text-xs break-words">已选中，但未满足当前条件；确认继续时需人工放行。</span>}
                  {item.metricFilter?.checks?.map(check => <span key={check.key}>
                    {check.condition} · 当前值：{check.raw == null || check.raw === '' ? '缺失' : String(check.raw)} · {check.reason}
                  </span>)}
                  {!item.metricFilter && <span>等待重新获取指标筛选结果</span>}
                  {item.keywordOpportunity?.manualApproval?.approved && <span>已人工放行，原始指标保留</span>}
                </>}
                {!combined && (item.marketMetrics?.missing?.length > 0 || item.marketMetrics?.breakdown) && (
                  <details className="text-[#667085] text-xs mt-[5px] [&>summary]:cursor-pointer [&>summary]:inline-block [&>summary]:mb-1 [&>span]:block">
                    <summary>查看评分依据</summary>
                    {item.marketMetrics?.missing?.length > 0 && <span>缺失：{item.marketMetrics.missing.join('、')}</span>}
                    {item.marketMetrics?.confidence && <span>置信度：{item.marketMetrics.confidence === 'high' ? '高' : item.marketMetrics.confidence === 'medium' ? '中' : '低'}</span>}
                    {item.marketMetrics?.breakdown && <span>评分：需求 {Math.round(item.marketMetrics.breakdown.demand || 0)} · 搜索 {Math.round(item.marketMetrics.breakdown.search || 0)} · 点击 {Math.round(item.marketMetrics.breakdown.click || 0)} · 转化 {Math.round(item.marketMetrics.breakdown.conversion || 0)}</span>}
                  </details>
                )}
              </div>
              <div className="flex flex-wrap justify-end items-center gap-1.5">
                {!combined && (item.localScore ? <small>本地分 {item.localScore}</small> : <small>{item.tier || ''}</small>)}
                {item.sycmData?.searchPopularity != null && <small>人气 {item.sycmData.searchPopularity}</small>}
                {item.sycmData?.demandSupplyRatio != null && <small>供需 {item.sycmData.demandSupplyRatio}</small>}
                {!combined && item.marketScore != null && <small>市场分 {item.marketScore}</small>}
                <button
                  type="button"
                  className={`node-secondary-button success ${item.reviewDecision === 'approved' ? 'active' : ''}`}
                  onClick={() => setDecision(item.key, 'approved')}
                  disabled={!canConfirm || confirming}
                >
                  <Check size={13} /> {combined && !item.reviewRecommended ? '人工放行' : '保留'}
                </button>
                <button
                  type="button"
                  className={`node-secondary-button danger ${item.reviewDecision === 'rejected' ? 'active' : ''}`}
                  onClick={() => setDecision(item.key, 'rejected')}
                  disabled={!canConfirm || confirming}
                >
                  <X size={13} /> 筛除
                </button>
              </div>
            </div>
          ))}
          {candidates.length === 0 && manualKeywords.length === 0 && <div className="artifact-empty">暂无候选词，可以先手动输入关键词。</div>}
        </div>}
        {!combined && visibleRows.length > visibleLimit && (
          <button type="button" className="node-secondary-button" onClick={() => setVisibleLimit((current) => current + 50)}>
            继续显示（剩余 {visibleRows.length - visibleLimit} 个）
          </button>
        )}
        <div className="node-product-actions">
          <button type="button" className="node-primary-button" onClick={confirmSelection} disabled={confirming || !canConfirm || approvedCount === 0}>
            <CheckCircle2 size={14} /> {confirming ? '正在确认' : combined ? `确认 ${approvedCount} 个词并继续` : '确认筛词结果'}
          </button>
          <button type="button" className="node-secondary-button" onClick={onRetryMine} disabled={!canRetryMine}>
            <RefreshCw size={13} /> {retryLabel}
          </button>
        </div>
        {riskConfirmation && <section className="grid gap-2.5 p-3 border border-slate-800/90 rounded-lg bg-slate-950/[0.42]" role="alertdialog" aria-label="确认人工放行">
          <strong>确认人工放行 {riskyCount} 个关键词？</strong>
          <p>这些词未满足筛选条件或缺少指标。原始指标和筛选原因会保留，放行后可以继续货源选品。</p>
          <div className="node-product-actions">
            <button type="button" className="node-secondary-button" disabled={confirming} onClick={() => setRiskConfirmation(false)}>返回调整</button>
            <button type="button" className="node-primary-button" disabled={confirming || !canConfirm} onClick={submitSelection}>确认人工放行</button>
          </div>
        </section>}
        <p className="node-workbench-note">{combined ? '按本次运行的筛选条件判断，人工放行保留原始指标。' : '确认后，只有"保留"的关键词会进入生意参谋校验；"筛除"的关键词会写入记录但不继续请求平台。'}</p>
      </section>
      {filterOpen && <KeywordFilterModal runId={currentRunId} decisions={Object.fromEntries(Object.entries(decisions).filter(([key]) => candidates.some(row => candidateKeyword(row) === key)))}
        onRecollected={onKeywordFilterRecollected}
        onApplied={async result => { setRiskConfirmation(false); await onKeywordFilterApplied?.(result); }} onClose={() => setFilterOpen(false)} />}
    </div>
  );
};
