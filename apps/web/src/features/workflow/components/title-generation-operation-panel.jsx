import { useState } from 'react';
import { Copy, PenLine, RefreshCw } from 'lucide-react';

import { artifactItems, candidateKeyword } from '../workflow-data.js';
import { ArtifactPanel } from './artifact-panel.jsx';

function rowSelectedKeyword(row = {}) {
  return String(row.selectedKeyword || row.keyword || row.blueOceanWord || row.product?.蓝海词 || row['蓝海词'] || '').trim();
}

export const TitleGenerationOperationPanel = ({
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
    <div className="node-embedded-workbench">
      <section className="node-workbench-section">
        <div className="node-workbench-head">
          <strong>已验真词</strong>
          <span>{verifiedRows.length} 个 · 可生成 {verifiedRows.filter((item) => !item.keywordOpportunity?.decision || item.keywordOpportunity.decision === 'continue').length} 个</span>
        </div>
        <div className="node-chip-list">
          {sortedVerifiedRows.slice(0, 16).map((item, index) => {
            const keyword = candidateKeyword(item);
            const decision = item.keywordOpportunity?.decision || 'continue';
            const score = item.keywordOpportunity?.score ?? item.sycmScore?.score ?? item.score;
            return (
              <button type="button" key={`${keyword}-${index}`} onClick={() => onUseVerifiedKeyword(item)}>
                <span>{keyword || '未命名关键词'}</span>
                <small>{score ? `机会分 ${score} · ${decision === 'continue' ? '可生成' : '需人工放行'}` : '已验真'}</small>
              </button>
            );
          })}
          {verifiedRows.length === 0 && <div className="artifact-empty">生意参谋校验通过后，可在这里选择关键词生成标题。</div>}
        </div>
      </section>

      <form className="node-workbench-section" onSubmit={onGenerateTitle}>
        <div className="node-workbench-head">
          <strong>标题生成</strong>
          <span>{titleLoading ? '生成中' : '手动可补同行标题'}</span>
        </div>
        <label className="node-field">
          <span>关键词</span>
          <input value={titleForm.keyword} onChange={(event) => onTitleFormChange({ ...titleForm, keyword: event.target.value })} placeholder="选择已验真词或手动输入" />
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

      <section className="node-workbench-section">
        <div className="node-workbench-head">
          <strong>标题与货源链接结果</strong>
          <span>{generatedRows.length} 条记录 · {titles.length} 个标题 · {sourceCount} 个链接</span>
        </div>
        {generatedRows.length > 0 && (
          <p className="node-workbench-note">
            这里的“记录”是一组可复核对象：1 个铺货标题 + 1 个 1688 货源链接 + 评分信息。当前展示 {visibleGeneratedRows.length}/{generatedRows.length} 条。
          </p>
        )}
        {titles.length > 0 && (
          <button type="button" className="node-secondary-button" onClick={() => onCopyTitle(titles.join('\n'))}>
            <Copy size={13} /> 复制全部标题
          </button>
        )}
        {generatedRows.length > 0 ? (
          <div className="node-product-list">
            {visibleGeneratedRows.map((item, index) => {
              const product = item.product || item;
              const title = item['铺货标题'] || item.title || product['铺货标题'] || '未生成标题';
              const url = item.url || item.productUrl || item['产品链接'] || product['产品链接'];
              const keyword = rowSelectedKeyword(item);
              return (
                <div className="node-product-row" key={`${url || index}`}>
                  <strong>{title}</strong>
                  {keyword && <small className="selected-keyword-badge">选词：{keyword}</small>}
                  <span>{item['链接原标题'] || item.productTitle || product['链接原标题'] || item.keyword || '货源结果'}</span>
                  <div>
                    <em>{product['商品原价'] || item.price ? `价格 ${product['商品原价'] || item.price}` : '暂无价格'}</em>
                    <em>{product['30天销量'] || item.sales ? `销量 ${product['30天销量'] || item.sales}` : '暂无销量'}</em>
                  </div>
                  <div className="node-product-actions">
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
