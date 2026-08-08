import { CandidateArtifactList } from './keyword-mining/candidate-artifact-list.jsx';
import { InspirationDiscoveryView } from './keyword-mining/inspiration-discovery-view.jsx';
import { SeedPoolWorkbench } from './keyword-mining/seed-pool-workbench.jsx';

/**
 * 关键词挖掘操作面板组件（主模式编排）
 * @param {object} props
 * @param {object} props.artifactState - 节点产物状态
 * @param {boolean} [props.dynamicMode=false] - 是否为动态灵感模式
 * @param {Array} [props.seedRows=[]] - 种子词列表
 * @param {object} props.seedDraft - 种子词草稿
 * @param {boolean} props.seedLoading - 种子词加载状态
 * @param {string} props.seedMessage - 种子词操作提示消息
 * @param {Function} props.onSeedDraftChange - 种子词草稿变更回调
 * @param {Function} props.onLoadSeeds - 刷新种子池回调
 * @param {Function} props.onAddSeed - 添加种子词回调
 * @param {Function} props.onToggleSeed - 切换种子词状态回调
 * @param {Function} props.onDeleteSeed - 删除种子词回调
 * @param {Function} props.onSetSeedStatus - 设置种子词状态回调
 * @param {string} props.minerTab - 词根挖掘 Tab
 * @param {string} props.minerInput - 词根挖掘输入框内容
 * @param {Array} [props.minerResults=[]] - 词根挖掘结果
 * @param {boolean} props.minerBusy - 词根挖掘执行状态
 * @param {Function} props.onMinerTabChange - 词根挖掘 Tab 切换回调
 * @param {Function} props.onMinerInputChange - 词根挖掘输入框变更回调
 * @param {Function} props.onRunMiner - 执行词根挖掘回调
 * @param {Function} props.onCopyCandidate - 复制候选词回调
 * @param {Function} props.onRetryMine - 重新执行灵感选词回调
 * @param {boolean} props.canRetryMine - 是否可以重新执行灵感选词
 * @returns {import('react').JSX.Element} 关键词挖掘操作面板
 */
export const KeywordMiningOperationPanel = ({
  artifactState,
  dynamicMode = false,
  seedRows,
  seedDraft,
  seedLoading,
  seedMessage,
  onSeedDraftChange,
  onLoadSeeds,
  onAddSeed,
  onToggleSeed,
  onDeleteSeed,
  onSetSeedStatus,
  minerTab,
  minerInput,
  minerResults,
  minerBusy,
  onMinerTabChange,
  onMinerInputChange,
  onRunMiner,
  onCopyCandidate,
  onRetryMine,
  canRetryMine
}) => {
  return (
    <div className="node-embedded-workbench">
      {dynamicMode ? (
        <InspirationDiscoveryView artifactState={artifactState} />
      ) : (
        <SeedPoolWorkbench
          seedRows={seedRows}
          seedDraft={seedDraft}
          seedLoading={seedLoading}
          seedMessage={seedMessage}
          onSeedDraftChange={onSeedDraftChange}
          onLoadSeeds={onLoadSeeds}
          onAddSeed={onAddSeed}
          onToggleSeed={onToggleSeed}
          onDeleteSeed={onDeleteSeed}
          onSetSeedStatus={onSetSeedStatus}
          minerTab={minerTab}
          minerInput={minerInput}
          minerResults={minerResults}
          minerBusy={minerBusy}
          onMinerTabChange={onMinerTabChange}
          onMinerInputChange={onMinerInputChange}
          onRunMiner={onRunMiner}
        />
      )}

      <CandidateArtifactList
        artifactState={artifactState}
        onCopyCandidate={onCopyCandidate}
        onRetryMine={onRetryMine}
        canRetryMine={canRetryMine}
      />
    </div>
  );
};
