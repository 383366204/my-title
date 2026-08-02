import { Handle, Position } from '@xyflow/react';
import { Check, Database, FileText, Layers, RefreshCw, Sparkles, Tag } from 'lucide-react';

import {
  getWorkflowBlockerActions,
  getWorkflowNodeViewModel,
  getWorkflowRuntimeActions
} from '../../../workflow-ui.js';
import { labelPipelineStatus } from '../../../pipeline-labels.js';

const getStatusBorderColor = (status) => {
  switch (status) {
    case 'running':
      return 'border-blue-500 bg-slate-900 shadow-[0_0_12px_rgba(59,130,246,0.5)]';
    case 'completed':
      return 'border-emerald-500 bg-slate-900';
    case 'failed':
      return 'border-rose-500 bg-slate-900';
    case 'blocked':
      return 'border-red-500 bg-slate-900 shadow-[0_0_12px_rgba(239,68,68,0.5)]';
    case 'waiting_manual':
      return 'border-amber-500 bg-slate-900 shadow-[0_0_12px_rgba(245,158,11,0.5)]';
    case 'retryable':
      return 'border-orange-500 bg-slate-900 shadow-[0_0_12px_rgba(249,115,22,0.5)]';
    case 'paused':
      return 'border-slate-500 bg-slate-900';
    default:
      return 'border-slate-700 bg-slate-900';
  }
};

const getStatusDotColor = (status) => {
  switch (status) {
    case 'running':
      return 'bg-blue-500 animate-ping';
    case 'completed':
      return 'bg-emerald-500';
    case 'failed':
      return 'bg-rose-500';
    case 'blocked':
      return 'bg-red-500';
    case 'waiting_manual':
      return 'bg-amber-500';
    case 'retryable':
      return 'bg-orange-500';
    case 'paused':
      return 'bg-slate-500';
    default:
      return 'bg-slate-500';
  }
};

const WorkflowProgressStrip = ({ view }) => {
  if (!view.progress) return null;
  return (
    <div className="workflow-node-progress" aria-label={view.progressLabel || '节点进度'}>
      <div className="workflow-node-progress-bar">
        <span style={{ width: `${view.progressPercent}%` }} />
      </div>
      {view.progressLabel && <div className="workflow-node-progress-label">{view.progressLabel}</div>}
    </div>
  );
};

const WorkflowBlockerCallout = ({ view }) => {
  if (!view.hasBlocker) return null;
  return (
    <div className={`workflow-node-callout workflow-node-callout-${view.tone}`}>
      <strong>{view.blockerTitle}</strong>
      <span>{view.blockerMessage}</span>
    </div>
  );
};

const WorkflowNodeOperationStatus = ({ data }) => {
  if (!data?.operationMessage) return null;
  return (
    <div className="workflow-node-operation-status" role="status" aria-live="polite">
      {data.pendingAction && <RefreshCw size={11} className="animate-spin" />}
      <span>{data.operationMessage}</span>
    </div>
  );
};

const WorkflowNodeActionChip = ({ view, onAction }) => (
  <span
    className={`production-node-action production-node-action-${view.primaryAction.tone}`}
    role="button"
    tabIndex={0}
    onPointerDown={(event) => event.stopPropagation()}
    onClick={(event) => {
      event.stopPropagation();
      onAction?.(view.primaryAction.action);
    }}
    onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        onAction?.(view.primaryAction.action);
      }
    }}
  >
    {view.primaryAction.action === 'confirm-distribution' && <Check size={11} />}
    {view.primaryAction.label}
  </span>
);

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

// 铺货复核有专门的处理动作，避免和“查看产物”打开同一个清单弹窗。
const ARTIFACT_NODE_IDS = new Set(['mine', 'verify', 'select', 'generate']);

const WorkflowNodeArtifactButton = ({ data }) => {
  if (!data?.onViewArtifact || !ARTIFACT_NODE_IDS.has(String(data.id || ''))) return null;
  return (
    <span
      className="production-node-artifact-action"
      role="button"
      tabIndex={0}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        data.onViewArtifact();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          data.onViewArtifact();
        }
      }}
    >
      <FileText size={11} /> 查看产物
    </span>
  );
};

const WorkflowStepBadge = ({ data }) => {
  if (!data.stepIndex || !data.stepTotal) return null;
  return (
    <span className="workflow-step-badge">
      步骤 {data.stepIndex}/{data.stepTotal}
    </span>
  );
};

const WorkflowNodeOutputSummary = ({ view }) => {
  if (!view.successLabel) return null;
  return (
    <div className="workflow-node-output-summary">
      {view.successLabel}
    </div>
  );
};

