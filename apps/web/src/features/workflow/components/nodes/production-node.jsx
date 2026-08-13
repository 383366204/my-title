import { Handle, Position } from '@xyflow/react';
import { Download, RefreshCw, Settings2 } from 'lucide-react';

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

const WorkflowSheetQuickActions = ({ data, view }) => {
  if (data?.sheetConfig !== true) return null;
  const readOnly = data.workflowReadOnly === true || !['idle', 'pending'].includes(String(data.status || data.state || 'idle').toLowerCase());
  const sheetType = data.sheetType === 'review' ? 'review' : 'order';
  return (
    <div className="production-sheet-actions" aria-label="制表操作">
      {data.reviewSourceUpload !== true && data.orderSheetOnly !== true && <div className="production-sheet-type" role="group" aria-label="表格类型快捷选择">
        {[['order', '刷单表'], ['review', '评价表']].map(([value, label]) => (
          <button
            type="button"
            key={value}
            className={sheetType === value ? 'active' : ''}
            aria-pressed={sheetType === value}
            disabled={readOnly}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              data.onUpdate?.('sheetType', value);
            }}
          >
            {label}
          </button>
        ))}
      </div>}
      <button
        type="button"
        className="production-sheet-settings"
        title={view.primaryAction.label}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          data.onAction?.('configure-sheet');
        }}
      >
        <Settings2 size={12} /> {view.primaryAction.label}
      </button>
    </div>
  );
};

const WorkflowCollectionQuickActions = ({ data, view }) => {
  if (data?.orderSheetConfig !== true) return null;
  const isHistoricalConfig = data.workflowReadOnly === true;
  const readOnly = !isHistoricalConfig && !['idle', 'pending'].includes(String(data.status || data.state || 'idle').toLowerCase());
  return (
    <div className="production-collection-actions" aria-label="采集条件">
      <label>
        <span>日期</span>
        <select
          aria-label="采集日期范围"
          value={data.dateMode || 'latest_day'}
          disabled={readOnly}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => data.onUpdate?.('dateMode', event.target.value)}
        >
          <option value="latest_day">最近单日</option>
          <option value="last_7_days">最近 7 天</option>
          <option value="last_30_days">最近 30 天</option>
          <option value="custom">自定义</option>
        </select>
      </label>
      <label>
        <span>页数</span>
        <input
          aria-label="采集页数"
          type="number"
          min="1"
          max="5"
          value={data.pages ?? 1}
          disabled={readOnly}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => data.onUpdate?.('pages', Math.min(5, Math.max(1, Number.parseInt(event.target.value, 10) || 1)))}
        />
      </label>
      <button
        type="button"
        className="production-sheet-settings"
        title={view.primaryAction.label}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          data.onAction?.('manual-input');
        }}
      >
        <Settings2 size={12} /> {view.primaryAction.label}
      </button>
    </div>
  );
};

const WorkflowReviewQuickActions = ({ data }) => {
  if (data?.reviewConfig !== true) return null;
  const readOnly = data.workflowReadOnly === true || !['idle', 'pending'].includes(String(data.status || data.state || 'idle').toLowerCase());
  return (
    <div className="production-collection-actions production-review-actions" aria-label="评价生成设置">
      <label>
        <span>语气</span>
        <select
          aria-label="评价语气"
          value={data.reviewTone || '自然真实'}
          disabled={readOnly}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => data.onUpdate?.('reviewTone', event.target.value)}
        >
          <option value="自然真实">自然真实</option>
          <option value="简洁克制">简洁克制</option>
          <option value="生活化">生活化</option>
        </select>
      </label>
      <label>
        <span>字数</span>
        <input
          aria-label="评价字数"
          type="number"
          min="15"
          max="100"
          value={data.reviewLength ?? 35}
          disabled={readOnly}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => data.onUpdate?.('reviewLength', Math.min(100, Math.max(15, Number.parseInt(event.target.value, 10) || 35)))}
        />
      </label>
      <label className="production-review-toggle">
        <input
          type="checkbox"
          checked={data.useAI !== false}
          disabled={readOnly}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => data.onUpdate?.('useAI', event.target.checked)}
        />
        <span>AI</span>
      </label>
    </div>
  );
};

const WorkflowCompletionDownload = ({ nodeId, data }) => {
  const status = String(data?.status || data?.state || '').toLowerCase();
  const workflowRunId = data?.workflowRunId || data?.output?.runId;
  if (nodeId !== 'end' || status !== 'completed' || data?.orderSheetDownload !== true || !workflowRunId) {
    return null;
  }
  const downloadUrl = `/api/workflows/runs/${encodeURIComponent(workflowRunId)}/artifacts/generateSheet/raw`;
  return (
    <a
      className="production-node-download-action"
      href={downloadUrl}
      download
      title="下载本次生成的 Excel 表格"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <Download size={13} /> 下载 Excel
    </a>
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
      {view.configSummary && <div className="workflow-node-config-summary">{view.configSummary}</div>}

      <WorkflowProgressStrip view={view} />
      <WorkflowNodeOutputSummary view={view} />
      <WorkflowNodeDiversitySummary nodeId={id} data={data} />
      <WorkflowBlockerCallout view={view} />
      <WorkflowNodeOperationStatus data={data} />
      {id === 'start' && <WorkflowCollectionQuickActions data={data} view={view} />}
      {id === 'generateReviews' && <WorkflowReviewQuickActions data={data} />}
      {id === 'generateSheet' && <WorkflowSheetQuickActions data={data} view={view} />}
      {!['artifact', 'inspect'].includes(view.primaryAction.action)
        && !(id === 'generateSheet' && data.sheetConfig === true)
        && !(id === 'start' && data.orderSheetConfig === true)
        && <WorkflowNodeActionChip view={view} onAction={data.onAction} />}
      <WorkflowNodeSecondaryActions nodeId={id} data={data} />
      <WorkflowNodeArtifactButton data={data} />
      <WorkflowCompletionDownload nodeId={id} data={data} />
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
};
