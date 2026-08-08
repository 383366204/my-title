import { Handle, Position } from '@xyflow/react';
import { RefreshCw } from 'lucide-react';

import {
  getWorkflowBlockerActions,
  getWorkflowNodeViewModel,
  getWorkflowRuntimeActions
} from '../../../../workflow-ui.js';
import { labelPipelineStatus } from '../../../../pipeline-labels.js';
import {
  WorkflowBlockerCallout,
  WorkflowNodeActionChip,
  WorkflowNodeArtifactButton,
  WorkflowNodeDiversitySummary,
  WorkflowNodeOutputSummary,
  WorkflowProgressStrip,
  WorkflowStepBadge
} from './workflow-node-parts.jsx';

const WorkflowNodeOperationStatus = ({ data }) => {
  if (!data?.operationMessage) return null;
  return (
    <div className="workflow-node-operation-status" role="status" aria-live="polite">
      {data.pendingAction && <RefreshCw size={11} className="animate-spin" />}
      <span>{data.operationMessage}</span>
    </div>
  );
};

const WorkflowNodeSecondaryActions = ({ nodeId, data }) => {
  const runtimeActions = getWorkflowRuntimeActions({
    runStatus: data?.workflowRunStatus,
    nodeId,
    state: data
  });
  const distributionActions = nodeId === 'export' && data?.distributionJob?.status === 'submitting'
    ? [{
        action: 'pause-distribution',
        label: data.distributionJob.requestedAction === 'pause' ? '暂停请求中' : '暂停铺货',
        description: data.distributionJob.requestedAction === 'pause'
          ? '当前批次完成后会停止后续铺货。'
          : '当前批次完成后停止，未提交的商品会保留在清单中。',
        disabled: data.distributionJob.requestedAction === 'pause'
      }]
    : [];
  const actions = [...distributionActions, ...runtimeActions, ...getWorkflowBlockerActions(nodeId, data)]
    .filter((action, index, list) => list.findIndex((item) => item.action === action.action) === index)
    .filter((action) => action.action !== getWorkflowNodeViewModel(nodeId, data).primaryAction.action)
    .slice(0, 3);
  if (actions.length === 0) return null;
  return (
    <div className="production-node-secondary-actions">
      {actions.map((action) => (
        <button
          type="button"
          key={action.action}
          className="production-node-secondary-action"
          title={action.description || action.label}
          disabled={action.disabled || Boolean(data.pendingAction)}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            data.onAction?.(action.action);
          }}
        >
          {data.pendingAction === action.action ? `${action.label}中…` : action.label}
        </button>
      ))}
    </div>
  );
};

/**
 * Component to render a production workflow canvas node.
 * @param {object} props Component props.
 * @param {string} props.id Node ID.
 * @param {object} props.data React Flow node data object.
 * @returns {import('react').JSX.Element} React component element.
 */
export const ProductionNode = ({ id, data }) => {
  const status = data.status || data.state || 'idle';
  const view = getWorkflowNodeViewModel(id, data);
  const tone = view.tone;
  const label = data.label || data.name || data.title || id;

  return (
    <div
      role="button"
      tabIndex={0}
      className={`production-node production-node-${tone}`}
      onPointerDown={(event) => {
        event.stopPropagation();
        data.onSelect?.();
      }}
      onClick={data.onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          data.onSelect?.();
        }
      }}
    >
      <Handle type="target" position={Position.Left} id="in" />
      <div className="production-node-head">
        <span>{data.stage || data.kind || data.action || data.type || 'workflow'}</span>
        <WorkflowStepBadge data={data} />
        <b>{labelPipelineStatus(status)}</b>
      </div>
      <div className="production-node-title">{label}</div>
      {data.description && <div className="production-node-description">{data.description}</div>}

      <WorkflowProgressStrip view={view} />
      <WorkflowNodeOutputSummary view={view} />
      <WorkflowNodeDiversitySummary nodeId={id} data={data} />
      <WorkflowBlockerCallout view={view} />
      <WorkflowNodeOperationStatus data={data} />
      {!['artifact', 'inspect'].includes(view.primaryAction.action) && <WorkflowNodeActionChip view={view} onAction={data.onAction} />}
      <WorkflowNodeSecondaryActions nodeId={id} data={data} />
      <WorkflowNodeArtifactButton data={data} />
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
};