const WorkflowNodeDiversitySummary = ({ nodeId, data }) => {
  const diversity = data?.output?.diversity || data?.diversity || null;
  if (!diversity) return null;
  const rows = nodeId === 'mine'
    ? [
        Number(data?.output?.inspirationCount || diversity.inspirations || 0) > 0 ? `${data?.output?.inspirationCount || diversity.inspirations} 条灵感` : '',
        Number(data?.output?.selectedRoots || diversity.selectedRoots || 0) > 0 ? `${data?.output?.selectedRoots || diversity.selectedRoots} 个词根` : '',
        Number(data?.output?.inspirationRejected || diversity.inspirationRejected || 0) > 0 ? `拦截 ${data?.output?.inspirationRejected || diversity.inspirationRejected} 条` : '',
        Number(diversity.familyCount || 0) > 0 ? `${diversity.familyCount} 个词族` : '',
        Number(diversity.newFamilyCount || 0) > 0 ? `新增 ${diversity.newFamilyCount} 个` : '',
        Number(diversity.seedReplenished || 0) > 0 ? `补充种子 ${diversity.seedReplenished} 个` : '',
        Number(diversity.seenFiltered || 0) > 0 ? `过滤旧词 ${diversity.seenFiltered} 个` : ''
      ]
    : nodeId === 'select'
      ? [
          Number(diversity.newOffers || 0) > 0 ? `新货源 ${diversity.newOffers} 个` : '',
          Number(diversity.uniqueOffers || 0) > 0 ? `独立货源 ${diversity.uniqueOffers} 个` : '',
          Number(diversity.suppliers || 0) > 0 ? `${diversity.suppliers} 家供应商` : '',
          Number(diversity.historyFallbackCount || 0) > 0 ? `历史回退 ${diversity.historyFallbackCount} 个` : ''
        ]
      : [];
  const visible = rows.filter(Boolean);
  if (visible.length === 0) return null;
  return <div className="workflow-node-diversity-summary">{visible.join(' · ')}</div>;
};

const shouldShowNodeActionChip = (status) => (
  ['blocked', 'waiting_manual', 'retryable', 'paused', 'failed'].includes(String(status || '').toLowerCase())
);

