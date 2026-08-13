import { X } from 'lucide-react';

import { getWorkflowNodeDetailRows } from '../../../workflow-ui.js';
import { WORKFLOW_OVERLAYS } from '../workflow-action-registry.js';
import { ArtifactPanel } from './artifact-panel.jsx';
import { DistributionExportPanel } from './distribution-export-panel.jsx';
import { ManualProductSelectionPanel } from './manual-product-selection-panel.jsx';
import { ManualWorkflowInputPanel } from './manual-workflow-input-panel.jsx';
import { NodeOperationPanel } from './node-operation-panel.jsx';
import { ReviewSourceUploadPanel } from './review-source-upload-panel.jsx';
import { SheetConfigurationPanel } from './sheet-configuration-panel.jsx';
import { StartConfigurationPanel } from './start-configuration-panel.jsx';

const OVERLAY_COPY = {
  [WORKFLOW_OVERLAYS.ARTIFACT]: ['节点产物', '查看此节点生成的结构化结果。'],
  [WORKFLOW_OVERLAYS.DISTRIBUTION]: ['铺货清单与复核', '核对标题和类目，可复制内容人工铺货，也可确认后自动铺货。'],
  [WORKFLOW_OVERLAYS.NODE_WORKBENCH]: ['节点操作', '处理当前节点的阻塞、筛选或重试。'],
  [WORKFLOW_OVERLAYS.PRODUCT_SELECT]: ['勾选 1688 货源', '保留合适货源，也可以粘贴新的 1688 链接。'],
  [WORKFLOW_OVERLAYS.SHEET_CONFIG]: ['配置业务表格', '设置表格类型、输出范围和版式内容。'],
  [WORKFLOW_OVERLAYS.START_CONFIG]: ['配置流水线输入', '配置完成后返回画布启动流水线。']
};

function WorkflowOverlayShell({ children, description, label, onClose, wide = false }) {
  return (
    <div className="workflow-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className={`workflow-modal workflow-node-overlay ${wide ? 'is-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="workflow-modal-head">
          <div><strong>{label}</strong><span>{description}</span></div>
          <button type="button" className="workflow-modal-close" aria-label={`关闭${label}`} onClick={onClose}><X size={15} /></button>
        </div>
        <div className="workflow-node-overlay-body">{children}</div>
      </section>
    </div>
  );
}

export function WorkflowOverlayManager({
  activeOverlay,
  activeTemplateMode,
  activeTemplateView,
  artifactState,
  copyText,
  currentRunId,
  nodeOperationProps,
  nodes,
  onClose,
  onConfirmProductReview,
  onRetryNode,
  onSaveManualInput,
  onUpdateNodeData,
  updateDistributionNodeJob
}) {
  if (!activeOverlay) return null;
  const node = nodes.find((item) => item.id === activeOverlay.nodeId) || null;
  const nodeLabel = node?.data?.label || node?.id || '节点';
  const [defaultLabel, defaultDescription] = OVERLAY_COPY[activeOverlay.type] || OVERLAY_COPY[WORKFLOW_OVERLAYS.NODE_WORKBENCH];
  const label = activeOverlay.type === WORKFLOW_OVERLAYS.ARTIFACT ? `${nodeLabel}产物` : defaultLabel;
  const awaitingArtifact = Boolean(currentRunId && node?.id && artifactState.nodeId !== node.id);
  const scopedArtifactState = awaitingArtifact
    ? { status: 'loading', nodeId: node?.id || null, artifact: null, error: '' }
    : artifactState;

  if (activeOverlay.type === WORKFLOW_OVERLAYS.START_CONFIG && activeTemplateMode === 'manual') {
    const startNode = node || nodes.find((item) => item.id === 'start');
    return (
      <div className="workflow-modal-backdrop" role="presentation" onClick={onClose}>
        <ManualWorkflowInputPanel
          initialDefaultKeyword={startNode?.data?.defaultKeyword || ''}
          initialItems={startNode?.data?.items || []}
          onCancel={onClose}
          onSave={onSaveManualInput}
        />
      </div>
    );
  }

  if (activeOverlay.type === WORKFLOW_OVERLAYS.START_CONFIG && activeTemplateMode === 'review-sheet') {
    return (
      <WorkflowOverlayShell label="上传并确认刷单表" description={activeTemplateView.modeHint} onClose={onClose} wide>
        <ReviewSourceUploadPanel
          node={node || nodes.find((item) => item.id === 'start')}
          onDone={onClose}
          onUpdateField={onUpdateNodeData}
          readOnly={Boolean(currentRunId)}
        />
      </WorkflowOverlayShell>
    );
  }

  let content = null;
  if (activeOverlay.type === WORKFLOW_OVERLAYS.START_CONFIG) {
    content = (
      <StartConfigurationPanel
        mode={activeTemplateMode}
        modeHint={activeTemplateView.modeHint}
        node={node || nodes.find((item) => item.id === 'start')}
        onDone={onClose}
        onUpdateField={onUpdateNodeData}
        readOnly={Boolean(currentRunId)}
      />
    );
  } else if (activeOverlay.type === WORKFLOW_OVERLAYS.SHEET_CONFIG) {
    content = (
      <SheetConfigurationPanel
        node={node || nodes.find((item) => item.id === 'generateSheet')}
        onDone={onClose}
        onUpdateField={onUpdateNodeData}
        readOnly={Boolean(currentRunId)}
      />
    );
  } else if (activeOverlay.type === WORKFLOW_OVERLAYS.PRODUCT_SELECT) {
    content = (
      <ManualProductSelectionPanel
        artifactState={scopedArtifactState}
        currentRunId={currentRunId}
        onConfirm={async (payload) => {
          const confirmed = await onConfirmProductReview(payload);
          if (confirmed) onClose();
        }}
        onRetry={async () => {
          onClose();
          await onRetryNode('select');
        }}
        canRetry={Boolean(currentRunId)}
      />
    );
  } else if (activeOverlay.type === WORKFLOW_OVERLAYS.DISTRIBUTION) {
    content = (
      <DistributionExportPanel
        artifactState={scopedArtifactState}
        onCopyText={copyText}
        currentRunId={currentRunId}
        sourceNodeId={node?.id}
        onDistributionJobChange={updateDistributionNodeJob}
        directPreview
        onManualComplete={onClose}
      />
    );
  } else if (activeOverlay.type === WORKFLOW_OVERLAYS.ARTIFACT) {
    content = <ArtifactPanel state={scopedArtifactState} />;
  } else {
    content = (
      <>
        {node && (
          <div className="workflow-overlay-diagnostics">
            {getWorkflowNodeDetailRows(node).filter((row) => row.label !== '产物位置').map((row) => (
              <div key={row.label}><span>{row.label}</span><strong>{row.value}</strong></div>
            ))}
          </div>
        )}
        <NodeOperationPanel {...nodeOperationProps} selectedNode={node} artifactState={scopedArtifactState} />
      </>
    );
  }

  return (
    <WorkflowOverlayShell
      label={label}
      description={defaultDescription}
      onClose={onClose}
      wide={[WORKFLOW_OVERLAYS.DISTRIBUTION, WORKFLOW_OVERLAYS.NODE_WORKBENCH, WORKFLOW_OVERLAYS.PRODUCT_SELECT, WORKFLOW_OVERLAYS.SHEET_CONFIG].includes(activeOverlay.type)}
    >
      {content}
    </WorkflowOverlayShell>
  );
}
