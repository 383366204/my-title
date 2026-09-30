import { useState } from 'react';
import { Copy, PenLine, RefreshCw } from 'lucide-react';

import { artifactItems, candidateKeyword } from '../workflow-data.js';
import { ArtifactPanel } from './artifact-panel.jsx';

function rowSelectedKeyword(row = {}) {
  return String(row.selectedKeyword || row.keyword || row.blueOceanWord || row.product?.蓝海词 || row['蓝海词'] || '').trim();
}

export const TitleGenerationOperationPanel = ({
  exactKeywordMode = false,
  artifactState,
  verifiedRows,
  titleForm,
  titleLoading,
  titleResult,
  titleError,
  onTitleFormChange,
  onUseVerifiedKeyword,
  onGenerateTitle,
  onCopyTitle,
  onRetryGenerate,
  canRetryGenerate
}) => {
  const [showAllGeneratedRows, setShowAllGeneratedRows] = useState(false);
  const generatedRows = titleResult?.products || artifactItems(artifactState);
  const sortedVerifiedRows = [...verifiedRows].sort((a, b) => {
    const aBlocked = a.keywordOpportunity?.decision && a.keywordOpportunity.decision !== 'continue';
    const bBlocked = b.keywordOpportunity?.decision && b.keywordOpportunity.decision !== 'continue';
    if (aBlocked === bBlocked) return 0;
    return aBlocked ? 1 : -1;
  });
  const titles = generatedRows.map((item) => {
    const product = item.product || item;
    return item['铺货标题'] || item.title || product['铺货标题'];
  }).filter(Boolean);
  const sourceCount = generatedRows.filter((item) => {
    const product = item.product || item;
    return item.url || item.productUrl || item['产品链接'] || product['产品链接'];
  }).length;
  const visibleLimit = showAllGeneratedRows ? generatedRows.length : 20;
  const visibleGeneratedRows = generatedRows.slice(0, visibleLimit);

  return (
    <div className="grid gap-3">
      <section className="grid gap-2.5 p-3 border border-slate-800/90 rounded-lg bg-slate-950/[0.42]">
        <div className="flex items-center justify-between gap-2.5">
          <strong className="min-w-0 text-slate-200 text-xs">{exactKeywordMode ? '精确关键词' : '已验真词'}</strong>
          <span className="shrink-0 text-slate-400 text-[10px]">{verifiedRows.length} 个 · 可生成 {verifiedRows.filter((item) => !item.keywordOpportunity?.decision || item.keywordOpportunity.decision === 'continue').length} 个</span>
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-[150px] overflow-auto">
          {sortedVerifiedRows.slice(0, 16).map((item, index) => {
            const keyword = candidateKeyword(item);
            const decision = item.keywordOpportunity?.decision || 'continue';
            const score = item.keywordOpportunity?.score ?? item.sycmScore?.score ?? item.score;
            return (
              <button type="button" key={`${keyword}-${index}`} onClick={() => onUseVerifiedKeyword(item)} className="inline-flex items-center gap-1.5 max-w-full border border-slate-700 rounded-full bg-slate-900 text-slate-200 text-[11px] px-2 py-[5px]">
                <span>{keyword || '未命名关键词'}</span>
                <small className="text-slate-400 text-[10px]">{exactKeywordMode ? '用户指定' : score ? `机会分 ${score} · ${decision === 'continue' ? '可生成' : '需人工放行'}` : '已验真'}</small>
              </button>
            );
          })}
          {verifiedRows.length === 0 && <div className="artifact-empty">{exactKeywordMode ? '暂无已选货源对应的关键词，请先完成货源选品。' : '生意参谋校验通过后，可在这里选择关键词生成标题。'}</div>}
        </div>
      </section>

      <form className="grid gap-2.5 p-3 border border-slate-800/90 rounded-lg bg-slate-950/[0.42]" onSubmit={onGenerateTitle}>
        <div className="flex items-center justify-between gap-2.5">
          <strong className="min-w-0 text-slate-200 text-xs">标题生成</strong>
          <span className="shrink-0 text-slate-400 text-[10px]">{titleLoading ? '生成中' : '手动可补同行标题'}</span>
        </div>
        <label className="node-field">
          <span>关键词</span>
          <input value={titleForm.keyword} onChange={(event) => onTitleFormChange({ ...titleForm, keyword: event.target.value })} placeholder={exactKeywordMode ? '选择精确关键词或手动输入' : '选择已验真词或手动输入'} />
        </label>
        <label className="node-field">
          <span>标题长度</span>
          <input type="number" min="10" max="100" value={titleForm.maxLength} onChange={(event) => onTitleFormChange({ ...titleForm, maxLength: event.target.value })} />
        </label>
        <label className="node-field">
          <span>同行标题</span>
          <textarea rows="4" value={titleForm.peerTitles} onChange={(event) => onTitleFormChange({ ...titleForm, peerTitles: event.target.value })} placeholder="一行一个，可为空" />
        </label>
        {titleError && <div className="artifact-error">{titleError}</div>}
        <button type="submit" className="node-primary-button" disabled={titleLoading || !titleForm.keyword.trim()}>
          {titleLoading ? <RefreshCw size={14} className="animate-spin" /> : <PenLine size={14} />}
          生成标题货源
        </button>
        <button type="button" className="node-secondary-button" onClick={onRetryGenerate} disabled={!canRetryGenerate}>
          <RefreshCw size={13} /> 从标题节点重跑
        </button>
      </form>

      <section className="grid gap-2.5 p-3 border border-slate-800/90 rounded-lg bg-slate-950/[0.42]">
        <div className="flex items-center justify-between gap-2.5">
          <strong className="min-w-0 text-slate-200 text-xs">标题与货源链接结果</strong>
          <span className="shrink-0 text-slate-400 text-[10px]">{generatedRows.length} 条记录 · {titles.length} 个标题 · {sourceCount} 个链接</span>
        </div>
        {generatedRows.length > 0 && (
          <p className="node-workbench-note">
            这里的"记录"是一组可复核对象：1 个铺货标题 + 1 个 1688 货源链接 + 评分信息。当前展示 {visibleGeneratedRows.length}/{generatedRows.length} 条。
          </p>
        )}
        {titles.length > 0 && (
          <button type="button" className="node-secondary-button" onClick={() => onCopyTitle(titles.join('\n'))}>
            <Copy size={13} /> 复制全部标题
          </button>
        )}
        {generatedRows.length > 0 ? (
          <div className="grid gap-[7px] max-h-[250px] overflow-auto">
            {visibleGeneratedRows.map((item, index) => {
              const product = item.product || item;
              const title = item['铺货标题'] || item.title || product['铺货标题'] || '未生成标题';
              const url = item.url || item.productUrl || item['产品链接'] || product['产品链接'];
              const keyword = rowSelectedKeyword(item);
              return (
                <div className="grid gap-2 p-[9px] border border-slate-800/[0.86] rounded-lg bg-slate-900/[0.62]" key={`${url || index}`}>
                  <strong className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-slate-200 text-xs">{title}</strong>
                  {keyword && <small className="inline-flex w-fit max-w-full items-center border border-sky-500/30 rounded-full bg-sky-900/[0.28] text-sky-200 text-[10px] font-extrabold leading-[1.1] px-[7px] py-1 break-words">选词：{keyword}</small>}
                  <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-slate-400 text-[10px]">{item['链接原标题'] || item.productTitle || product['链接原标题'] || item.keyword || '货源结果'}</span>
                  <div className="flex flex-wrap gap-1.5">
                    <em className="rounded-full bg-slate-800/90 text-slate-300 text-[10px] not-italic px-[7px] py-[2px]">{product['商品原价'] || item.price ? `价格 ${product['商品原价'] || item.price}` : '暂无价格'}</em>
                    <em className="rounded-full bg-slate-800/90 text-slate-300 text-[10px] not-italic px-[7px] py-[2px]">{product['30天销量'] || item.sales ? `销量 ${product['30天销量'] || item.sales}` : '暂无销量'}</em>
                  </div>
                  <div className="node-product-actions mt-[2px] [&_.node-secondary-button]:min-h-[30px] [&_.node-secondary-button]:px-[9px] [&_.node-secondary-button]:py-[6px] [&_.node-secondary-button]:no-underline">
                    <button type="button" className="node-secondary-button" onClick={() => onCopyTitle(title)}>
                      <Copy size={13} /> 复制标题
                    </button>
                    {url && (
                      <a className="node-secondary-button" href={url} target="_blank" rel="noreferrer">
                        打开货源
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
            {generatedRows.length > visibleGeneratedRows.length && (
              <button type="button" className="node-secondary-button" onClick={() => setShowAllGeneratedRows(true)}>
                展开全部 {generatedRows.length} 条
              </button>
            )}
            {showAllGeneratedRows && generatedRows.length > 20 && (
              <button type="button" className="node-secondary-button" onClick={() => setShowAllGeneratedRows(false)}>
                收起，仅看前 20 条
              </button>
            )}
          </div>
        ) : (
          <ArtifactPanel state={artifactState} />
        )}
      </section>
    </div>
  );
};