export const InputNode = ({ data }) => {
  const statusColor = getStatusBorderColor(data.status);
  const dotColor = getStatusDotColor(data.status);
  const view = getWorkflowNodeViewModel(data.id || data.label, data);

  return (
    <div
      className={`p-4 rounded-xl border-2 w-64 text-slate-100 ${statusColor} transition-all duration-300`}
      onPointerDown={(event) => {
        event.stopPropagation();
        data.onSelect?.();
      }}
      onClick={data.onSelect}
      style={{ cursor: 'pointer' }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold tracking-wider text-blue-400 uppercase flex items-center gap-1">
          <Layers size={12} /> 输入节点
        </span>
        <WorkflowStepBadge data={data} />
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-400">{labelPipelineStatus(data.status)}</span>
          <span className={`h-2 w-2 rounded-full ${dotColor}`} />
        </div>
      </div>
      <div className="text-sm font-semibold mb-1 truncate text-slate-200">
        关键词: {data.keyword || <span className="text-slate-500 italic">未设置</span>}
      </div>
      <div className="text-xs text-slate-400">
        最大长度: {data.maxLength || 60} 字符
      </div>

      <WorkflowProgressStrip view={view} />
      <WorkflowBlockerCallout view={view} />
      {shouldShowNodeActionChip(data.status) && view.primaryAction.action !== 'artifact' && <WorkflowNodeActionChip view={view} onAction={data.onAction} />}
      <WorkflowNodeArtifactButton data={data} />

      <Handle type="source" position={Position.Right} id="a" style={{ background: '#3b82f6', width: 8, height: 8 }} />
    </div>
  );
};

// 2. Mining Node (关键词挖掘节点)
export const MiningNode = ({ data }) => {
  const statusColor = getStatusBorderColor(data.status);
  const dotColor = getStatusDotColor(data.status);
  const view = getWorkflowNodeViewModel(data.id || 'mine', data);

  const keywords = data.output?.keywords || [];

  return (
    <div
      className={`p-4 rounded-xl border-2 w-64 text-slate-100 ${statusColor} transition-all duration-300`}
      onPointerDown={(event) => {
        event.stopPropagation();
        data.onSelect?.();
      }}
      onClick={data.onSelect}
      style={{ cursor: 'pointer' }}
    >
      <Handle type="target" position={Position.Left} id="in" style={{ background: '#3b82f6', width: 8, height: 8 }} />
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold tracking-wider text-indigo-400 uppercase flex items-center gap-1">
          <Database size={12} /> 关键词挖掘
        </span>
        <WorkflowStepBadge data={data} />
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-400">{labelPipelineStatus(data.status)}</span>
          <span className={`h-2 w-2 rounded-full ${dotColor}`} />
        </div>
      </div>
      <div className="text-xs text-slate-400 mb-1">
        挖掘数量限制: {data.count || 10} 个
      </div>

      {data.status === 'completed' && keywords.length > 0 ? (
        <div className="mt-2 bg-slate-950 p-2 rounded border border-slate-800 text-[11px] max-h-24 overflow-y-auto">
          <div className="font-semibold text-indigo-300 mb-1">挖掘词根结果:</div>
          <div className="flex flex-wrap gap-1">
            {keywords.map((kw, i) => (
              <span key={i} className="px-1.5 py-0.5 bg-indigo-950/50 border border-indigo-800 text-indigo-200 rounded text-[10px]">
                {kw}
              </span>
            ))}
          </div>
        </div>
      ) : data.status === 'running' ? (
        <div className="text-xs text-blue-400 mt-2 flex items-center gap-1.5">
          <RefreshCw size={12} className="animate-spin" /> AI正在分词与挖掘...
        </div>
      ) : (
        <div className="text-[11px] text-slate-500 mt-1 italic">等待上游输入...</div>
      )}

      <WorkflowProgressStrip view={view} />
      <WorkflowNodeOutputSummary view={view} />
      <WorkflowNodeDiversitySummary nodeId="mine" data={data} />
      <WorkflowBlockerCallout view={view} />
      {shouldShowNodeActionChip(data.status) && view.primaryAction.action !== 'artifact' && <WorkflowNodeActionChip view={view} onAction={data.onAction} />}
      <WorkflowNodeArtifactButton data={data} />

      <Handle type="source" position={Position.Right} id="out" style={{ background: '#3b82f6', width: 8, height: 8 }} />
    </div>
  );
};

// 3. Title Generator Node (标题生成与选品卡片)
export const TitleGeneratorNode = ({ data }) => {
  const statusColor = getStatusBorderColor(data.status);
  const dotColor = getStatusDotColor(data.status);
  const view = getWorkflowNodeViewModel(data.id || 'generate', data);

  const result = data.output || {};
  const titles = result.titles || [];
  const product = result.products?.[0] || null;

  return (
    <div
      className={`p-4 rounded-xl border-2 w-72 text-slate-100 ${statusColor} transition-all duration-300`}
      onPointerDown={(event) => {
        event.stopPropagation();
        data.onSelect?.();
      }}
      onClick={data.onSelect}
      style={{ cursor: 'pointer' }}
    >
      <Handle type="target" position={Position.Left} id="in" style={{ background: '#3b82f6', width: 8, height: 8 }} />
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold tracking-wider text-emerald-400 uppercase flex items-center gap-1">
          <Sparkles size={12} /> 标题与选品生成
        </span>
        <WorkflowStepBadge data={data} />
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-400">{labelPipelineStatus(data.status)}</span>
          <span className={`h-2 w-2 rounded-full ${dotColor}`} />
        </div>
      </div>

      {data.status === 'completed' && titles.length > 0 ? (
        <div className="space-y-2 mt-2">
          <div className="bg-slate-950 p-2 rounded border border-slate-800 text-[11px]">
            <div className="font-semibold text-emerald-300 mb-1 flex items-center gap-1">
              <Tag size={10} /> 优化淘系标题:
            </div>
            <div className="font-mono text-slate-300 bg-slate-900 p-1.5 rounded border border-slate-800 break-words">
              {titles[0]}
            </div>
          </div>

          {product && (
            <div className="bg-slate-950 p-2 rounded border border-slate-800 text-[11px] space-y-1">
              <div className="font-semibold text-emerald-300">1688推荐货源:</div>
              <div className="flex items-center gap-2">
                {product.主图链接 && (
                  <img src={product.主图链接} className="w-8 h-8 rounded object-cover border border-slate-800" alt="product" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-slate-300 truncate">{product.链接原标题}</div>
                  <div className="text-[10px] text-slate-400 flex justify-between">
                    <span>底价: ¥{product.商品原价}</span>
                    <span>销: {product['30天销量']}</span>
                  </div>
                </div>
              </div>
              <div className="text-[10px] text-slate-400 border-t border-slate-800/50 pt-1 mt-1 break-words">
                <span className="text-emerald-500 font-bold">推荐理由: </span>{product.选品理由}
              </div>
            </div>
          )}
        </div>
      ) : data.status === 'running' ? (
        <div className="text-xs text-blue-400 mt-2 flex items-center gap-1.5">
          <RefreshCw size={12} className="animate-spin" /> AI正在组合生成标题及优选货源...
        </div>
      ) : (
        <div className="text-[11px] text-slate-500 mt-1 italic">等待上游数据...</div>
      )}

      <WorkflowProgressStrip view={view} />
      <WorkflowNodeOutputSummary view={view} />
      <WorkflowBlockerCallout view={view} />
      {shouldShowNodeActionChip(data.status) && view.primaryAction.action !== 'artifact' && <WorkflowNodeActionChip view={view} onAction={data.onAction} />}
      <WorkflowNodeArtifactButton data={data} />

      <Handle type="source" position={Position.Right} id="out" style={{ background: '#3b82f6', width: 8, height: 8 }} />
    </div>
  );
};

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
