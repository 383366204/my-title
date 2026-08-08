import { Check, Copy, ExternalLink, X } from 'lucide-react';
import { distributionRowCategory, distributionRowUrl, rowSelectedKeyword } from './distribution-view-model.js';

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
  const keyword = rowSelectedKeyword(row);
  const isPreview = variant === 'preview';

  if (isPreview) {
    if (isBlocked) {
      return (
        <article className="export-preview-row blocked">
          <div>
            <strong>{row.title}</strong>
            <span>被拦截，未加入</span>
            {keyword && <small className="selected-keyword-badge">选词：{keyword}</small>}
          </div>
          {row.description && <p>拦截原因：{row.description}</p>}
          {Array.isArray(row.metrics) && row.metrics.length > 0 && <p>{row.metrics.join(' · ')}</p>}
          {url && <p>{url}</p>}
          <div className="distribution-edit-grid">
            <label>
              <span>铺货标题</span>
              <input value={row.title || ''} onChange={(event) => onUpdateEdit?.(row.key, 'title', event.target.value)} />
            </label>
            <label>
              <span>铺货类目</span>
              <input
                value={distributionRowCategory(row)}
                onChange={(event) => onUpdateEdit?.(row.key, 'category', event.target.value)}
                placeholder="补充类目后再加入"
              />
            </label>
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
          <strong>{row.title || '未命名铺货项'}</strong>
          <span>{row.removed ? '已移除' : '将导出'}</span>
          {keyword && <small className="selected-keyword-badge">选词：{keyword}</small>}
        </div>
        {Array.isArray(row.metrics) && row.metrics.length > 0 && <p>{row.metrics.join(' · ')}</p>}
        {url && <p>{url}</p>}
        <div className="distribution-edit-grid">
          <label>
            <span>铺货标题</span>
            <input value={row.title || ''} disabled={row.removed} onChange={(event) => onUpdateEdit?.(row.key, 'title', event.target.value)} />
          </label>
          <label>
            <span>铺货类目</span>
            <input
              value={distributionRowCategory(row)}
              disabled={row.removed}
              onChange={(event) => onUpdateEdit?.(row.key, 'category', event.target.value)}
              placeholder="请选择或填写类目"
            />
          </label>
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
            <strong>{row.title}</strong>
            <span>{row.meta}</span>
            {keyword && <small className="selected-keyword-badge">选词：{keyword}</small>}
          </div>
          <em>未加入</em>
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
          <label>
            <span>铺货类目</span>
            <input
              value={distributionRowCategory(row)}
              onChange={(event) => onUpdateEdit?.(row.key, 'category', event.target.value)}
              placeholder="补充类目后再加入"
            />
          </label>
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
          <strong>{row.title || '未命名铺货项'}</strong>
          {row.meta && <span>{row.meta}{row.fromReview ? ' · 人工加入' : ''}</span>}
          {keyword && <small className="selected-keyword-badge">选词：{keyword}</small>}
        </div>
        <em>{row.removed ? '已移除' : '将导出'}</em>
      </div>
      {Array.isArray(row.metrics) && row.metrics.length > 0 && (
        <div className="review-row-meta">
          {row.metrics.map((metric) => <span key={metric}>{metric}</span>)}
        </div>
      )}
      {url && <p className="export-row-url">{url}</p>}
      <div className="distribution-edit-grid">
        <label>
          <span>铺货标题</span>
          <input value={row.title || ''} disabled={row.removed} onChange={(event) => onUpdateEdit?.(row.key, 'title', event.target.value)} />
        </label>
        <label>
          <span>铺货类目</span>
          <input
            value={distributionRowCategory(row)}
            disabled={row.removed}
            onChange={(event) => onUpdateEdit?.(row.key, 'category', event.target.value)}
            placeholder="请选择或填写类目"
          />
        </label>
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
