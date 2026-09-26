import { Check, Copy, ExternalLink, X } from 'lucide-react';
import { distributionRowUrl, rowSelectedKeyword } from './distribution-view-model.js';
import { CategoryControl } from './category-control.jsx';

/**
 * Component to render a single distribution row item.
 * @param {object} props Component props.
 * @param {object} props.row Row data object.
 * @param {'workbench'|'preview'} [props.variant='workbench'] UI display variant.
 * @param {boolean} [props.isBlocked=false] Whether row is blocked by review system.
 * @param {Function} [props.onUpdateEdit] Edit callback (key, field, value).
 * @param {Function} [props.onMarkRemoved] Mark removal toggle callback (key, removed).
 * @param {Function} [props.onMarkIncluded] Mark inclusion toggle callback (key, included).
 * @param {Function} [props.onCopyText] Copy text handler function.
 * @returns {import('react').JSX.Element} React component element.
 */
export function DistributionRow({
  row,
  variant = 'workbench', // 'preview' | 'workbench'
  isBlocked = false,
  onUpdateEdit,
  onMarkRemoved,
  onMarkIncluded,
  onCopyText
}) {
  const url = distributionRowUrl(row);
  // 顶部展示原 1688 标题；上一步产物没匹配到时回退铺货标题
  const sourceTitle = String(row.sourceTitle || row.title || '未命名商品');
  const keyword = rowSelectedKeyword(row);
  const isPreview = variant === 'preview';

  if (isPreview) {
    if (isBlocked) {
      return (
        <article className="export-preview-row blocked">
          <div>
            <div className="export-row-title-line">
              <strong title={sourceTitle}>{sourceTitle}</strong>
              <em>未加入</em>
            </div>
            {keyword && <small className="selected-keyword-badge">选词：{keyword}</small>}
          </div>
          {row.description && <p>拦截原因：{row.description}</p>}
          {Array.isArray(row.metrics) && row.metrics.length > 0 && <p>{row.metrics.join(' · ')}</p>}
          <div className="distribution-edit-grid">
            <label>
              <span>铺货标题</span>
              <input value={row.title || ''} onChange={(event) => onUpdateEdit?.(row.key, 'title', event.target.value)} />
            </label>
            <CategoryControl row={row} />
          </div>
          <div className="review-row-actions">
            <button type="button" className="node-secondary-button success" onClick={() => onMarkIncluded?.(row.key, true)}>
              <Check size={13} /> 加入当前清单
            </button>
            {url && (
              <a className="node-secondary-button" href={url} target="_blank" rel="noreferrer">
                <ExternalLink size={13} /> 打开货源
              </a>
            )}
          </div>
        </article>
      );
    }

    return (
      <article className={`export-preview-row ${row.removed ? 'is-removed' : ''}`}>
        <div>
          <div className="export-row-title-line">
            <strong title={sourceTitle}>{sourceTitle}</strong>
            <em>{row.removed ? '已移除' : '将导出'}</em>
          </div>
          {keyword && <small className="selected-keyword-badge">选词：{keyword}</small>}
        </div>
        {Array.isArray(row.metrics) && row.metrics.length > 0 && <p>{row.metrics.join(' · ')}</p>}
        <div className="distribution-edit-grid">
          <label>
            <span>铺货标题</span>
            <input value={row.title || ''} disabled={row.removed} onChange={(event) => onUpdateEdit?.(row.key, 'title', event.target.value)} />
          </label>
          <CategoryControl row={row} />
        </div>
        <div className="review-row-actions">
          <button type="button" className={`node-secondary-button ${row.removed ? 'success' : 'danger'}`} onClick={() => onMarkRemoved?.(row.key, !row.removed)}>
            {row.removed ? <Check size={13} /> : <X size={13} />}
            {row.removed ? '恢复' : '移除'}
          </button>
          {url && (
            <a className="node-secondary-button" href={url} target="_blank" rel="noreferrer">
              <ExternalLink size={13} /> 打开货源
            </a>
          )}
        </div>
      </article>
    );
  }

  // Workbench variant
  if (isBlocked) {
    return (
      <article className="export-row blocked">
        <div className="export-row-head">
          <div>
            <div className="export-row-title-line">
              <strong title={sourceTitle}>{sourceTitle}</strong>
              <em>未加入</em>
            </div>
            <span>{row.meta}</span>
            {keyword && <small className="selected-keyword-badge">选词：{keyword}</small>}
          </div>
        </div>
        {Array.isArray(row.metrics) && row.metrics.length > 0 && (
          <div className="review-row-meta">
            {row.metrics.map((metric) => <span key={metric}>{metric}</span>)}
          </div>
        )}
        {row.description && <p className="export-row-url">拦截原因：{row.description}</p>}
        <div className="distribution-edit-grid">
          <label>
            <span>铺货标题</span>
            <input value={row.title || ''} onChange={(event) => onUpdateEdit?.(row.key, 'title', event.target.value)} />
          </label>
          <CategoryControl row={row} />
        </div>
        <div className="review-row-actions">
          <button type="button" className="node-secondary-button success" onClick={() => onMarkIncluded?.(row.key, true)}>
            <Check size={13} /> 加入当前清单
          </button>
          {url && (
            <a className="node-secondary-button" href={url} target="_blank" rel="noreferrer">
              <ExternalLink size={13} /> 打开货源
            </a>
          )}
        </div>
      </article>
    );
  }

  return (
    <article className={`export-row ${row.removed ? 'is-removed' : ''}`}>
      <div className="export-row-head">
        <div>
          <div className="export-row-title-line">
            <strong title={row.title || '未命名铺货项'}>{row.title || '未命名铺货项'}</strong>
            <em>{row.removed ? '已移除' : '将导出'}</em>
          </div>
          {row.meta && <span>{row.meta}{row.fromReview ? ' · 人工加入' : ''}</span>}
          {keyword && <small className="selected-keyword-badge">选词：{keyword}</small>}
        </div>
      </div>
      {Array.isArray(row.metrics) && row.metrics.length > 0 && (
        <div className="review-row-meta">
          {row.metrics.map((metric) => <span key={metric}>{metric}</span>)}
        </div>
      )}
      <div className="distribution-edit-grid">
        <label>
          <span>铺货标题</span>
          <input value={row.title || ''} disabled={row.removed} onChange={(event) => onUpdateEdit?.(row.key, 'title', event.target.value)} />
        </label>
        <CategoryControl row={row} />
      </div>
      <div className="review-row-actions">
        <button type="button" className="node-secondary-button" onClick={() => onCopyText?.(row.title || '')}>
          <Copy size={13} /> 复制标题
        </button>
        <button type="button" className={`node-secondary-button ${row.removed ? 'success' : 'danger'}`} onClick={() => onMarkRemoved?.(row.key, !row.removed)}>
          {row.removed ? <Check size={13} /> : <X size={13} />}
          {row.removed ? '恢复' : '移除'}
        </button>
        {url && (
          <a className="node-secondary-button" href={url} target="_blank" rel="noreferrer">
            <ExternalLink size={13} /> 打开货源
          </a>
        )}
      </div>
    </article>
  );
}
