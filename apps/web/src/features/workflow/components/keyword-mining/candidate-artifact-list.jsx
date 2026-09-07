import { useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';

import { artifactItems, candidateKeyword } from '../../workflow-data.js';
import { ArtifactPanel } from '../artifact-panel.jsx';

/**
 * 候选词产物列表组件
 * @param {object} props
 * @param {object} props.artifactState - 节点产物状态
 * @param {Function} props.onCopyCandidate - 复制候选词回调
 * @param {Function} props.onRetryMine - 重新执行灵感选词回调
 * @param {boolean} props.canRetryMine - 是否允许重新执行灵感选词
 * @returns {import('react').JSX.Element} 候选词产物列表视图
 */
export const CandidateArtifactList = ({
  artifactState,
  onCopyCandidate,
  onRetryMine,
  canRetryMine
}) => {
  const candidates = artifactItems(artifactState);
  const [visibleLimit, setVisibleLimit] = useState(20);
  const rootExpansion = candidates.some((item) => item.source === 'sycm_root_expansion');

  return (
    <section className="node-workbench-section">
      <div className="node-workbench-head">
        <strong>{rootExpansion ? '词根拓词结果' : '候选词产物'}</strong>
        <span>{candidates.length} 个</span>
      </div>
      <div className="node-candidate-list">
        {candidates.slice(0, visibleLimit).map((item, index) => (
          <div className="node-candidate-row" key={`${candidateKeyword(item)}-${index}`}>
            <div>
              <strong>{candidateKeyword(item) || '未命名候选词'}</strong>
              <span>{item.inspiration?.inspirationWord ? `灵感 ${item.inspiration.inspirationWord} → ${item.rootKeyword || item.coreProduct || '商品词根'} · ` : ''}{item.sourceRoots?.length > 1 ? `来源词根：${item.sourceRoots.join('、')} · ` : ''}{item.relationReason || item.reason || item.source || item.nextAction || '等待生意参谋校验'}</span>
              {rootExpansion && <span>搜索人气 {item.sycmData?.searchPopularity ?? 0} · 供需比 {item.sycmData?.demandSupplyRatio ?? 0} · 市场分 {item.marketScore ?? 0}</span>}
            </div>
            <button type="button" className="node-icon-button" title="复制关键词" onClick={() => onCopyCandidate(candidateKeyword(item))}>
              <Copy size={13} />
            </button>
          </div>
        ))}
        {candidates.length === 0 && <ArtifactPanel state={artifactState} />}
      </div>
      {candidates.length > visibleLimit && (
        <button type="button" className="node-secondary-button" onClick={() => setVisibleLimit((current) => current + 50)}>
          继续显示（剩余 {candidates.length - visibleLimit} 个）
        </button>
      )}
      <button type="button" className="node-secondary-button" onClick={onRetryMine} disabled={!canRetryMine}>
        <RefreshCw size={13} /> {rootExpansion ? '继续或重试拓词' : '重新执行灵感选词'}
      </button>
    </section>
  );
};
