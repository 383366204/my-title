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
  index,
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
        <article className="grid grid-cols-[minmax(0,1fr)] gap-2 min-w-0 border border-amber-500/32 rounded-lg bg-[rgba(120,53,15,0.12)] p-[11px]">
          <div>
            <div className="flex items-center gap-1.5 min-w-0">
              <strong className="block text-slate-200 text-[13px] leading-[1.35] break-all" title={sourceTitle}>{sourceTitle}</strong>
              <em className="shrink-0 ml-auto whitespace-nowrap rounded-full bg-slate-900/95 text-slate-300 text-[10px] not-italic font-extrabold px-[7px] py-1">未加入</em>
            </div>
            {keyword && <small className="mt-1.5 inline-flex w-fit max-w-full items-center border border-sky-500/32 rounded-full bg-sky-900/28 text-sky-200 text-[10px] font-extrabold leading-[1.1] px-[7px] py-1 break-all">选词：{keyword}</small>}
          </div>
          {row.description && <p className="m-0 text-slate-400 text-[11px] leading-[1.45] break-all">拦截原因：{row.description}</p>}
          {Array.isArray(row.metrics) && row.metrics.length > 0 && <p className="m-0 text-slate-400 text-[11px] leading-[1.45] break-all">{row.metrics.join(' · ')}</p>}
          <div className="grid min-w-0 grid-cols-[minmax(0,1.5fr)_minmax(180px,0.7fr)] gap-2.5 my-2.5 max-sm:grid-cols-[minmax(0,1fr)] [&>label]:flex [&>label]:min-w-0 [&>label]:flex-col [&>label]:gap-[5px] [&>label]:text-slate-400 [&>label]:text-[10px] [&>label]:font-bold [&>input]:w-full [&>input]:min-w-0 [&>input]:py-2 [&>input]:px-[9px] [&>input]:border [&>input]:border-slate-700 [&>input]:rounded-[5px] [&>input]:bg-[#091224] [&>input]:text-slate-200 [&>input]:text-xs [&>input:focus]:border-blue-500 [&>input:focus]:outline-none [&>input:disabled]:cursor-not-allowed [&>input:disabled]:opacity-55">
            <label>
              <span>铺货标题</span>
              <input value={row.title || ''} onChange={(event) => onUpdateEdit?.(row.key, 'title', event.target.value)} />
            </label>
            <CategoryControl row={row} onUpdateEdit={onUpdateEdit} />
          </div>
          <div className="flex flex-wrap gap-1.5 mt-[9px] [&_.node-secondary-button]:min-h-[30px] [&_.node-secondary-button]:py-1.5 [&_.node-secondary-button]:px-[9px] [&_.node-secondary-button]:no-underline">
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
      <article className={`flex min-w-0 border rounded-md bg-slate-900/72 overflow-hidden ${row.removed ? 'border-rose-400/32 opacity-[0.78]' : 'border-slate-800/90'}`}>
        {index != null && <span className="shrink-0 self-stretch flex items-center justify-center w-6 text-slate-500 text-[11px] font-bold border-r border-slate-700 bg-slate-900/40">{index}</span>}
        <div className="flex flex-col gap-0.5 min-w-0 flex-1 py-1 px-2">
          {/* Row 1: source title + keyword/metrics + status + remove */}
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="shrink-0 text-slate-400 text-[11px] font-bold whitespace-nowrap">原标题</span>
            {url
              ? <a href={url} target="_blank" rel="noreferrer" className="flex-auto min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-blue-400 hover:text-blue-300 underline underline-offset-2 text-[11px] leading-[1.35]" title={sourceTitle}>{sourceTitle}</a>
              : <strong className="block flex-auto min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-slate-200 text-[11px] leading-[1.35]" title={sourceTitle}>{sourceTitle}</strong>
            }
            {keyword && <small className="shrink-0 inline-flex items-center border border-sky-500/32 rounded-full bg-sky-900/28 text-sky-200 text-[10px] font-extrabold leading-[1.1] px-[5px] py-0.5">选词：{keyword}</small>}
            {Array.isArray(row.metrics) && row.metrics.length > 0 && <span className="shrink-0 text-slate-500 text-[10px] whitespace-nowrap">{row.metrics.join(' · ')}</span>}
            <em className={`shrink-0 whitespace-nowrap rounded-full text-[10px] not-italic font-extrabold px-[7px] py-0.5 ${row.removed ? 'bg-[rgba(127,29,29,0.28)] text-rose-200' : 'bg-emerald-900/28 text-green-200'}`}>{row.removed ? '已移除' : '将导出'}</em>
            <button type="button" className={`node-secondary-button shrink-0 !min-h-[22px] !py-0 !px-[6px] !text-[10px] ${row.removed ? 'success' : 'danger'}`} onClick={() => onMarkRemoved?.(row.key, !row.removed)}>
              {row.removed ? <Check size={11} /> : <X size={11} />}
              {row.removed ? '恢复' : '移除'}
            </button>
          </div>
          {/* Row 2: editable title + category side by side */}
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="shrink-0 text-slate-400 text-[11px] font-bold whitespace-nowrap">铺货标题</span>
            <input value={row.title || ''} disabled={row.removed} onChange={(event) => onUpdateEdit?.(row.key, 'title', event.target.value)}
              style={{ fontSize: '11px' }}
              className="flex-1 min-w-0 py-0.5 px-[7px] border border-slate-700 rounded-[5px] bg-[#091224] text-slate-200 font-normal leading-[1.4] focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-55" />
            <span className="shrink-0 text-slate-400 text-[11px] font-bold whitespace-nowrap ml-2">铺货类目</span>
            <div className="flex-1 min-w-[120px]">
              <CategoryControl row={row} onUpdateEdit={onUpdateEdit} compact />
            </div>
          </div>
        </div>
      </article>
    );
  }

  // Workbench variant
  if (isBlocked) {
    return (
      <article className="min-w-0 border border-amber-500/32 rounded-lg bg-[rgba(120,53,15,0.12)] p-[11px]">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-start [&>div>strong]:block [&>div>strong]:min-w-0 [&>div>strong]:text-slate-200 [&>div>strong]:text-[13px] [&>div>strong]:leading-[1.35] [&>div>strong]:break-all [&>div>span]:block [&>div>span]:min-w-0 [&>div>span]:mt-1 [&>div>span]:text-blue-300 [&>div>span]:text-[10px]">
          <div>
            <div className="flex items-center gap-1.5 min-w-0">
              <strong className="block flex-auto min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-slate-200 text-[13px] leading-[1.35]" title={sourceTitle}>{sourceTitle}</strong>
              <em className="shrink-0 ml-auto whitespace-nowrap rounded-full bg-emerald-900/28 text-green-200 text-[10px] not-italic font-extrabold px-[7px] py-1">未加入</em>
            </div>
            <span>{row.meta}</span>
            {keyword && <small className="mt-1.5 inline-flex w-fit max-w-full items-center border border-sky-500/32 rounded-full bg-sky-900/28 text-sky-200 text-[10px] font-extrabold leading-[1.1] px-[7px] py-1 break-all">选词：{keyword}</small>}
          </div>
        </div>
        {Array.isArray(row.metrics) && row.metrics.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-[9px] [&>span]:rounded-full [&>span]:bg-slate-800/90 [&>span]:text-slate-300 [&>span]:text-[10px] [&>span]:leading-none [&>span]:px-[7px] [&>span]:py-[5px]">
            {row.metrics.map((metric) => <span key={metric}>{metric}</span>)}
          </div>
        )}
        {row.description && <p className="mt-2 mb-0 text-slate-400 text-[10px] leading-[1.45] break-all">拦截原因：{row.description}</p>}
        <div className="grid min-w-0 grid-cols-[minmax(0,1.5fr)_minmax(180px,0.7fr)] gap-2.5 my-2.5 max-sm:grid-cols-[minmax(0,1fr)] [&>label]:flex [&>label]:min-w-0 [&>label]:flex-col [&>label]:gap-[5px] [&>label]:text-slate-400 [&>label]:text-[10px] [&>label]:font-bold [&>input]:w-full [&>input]:min-w-0 [&>input]:py-2 [&>input]:px-[9px] [&>input]:border [&>input]:border-slate-700 [&>input]:rounded-[5px] [&>input]:bg-[#091224] [&>input]:text-slate-200 [&>input]:text-xs [&>input:focus]:border-blue-500 [&>input:focus]:outline-none [&>input:disabled]:cursor-not-allowed [&>input:disabled]:opacity-55">
          <label>
            <span>铺货标题</span>
            <input value={row.title || ''} onChange={(event) => onUpdateEdit?.(row.key, 'title', event.target.value)} />
          </label>
          <CategoryControl row={row} onUpdateEdit={onUpdateEdit} />
        </div>
        <div className="flex flex-wrap gap-1.5 mt-[9px] [&_.node-secondary-button]:min-h-[30px] [&_.node-secondary-button]:py-1.5 [&_.node-secondary-button]:px-[9px] [&_.node-secondary-button]:no-underline">
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
    <article className={`min-w-0 border rounded-lg bg-slate-900/66 p-[11px] ${row.removed ? 'border-rose-400/32 opacity-[0.78]' : 'border-slate-800/90'}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-start [&>div>strong]:block [&>div>strong]:min-w-0 [&>div>strong]:text-slate-200 [&>div>strong]:text-[13px] [&>div>strong]:leading-[1.35] [&>div>strong]:break-all [&>div>span]:block [&>div>span]:min-w-0 [&>div>span]:mt-1 [&>div>span]:text-blue-300 [&>div>span]:text-[10px]">
        <div>
          <div className="flex items-center gap-1.5 min-w-0">
            <strong className="block flex-auto min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-slate-200 text-[13px] leading-[1.35]" title={row.title || '未命名铺货项'}>{row.title || '未命名铺货项'}</strong>
            <em className={`shrink-0 ml-auto whitespace-nowrap rounded-full text-[10px] not-italic font-extrabold px-[7px] py-1 ${row.removed ? 'bg-[rgba(127,29,29,0.28)] text-rose-200' : 'bg-emerald-900/28 text-green-200'}`}>{row.removed ? '已移除' : '将导出'}</em>
          </div>
          {row.meta && <span>{row.meta}{row.fromReview ? ' · 人工加入' : ''}</span>}
          {keyword && <small className="mt-1.5 inline-flex w-fit max-w-full items-center border border-sky-500/32 rounded-full bg-sky-900/28 text-sky-200 text-[10px] font-extrabold leading-[1.1] px-[7px] py-1 break-all">选词：{keyword}</small>}
        </div>
      </div>
      {Array.isArray(row.metrics) && row.metrics.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-[9px] [&>span]:rounded-full [&>span]:bg-slate-800/90 [&>span]:text-slate-300 [&>span]:text-[10px] [&>span]:leading-none [&>span]:px-[7px] [&>span]:py-[5px]">
          {row.metrics.map((metric) => <span key={metric}>{metric}</span>)}
        </div>
      )}
      <div className="grid min-w-0 grid-cols-[minmax(0,1.5fr)_minmax(180px,0.7fr)] gap-2.5 my-2.5 max-sm:grid-cols-[minmax(0,1fr)] [&>label]:flex [&>label]:min-w-0 [&>label]:flex-col [&>label]:gap-[5px] [&>label]:text-slate-400 [&>label]:text-[10px] [&>label]:font-bold [&>input]:w-full [&>input]:min-w-0 [&>input]:py-2 [&>input]:px-[9px] [&>input]:border [&>input]:border-slate-700 [&>input]:rounded-[5px] [&>input]:bg-[#091224] [&>input]:text-slate-200 [&>input]:text-xs [&>input:focus]:border-blue-500 [&>input:focus]:outline-none [&>input:disabled]:cursor-not-allowed [&>input:disabled]:opacity-55">
        <label>
          <span>铺货标题</span>
          <input value={row.title || ''} disabled={row.removed} onChange={(event) => onUpdateEdit?.(row.key, 'title', event.target.value)} />
        </label>
        <CategoryControl row={row} onUpdateEdit={onUpdateEdit} />
      </div>
      <div className="flex flex-wrap gap-1.5 mt-[9px] [&_.node-secondary-button]:min-h-[30px] [&_.node-secondary-button]:py-1.5 [&_.node-secondary-button]:px-[9px] [&_.node-secondary-button]:no-underline">
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
