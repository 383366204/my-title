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

  return (
    <section className="node-workbench-section">
      <div className="node-workbench-head">
        <strong>候选词产物</strong>
        <span>{candidates.length} 个</span>
      </div>
      <div className="node-candidate-list">
        {candidates.slice(0, 8).map((item, index) => (
          <div className="node-candidate-row" key={`${candidateKeyword(item)}-${index}`}>
            <div>
              <strong>{candidateKeyword(item) || '未命名候选词'}</strong>
              <span>{item.inspiration?.inspirationWord ? `灵感 ${item.inspiration.inspirationWord} → ${item.rootKeyword || item.coreProduct || '商品词根'} · ` : ''}{item.relationReason || item.reason || item.source || item.nextAction || '等待生意参谋校验'}</span>
            </div>
            <button type="button" className="node-icon-button" title="复制关键词" onClick={() => onCopyCandidate(candidateKeyword(item))}>
              <Copy size={13} />
            </button>
          </div>
        ))}
        {candidates.length === 0 && <ArtifactPanel state={artifactState} />}
      </div>
      <button type="button" className="node-secondary-button" onClick={onRetryMine} disabled={!canRetryMine}>
        <RefreshCw size={13} /> 重新执行灵感选词
      </button>
    </section>
  );
};
