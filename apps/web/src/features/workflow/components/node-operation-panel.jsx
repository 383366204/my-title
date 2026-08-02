import { getWorkflowNodePanelKind, getWorkflowResultSummaryView } from '../../../workflow-ui.js';
import { ArtifactPanel } from './artifact-panel.jsx';
import { DistributionExportPanel } from './distribution-export-panel.jsx';
import { KeywordMiningOperationPanel } from './keyword-mining-operation-panel.jsx';
import { KeywordReviewOperationPanel } from './keyword-review-operation-panel.jsx';
import { ManualProductSelectionPanel } from './manual-product-selection-panel.jsx';
import { TitleGenerationOperationPanel } from './title-generation-operation-panel.jsx';

const NodeResultSummaryCard = ({ nodeId, state }) => {
  const summary = getWorkflowResultSummaryView(nodeId, state);
  if (summary.empty && String(state?.status || '').toLowerCase() === 'idle') return null;
  return (
    <div className={`node-result-summary-card ${summary.empty ? 'node-result-summary-empty' : ''}`}>
      <div className="node-result-summary-head">
        <div>
          <span>节点结果</span>
          <strong>{summary.title}</strong>
        </div>
        <b>{summary.statusLabel}</b>
      </div>
      <div className="node-result-summary-body">
        <div>
          <span>成功数量</span>
          <strong>{summary.countLabel || '暂无成功产物'}</strong>
        </div>
      </div>
      <p>{summary.hint}</p>
    </div>
  );
};

const nodeResultHint = (kind) => {
  if (kind === 'keyword-mining') return '候选词会连同灵感来源、商品词根和拦截原因展示，并保存到当前运行产物。';
  if (kind === 'keyword-review') return '人工筛词会写入 reviewed-candidates.jsonl，只有确认通过的词会进入生意参谋。';
  if (kind === 'sycm-verify') return '验真通过词会展示在节点产物，并保存到 verified-keywords.jsonl。';
  if (kind === 'product-select') return '已选货源会展示在节点产物，并保存到 selected-products.jsonl。';
  if (kind === 'title-generate') return '生成的标题会关联已选货源，并保存到 generated-products.jsonl。';
  if (kind === 'review') return '待铺货清单和复核报告会展示在复核节点，并保存到 distribution-batch.txt / distribution-review.md。';
  return '';
};

const NODE_PANEL_COPY = {
  'keyword-mining': {
    title: '灵感选词操作台',
    description: '检查当天灵感、商品词根、候选词和未采用原因。'
  },
  'keyword-review': {
    title: '人工选词与选品操作台',
    description: '在同一个节点输入关键词、筛选关键词，并勾选或手动添加 1688 商品。'
  },
  'sycm-verify': {
    title: '生意参谋校验操作台',
    description: 'Chrome 状态、阻塞原因、重试校验和指标表会集中在这里操作。'
  },
  'product-select': {
    title: '货源选品操作台',
    description: '查看验真词对应的 1688 货源、机会评分、价格销量和下一步建议。'
  },
  'title-generate': {
    title: '标题生成操作台',
    description: '基于已选货源生成铺货标题，结果仍会归档到当前流水线。'
  },
  'distribution-export': {
    title: '铺货清单与人工复核',
    description: '自动可铺货项和被系统拦截项在这里统一查看、加入、移除和复制。'
  },
  completion: {
    title: '流程完成结果',
    description: '导出文件、批次结果和通过率会集中在这里展示。'
  }
};

export const NodeOperationPanel = ({
  selectedNode,
  artifactState,
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
  verifiedRows,
  titleForm,
  titleLoading,
  titleResult,
  titleError,
  onTitleFormChange,
  onUseVerifiedKeyword,
  onGenerateTitle,
  onCopyText,
  onConfirmKeywordReview,
  onConfirmProductReview,
  onRetryNode,
  currentRunId,
  manualMode,
  onDistributionJobChange
}) => {
  const kind = getWorkflowNodePanelKind(selectedNode?.id);
  const copy = kind === 'product-select' && manualMode
    ? { title: '商品资料获取结果', description: '逐条查看1688商品标题、主图、类目和获取失败原因。' }
    : NODE_PANEL_COPY[kind];
  const resultHint = nodeResultHint(kind);
  if (!copy) return <ArtifactPanel state={artifactState} />;

  return (
    <div className="node-operation-panel">
      <div className="node-operation-panel-head">
        <h3>{copy.title}</h3>
        <p>{copy.description}</p>
        {resultHint && <p className="node-result-hint">{resultHint}</p>}
      </div>
      <NodeResultSummaryCard nodeId={selectedNode?.id} state={selectedNode?.data || {}} />
      {kind === 'keyword-mining' && (
        <KeywordMiningOperationPanel
          artifactState={artifactState}
          dynamicMode={String(selectedNode?.data?.discoveryMode || selectedNode?.data?.output?.discovery?.mode || '').toLowerCase() !== 'seed'}
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
          onCopyCandidate={onCopyText}
          onRetryMine={() => onRetryNode('mine')}
          canRetryMine={Boolean(currentRunId)}
        />
      )}
      {kind === 'title-generate' && (
        <TitleGenerationOperationPanel
          artifactState={artifactState}
          verifiedRows={verifiedRows}
          titleForm={titleForm}
          titleLoading={titleLoading}
          titleResult={titleResult}
          titleError={titleError}
          onTitleFormChange={onTitleFormChange}
          onUseVerifiedKeyword={onUseVerifiedKeyword}
          onGenerateTitle={onGenerateTitle}
          onCopyTitle={onCopyText}
          onRetryGenerate={() => onRetryNode('generate')}
          canRetryGenerate={Boolean(currentRunId)}
        />
      )}
      {kind === 'keyword-review' && manualMode && ['waiting_confirmation', 'awaiting_product_review'].includes(String(selectedNode?.data?.status || '').toLowerCase()) ? (
        <ManualProductSelectionPanel
          artifactState={artifactState}
          currentRunId={currentRunId}
          onConfirm={onConfirmProductReview}
        />
      ) : kind === 'keyword-review' && (
        <KeywordReviewOperationPanel
          artifactState={artifactState}
          onConfirmKeywordReview={onConfirmKeywordReview}
          onRetryMine={() => onRetryNode('mine')}
          canConfirm={Boolean(currentRunId)}
          canRetryMine={Boolean(currentRunId)}
        />
      )}
      {kind === 'product-select' && !manualMode && (
        <ManualProductSelectionPanel
          artifactState={artifactState}
          currentRunId={currentRunId}
          onConfirm={onConfirmProductReview}
        />
      )}
      {kind === 'product-select' && manualMode && <ArtifactPanel state={artifactState} />}
      {kind === 'distribution-export' && (
        <DistributionExportPanel
          artifactState={artifactState}
          onCopyText={onCopyText}
          currentRunId={currentRunId}
          sourceNodeId={selectedNode?.id}
          onDistributionJobChange={onDistributionJobChange}
        />
      )}
      {kind !== 'keyword-mining' && kind !== 'keyword-review' && kind !== 'product-select' && kind !== 'title-generate' && kind !== 'distribution-export' && (
        <ArtifactPanel state={artifactState} />
      )}
    </div>
  );
};
