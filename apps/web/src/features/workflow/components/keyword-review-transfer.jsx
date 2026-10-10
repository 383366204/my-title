import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown } from 'lucide-react';

function metricPresentation(check, metric, fallback, legacyTrend, legacyDirection) {
  let value = check?.displayValue ?? metric?.displayValue ?? check?.raw ?? metric?.raw ?? fallback;
  let trendRaw = check?.trendRaw ?? metric?.trendRaw ?? legacyTrend;
  const text = String(value ?? '').trim();
  const match = text.match(/^(.*?)([+-]\d+(?:\.\d+)?%)$/)
    || text.match(/^(.*?)\s+(\d+(?:\.\d+)?%)$/);
  // 只拆完整指标后的变化率，不能把百分比区间的上界当作变化率。
  if (match && /^[\d.]+(?:千|万|亿)?%?(?:\s*[~～至—–]\s*[\d.]+(?:千|万|亿)?%?)?$/.test(match[1].trim())) {
    value = match[1].trim();
    trendRaw ??= match[2];
  }
  const direction = check?.trendDirection ?? metric?.trendDirection ?? legacyDirection
    ?? (String(trendRaw || '').startsWith('-') ? 'down' : String(trendRaw || '').startsWith('+') ? 'up' : null);
  return { value, trendRaw, direction };
}

/**
 * 复核穿梭列表：移动只修改人工决定，不改写指标判断。
 * @param {object} props 候选词、搜索结果及决定更新回调。
 * @returns {import('react').JSX.Element} 双栏关键词复核列表。
 */
export function KeywordReviewTransfer({ rows, visibleRows, disabled, onMove }) {
  const [marked, setMarked] = useState(new Set());
  const [limits, setLimits] = useState({ rejected: 50, approved: 50 });
  useEffect(() => { setMarked(new Set()); setLimits({ rejected: 50, approved: 50 }); }, [visibleRows]);
  const move = (keys, decision) => {
    onMove(keys, decision);
    setMarked(new Set());
  };
  const toggle = key => setMarked(current => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  return <div className="keyword-transfer">
    {['rejected', 'approved'].map(side => {
      const kept = side === 'approved';
      const filtered = visibleRows.filter(row => row.reviewDecision === side);
      const count = rows.filter(row => row.reviewDecision === side).length;
      const selected = filtered.filter(row => marked.has(row.key)).map(row => row.key);
      const all = filtered.length > 0 && selected.length === filtered.length;
      const Icon = kept ? ArrowLeft : ArrowRight;
      const target = kept ? 'rejected' : 'approved';
      const name = kept ? '符合条件 / 已保留' : '不符合 / 待判断';
      return <section className={`keyword-transfer-pane ${kept ? 'is-approved' : 'is-rejected'}`} aria-label={name} key={side}>
        <header><strong>{name}</strong><span>{count} 个</span></header>
        <div className="keyword-transfer-toolbar">
          <label className="keyword-filter-toggle"><input type="checkbox" aria-label={`全选${name}搜索结果`} checked={all} disabled={disabled || !filtered.length}
            ref={element => { if (element) element.indeterminate = selected.length > 0 && !all; }}
            onChange={() => setMarked(current => {
              const next = new Set(current);
              for (const row of filtered) if (all) next.delete(row.key); else next.add(row.key);
              return next;
            })} /><span>全选结果 {filtered.length}</span></label>
          <button type="button" className="node-secondary-button" disabled={disabled || !selected.length} onClick={() => move(selected, target)}>
            <Icon size={14} />{kept ? '移出' : '保留'}所选{selected.length ? ` ${selected.length}` : ''}
          </button>
        </div>
        <div className="keyword-transfer-list">
          {filtered.slice(0, limits[side]).map(row => <div className="keyword-transfer-row" key={row.key}>
            <input type="checkbox" aria-label={`选择 ${row.keyword}`} checked={marked.has(row.key)} disabled={disabled} onChange={() => toggle(row.key)} />
            <div className="keyword-transfer-content">
              <div className="keyword-transfer-heading">
                <strong>{row.keyword}</strong>
                {(row.root || row.seed) && <span>词根：{row.root || row.seed}</span>}
              </div>
              <div className="keyword-transfer-metrics">
                { [['searchPopularity', '人气'], ['demandSupplyRatio', '供需'], ['conversionRate', '转化'], ['tmallClickShare', '天猫占比']].map(([key, label]) => {
                  const check = row.metricFilter?.checks?.find(item => item.key === key);
                  const { value, trendRaw, direction } = metricPresentation(check, row.sycmData?.metrics?.[key], row.sycmData?.[key], row.sycmData?.[`${key}_trend`], row.sycmData?.[`${key}_trendDirection`]);
                  const status = check?.enabled === false ? 'disabled' : check?.status || 'review';
                  return <span key={key} className={`keyword-check-${status}`} title={check ? `${check.condition} · ${check.reason}` : '暂无筛选依据'}>
                    {label} {value == null || value === '' ? '缺失' : String(value)}
                    {trendRaw && <span className="keyword-metric-trend" style={{ color: direction === 'up' ? '#f87171' : direction === 'down' ? '#6ee7b7' : '#94a3b8' }} title={direction === 'up' ? '上涨' : direction === 'down' ? '下降' : '涨跌方向未知'}>
                      {' '}{trendRaw}{direction === 'up' ? <ArrowUp size={12} aria-label="上涨" /> : direction === 'down' ? <ArrowDown size={12} aria-label="下降" /> : null}
                    </span>}
                    {!trendRaw && <span className="keyword-metric-trend text-slate-400" title="历史记录未保存变化率，需要重新采集生意参谋数据">-</span>}
                  </span>;
                })}
              </div>
              {!row.reviewRecommended && kept && <span className="keyword-status-warning">人工保留 · 未通过条件</span>}
            </div>
            <button type="button" className="keyword-transfer-arrow" aria-label={`${kept ? '移出' : '保留'} ${row.keyword}`} title={kept ? '移出已保留' : '移入已保留'} disabled={disabled} onClick={() => move([row.key], target)}><Icon size={16} /></button>
          </div>)}
          {!filtered.length && <p className="artifact-empty">{count ? '没有匹配的关键词' : '暂无关键词'}</p>}
          {filtered.length > limits[side] && <button type="button" className="node-secondary-button" onClick={() => setLimits(current => ({ ...current, [side]: current[side] + 50 }))}>继续显示（剩余 {filtered.length - limits[side]} 个）</button>}
        </div>
      </section>;
    })}
  </div>;
}
