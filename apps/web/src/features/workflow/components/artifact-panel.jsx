import { Download, ExternalLink, RefreshCw } from 'lucide-react';

import { getWorkflowArtifactView, summarizeWorkflowArtifact } from '../artifact-view.js';

export function ArtifactPanel({ state }) {
  const artifact = state.artifact;
  const view = getWorkflowArtifactView(artifact, state.nodeId);
  const businessRows = view.kind === 'business-list' || view.kind === 'candidate-list';

  return (
    <div className="workflow-artifact-panel">
      <div className="flex items-center justify-between gap-2.5 mb-2.5">
        <span className="text-[var(--text-subtle)] text-xs font-extrabold">{view.title || '节点产物'}</span>
        {artifact && <b className="min-w-0 text-[var(--text-disabled)] text-[10px] font-extrabold truncate">{summarizeWorkflowArtifact(artifact)}</b>}
      </div>
      {state.status === 'loading' && (
        <div className="min-w-0 rounded-md p-2.5 text-xs leading-normal flex items-center gap-1.5 bg-[rgba(15,23,42,0.58)] text-[var(--text-disabled)]"><RefreshCw size={13} className="animate-spin" /> 正在加载节点产物...</div>
      )}
      {state.status === 'error' && (
        <div className="min-w-0 rounded-md p-2.5 text-xs leading-normal border border-[rgba(244,63,94,0.32)] bg-[rgba(127,29,29,0.18)] text-[#fecdd3]">{state.error || '节点产物加载失败'}</div>
      )}
      {state.status === 'empty' && (
        <div className="min-w-0 rounded-md p-2.5 text-xs leading-normal flex items-center gap-1.5 bg-[rgba(15,23,42,0.58)] text-[var(--text-disabled)]">{state.error || view.emptyText}</div>
      )}
      {state.status === 'ready' && artifact && businessRows && (
        <div className="artifact-business-list grid gap-2 min-w-0 max-h-[360px] overflow-y-auto">
          {view.rows.length === 0 ? (
            <div className="min-w-0 rounded-md p-2.5 text-xs leading-normal flex items-center gap-1.5 bg-[rgba(15,23,42,0.58)] text-[var(--text-disabled)]">{view.emptyText}</div>
          ) : view.rows.map((item, index) => (
            <div className="artifact-business-row min-w-0 border border-[rgba(148,163,184,0.16)] rounded-lg bg-[rgba(15,23,42,0.58)] p-2.5" key={`${item.title}-${index}`}>
              <strong className="block text-[var(--text-body)] text-[13px] leading-snug break-all">{item.title}</strong>
              {item.meta && <span className="block mt-1 text-[#93c5fd] text-[11px]">{item.meta}</span>}
              {Array.isArray(item.metrics) && item.metrics.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {item.metrics.map((metric) => <em key={metric} className="inline-flex min-w-0 border border-[rgba(20,184,166,0.22)] rounded-full bg-[rgba(15,118,110,0.16)] text-[#99f6e4] not-italic text-[10px] leading-none py-1 px-1.5">{metric}</em>)}
                </div>
              )}
              {item.description && <p className="mt-1 text-[var(--text-muted)] text-[11px] leading-normal break-all">{item.description}</p>}
              {item.sourceUrl && (
                <a className="w-fit mt-1.5 text-[11px]" href={item.sourceUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={12} /> {['resolveShops', 'collectCompetitors', 'enrichCompetitors'].includes(state.nodeId)
                    ? state.nodeId === 'resolveShops' ? '打开同行店铺' : '打开淘宝商品'
                    : state.nodeId === 'collectRank' ? '打开淘宝商品' : '打开灵感来源'}
                </a>
              )}
            </div>
          ))}
        </div>
      )}
      {state.status === 'ready' && artifact && view.kind === 'json-list' && (
        <div className="grid gap-2 min-w-0 max-h-[360px] overflow-y-auto">
          {view.rows.length === 0 ? (
            <div className="min-w-0 rounded-md p-2.5 text-xs leading-normal flex items-center gap-1.5 bg-[rgba(15,23,42,0.58)] text-[var(--text-disabled)]">{view.emptyText}</div>
          ) : view.rows.map((item, index) => (
            <pre key={index} className="min-w-0 max-w-full m-0 border border-[rgba(30,41,59,0.9)] rounded-md bg-[rgba(15,23,42,0.78)] text-[var(--text-subtle)] font-mono text-[10px] leading-relaxed p-2 whitespace-pre-wrap break-all">{JSON.stringify(item, null, 2)}</pre>
          ))}
        </div>
      )}
      {state.status === 'ready' && artifact && (view.kind === 'text' || view.kind === 'json-text') && (
        <pre className="min-w-0 max-w-full max-h-[420px] overflow-auto m-0 border border-[rgba(30,41,59,0.9)] rounded-md bg-[rgba(15,23,42,0.78)] text-[var(--text-subtle)] font-mono text-[10px] leading-relaxed p-2 whitespace-pre-wrap break-all">
          {view.text || view.emptyText}
        </pre>
      )}
      {state.status === 'ready' && artifact && view.kind === 'file' && (
        <div className="artifact-file-card">
          <div>
            <strong>{artifact.filename || '商品排行表格.xlsx'}</strong>
            <span>{artifact.count ? `共 ${artifact.count} 条商品` : 'Excel 文件已生成'}</span>
          </div>
          <a className="artifact-download-button" href={artifact.downloadUrl} download={artifact.filename || undefined}>
            <Download size={14} /> 下载表格
          </a>
        </div>
      )}
    </div>
  );
}
