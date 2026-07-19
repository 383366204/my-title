import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  MarkerType
} from '@xyflow/react';
import {
  Play,
  Square,
  RefreshCw,
  FileText,
  Clock,
  Sparkles,
  Settings,
  Layers,
  ChevronRight,
  Database,
  Tag,
  Trash2,
  Plus,
  Copy,
  PenLine,
  CheckCircle2,
  Check,
  X,
  ExternalLink,
  ChevronLeft
} from 'lucide-react';

import '@xyflow/react/dist/style.css';
import './App.css';
import {
  formatWorkflowProgressLabel,
  getStartNodeParams,
  getWorkflowBlockerActions,
  getWorkflowArtifactView,
  buildWorkflowOperationRequest,
  buildWorkflowDeleteRunRequest,
  getWorkflowRuntimeActions,
  getWorkflowLaunchBlocker,
  getWorkflowNodeDetailRows,
  getWorkflowNodePanelKind,
  getWorkflowNodeViewModel,
  getWorkflowOperationMessage,
  getWorkflowResultSummaryView,
  getWorkflowRunActiveNodeId,
  getWorkflowTemplateView,
  getUnifiedWorkflowHistoryItem,
  isWorkflowInputNodeType,
  labelWorkflowNodeStatus,
  normalizeWorkflowProgressEvent,
  summarizeWorkflowArtifact
} from './workflow-ui.js';
import {
  labelPipelineStatus
} from './pipeline-labels.js';

// ==================== Custom Flow Nodes ====================

const MINER_TABS = [
  { id: 'peer', label: '同行词根', endpoint: '/api/miner/peer', needsInput: true },
  { id: 'opp', label: '1688商机', endpoint: '/api/miner/opportunities', needsInput: false },
  { id: 'sycm-market', label: '参谋关联词', endpoint: '/api/miner/sycm-market', needsInput: true }
];

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.ok === false) {
    throw new Error(payload.error || `请求失败: ${res.status}`);
  }
  return payload.data ?? payload;
}

function copyText(value) {
  if (!navigator?.clipboard) return Promise.resolve();
  return navigator.clipboard.writeText(String(value || ''));
}

function artifactItems(state) {
  const artifact = state?.artifact || null;
  if (!artifact) return [];
  if (Array.isArray(artifact.items)) return artifact.items;
  if (Array.isArray(artifact.rows)) return artifact.rows;
  return [];
}

function candidateKeyword(row = {}) {
  return String(row.keyword || row.word || row.title || row.query || '').trim();
}

function rowSelectedKeyword(row = {}) {
  return String(row.selectedKeyword || row.keyword || row.blueOceanWord || row.product?.蓝海词 || row['蓝海词'] || '').trim();
}

// 1. Input Node (输入参数节点)
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
          disabled={action.disabled}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            data.onAction?.(action.action);
          }}
        >
          {action.label}
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
  if (kind === 'keyword-mining') return '候选词会展示在本面板“候选词产物”，并保存到 candidates.jsonl。';
  if (kind === 'keyword-review') return '人工筛词会写入 reviewed-candidates.jsonl，只有确认通过的词会进入生意参谋。';
  if (kind === 'sycm-verify') return '验真通过词会展示在节点产物，并保存到 verified-keywords.jsonl。';
  if (kind === 'product-select') return '已选货源会展示在节点产物，并保存到 selected-products.jsonl。';
  if (kind === 'title-generate') return '生成的标题会关联已选货源，并保存到 generated-products.jsonl。';
  if (kind === 'review') return '待铺货清单和复核报告会展示在复核节点，并保存到 distribution-batch.txt / distribution-review.md。';
  return '';
};

const shouldShowNodeActionChip = (status) => (
  ['blocked', 'waiting_manual', 'retryable', 'paused', 'failed'].includes(String(status || '').toLowerCase())
);

const InputNode = ({ data }) => {
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
const MiningNode = ({ data }) => {
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
      <WorkflowBlockerCallout view={view} />
      {shouldShowNodeActionChip(data.status) && view.primaryAction.action !== 'artifact' && <WorkflowNodeActionChip view={view} onAction={data.onAction} />}
      <WorkflowNodeArtifactButton data={data} />

      <Handle type="source" position={Position.Right} id="out" style={{ background: '#3b82f6', width: 8, height: 8 }} />
    </div>
  );
};

// 3. Title Generator Node (标题生成与选品卡片)
const TitleGeneratorNode = ({ data }) => {
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

const ProductionNode = ({ id, data }) => {
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
      <WorkflowBlockerCallout view={view} />
      {!['artifact', 'inspect'].includes(view.primaryAction.action) && <WorkflowNodeActionChip view={view} onAction={data.onAction} />}
      <WorkflowNodeSecondaryActions nodeId={id} data={data} />
      <WorkflowNodeArtifactButton data={data} />
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
};

// ==================== Node Types Map ====================
const nodeTypes = {
  'keyword-input': InputNode,
  'input': ProductionNode,
  'keyword-mining': MiningNode,
  'title-generator': TitleGeneratorNode,
  'start': ProductionNode,
  'task': ProductionNode,
  'agent': ProductionNode,
  'tool': ProductionNode,
  'review': ProductionNode,
  'decision': ProductionNode,
  'output': ProductionNode,
  'end': ProductionNode
};

const isInputNodeType = isWorkflowInputNodeType;
const DEFAULT_WORKFLOW_MODE = 'daily';
const ACTIVE_RUN_STATUSES = new Set(['pending', 'running', 'created', 'mined', 'verified', 'products_selected', 'generated', 'resuming', 'retrying', 'awaiting_keyword_review', 'awaiting_product_review']);
const DAILY_START_FIELDS = [
  { key: 'mine', label: '挖掘候选词', min: 1, max: 200 },
  { key: 'rootLimit', label: '每日词根数', min: 1, max: 20 },
  { key: 'rootCooldownDays', label: '词根冷却天数', min: 0, max: 60 },
  { key: 'verify', label: '生意参谋校验', min: 1, max: 200 },
  { key: 'verifyReserve', label: '备用词补验数量', min: 0, max: 30 },
  { key: 'select', label: '货源选品', min: 1, max: 100 },
  { key: 'generate', label: '标题生成', min: 1, max: 100 },
  { key: 'export', label: '导出清单数量', min: 1, max: 100 },
  { key: 'productsPerKeyword', label: '每词货源数', min: 1, max: 50 },
  { key: 'length', label: '标题长度', min: 30, max: 80 },
  { key: 'pages', label: '采集页数', min: 1, max: 5 }
];
const DAILY_START_OPTIONS = [
  { key: 'source', label: '挖词来源', options: [{ value: 'sycm_hot', label: '生意参谋热搜关联词' }, { value: 'sycm_blue', label: '生意参谋蓝海关联词' }, { value: 'local', label: '本地规则扩展' }, { value: 'hybrid', label: '本地规则 + AI' }] },
  { key: 'rootMode', label: '词根模式', options: [{ value: 'auto', label: '自动提取短词根' }, { value: 'seed', label: '直接使用种子词' }] },
  { key: 'autoAllowReviewKeywords', label: '严格词为空时', options: [{ value: 'true', label: '继续少量可复核词' }, { value: 'false', label: '停在验真等待处理' }] }
];

const unwrapApiData = (payload) => payload?.data || payload || {};

const normalizeTemplateList = (payload) => {
  const data = unwrapApiData(payload);
  const rawTemplates = Array.isArray(data)
    ? data
    : data?.templates || data?.items || data?.workflows || [];
  return Array.isArray(rawTemplates)
    ? rawTemplates.filter((template) => template?.workflow?.nodes && template?.workflow?.edges)
    : [];
};

const normalizeRunList = (payload) => {
  const data = unwrapApiData(payload);
  const rawRuns = Array.isArray(data)
    ? data
    : data?.runs || data?.items || data?.history || [];
  return Array.isArray(rawRuns) ? rawRuns : [];
};

const getTemplateMode = (template) => template?.mode || template?.workflow?.mode || DEFAULT_WORKFLOW_MODE;

const normalizeCanvasNode = (node, selectNode, actionHandler, artifactHandler) => {
  const renderType = nodeTypes[node.type] ? node.type : 'task';
  return {
    ...node,
    type: renderType,
    data: {
      ...node.data,
      id: node.id,
      originalType: node.data?.originalType || node.type,
      status: node.data?.status || 'idle',
      output: node.data?.output || null,
      error: node.data?.error || null,
      progress: node.data?.progress || null,
      blocker: node.data?.blocker || null,
      actionHint: node.data?.actionHint || null,
      nextRecommendedAction: node.data?.nextRecommendedAction || null,
      platformStatus: node.data?.platformStatus || null,
      manualAction: node.data?.manualAction || null,
      durationMs: node.data?.durationMs || null,
      outputSummary: node.data?.outputSummary || null,
      cooldownRemainingMs: node.data?.cooldownRemainingMs || 0,
      workflowRunStatus: node.data?.workflowRunStatus || 'idle',
      onSelect: () => selectNode(node.id),
      onAction: (action) => actionHandler?.(action, node.id),
      onViewArtifact: () => artifactHandler?.(node.id)
    }
  };
};

const normalizeWorkflowForCanvas = (workflow = {}) => {
  const rawNodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const rawEdges = Array.isArray(workflow.edges) ? workflow.edges : [];
  const nodes = rawNodes
    .filter((node) => node?.id !== 'review')
    .map((node, index, visibleNodes) => ({
      ...node,
      data: {
        ...node.data,
        stepIndex: index + 1,
        stepTotal: visibleNodes.length
      }
    }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = rawEdges.filter((edge) => (
    edge?.source !== 'review'
    && edge?.target !== 'review'
    && nodeIds.has(edge?.source)
    && nodeIds.has(edge?.target)
  ));
  if (nodeIds.has('export') && nodeIds.has('end') && !edges.some((edge) => edge.source === 'export' && edge.target === 'end')) {
    edges.push({ id: 'export-end', source: 'export', target: 'end', type: 'straight' });
  }
  return { ...workflow, nodes, edges };
};

const effectiveCanvasNodeId = (nodeId) => (nodeId === 'review' ? 'export' : nodeId);

const shouldPreferLegacyReviewState = (state = {}) => {
  const status = String(state.status || state.state || '').toLowerCase();
  return ['blocked', 'failed', 'retryable', 'waiting_manual', 'paused', 'needs_review', 'waiting_confirmation', 'running', 'resuming', 'retrying'].includes(status);
};

const mergeCanvasNodeState = (primary = {}, legacyReview = {}) => {
  if (!legacyReview || !shouldPreferLegacyReviewState(legacyReview)) return primary || {};
  return {
    ...(primary || {}),
    ...legacyReview,
    output: {
      ...(primary?.output || {}),
      ...(legacyReview.output || {})
    },
    progress: legacyReview.progress || primary?.progress || null
  };
};

const getCanvasNodeState = (nodeStates = {}, nodeId) => {
  if (nodeId === 'export') {
    if (!nodeStates.export && !nodeStates.review) return null;
    return mergeCanvasNodeState(nodeStates.export || {}, nodeStates.review || {});
  }
  return nodeStates?.[nodeId] || null;
};

const ArtifactPanel = ({ state }) => {
  const artifact = state.artifact;
  const view = getWorkflowArtifactView(artifact, state.nodeId);
  const businessRows = view.kind === 'business-list' || view.kind === 'candidate-list';

  return (
    <div className="workflow-artifact-panel">
      <div className="workflow-artifact-head">
        <span>{view.title || '节点产物'}</span>
        {artifact && <b>{summarizeWorkflowArtifact(artifact)}</b>}
      </div>
      {state.status === 'loading' && (
        <div className="artifact-empty"><RefreshCw size={13} className="animate-spin" /> 正在加载节点产物...</div>
      )}
      {state.status === 'error' && (
        <div className="artifact-error">{state.error || '节点产物加载失败'}</div>
      )}
      {state.status === 'empty' && (
        <div className="artifact-empty">{state.error || view.emptyText}</div>
      )}
      {state.status === 'ready' && artifact && businessRows && (
        <div className="artifact-business-list">
          {view.rows.length === 0 ? (
            <div className="artifact-empty">{view.emptyText}</div>
          ) : view.rows.map((item, index) => (
            <div className="artifact-business-row" key={`${item.title}-${index}`}>
              <strong>{item.title}</strong>
              {item.meta && <span>{item.meta}</span>}
              {Array.isArray(item.metrics) && item.metrics.length > 0 && (
                <div className="artifact-business-metrics">
                  {item.metrics.map((metric) => <em key={metric}>{metric}</em>)}
                </div>
              )}
              {item.description && <p>{item.description}</p>}
            </div>
          ))}
        </div>
      )}
      {state.status === 'ready' && artifact && view.kind === 'json-list' && (
        <div className="artifact-list">
          {view.rows.length === 0 ? (
            <div className="artifact-empty">{view.emptyText}</div>
          ) : view.rows.map((item, index) => (
            <pre key={index}>{JSON.stringify(item, null, 2)}</pre>
          ))}
        </div>
      )}
      {state.status === 'ready' && artifact && (view.kind === 'text' || view.kind === 'json-text') && (
        <pre className="artifact-text">
          {view.text || view.emptyText}
        </pre>
      )}
    </div>
  );
};

const REVIEW_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'recommended', label: '推荐铺货' },
  { id: 'manual', label: '待复核' },
  { id: 'rejected', label: '已拒绝' },
  { id: 'approved', label: '已通过' },
  { id: 'removed', label: '已移除' }
];

const REVIEW_GROUP_LABEL = {
  recommended: '推荐铺货',
  manual: '待人工复核',
  rejected: '硬拒绝'
};

function reviewRowKey(row, index) {
  return `${row.url || row.title || row.heading || 'row'}:${index}`;
}

function reviewInitialDecision(row) {
  return row.group === 'recommended' ? 'approved' : 'pending';
}

function buildApprovedDistributionText(rows) {
  return rows
    .map((row) => {
      const parts = [row.url, row.title, row.category].filter((part) => part && part !== '-');
      return parts.join('$$');
    })
    .filter(Boolean)
    .join('\n');
}

function distributionRowUrl(row = {}) {
  return row.url
    || row.raw?.url
    || row.raw?.productUrl
    || row.raw?.['产品链接']
    || row.raw?.product?.['产品链接']
    || row.description
    || '';
}

function distributionRowCategory(row = {}) {
  return row.category
    || row.raw?.category
    || row.raw?.recommendedCategory
    || row.raw?.productCategory
    || row.raw?.product?.类目
    || '';
}

function distributionRowPrice(row = {}) {
  return row.raw?.price
    || row.raw?.['商品原价']
    || row.raw?.product?.['商品原价']
    || '';
}

function buildDistributionText(rows) {
  return rows
    .map((row) => {
      const url = distributionRowUrl(row);
      const category = distributionRowCategory(row);
      return [url, row.title, category && category !== '-' ? category : ''].filter(Boolean).join('$$');
    })
    .filter(Boolean)
    .join('\n');
}

const EXPORT_STATUS_LABELS = {
  ready: '可直接导出',
  review_candidate: '待人工复核',
  rejected_before_distribution: '导出前拦截'
};

const EXPORT_REASON_LABELS = {
  missing_category: '缺少商品或推荐类目',
  keyword_opportunity_reject: '关键词机会评分未通过',
  keyword_opportunity_observe: '关键词需要观察',
  keyword_opportunity_review: '关键词需要人工复核',
  legacy_keyword_opportunity_reject: '历史产物：关键词机会未通过，新流程会在校验节点拦截',
  legacy_keyword_opportunity_observe: '历史产物：关键词需要观察，新流程会在校验节点提示',
  legacy_keyword_opportunity_review: '历史产物：关键词需要复核，新流程会在校验节点提示',
  product_opportunity_candidate: '货源只是候选级别',
  product_opportunity_manual_review: '货源需要人工复核',
  hot_keyword_product: '热搜词货源，需要谨慎铺货',
  sales_missing_or_zero: '销量缺失或为 0',
  fallback_hot: '蓝海数据不足，降级使用热搜趋势',
  missing_url: '缺少 1688 货源链接',
  invalid_1688_url: '1688 货源链接无效',
  missing_title: '缺少铺货标题',
  title_missing_keyword: '标题未包含核心关键词',
  missing_category_product: '商品类目缺失',
  category_conflict: '推荐类目与商品类目冲突',
  duplicate_url: '货源链接重复',
  duplicate_title: '标题重复',
  hot_export_limit: '热搜趋势词超过自动导出上限'
};

const EXPORT_VALUE_LABELS = {
  reject: '未通过',
  continue: '继续',
  stop: '停止',
  candidate: '候选',
  strong_recommend: '强推荐',
  manual_review: '人工复核',
  generate_title: '生成标题',
  trend: '趋势参考',
  high: '高',
  medium: '中',
  low: '低',
  unknown: '未知',
  trend_reference: '仅作趋势参考',
  title_core: '可作为标题核心词',
  title_optional: '可作为标题辅助词'
};

const DISTRIBUTION_BLOCKER_LABELS = {
  empty_input: '铺货清单为空',
  login_expired: '铺货工具登录已过期',
  browser_cdp_unavailable: 'Chrome 调试连接不可用',
  distribution_quota_exhausted: '铺货平台剩余额度为 0',
  recent_duplicate_batch: '近期已提交过相同批次'
};

function labelExportValue(value) {
  const normalized = String(value || '').trim();
  return EXPORT_VALUE_LABELS[normalized] || normalized;
}

function labelDistributionBlocker(value) {
  const normalized = String(value || '').trim();
  return DISTRIBUTION_BLOCKER_LABELS[normalized] || normalized;
}

function labelExportStatus(status) {
  return EXPORT_STATUS_LABELS[String(status || '').trim()] || String(status || '待处理');
}

function labelExportReasons(reasonText) {
  return String(reasonText || '')
    .split(',')
    .map((reason) => reason.trim())
    .filter(Boolean)
    .map((reason) => {
      const titleTooShort = reason.match(/^title_too_short:(.+)$/);
      if (titleTooShort) return `标题过短（${titleTooShort[1]}）`;
      const bannedWords = reason.match(/^banned_words:(.+)$/);
      if (bannedWords) return `包含违禁词：${bannedWords[1]}`;
      return EXPORT_REASON_LABELS[reason] || reason;
    })
    .join('，');
}

function labelOpportunitySummary(value) {
  const parts = String(value || '').split('/').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3) {
    return `评分 ${parts[0]}，判断 ${labelExportValue(parts[1])}，下一步 ${labelExportValue(parts[2])}`;
  }
  return labelExportValue(value);
}

function exportReviewRowToDistributionRow(row = {}, index = 0) {
  const statusLabel = labelExportStatus(row.status);
  const reasonLabel = labelExportReasons(row.reason);
  const keyword = rowSelectedKeyword(row);
  return {
    ...row,
    selectedKeyword: keyword,
    key: `blocked:${row.url || row.title || row.heading || 'row'}:${index}`,
    title: row.title || row.heading || '未命名拦截项',
    meta: `${row.group === 'rejected' ? '系统拦截' : '待人工复核'} · ${statusLabel}`,
    metrics: [
      keyword ? `选词：${keyword}` : '',
      row.category && row.category !== '-' ? `类目 ${row.category}` : '',
      row.confidence ? `置信度 ${labelExportValue(row.confidence)}` : '',
      row.usage ? `用途 ${labelExportValue(row.usage)}` : '',
      row.productOpportunity ? `货源机会：${labelOpportunitySummary(row.productOpportunity)}` : '',
      row.keywordOpportunity ? `关键词机会：${labelOpportunitySummary(row.keywordOpportunity)}` : ''
    ].filter(Boolean),
    description: reasonLabel || row.risk || row.decision || '',
    riskText: row.risk || '',
    decisionText: row.decision || '',
    fromReview: true
  };
}

const DistributionExportPanel = ({ artifactState, onCopyText, currentRunId, sourceNodeId = 'export', onDistributionJobChange }) => {
  const [exportArtifactState, setExportArtifactState] = useState({ status: 'empty', artifact: null, error: '' });
  const sourceIsReview = sourceNodeId === 'review';
  const exportArtifact = sourceIsReview ? exportArtifactState.artifact : artifactState.artifact;
  const exportStatus = sourceIsReview ? exportArtifactState.status : artifactState.status;
  const exportError = sourceIsReview ? exportArtifactState.error : artifactState.error;
  const view = getWorkflowArtifactView(exportArtifact, 'export');
  const storageKey = `ecom.exportSelection.${currentRunId || artifactState.artifact?.runId || 'draft'}`;
  const includeStorageKey = `ecom.exportManualInclude.${currentRunId || artifactState.artifact?.runId || 'draft'}`;
  const [removed, setRemoved] = useState({});
  const [included, setIncluded] = useState({});
  const [reviewArtifactState, setReviewArtifactState] = useState({ status: 'empty', artifact: null, error: '' });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [distributionCheck, setDistributionCheck] = useState({ status: 'idle', result: null, error: '' });
  const [distributionJob, setDistributionJob] = useState(null);
  const [distributionSubmitError, setDistributionSubmitError] = useState('');
  const [distributionChromeStarting, setDistributionChromeStarting] = useState(false);
  const [distributionChromeMessage, setDistributionChromeMessage] = useState('');

  const setTrackedDistributionJob = (job) => {
    setDistributionJob(job);
    onDistributionJobChange?.(job);
  };

  useEffect(() => {
    if (!sourceIsReview) {
      setExportArtifactState({ status: 'empty', artifact: null, error: '' });
      return;
    }
    if (!currentRunId) {
      setExportArtifactState({ status: 'empty', artifact: null, error: '' });
      return;
    }
    let cancelled = false;
    setExportArtifactState((previous) => ({ ...previous, status: 'loading', error: '' }));
    fetch(`/api/workflows/runs/${currentRunId}/artifacts/export`)
      .then((res) => res.json().then((payload) => {
        if (!res.ok || payload.ok === false) throw new Error(payload.error || '导出清单加载失败');
        return payload.data?.artifact || payload.data || payload.artifact || payload;
      }))
      .then((artifact) => {
        if (!cancelled) setExportArtifactState({ status: artifact ? 'ready' : 'empty', artifact, error: '' });
      })
      .catch((error) => {
        if (!cancelled) setExportArtifactState({ status: 'error', artifact: null, error: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, [currentRunId, sourceIsReview]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) || '{}');
      setRemoved(saved && typeof saved === 'object' ? saved : {});
    } catch (_error) {
      setRemoved({});
    }
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(removed));
    } catch (_error) {
      // 浏览器可能禁用 localStorage，清单操作仍可在当前页面临时使用。
    }
  }, [storageKey, removed]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = JSON.parse(window.localStorage.getItem(includeStorageKey) || '{}');
      setIncluded(saved && typeof saved === 'object' ? saved : {});
    } catch (_error) {
      setIncluded({});
    }
  }, [includeStorageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(includeStorageKey, JSON.stringify(included));
    } catch (_error) {
      // 浏览器可能禁用 localStorage，人工加入清单仍可在当前页面临时使用。
    }
  }, [includeStorageKey, included]);

  useEffect(() => {
    if (sourceIsReview) {
      setReviewArtifactState({ status: artifactState.status, artifact: artifactState.artifact, error: artifactState.error || '' });
      return;
    }
    if (!currentRunId) {
      setReviewArtifactState({ status: 'empty', artifact: null, error: '' });
      return;
    }
    let cancelled = false;
    setReviewArtifactState((previous) => ({ ...previous, status: 'loading', error: '' }));
    fetch(`/api/workflows/runs/${currentRunId}/artifacts/review`)
      .then((res) => res.json().then((payload) => {
        if (!res.ok || payload.ok === false) throw new Error(payload.error || '复核报告加载失败');
        return payload.data?.artifact || payload.data || payload.artifact || payload;
      }))
      .then((artifact) => {
        if (!cancelled) setReviewArtifactState({ status: artifact ? 'ready' : 'empty', artifact, error: '' });
      })
      .catch((error) => {
        if (!cancelled) setReviewArtifactState({ status: 'error', artifact: null, error: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, [artifactState, currentRunId, sourceIsReview]);

  const sourceRows = view.kind === 'business-list' ? (view.rows || []) : [];
  const readyRows = sourceRows.map((row, index) => {
    const key = `${distributionRowUrl(row) || row.title || 'row'}:${index}`;
    return { ...row, key, removed: Boolean(removed[key]), fromReview: false };
  });
  const reviewView = getWorkflowArtifactView(reviewArtifactState.artifact, 'review');
  const blockedRows = reviewView.kind === 'review-list'
    ? reviewView.rows
      .filter((row) => row.group === 'manual' || row.group === 'rejected')
      .map(exportReviewRowToDistributionRow)
    : [];
  const manuallyIncludedRows = blockedRows
    .filter((row) => included[row.key])
    .map((row) => ({ ...row, removed: Boolean(removed[row.key]) }));
  const rows = [...readyRows, ...manuallyIncludedRows];
  const activeRows = rows.filter((row) => !row.removed);
  const removedRows = rows.filter((row) => row.removed);
  const pendingBlockedRows = blockedRows.filter((row) => !included[row.key]);
  const copyTextValue = buildDistributionText(activeRows);

  const markRemoved = (key, value) => {
    setRemoved((previous) => ({ ...previous, [key]: value }));
  };

  const markIncluded = (key, value) => {
    setIncluded((previous) => ({ ...previous, [key]: value }));
    if (value) {
      setRemoved((previous) => ({ ...previous, [key]: false }));
    }
  };

  const checkDistribution = async () => {
    if (!copyTextValue) {
      setDistributionCheck({ status: 'error', result: null, error: '当前清单为空，请先保留或加入至少 1 个商品。' });
      return null;
    }
    setDistributionCheck({ status: 'loading', result: null, error: '' });
    try {
      const payload = await fetchJson('/api/distribution/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: copyTextValue })
      });
      setDistributionCheck({ status: 'ready', result: payload, error: '' });
      return payload;
    } catch (error) {
      setDistributionCheck({ status: 'error', result: null, error: error.message });
      return null;
    }
  };

  useEffect(() => {
    const jobId = distributionJob?.jobId;
    if (!jobId || ['completed', 'completed_with_issues', 'failed', 'cancelled'].includes(distributionJob.status)) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const job = await fetchJson(`/api/distribution/runs/${encodeURIComponent(jobId)}`);
        if (!cancelled) setTrackedDistributionJob(job);
      } catch (error) {
        if (!cancelled) setDistributionSubmitError(error.message);
      }
    };
    poll();
    const timer = window.setInterval(poll, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [distributionJob?.jobId, distributionJob?.status]);

  const submitDistribution = async (checkResult = distributionCheck.result) => {
    if (!copyTextValue || !checkResult?.canSubmit) return;
    setDistributionSubmitError('');
    try {
      const job = await fetchJson('/api/distribution/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: copyTextValue, confirm: true, runId: currentRunId || '' })
      });
      setTrackedDistributionJob(job);
      setPreviewOpen(false);
    } catch (error) {
      setDistributionSubmitError(error.message);
    }
  };

  const confirmAndSubmitDistribution = async () => {
    if (!copyTextValue || distributionJob?.status === 'submitting') return;
    const checkResult = distributionCheck.result?.canSubmit
      ? distributionCheck.result
      : await checkDistribution();
    if (checkResult?.canSubmit) await submitDistribution(checkResult);
  };

  const startDistributionChrome = async () => {
    setDistributionChromeStarting(true);
    setDistributionSubmitError('');
    setDistributionChromeMessage('');
    try {
      const result = await fetchJson('/api/distribution/chrome/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      setDistributionChromeMessage(result.userMessage || '铺货 Chrome 已启动，请登录铺货平台后重新检查。');
    } catch (error) {
      setDistributionSubmitError(error.message);
    } finally {
      setDistributionChromeStarting(false);
    }
  };

  const distributionNeedsChrome = distributionCheck.result?.blockers?.includes('browser_cdp_unavailable');

  const controlDistribution = async (action) => {
    if (!distributionJob?.jobId) return;
    try {
      const job = await fetchJson(`/api/distribution/runs/${encodeURIComponent(distributionJob.jobId)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      setTrackedDistributionJob(job);
    } catch (error) {
      setDistributionSubmitError(error.message);
    }
  };

  return (
    <div className="export-workbench">
      <section className={`distribution-ready-hero ${activeRows.length > 0 ? 'has-items' : 'is-empty'}`}>
        <div className="distribution-ready-hero-copy">
          <span className="distribution-ready-eyebrow">当前要处理</span>
          <strong>{activeRows.length} 个待铺货商品</strong>
          <p>
            {activeRows.length > 0
              ? '先查看并确认清单，再检查铺货环境。被拦截的商品不会自动进入铺货。'
              : '当前没有可铺货商品，请先完成标题生成或把下方合适的复核项加入清单。'}
          </p>
        </div>
        <div className="distribution-ready-hero-actions">
          <button type="button" className="node-primary-button" disabled={!copyTextValue} onClick={() => setPreviewOpen(true)}>
            <FileText size={14} /> 查看并确认清单
          </button>
          <button type="button" className="node-secondary-button" disabled={!copyTextValue} onClick={() => onCopyText(copyTextValue)}>
            <Copy size={13} /> 复制待铺货清单
          </button>
        </div>
      </section>

      <div className="distribution-next-steps" aria-label="铺货操作步骤">
        <span className="is-current"><b>1</b>确认商品</span>
        <ChevronRight size={13} />
        <span><b>2</b>检查环境</span>
        <ChevronRight size={13} />
        <span><b>3</b>确认并自动铺货</span>
      </div>

      {distributionJob && (
        <section className={`distribution-execution-panel ${distributionJob.status === 'failed' || distributionJob.status === 'completed_with_issues' ? 'blocked' : ''}`}>
          <div className="distribution-execution-head">
            <div>
              <strong>{distributionJob.status === 'submitting' ? '正在自动铺货' : distributionJob.status === 'paused' ? '铺货已暂停' : distributionJob.status === 'completed' ? '铺货已完成' : distributionJob.status === 'cancelled' ? '铺货已取消' : '铺货结果'}</strong>
              <span>{distributionJob.completed || 0} / {distributionJob.total || activeRows.length} 个商品已处理</span>
            </div>
            {distributionJob.status === 'submitting' && (
              <div className="distribution-execution-actions">
                <button type="button" className="node-secondary-button" onClick={() => controlDistribution('pause')}><Clock size={13} /> 批次完成后暂停</button>
                <button type="button" className="node-secondary-button danger" onClick={() => controlDistribution('cancel')}><Square size={13} /> 取消后续批次</button>
              </div>
            )}
          </div>
          <div className="distribution-progress-track"><span style={{ width: `${Math.min(100, Math.round(((distributionJob.completed || 0) / Math.max(1, distributionJob.total || 1)) * 100))}%` }} /></div>
          <p>第 {distributionJob.progress?.batchIndex || 0} / {distributionJob.progress?.batchTotal || 0} 批 · {distributionJob.progress?.phase || '等待状态更新'}</p>
          {distributionJob.error && <p className="distribution-error-text">{distributionJob.error}</p>}
          {distributionSubmitError && <p className="distribution-error-text">{distributionSubmitError}</p>}
          {Array.isArray(distributionJob.results) && distributionJob.results.some(row => row.status && row.status !== 'confirmed' && !row.skipped) && (
            <p className="distribution-error-text">存在未确认成功的批次，请查看结果后再处理，不会自动重复提交。</p>
          )}
          {Array.isArray(distributionJob.results) && distributionJob.results.length > 0 && (
            <div className="distribution-batch-results">
              {distributionJob.results.map((batch) => (
                <span key={`${batch.batchIndex}-${batch.batchHash || batch.status}`} className={batch.status === 'confirmed' ? 'success' : 'failed'}>
                  第 {batch.batchIndex} 批：{batch.status === 'confirmed' ? '已确认' : batch.skipped ? '已跳过' : '需处理'}（{batch.count || 0} 个）
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="review-summary-grid">
        <div><strong>{rows.length}</strong><span>清单项</span></div>
        <div><strong>{activeRows.length}</strong><span>将导出</span></div>
        <div><strong>{pendingBlockedRows.length}</strong><span>待人工加入</span></div>
        <div><strong>{copyTextValue ? '可复制' : '无内容'}</strong><span>清单状态</span></div>
      </div>

      <div className="export-toolbar">
        <button type="button" className="node-secondary-button" onClick={() => setPreviewOpen(true)} disabled={!copyTextValue}>
          <FileText size={13} /> 打开清单预览
        </button>
        <button type="button" className="node-secondary-button" disabled={!copyTextValue} onClick={() => onCopyText(copyTextValue)}>
          <Copy size={13} /> 复制当前清单
        </button>
        <button type="button" className="node-secondary-button success" disabled={!copyTextValue || distributionCheck.status === 'loading'} onClick={checkDistribution}>
          {distributionCheck.status === 'loading' ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
          检查铺货环境
        </button>
        <button type="button" className="node-secondary-button" disabled={removedRows.length === 0} onClick={() => setRemoved({})}>
          <RefreshCw size={13} /> 恢复全部
        </button>
      </div>

      {distributionCheck.status !== 'idle' && (
        <div className={`distribution-check-panel ${distributionCheck.status === 'error' || distributionCheck.result?.ok === false ? 'blocked' : ''}`}>
          {distributionCheck.status === 'loading' ? (
            <span><RefreshCw size={13} className="animate-spin" /> 正在检查 Chrome、登录状态和重复提交...</span>
          ) : distributionCheck.status === 'error' ? (
            <span>{distributionCheck.error}</span>
          ) : (
            <>
              <strong>{distributionCheck.result?.canSubmit ? '检查通过，可以进入最终确认' : '检查未通过，需要先处理阻塞'}</strong>
              <p>
                清单 {distributionCheck.result?.total || 0} 条
                {Array.isArray(distributionCheck.result?.batches) ? ` · ${distributionCheck.result.batches.length} 个批次` : ''}
              </p>
              {Array.isArray(distributionCheck.result?.blockers) && distributionCheck.result.blockers.length > 0 && (
                <p>阻塞原因：{distributionCheck.result.blockers.map(labelDistributionBlocker).join('，')}</p>
              )}
              {distributionCheck.result?.canSubmit && <p>检查通过。打开清单预览后，确认商品无误即可启动自动铺货。</p>}
            </>
          )}
        </div>
      )}

      <div className="export-row-list">
        {exportStatus === 'loading' && <div className="artifact-empty"><RefreshCw size={13} className="animate-spin" /> 正在加载铺货清单...</div>}
        {exportStatus === 'error' && <div className="artifact-error">{exportError || '铺货清单加载失败'}</div>}
        {(exportStatus === 'ready' || exportStatus === 'empty') && rows.length === 0 && (
          <div className="artifact-empty">当前导出清单为空，通常表示前面的生成或复核没有产出可铺货商品。</div>
        )}
        {rows.map((row) => {
          const url = distributionRowUrl(row);
          const keyword = rowSelectedKeyword(row);
          return (
            <article className={`export-row ${row.removed ? 'is-removed' : ''}`} key={row.key}>
              <div className="export-row-head">
                <div>
                  <strong>{row.title || '未命名铺货项'}</strong>
                  {row.meta && <span>{row.meta}{row.fromReview ? ' · 人工加入' : ''}</span>}
                  {keyword && <small className="selected-keyword-badge">选词：{keyword}</small>}
                </div>
                <em>{row.removed ? '已移除' : '将导出'}</em>
              </div>
              {Array.isArray(row.metrics) && row.metrics.length > 0 && (
                <div className="review-row-meta">
                  {row.metrics.map((metric) => <span key={metric}>{metric}</span>)}
                </div>
              )}
              {url && <p className="export-row-url">{url}</p>}
              <div className="review-row-actions">
                <button type="button" className="node-secondary-button" onClick={() => onCopyText(row.title || '')}>
                  <Copy size={13} /> 复制标题
                </button>
                <button type="button" className={`node-secondary-button ${row.removed ? 'success' : 'danger'}`} onClick={() => markRemoved(row.key, !row.removed)}>
                  {row.removed ? <Check size={13} /> : <X size={13} />}
                  {row.removed ? '恢复' : '移除'}
                </button>
                {url && (
                  <a className="node-secondary-button" href={url} target="_blank" rel="noreferrer">
                    <ExternalLink size={13} /> 打开货源
                  </a>
                )}
              </div>
            </article>
          );
        })}
        {reviewArtifactState.status === 'loading' && <div className="artifact-empty"><RefreshCw size={13} className="animate-spin" /> 正在读取拦截原因...</div>}
        {reviewArtifactState.status === 'error' && <div className="artifact-error">{reviewArtifactState.error || '拦截原因加载失败'}</div>}
        {pendingBlockedRows.length > 0 && (
          <section className="export-blocked-section">
            <div className="node-workbench-head">
              <strong>被拦截但可人工判断</strong>
              <span>{pendingBlockedRows.length} 条</span>
            </div>
            <div className="export-row-list compact">
              {pendingBlockedRows.map((row) => {
                const url = distributionRowUrl(row);
                const keyword = rowSelectedKeyword(row);
                return (
                  <article className="export-row blocked" key={row.key}>
                    <div className="export-row-head">
                      <div>
                        <strong>{row.title}</strong>
                        <span>{row.meta}</span>
                        {keyword && <small className="selected-keyword-badge">选词：{keyword}</small>}
                      </div>
                      <em>未加入</em>
                    </div>
                    {Array.isArray(row.metrics) && row.metrics.length > 0 && (
                      <div className="review-row-meta">
                        {row.metrics.map((metric) => <span key={metric}>{metric}</span>)}
                      </div>
                    )}
                    {row.description && <p className="export-row-url">拦截原因：{row.description}</p>}
                    <div className="review-row-actions">
                      <button type="button" className="node-secondary-button success" onClick={() => markIncluded(row.key, true)}>
                        <Check size={13} /> 加入当前清单
                      </button>
                      {url && (
                        <a className="node-secondary-button" href={url} target="_blank" rel="noreferrer">
                          <ExternalLink size={13} /> 打开货源
                        </a>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {previewOpen && (
        <div className="workflow-modal-backdrop" role="presentation" onClick={() => setPreviewOpen(false)}>
          <section className="workflow-modal export-preview-modal" role="dialog" aria-modal="true" aria-label="导出清单预览" onClick={(event) => event.stopPropagation()}>
            <div className="workflow-modal-head">
              <div>
                <strong>导出清单预览</strong>
                <span>{activeRows.length} 条将导出 · {removedRows.length} 条已移除 · {pendingBlockedRows.length} 条待人工加入</span>
              </div>
              <button type="button" className="node-icon-button" title="关闭弹窗" onClick={() => setPreviewOpen(false)}>
                <X size={14} />
              </button>
            </div>

            <div className="export-preview-actions">
              <button type="button" className="node-secondary-button" disabled={!copyTextValue} onClick={() => onCopyText(copyTextValue)}>
                <Copy size={13} /> 复制弹窗清单
              </button>
              <button type="button" className="node-secondary-button" disabled={removedRows.length === 0} onClick={() => setRemoved({})}>
                <RefreshCw size={13} /> 恢复全部
              </button>
              <button type="button" className="node-primary-button danger" disabled={!copyTextValue || distributionJob?.status === 'submitting' || distributionCheck.status === 'loading'} onClick={confirmAndSubmitDistribution}>
                {distributionCheck.status === 'loading' ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
                {distributionCheck.status === 'loading' ? '正在检查铺货环境' : '确认并开始自动铺货'}
              </button>
            </div>
            <div className="export-preview-status">
              <p className="distribution-confirm-warning">提交后会使用当前 Chrome 登录态进行铺货。已确认成功的商品不会自动重复提交，请确认清单无误。</p>
              {distributionCheck.status === 'loading' && (
                <div className="distribution-modal-feedback checking">
                  <RefreshCw size={13} className="animate-spin" /> 正在检查清单、Chrome 调试端口和登录状态，请稍候...
                </div>
              )}
              {distributionCheck.status === 'error' && (
                <div className="distribution-modal-feedback blocked">铺货检查失败：{distributionCheck.error || '未知错误'}</div>
              )}
              {distributionCheck.status === 'ready' && !distributionCheck.result?.canSubmit && (
                <div className="distribution-modal-feedback blocked">
                  <strong>暂时无法开始自动铺货</strong>
                  {Array.isArray(distributionCheck.result?.blockers) && distributionCheck.result.blockers.length > 0
                    ? <span>阻塞原因：{distributionCheck.result.blockers.map(labelDistributionBlocker).join('，')}</span>
                    : <span>请检查 Chrome 登录状态、CDP 端口和清单格式。</span>}
                  {distributionNeedsChrome && (
                    <div className="distribution-modal-feedback-actions">
                      <button type="button" className="node-secondary-button" onClick={startDistributionChrome} disabled={distributionChromeStarting}>
                        {distributionChromeStarting ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
                        {distributionChromeStarting ? '正在启动 Chrome' : '启动铺货 Chrome'}
                      </button>
                      <button type="button" className="node-secondary-button" onClick={checkDistribution} disabled={distributionChromeStarting || distributionCheck.status === 'loading'}>
                        <RefreshCw size={13} /> 重新检查
                      </button>
                    </div>
                  )}
                </div>
              )}
              {distributionSubmitError && (
                <div className="distribution-modal-feedback blocked">提交失败：{distributionSubmitError}</div>
              )}
              {distributionChromeMessage && !distributionSubmitError && (
                <div className="distribution-modal-feedback checking">{distributionChromeMessage}</div>
              )}
            </div>

            <div className="export-preview-list">
              {rows.length === 0 && (
                <div className="artifact-empty">当前导出清单为空，通常表示前面的生成或复核没有产出可铺货商品。</div>
              )}
              {rows.map((row) => {
                const url = distributionRowUrl(row);
                const keyword = rowSelectedKeyword(row);
                return (
                  <article className={`export-preview-row ${row.removed ? 'is-removed' : ''}`} key={row.key}>
                    <div>
                      <strong>{row.title || '未命名铺货项'}</strong>
                      <span>{row.removed ? '已移除' : '将导出'}</span>
                      {keyword && <small className="selected-keyword-badge">选词：{keyword}</small>}
                    </div>
                    {Array.isArray(row.metrics) && row.metrics.length > 0 && <p>{row.metrics.join(' · ')}</p>}
                    {url && <p>{url}</p>}
                    <div className="review-row-actions">
                      <button type="button" className={`node-secondary-button ${row.removed ? 'success' : 'danger'}`} onClick={() => markRemoved(row.key, !row.removed)}>
                        {row.removed ? <Check size={13} /> : <X size={13} />}
                        {row.removed ? '恢复' : '移除'}
                      </button>
                      {url && (
                        <a className="node-secondary-button" href={url} target="_blank" rel="noreferrer">
                          <ExternalLink size={13} /> 打开货源
                        </a>
                      )}
                    </div>
                  </article>
                );
              })}
              {pendingBlockedRows.map((row) => {
                const url = distributionRowUrl(row);
                const keyword = rowSelectedKeyword(row);
                return (
                  <article className="export-preview-row blocked" key={row.key}>
                    <div>
                      <strong>{row.title}</strong>
                      <span>被拦截，未加入</span>
                      {keyword && <small className="selected-keyword-badge">选词：{keyword}</small>}
                    </div>
                    {row.description && <p>拦截原因：{row.description}</p>}
                    {Array.isArray(row.metrics) && row.metrics.length > 0 && <p>{row.metrics.join(' · ')}</p>}
                    {url && <p>{url}</p>}
                    <div className="review-row-actions">
                      <button type="button" className="node-secondary-button success" onClick={() => markIncluded(row.key, true)}>
                        <Check size={13} /> 加入当前清单
                      </button>
                      {url && (
                        <a className="node-secondary-button" href={url} target="_blank" rel="noreferrer">
                          <ExternalLink size={13} /> 打开货源
                        </a>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

const ReviewOperationPanel = ({ artifactState, onCopyText, currentRunId }) => {
  const view = getWorkflowArtifactView(artifactState.artifact, 'review');
  const storageKey = `ecom.reviewDecisions.${currentRunId || artifactState.artifact?.runId || 'draft'}`;
  const [filter, setFilter] = useState('all');
  const [decisions, setDecisions] = useState({});

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) || '{}');
      setDecisions(saved && typeof saved === 'object' ? saved : {});
    } catch (_error) {
      setDecisions({});
    }
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(decisions));
    } catch (_error) {
      // 浏览器可能禁用 localStorage，复核仍可在当前页面临时使用。
    }
  }, [storageKey, decisions]);

  if (view.kind !== 'review-list') return <ArtifactPanel state={artifactState} />;

  const rows = (view.rows || []).map((row, index) => {
    const key = reviewRowKey(row, index);
    return {
      ...row,
      key,
      decisionState: decisions[key] || reviewInitialDecision(row)
    };
  });
  const approvedRows = rows.filter((row) => row.decisionState === 'approved');
  const removedRows = rows.filter((row) => row.decisionState === 'removed');
  const manualRows = rows.filter((row) => row.group === 'manual' && row.decisionState === 'pending');
  const visibleRows = rows.filter((row) => {
    if (filter === 'all') return true;
    if (filter === 'approved' || filter === 'removed') return row.decisionState === filter;
    return row.group === filter;
  });
  const approvedText = buildApprovedDistributionText(approvedRows);

  const setDecision = (key, value) => {
    setDecisions((previous) => ({ ...previous, [key]: value }));
  };

  return (
    <div className="review-workbench">
      <div className="review-summary-grid">
        <div><strong>{rows.length}</strong><span>复核项</span></div>
        <div><strong>{approvedRows.length}</strong><span>已通过</span></div>
        <div><strong>{manualRows.length}</strong><span>待处理</span></div>
        <div><strong>{removedRows.length}</strong><span>已移除</span></div>
      </div>

      <div className="review-toolbar">
        <div className="review-filter-tabs">
          {REVIEW_FILTERS.map((item) => (
            <button type="button" key={item.id} className={filter === item.id ? 'active' : ''} onClick={() => setFilter(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <button type="button" className="node-secondary-button" disabled={!approvedText} onClick={() => onCopyText(approvedText)}>
          <Copy size={13} /> 复制已通过清单
        </button>
      </div>

      <div className="review-row-list">
        {artifactState.status === 'loading' && <div className="artifact-empty"><RefreshCw size={13} className="animate-spin" /> 正在加载复核项...</div>}
        {artifactState.status === 'error' && <div className="artifact-error">{artifactState.error || '复核项加载失败'}</div>}
        {artifactState.status === 'ready' && visibleRows.length === 0 && <div className="artifact-empty">{view.emptyText}</div>}
        {artifactState.status === 'ready' && visibleRows.map((row) => (
          <article className={`review-row review-${row.group} decision-${row.decisionState}`} key={row.key}>
            <div className="review-row-head">
              <div>
                <strong>{row.title || row.heading || '未命名复核项'}</strong>
                <span>{REVIEW_GROUP_LABEL[row.group] || '复核项'} · {row.status || '待处理'}</span>
              </div>
              <em>{row.decisionState === 'approved' ? '已通过' : row.decisionState === 'removed' ? '已移除' : '待处理'}</em>
            </div>
            <div className="review-row-meta">
              {row.category && <span>类目 {row.category}</span>}
              {row.confidence && <span>置信度 {row.confidence}</span>}
              {row.usage && <span>{row.usage}</span>}
            </div>
            {(row.reason || row.decision || row.risk || row.sycmReason || row.keywordOpportunity || row.productOpportunity) && (
              <div className="review-row-reason">
                {row.reason && <p><b>复核原因</b>{row.reason}</p>}
                {row.decision && <p><b>判断</b>{row.decision}</p>}
                {row.risk && <p><b>风险</b>{row.risk}</p>}
                {row.sycmReason && <p><b>参谋原因</b>{row.sycmReason}</p>}
                {row.keywordOpportunity && <p><b>词机会</b>{row.keywordOpportunity}</p>}
                {row.productOpportunity && <p><b>货源机会</b>{row.productOpportunity}</p>}
              </div>
            )}
            <div className="review-row-actions">
              <button type="button" className="node-secondary-button success" onClick={() => setDecision(row.key, 'approved')}>
                <Check size={13} /> 通过
              </button>
              <button type="button" className="node-secondary-button danger" onClick={() => setDecision(row.key, 'removed')}>
                <X size={13} /> 移除
              </button>
              <button type="button" className="node-secondary-button" onClick={() => onCopyText(row.title || row.heading || '')}>
                <Copy size={13} /> 复制标题
              </button>
              {row.url && (
                <a className="node-secondary-button" href={row.url} target="_blank" rel="noreferrer">
                  <ExternalLink size={13} /> 打开货源
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
};

const NODE_PANEL_COPY = {
  'keyword-mining': {
    title: '选词挖掘操作台',
    description: '维护种子池、发现词根，并把当前节点产物作为候选词检查。'
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

const KeywordMiningOperationPanel = ({
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
  onCopyCandidate,
  onRetryMine,
  canRetryMine
}) => {
  const candidates = artifactItems(artifactState);
  const activeTab = MINER_TABS.find((item) => item.id === minerTab) || MINER_TABS[0];
  const [seedFilter, setSeedFilter] = useState('all');
  const [selectedSeedKeyword, setSelectedSeedKeyword] = useState('');
  const seedStatusLabel = {
    active: '活跃',
    observing: '观察',
    explore: '探索',
    cooling: '冷却',
    paused: '暂停',
    disabled: '停用'
  };
  const normalizedSeeds = seedRows.map((seed) => ({ ...seed, status: seed.status || 'active' }));
  const statusCounts = normalizedSeeds.reduce((counts, seed) => {
    counts[seed.status] = (counts[seed.status] || 0) + 1;
    return counts;
  }, {});
  const visibleSeeds = seedFilter === 'all'
    ? normalizedSeeds
    : normalizedSeeds.filter((seed) => seed.status === seedFilter);
  const selectedSeed = normalizedSeeds.find((seed) => seed.keyword === selectedSeedKeyword) || visibleSeeds[0] || null;

  return (
    <div className="node-embedded-workbench">
      <section className="node-workbench-section">
        <div className="node-workbench-head">
          <strong>种子池</strong>
          <span>{seedLoading ? '加载中' : `活跃 ${statusCounts.active || 0} · 观察 ${statusCounts.observing || 0}`}</span>
        </div>
        <form className="node-inline-form" onSubmit={(event) => { event.preventDefault(); onAddSeed(); }}>
          <input value={seedDraft.keyword} onChange={(event) => onSeedDraftChange({ ...seedDraft, keyword: event.target.value })} placeholder="新增种子词" />
          <input value={seedDraft.category} onChange={(event) => onSeedDraftChange({ ...seedDraft, category: event.target.value })} placeholder="类目" />
          <button type="submit" className="node-icon-button" title="添加种子词"><Plus size={14} /></button>
        </form>
        {seedMessage && <div className="node-workbench-message">{seedMessage}</div>}
        <div className="node-seed-status-tabs" role="tablist" aria-label="种子池状态筛选">
          {[['all', '全部'], ['active', '活跃'], ['observing', '观察'], ['explore', '探索'], ['cooling', '冷却']].map(([status, label]) => (
            <button type="button" key={status} className={seedFilter === status ? 'active' : ''} onClick={() => setSeedFilter(status)}>
              {label} {status === 'all' ? normalizedSeeds.length : (statusCounts[status] || 0)}
            </button>
          ))}
        </div>
        <div className="node-seed-compact-list">
          {visibleSeeds.slice(0, 12).map((seed) => (
            <div className={`node-seed-compact-row ${selectedSeed?.keyword === seed.keyword ? 'is-selected' : ''}`} key={seed.keyword}>
              <button type="button" onClick={() => setSelectedSeedKeyword(seed.keyword)}>
                <strong>{seed.keyword}</strong>
                <span>{seed.category || '未分类'} · {seedStatusLabel[seed.status] || '活跃'} · 权重 {seed.priorityScore ?? seed.priority ?? 0}</span>
              </button>
              <button type="button" className="node-icon-button danger" title="删除种子词" onClick={() => onDeleteSeed(seed.keyword)}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {visibleSeeds.length === 0 && <div className="artifact-empty">当前状态下没有种子词。</div>}
        </div>
        {selectedSeed && (
          <div className="node-seed-detail">
            <div>
              <strong>{selectedSeed.keyword}</strong>
              <span>{selectedSeed.category || '未分类'} · {selectedSeed.type === 'direct' ? '直接词' : '扩词种子'} · 来源 {selectedSeed.source || '未记录'}</span>
              <small>{selectedSeed.statusReason || '暂无状态变更说明'} · 成功 {selectedSeed.successCount || 0} / 失败 {selectedSeed.failCount || 0}</small>
            </div>
            <div className="node-seed-detail-actions">
              {selectedSeed.status !== 'active' && <button type="button" className="node-secondary-button success" onClick={() => onSetSeedStatus(selectedSeed.keyword, 'active')}>晋升活跃</button>}
              {selectedSeed.status !== 'observing' && <button type="button" className="node-secondary-button" onClick={() => onSetSeedStatus(selectedSeed.keyword, 'observing')}>转为观察</button>}
              {selectedSeed.status !== 'explore' && <button type="button" className="node-secondary-button" onClick={() => onSetSeedStatus(selectedSeed.keyword, 'explore')}>仅作探索</button>}
              {selectedSeed.status !== 'cooling' && <button type="button" className="node-secondary-button" onClick={() => onSetSeedStatus(selectedSeed.keyword, 'cooling')}>进入冷却</button>}
              <button type="button" className="node-secondary-button" onClick={() => onToggleSeed(selectedSeed.keyword)}>{selectedSeed.status === 'paused' ? '恢复' : '暂停'}</button>
            </div>
          </div>
        )}
        <button type="button" className="node-secondary-button" onClick={onLoadSeeds} disabled={seedLoading}>
          <RefreshCw size={13} className={seedLoading ? 'animate-spin' : ''} /> 刷新种子池
        </button>
      </section>

      <section className="node-workbench-section">
        <div className="node-workbench-head">
          <strong>词根发现</strong>
          <span>{minerResults.length} 个结果</span>
        </div>
        <div className="node-segmented">
          {MINER_TABS.map((tab) => (
            <button type="button" key={tab.id} className={minerTab === tab.id ? 'active' : ''} onClick={() => onMinerTabChange(tab.id)}>
              {tab.label}
            </button>
          ))}
        </div>
        {activeTab.needsInput && (
          <input className="node-wide-input" value={minerInput} onChange={(event) => onMinerInputChange(event.target.value)} placeholder="输入关键词或商品链接" />
        )}
        <button type="button" className="node-primary-button" onClick={onRunMiner} disabled={minerBusy || (activeTab.needsInput && !minerInput.trim())}>
          {minerBusy ? <RefreshCw size={14} className="animate-spin" /> : <Database size={14} />}
          提取词根
        </button>
        <div className="node-chip-list">
          {minerResults.slice(0, 16).map((item) => (
            <button type="button" key={`${item.word}-${item.searchPopularity || item.count || ''}`} onClick={() => onSeedDraftChange({ ...seedDraft, keyword: item.word })}>
              <span>{item.word}</span>
              <small>{item.searchPopularity ? `人气 ${item.searchPopularity}` : `词频 ${item.count || 1}`}</small>
            </button>
          ))}
          {minerResults.length === 0 && <div className="artifact-empty">词根发现结果会显示在这里，可点选后加入种子池。</div>}
        </div>
      </section>

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
                <span>{item.reason || item.source || item.nextAction || '等待生意参谋校验'}</span>
              </div>
              <button type="button" className="node-icon-button" title="复制关键词" onClick={() => onCopyCandidate(candidateKeyword(item))}>
                <Copy size={13} />
              </button>
            </div>
          ))}
          {candidates.length === 0 && <ArtifactPanel state={artifactState} />}
        </div>
        <button type="button" className="node-secondary-button" onClick={onRetryMine} disabled={!canRetryMine}>
          <RefreshCw size={13} /> 从选词挖掘重跑
        </button>
      </section>
    </div>
  );
};

const TitleGenerationOperationPanel = ({
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

const KeywordReviewOperationPanel = ({
  artifactState,
  onConfirmKeywordReview,
  onRetryMine,
  canConfirm,
  canRetryMine
}) => {
  const candidates = artifactItems(artifactState);
  const [decisions, setDecisions] = useState({});
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [manualKeywordDraft, setManualKeywordDraft] = useState('');
  const [manualKeywords, setManualKeywords] = useState([]);
  const candidateRows = useMemo(() => [...candidates, ...manualKeywords.map((keyword) => ({
    keyword,
    source: 'manual',
    reason: '用户手动添加',
    manualInput: true
  }))].map((item, index) => {
    const keyword = candidateKeyword(item);
    const key = `${keyword || 'candidate'}-${index}`;
    const persistedDecision = item.reviewStatus === 'rejected' ? 'rejected' : 'approved';
    return {
      ...item,
      keyword,
      key,
      reviewDecision: decisions[key] || persistedDecision
    };
  }), [candidates, decisions]);
  const approvedCount = candidateRows.filter((item) => item.reviewDecision === 'approved').length;
  const rejectedCount = candidateRows.filter((item) => item.reviewDecision === 'rejected').length;
  const visibleRows = useMemo(() => candidateRows.filter((item) => {
    const text = `${item.keyword || ''} ${item.root || item.seed || ''} ${item.source || ''}`.toLowerCase();
    if (query.trim() && !text.includes(query.trim().toLowerCase())) return false;
    const marketScore = Number(item.marketScore ?? item.marketMetrics?.score ?? 0);
    const missing = Array.isArray(item.marketMetrics?.missing) ? item.marketMetrics.missing : [];
    if (filter === 'recommended') return marketScore >= 60 || Number(item.localScore || 0) >= 70;
    if (filter === 'missing') return missing.length > 0 || !item.sycmData;
    if (filter === 'high-confidence') return item.marketMetrics?.confidence === 'high' || item.confidence === 'high';
    if (filter === 'rejected') return item.reviewDecision === 'rejected';
    return true;
  }), [candidateRows, filter, query]);
  const setAllDecisions = (decision) => {
    setDecisions(Object.fromEntries(candidateRows.map((item) => [item.key, decision])));
  };
  const setDecision = (key, decision) => {
    setDecisions((current) => ({ ...current, [key]: decision }));
  };
  const addManualKeywords = () => {
    const incoming = manualKeywordDraft.split(/\r?\n|[,，]/).map((item) => item.trim()).filter(Boolean);
    if (incoming.length === 0) return;
    setManualKeywords((current) => [...new Set([...current, ...incoming])]);
    setManualKeywordDraft('');
  };

  return (
    <div className="node-embedded-workbench">
      <section className="node-workbench-section">
        <div className="node-workbench-head">
          <strong>候选词筛选</strong>
          <span>保留 {approvedCount} 个 · 筛除 {rejectedCount} 个</span>
        </div>
        <div className="keyword-review-manual-input">
          <input
            className="keyword-review-search"
            value={manualKeywordDraft}
            onChange={(event) => setManualKeywordDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addManualKeywords(); } }}
            placeholder="输入关键词后加入候选，可用逗号分隔"
            aria-label="手动输入关键词"
          />
          <button type="button" className="node-secondary-button" onClick={addManualKeywords} disabled={!manualKeywordDraft.trim()}>
            <Plus size={13} /> 加入候选词
          </button>
        </div>
        {manualKeywords.length > 0 && (
          <div className="node-chip-list keyword-review-manual-list">
            {manualKeywords.map((keyword) => <span className="workflow-template-chip" key={keyword}>{keyword}</span>)}
          </div>
        )}
        {candidateRows.length > 0 && (
          <div className="keyword-review-toolbar">
            <input className="keyword-review-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索关键词或词根" aria-label="搜索候选关键词" />
            <select className="keyword-review-filter" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="筛选候选词">
              <option value="all">全部候选词</option>
              <option value="recommended">优先推荐</option>
              <option value="high-confidence">高置信度</option>
              <option value="missing">有缺失指标</option>
              <option value="rejected">已筛除</option>
            </select>
            <button type="button" className="node-secondary-button success" onClick={() => setAllDecisions('approved')}>
              <Check size={13} /> 全部保留
            </button>
            <button type="button" className="node-secondary-button danger" onClick={() => setAllDecisions('rejected')}>
              <X size={13} /> 全部筛除
            </button>
          </div>
        )}
        <div className="node-candidate-list">
          {visibleRows.slice(0, 20).map((item) => (
            <div className={`node-candidate-row keyword-review-row ${item.reviewDecision === 'rejected' ? 'is-rejected' : 'is-approved'}`} key={item.key}>
              <div>
                <strong>{item.keyword || '未命名候选词'}</strong>
                <span>{item.root || item.seed ? `词根：${item.root || item.seed}` : ''} {item.source ? `· 来源：${item.source}` : ''}</span>
                <span>{item.reason || item.gateReason || item.tier || '人工判断是否进入生意参谋'}</span>
                {(item.marketMetrics?.missing?.length > 0 || item.marketMetrics?.breakdown) && (
                  <details className="keyword-review-detail">
                    <summary>查看评分依据</summary>
                    {item.marketMetrics?.missing?.length > 0 && <span>缺失：{item.marketMetrics.missing.join('、')}</span>}
                    {item.marketMetrics?.confidence && <span>置信度：{item.marketMetrics.confidence === 'high' ? '高' : item.marketMetrics.confidence === 'medium' ? '中' : '低'}</span>}
                    {item.marketMetrics?.breakdown && <span>评分：需求 {Math.round(item.marketMetrics.breakdown.demand || 0)} · 搜索 {Math.round(item.marketMetrics.breakdown.search || 0)} · 点击 {Math.round(item.marketMetrics.breakdown.click || 0)} · 转化 {Math.round(item.marketMetrics.breakdown.conversion || 0)}</span>}
                  </details>
                )}
              </div>
              <div className="keyword-review-actions">
                {item.localScore ? <small>本地分 {item.localScore}</small> : <small>{item.tier || ''}</small>}
                {item.sycmData?.searchPopularity != null && <small>人气 {item.sycmData.searchPopularity}</small>}
                {item.sycmData?.demandSupplyRatio != null && <small>供需 {item.sycmData.demandSupplyRatio}</small>}
                {item.marketScore != null && <small>市场分 {item.marketScore}</small>}
                <button
                  type="button"
                  className={`node-secondary-button success ${item.reviewDecision === 'approved' ? 'active' : ''}`}
                  onClick={() => setDecision(item.key, 'approved')}
                >
                  <Check size={13} /> 保留
                </button>
                <button
                  type="button"
                  className={`node-secondary-button danger ${item.reviewDecision === 'rejected' ? 'active' : ''}`}
                  onClick={() => setDecision(item.key, 'rejected')}
                >
                  <X size={13} /> 筛除
                </button>
              </div>
            </div>
          ))}
          {candidates.length === 0 && manualKeywords.length === 0 && <div className="artifact-empty">暂无候选词，可以先手动输入关键词。</div>}
        </div>
        <div className="node-product-actions">
          <button type="button" className="node-primary-button" onClick={() => onConfirmKeywordReview(candidateRows, manualKeywords)} disabled={!canConfirm || candidateRows.length === 0}>
            <CheckCircle2 size={14} /> 确认筛词结果
          </button>
          <button type="button" className="node-secondary-button" onClick={onRetryMine} disabled={!canRetryMine}>
            <RefreshCw size={13} /> 返回挖词重跑
          </button>
        </div>
        <p className="node-workbench-note">确认后，只有“保留”的关键词会进入生意参谋校验；“筛除”的关键词会写入记录但不继续请求平台。</p>
      </section>
    </div>
  );
};

const ManualProductSelectionPanel = ({ artifactState, currentRunId, onConfirm }) => {
  const rows = artifactItems(artifactState);
  const [selected, setSelected] = useState({});
  const [manual, setManual] = useState({ url: '', title: '', category: '', keyword: '' });
  const [directUrls, setDirectUrls] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    setSelected(Object.fromEntries(rows.map((row, index) => [
      `${row.url || row.product?.['产品链接'] || row.product?.url || index}`,
      false
    ])));
  }, [artifactState.artifact]);

  const rowKey = (row, index) => `${row.url || row.product?.['产品链接'] || row.product?.url || index}`;
  const toggle = (key) => setSelected((current) => ({ ...current, [key]: !current[key] }));
  const submit = async () => {
    const approvedProductIds = rows.filter((row, index) => selected[rowKey(row, index)]).map((row, index) => rowKey(row, index));
    const defaultKeyword = manual.keyword.trim() || rows.find((row) => row.keyword)?.keyword || '';
    const directProducts = directUrls
      .split(/\r?\n|[,，]/)
      .map((item) => item.trim())
      .filter((item) => /detail\.1688\.com\/offer\//i.test(item))
      .map((url) => ({ url, keyword: defaultKeyword }));
    const manualProducts = [
      ...(manual.url.trim() && manual.keyword.trim() ? [{ ...manual }] : []),
      ...directProducts
    ];
    if (approvedProductIds.length === 0 && manualProducts.length === 0) {
      setMessage('请至少勾选一个商品，或粘贴有效的 1688 商品 URL。');
      return;
    }
    setMessage('');
    await onConfirm({ approvedProductIds, manualProducts });
  };

  return (
    <div className="node-embedded-workbench">
      <section className="node-workbench-section">
        <div className="node-workbench-head">
          <strong>勾选 1688 货源</strong>
          <span>{rows.filter((row, index) => selected[rowKey(row, index)]).length} 个已选</span>
        </div>
        <div className="node-product-list">
          {rows.map((row, index) => {
            const product = row.product || row;
            const url = row.url || row.productUrl || product['产品链接'] || product.url || '';
            const title = row.sourceTitle || row.title || product['链接原标题'] || product.title || '未命名商品';
            const key = rowKey(row, index);
            return (
              <label className="node-product-row manual-product-choice" key={key}>
                <input type="checkbox" checked={Boolean(selected[key])} onChange={() => toggle(key)} />
                <div>
                  <strong>{title}</strong>
                  <span>{row.keyword || '手动货源'} · {row.recommendedCategory || product.category || '未设置类目'}</span>
                  <small>{url}</small>
                </div>
              </label>
            );
          })}
          {rows.length === 0 && <div className="artifact-empty">暂无 1688 搜索结果，请手动添加商品。</div>}
        </div>
      </section>
      <section className="node-workbench-section">
        <div className="node-workbench-head"><strong>直接粘贴 1688 链接</strong><span>一行一个</span></div>
        <textarea
          className="node-field-textarea"
          rows="4"
          value={directUrls}
          onChange={(event) => setDirectUrls(event.target.value)}
          placeholder="https://detail.1688.com/offer/123456.html\nhttps://detail.1688.com/offer/789012.html"
        />
        <p className="node-workbench-note">直接加入的商品会带着关联关键词进入 AI 标题生成；标题或类目信息不足时会在铺货复核中提示。</p>
      </section>
      <section className="node-workbench-section">
        <div className="node-workbench-head"><strong>手动添加商品</strong><span>URL + 标题 + 类目</span></div>
        <label className="node-field"><span>单个商品 URL</span><input value={manual.url} onChange={(event) => setManual({ ...manual, url: event.target.value })} placeholder="可只填 URL，也可继续补充信息" /></label>
        <label className="node-field"><span>商品标题</span><input value={manual.title} onChange={(event) => setManual({ ...manual, title: event.target.value })} placeholder="商品原标题或自定义商品名" /></label>
        <label className="node-field"><span>类目</span><input value={manual.category} onChange={(event) => setManual({ ...manual, category: event.target.value })} placeholder="例如：饰品 > 项链" /></label>
        <label className="node-field"><span>关联关键词</span><input value={manual.keyword} onChange={(event) => setManual({ ...manual, keyword: event.target.value })} placeholder="例如：纯银项链" /></label>
        <button type="button" className="node-primary-button" disabled={!currentRunId} onClick={submit}><Check size={13} /> 确认人工选品</button>
        {message && <div className="artifact-error">{message}</div>}
      </section>
    </div>
  );
};

const NodeOperationPanel = ({
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
  const copy = NODE_PANEL_COPY[kind];
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

const formatDateTime = (value) => {
  if (!value) return '未知时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

export default function WorkflowStudio({ initialMode: _initialMode, onNavigate }) {
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const runEventSourceRef = useRef(null);

  // 工作流执行状态
  const [currentRunId, setCurrentRunId] = useState(null);
  const [runStatus, setRunStatus] = useState('idle'); // 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'
  const [logs, setLogs] = useState([]);
  const [historyRuns, setHistoryRuns] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [activeTemplateId, setActiveTemplateId] = useState(null);
  const [activeTemplateMode, setActiveTemplateMode] = useState(DEFAULT_WORKFLOW_MODE);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [deletingRunId, setDeletingRunId] = useState('');
  const [artifactState, setArtifactState] = useState({
    status: 'empty',
    nodeId: null,
    artifact: null,
    error: ''
  });
  const [seedRows, setSeedRows] = useState([]);
  const [seedDraft, setSeedDraft] = useState({ keyword: '', category: '', priority: 5, type: 'manual' });
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedMessage, setSeedMessage] = useState('');
  const [minerTab, setMinerTab] = useState('peer');
  const [minerInput, setMinerInput] = useState('');
  const [minerResults, setMinerResults] = useState([]);
  const [minerBusy, setMinerBusy] = useState(false);
  const [titleForm, setTitleForm] = useState({ keyword: '', maxLength: 60, peerTitles: '' });
  const [titleLoading, setTitleLoading] = useState(false);
  const [titleResult, setTitleResult] = useState(null);
  const [titleError, setTitleError] = useState('');
  const [verifiedArtifactRows, setVerifiedArtifactRows] = useState([]);
  const [artifactPreviewOpen, setArtifactPreviewOpen] = useState(false);

  // 1. 获取模板列表
  const fetchTemplates = async () => {
    try {
      const res = await fetch('/api/workflows/templates');
      const payload = await res.json();
      if (payload.ok === false) throw new Error(payload.error || '获取工作流模板失败');
      const nextTemplates = normalizeTemplateList(payload);
      setTemplates(nextTemplates);
      // 默认加载第一个 production 模板
      if (nextTemplates.length > 0 && nodes.length === 0) {
        loadTemplate(nextTemplates[0]);
      }
    } catch (err) {
      console.error('获取工作流模板失败', err);
      setTemplates([]);
    }
  };

  // 2. 获取历史运行记录
  const fetchHistoryRuns = async () => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const res = await fetch('/api/workflows/runs');
      const payload = await res.json();
      if (payload.ok === false) throw new Error(payload.error || '获取运行历史失败');
      setHistoryRuns(normalizeRunList(payload));
    } catch (err) {
      console.error('获取运行历史失败', err);
      setHistoryError(err.message);
      setHistoryRuns([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
    fetchHistoryRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 加载工作流模板
  const loadTemplate = (template) => {
    runEventSourceRef.current?.close();
    runEventSourceRef.current = null;
    const defaultWorkflow = normalizeWorkflowForCanvas(template?.workflow || { nodes: [], edges: [] });
    // 重置节点状态为 idle
    const formattedNodes = (defaultWorkflow.nodes || []).map(n => normalizeCanvasNode({
      ...n,
      data: {
        ...n.data,
        status: 'idle',
        output: null,
        error: null
      }
    }, setSelectedNodeId, handleNodeAction, handleViewNodeArtifact));
    setNodes(formattedNodes);
    setEdges((defaultWorkflow.edges || []).map(e => ({
      ...e,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' },
      style: { stroke: '#3b82f6', strokeWidth: 2.5 }
    })));
    setActiveTemplateId(template?.id || null);
    setActiveTemplateMode(getTemplateMode(template));
    setSelectedNodeId(null);
    setRunStatus('idle');
    setCurrentRunId(null);
    setLogs([]);
    setArtifactState({ status: 'empty', nodeId: null, artifact: null, error: '' });
  };

  // 点击节点事件
  const onNodeClick = useCallback((event, node) => {
    setSelectedNodeId(node.id);
  }, []);

  useEffect(() => {
    const handleSelectNode = (event) => {
      const nodeId = event.detail?.nodeId;
      if (!nodeId) return;
      setSelectedNodeId(nodeId);
    };
    window.addEventListener('workflow:select-node', handleSelectNode);
    return () => window.removeEventListener('workflow:select-node', handleSelectNode);
  }, []);

  useEffect(() => {
    if (!selectedNodeId) return;
    if (!currentRunId) {
      setArtifactState({
        status: 'empty',
        nodeId: selectedNodeId,
        artifact: null,
        error: ''
      });
      return;
    }

    let cancelled = false;
    setArtifactState({ status: 'loading', nodeId: selectedNodeId, artifact: null, error: '' });
    const artifactLimit = selectedNodeId === 'generate' ? '?limit=200' : '';
    fetch(`/api/workflows/runs/${currentRunId}/artifacts/${selectedNodeId}${artifactLimit}`)
      .then(async (res) => {
        const payload = await res.json();
        if (res.status === 404) return null;
        if (payload.ok === false || !res.ok) {
          throw new Error(payload.error || '节点产物加载失败');
        }
        const data = unwrapApiData(payload);
        return data?.artifact || data;
      })
      .then((artifact) => {
        if (!cancelled) {
          setArtifactState({ status: artifact ? 'ready' : 'empty', nodeId: selectedNodeId, artifact, error: '' });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setArtifactState({ status: 'error', nodeId: selectedNodeId, artifact: null, error: err.message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedNodeId, currentRunId]);

  const loadSeeds = useCallback(async () => {
    setSeedLoading(true);
    setSeedMessage('');
    try {
      const rows = await fetchJson('/api/seeds');
      setSeedRows(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setSeedMessage(err.message);
    } finally {
      setSeedLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedNodeId === 'mine') {
      loadSeeds();
    }
  }, [selectedNodeId, loadSeeds]);

  useEffect(() => {
    if (selectedNodeId !== 'generate' || !currentRunId) {
      setVerifiedArtifactRows([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/workflows/runs/${currentRunId}/artifacts/verify`)
      .then(async (res) => {
        if (res.status === 404) return null;
        const payload = await res.json();
        if (!res.ok || payload.ok === false) throw new Error(payload.error || '已验真词加载失败');
        return unwrapApiData(payload)?.artifact || unwrapApiData(payload);
      })
      .then((artifact) => {
        if (!cancelled) {
          setVerifiedArtifactRows(artifactItems({ artifact }));
        }
      })
      .catch(() => {
        if (!cancelled) setVerifiedArtifactRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedNodeId, currentRunId]);

  // 选中节点对象
  const selectedNode = useMemo(() => {
    return nodes.find(n => n.id === selectedNodeId) || null;
  }, [nodes, selectedNodeId]);
  const orderedWorkflowNodes = useMemo(() => (
    [...nodes].sort((a, b) => (
      Number(a.data?.stepIndex || 0) - Number(b.data?.stepIndex || 0)
      || a.position.x - b.position.x
    ))
  ), [nodes]);

  const isRunActive = ACTIVE_RUN_STATUSES.has(String(runStatus || '').toLowerCase());
  const isViewingRun = Boolean(currentRunId);
  const activeTemplate = useMemo(() => (
    templates.find((template) => template.id === activeTemplateId) || templates[0] || null
  ), [templates, activeTemplateId]);
  const activeTemplateView = useMemo(() => getWorkflowTemplateView(activeTemplate || { mode: activeTemplateMode }), [activeTemplate, activeTemplateMode]);
  const canCancelRun = Boolean(currentRunId) && isRunActive;
  const canPauseRun = Boolean(currentRunId) && isRunActive;
  const selectedNodeLabel = selectedNode?.data?.label || selectedNode?.id || '未选择节点';
  const activeTemplateLabel = activeTemplate?.name || activeTemplateView.title || '选品流水线';
  // 将全局运行状态同步到节点，让暂停、继续、重试等操作直接出现在节点上。
  useEffect(() => {
    setNodes((nds) => nds.map((node) => ({
      ...node,
      data: {
        ...node.data,
        workflowRunStatus: runStatus
      }
    })));
  }, [runStatus, setNodes]);

  const verifiedRows = useMemo(() => {
    const verifyNode = nodes.find((node) => node.id === 'verify');
    const output = verifyNode?.data?.output;
    if (Array.isArray(output?.verifiedKeywords)) return output.verifiedKeywords;
    if (Array.isArray(output?.items)) return output.items;
    if (Array.isArray(output?.rows)) return output.rows;
    if (verifiedArtifactRows.length > 0) return verifiedArtifactRows;
    if (artifactState.nodeId === 'verify') return artifactItems(artifactState);
    return [];
  }, [artifactState, nodes, verifiedArtifactRows]);

  // 修改节点配置参数
  const updateNodeData = (nodeId, field, value) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === nodeId) {
          return {
            ...node,
            data: {
              ...node.data,
              [field]: value
            }
          };
        }
        return node;
      })
    );
  };

  // SSE 实时更新订阅
  const listenToRunEvents = (runId) => {
    runEventSourceRef.current?.close();
    const eventSource = new EventSource(`/api/workflows/runs/${runId}/events`);
    runEventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.event === 'init') {
        // 初始化推送，把节点状态都同步一下
        const { status, nodeStates } = data.payload;
        setRunStatus(status);
        syncNodeStates(nodeStates);
      } else if (data.event === 'status_change') {
        const { status } = data.payload;
        setRunStatus(status);
        if (status === 'completed' || status === 'failed' || status === 'cancelled') {
          eventSource.close();
          if (runEventSourceRef.current === eventSource) runEventSourceRef.current = null;
          fetchHistoryRuns();
        }
      } else if (data.event === 'node_change') {
        const { nodeId, state } = data.payload;
        const effectiveNodeId = effectiveCanvasNodeId(nodeId);
        setNodes((nds) =>
          nds.map((node) => {
            if (node.id === effectiveNodeId) {
              return {
                ...node,
                data: {
                  ...node.data,
                  status: state.status,
                  output: state.output,
                  error: state.error,
                  progress: state.progress || null,
                  blocker: state.blocker || null,
                  actionHint: state.actionHint || null,
                  nextRecommendedAction: state.nextRecommendedAction || null,
                  platformStatus: state.platformStatus || null,
                  manualAction: state.manualAction || null,
                  durationMs: state.durationMs || null,
                  outputSummary: state.outputSummary || null,
                  cooldownRemainingMs: state.cooldownRemainingMs || 0
                }
              };
            }
            return node;
          })
        );
      } else if (data.event === 'log') {
        const log = data.payload;
        setLogs((prev) => [...prev, log]);
        // 自动滚动到日志底部
        setTimeout(() => {
          const consoleEl = document.getElementById('console-terminal');
          if (consoleEl) {
            consoleEl.scrollTop = consoleEl.scrollHeight;
          }
        }, 50);
      } else if (data.event === 'progress') {
        const progress = normalizeWorkflowProgressEvent(data);
        const nodeId = effectiveCanvasNodeId(progress.step || progress.nodeId);
        if (nodeId) {
          setNodes((nds) =>
            nds.map((node) => {
              if (node.id !== nodeId) return node;
              return {
                ...node,
                data: {
                  ...node.data,
                  status: progress.status || node.data.status,
                  progress,
                  blocker: progress.blocker || node.data.blocker || null,
                  actionHint: progress.actionHint || node.data.actionHint || null,
                  nextRecommendedAction: progress.nextRecommendedAction || node.data.nextRecommendedAction || null,
                  platformStatus: progress.platformStatus || node.data.platformStatus || null,
                  manualAction: progress.manualAction || node.data.manualAction || null,
                  cooldownRemainingMs: progress.cooldownRemainingMs || node.data.cooldownRemainingMs || 0
                }
              };
            })
          );
        }
        const message = progress.message || formatWorkflowProgressLabel(progress);
        if (message) {
          setLogs((prev) => [...prev, {
            timestamp: progress.timestamp || new Date().toISOString(),
            level: 'info',
            message: `[progress:${nodeId || 'workflow'}] ${message}`
          }]);
        }
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      if (runEventSourceRef.current === eventSource) runEventSourceRef.current = null;
    };

    return eventSource;
  };

  useEffect(() => {
    return () => {
      runEventSourceRef.current?.close();
      runEventSourceRef.current = null;
    };
  }, []);

  // 同步工作流节点状态到前端组件
  const syncNodeStates = (nodeStates) => {
    setNodes((nds) =>
      nds.map((node) => {
        const state = getCanvasNodeState(nodeStates, node.id);
        if (state) {
          return {
            ...node,
            data: {
              ...node.data,
              status: state.status,
              output: state.output,
              error: state.error,
              progress: state.progress || null,
              blocker: state.blocker || null,
              actionHint: state.actionHint || null,
              nextRecommendedAction: state.nextRecommendedAction || null,
              platformStatus: state.platformStatus || null,
              manualAction: state.manualAction || null,
              durationMs: state.durationMs || null,
              outputSummary: state.outputSummary || null,
              cooldownRemainingMs: state.cooldownRemainingMs || 0,
              onSelect: () => setSelectedNodeId(node.id)
            }
          };
        }
        return node;
      })
    );
  };

  // 加载指定历史运行记录的详情和日志
  const loadHistoryRun = async (runId) => {
    try {
      runEventSourceRef.current?.close();
      runEventSourceRef.current = null;
      setSelectedNodeId(null);
      setLogs([]);
      setHistoryError('');
      setRunStatus('pending');

      const res = await fetch(`/api/workflows/runs/${runId}`);
      const data = await res.json();

      if (!res.ok || data.ok === false) {
        throw new Error(data.error || '加载运行详情失败');
      }

      const run = unwrapApiData(data);
      const defaultWorkflow = normalizeWorkflowForCanvas(run.workflow || { nodes: [], edges: [] });

      setNodes((defaultWorkflow.nodes || []).map(n => {
        const state = getCanvasNodeState(run.nodeStates, n.id);
        return normalizeCanvasNode({
          ...n,
          data: {
            ...n.data,
            status: state.status || 'idle',
            output: state.output || null,
            error: state.error || null,
            progress: state.progress || null,
            blocker: state.blocker || null,
            actionHint: state.actionHint || null,
            nextRecommendedAction: state.nextRecommendedAction || null,
            platformStatus: state.platformStatus || null,
            manualAction: state.manualAction || null,
            durationMs: state.durationMs || null,
            outputSummary: state.outputSummary || null,
            cooldownRemainingMs: state.cooldownRemainingMs || 0
          }
        }, setSelectedNodeId, handleNodeAction, handleViewNodeArtifact);
      }));

      setEdges((defaultWorkflow.edges || []).map(e => ({
        ...e,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' },
        style: { stroke: '#3b82f6', strokeWidth: 2.5 }
      })));

      setCurrentRunId(runId);
      setRunStatus(run.status);
      setActiveTemplateId(defaultWorkflow.id || run.workflow?.id || null);
      setActiveTemplateMode(run.workflow?.mode || run.mode || activeTemplateMode);
      setSelectedNodeId(getWorkflowRunActiveNodeId(run));

      if (run.status === 'running' || run.status === 'pending') {
        listenToRunEvents(runId);
      } else if (run.logs) {
        setLogs(run.logs);
      }
    } catch (err) {
      console.error('加载历史记录失败', err);
      setCurrentRunId(null);
      setRunStatus('failed');
      setHistoryError(err.message);
      setLogs([{
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `加载历史记录失败: ${err.message}`
      }]);
    }
  };

  const deleteHistoryRun = async (runId) => {
    const ok = window.confirm('确认删除这次运行历史？相关产物和日志也会一起删除，此操作不可撤销。');
    if (!ok) return;
    setDeletingRunId(runId);
    setHistoryError('');
    try {
      const request = buildWorkflowDeleteRunRequest(runId);
      const res = await fetch(request.endpoint, request.options);
      const payload = await res.json();
      if (!res.ok || payload.ok === false) {
        throw new Error(payload.error || '删除运行历史失败');
      }
      setHistoryRuns((prev) => prev.filter((run) => getUnifiedWorkflowHistoryItem(run).runId !== runId));
      if (currentRunId === runId) {
        runEventSourceRef.current?.close();
        runEventSourceRef.current = null;
        setCurrentRunId(null);
        setRunStatus('idle');
        setLogs([]);
        setSelectedNodeId(null);
        setArtifactState({ status: 'empty', nodeId: null, artifact: null, error: '' });
        if (templates[0]) loadTemplate(templates[0]);
      }
    } catch (err) {
      setHistoryError(err.message);
      console.error('删除运行历史失败', err);
    } finally {
      setDeletingRunId('');
    }
  };

  // 运行当前画布上的工作流
  const handleRunWorkflow = async () => {
    if (runStatus === 'running') return;

    setLogs([]);
    setRunStatus('pending');

    const launchBlocker = getWorkflowLaunchBlocker(activeTemplateMode, nodes);
    if (launchBlocker) {
      setRunStatus(launchBlocker.status);
      setLogs(launchBlocker.logs);
      setCurrentRunId(null);
      return;
    }

    // 格式化工作流的 nodes/edges
    const workflowDef = {
      nodes: nodes.map(n => ({
        id: n.id,
        type: n.data?.originalType || n.type,
        position: n.position,
        data: n.data
      })),
      edges: edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target
      }))
    };

    try {
      const validationRes = await fetch('/api/workflows/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: activeTemplateId,
          mode: activeTemplateMode,
          params: getStartNodeParams(nodes),
          workflow: workflowDef
        })
      });
      const validationPayload = await validationRes.json();
      if (validationPayload.ok === false) {
        const errors = validationPayload.data?.errors || [{ message: validationPayload.error || '工作流校验失败' }];
        const typeOnlyErrors = errors.filter((error) => String(error.code || error.message || '').toLowerCase().includes('type'));
        if (typeOnlyErrors.length !== errors.length || !activeTemplateId) {
          setRunStatus('failed');
          setLogs(errors.map(error => ({
            timestamp: new Date().toISOString(),
            level: 'error',
            message: `[${error.code || 'validation_error'}] ${error.message}`
          })));
          return;
        }
        setLogs(errors.map(error => ({
          timestamp: new Date().toISOString(),
          level: 'warn',
          message: `[${error.code || 'production_validate'}] ${error.message}`
        })));
      }

      const res = await fetch('/api/workflows/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: activeTemplateId,
          mode: activeTemplateMode,
          params: getStartNodeParams(nodes)
        })
      });
      const payload = await res.json();

      if (payload.ok !== false) {
        const data = unwrapApiData(payload);
        const runId = data.runId || null;
        const message = data.message || payload.message || '工作流已提交。';
        setCurrentRunId(runId);
        setLogs((prev) => [...prev, {
          timestamp: new Date().toISOString(),
          level: runId ? 'info' : 'warn',
          message
        }]);
        if (runId) {
          setRunStatus('running');
          // 开始 SSE 监听运行事件
          listenToRunEvents(runId);
        } else {
          setRunStatus('completed');
          await fetchHistoryRuns();
        }
      } else {
        alert(`启动失败: ${payload.error}`);
        setRunStatus('failed');
      }
    } catch (err) {
      alert(`启动请求失败: ${err.message}`);
      setRunStatus('failed');
    }
  };

  // 取消当前正在执行的工作流
  const handleCancelWorkflow = async () => {
    if (!canCancelRun) return;
    try {
      const res = await fetch(`/api/workflows/runs/${currentRunId}/cancel`, {
        method: 'POST'
      });
      const payload = await res.json();
      if (!res.ok || payload.ok === false) {
        throw new Error(payload.error || '取消请求失败');
      }
      setLogs((prev) => [...prev, {
        timestamp: new Date().toISOString(),
        level: 'warn',
        message: '已请求取消，当前步骤会在安全边界停止。'
      }]);
    } catch (err) {
      console.error('取消工作流失败', err);
      setLogs((prev) => [...prev, {
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `取消请求失败: ${err.message}`
      }]);
    }
  };

  // 运行工作流恢复与操作
  const runWorkflowOperation = async (action, nodeId = null) => {
    const targetNodeId = nodeId || selectedNodeId;
    if (action === 'open-review' || action === 'confirm-distribution' || action === 'keyword-review' || action === 'product-review') {
      if (targetNodeId) setSelectedNodeId(targetNodeId);
      if (action === 'open-review' || action === 'confirm-distribution') setArtifactPreviewOpen(true);
      setLogs((prev) => [...prev, {
        timestamp: new Date().toISOString(),
        level: action === 'confirm-distribution' || action === 'keyword-review' ? 'warn' : 'info',
        message: getWorkflowOperationMessage(action, 'success')
      }]);
      return;
    }
    // Chrome 启动是平台准备动作，不依赖某一次流程运行。
    if (!currentRunId && action !== 'start-sycm-chrome') return;
    const { endpoint, body } = buildWorkflowOperationRequest(currentRunId, action, targetNodeId);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const payload = await res.json();
      if (!res.ok || payload.ok === false) {
        throw new Error(payload.error || '工作流操作失败');
      }
      const operationResult = unwrapApiData(payload);
      const message = getWorkflowOperationMessage(action, operationResult);
      setLogs((prev) => [...prev, {
        timestamp: new Date().toISOString(),
        level: 'info',
        message
      }]);
      if (action === 'start-sycm-chrome') {
        setNodes((currentNodes) => currentNodes.map((node) => (
          node.id === targetNodeId
            ? { ...node, data: { ...node.data, chromeStartMessage: message } }
            : node
        )));
        alert(message);
      }
      if (currentRunId) await loadHistoryRun(currentRunId);
    } catch (err) {
      const message = getWorkflowOperationMessage(action, 'error', err.message);
      setLogs((prev) => [...prev, {
        timestamp: new Date().toISOString(),
        level: 'error',
        message
      }]);
      alert(message);
      console.error(err);
    }
  };

  const updateDistributionNodeJob = useCallback((job) => {
    setNodes((currentNodes) => currentNodes.map((node) => (
      node.id === 'export'
        ? { ...node, data: { ...node.data, distributionJob: job || null } }
        : node
    )));
  }, [setNodes]);

  const handleNodeAction = async (action, nodeId) => {
    if (action === 'artifact' || action === 'inspect' || action === 'blocked' || action === 'review') {
      setSelectedNodeId(nodeId);
      return;
    }
    if (action === 'pause-distribution') {
      const job = nodes.find((node) => node.id === nodeId)?.data?.distributionJob;
      if (!job?.jobId || job.status !== 'submitting' || job.requestedAction === 'pause') return;
      try {
        const nextJob = await fetchJson(`/api/distribution/runs/${encodeURIComponent(job.jobId)}/pause`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        updateDistributionNodeJob(nextJob);
        setLogs((prev) => [...prev, {
          timestamp: new Date().toISOString(),
          level: 'warn',
          message: '已请求暂停铺货：当前批次完成后将停止后续商品提交。'
        }]);
      } catch (error) {
        const message = `暂停铺货失败：${error.message}`;
        setLogs((prev) => [...prev, {
          timestamp: new Date().toISOString(),
          level: 'error',
          message
        }]);
        alert(message);
      }
      return;
    }
    runWorkflowOperation(action, nodeId);
  };

  const handleViewNodeArtifact = (nodeId) => {
    setSelectedNodeId(nodeId);
    setArtifactPreviewOpen(true);
  };

  const addSeed = async () => {
    const keyword = String(seedDraft.keyword || '').trim();
    if (!keyword) {
      setSeedMessage('请先输入种子词。');
      return;
    }
    setSeedLoading(true);
    setSeedMessage('');
    try {
      await fetchJson('/api/seeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...seedDraft, keyword })
      });
      setSeedDraft((current) => ({ ...current, keyword: '' }));
      setSeedMessage('已加入种子池。');
      await loadSeeds();
    } catch (err) {
      setSeedMessage(err.message);
    } finally {
      setSeedLoading(false);
    }
  };

  const toggleSeed = async (keyword) => {
    setSeedMessage('');
    try {
      await fetchJson(`/api/seeds/${encodeURIComponent(keyword)}/toggle`, { method: 'POST' });
      await loadSeeds();
    } catch (err) {
      setSeedMessage(err.message);
    }
  };

  const setSeedStatus = async (keyword, status) => {
    setSeedMessage('');
    try {
      await fetchJson(`/api/seeds/${encodeURIComponent(keyword)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      setSeedMessage(`已将“${keyword}”设为${({ active: '活跃', observing: '观察', explore: '探索', cooling: '冷却' })[status] || status}。`);
      await loadSeeds();
    } catch (err) {
      setSeedMessage(err.message);
    }
  };

  const deleteSeed = async (keyword) => {
    const ok = window.confirm(`确认删除种子词「${keyword}」？`);
    if (!ok) return;
    setSeedMessage('');
    try {
      await fetchJson(`/api/seeds/${encodeURIComponent(keyword)}`, { method: 'DELETE' });
      await loadSeeds();
    } catch (err) {
      setSeedMessage(err.message);
    }
  };

  const runRootMiner = async () => {
    const tab = MINER_TABS.find((item) => item.id === minerTab) || MINER_TABS[0];
    if (tab.needsInput && !minerInput.trim()) return;
    setMinerBusy(true);
    setMinerResults([]);
    setSeedMessage('');
    try {
      const data = await fetchJson(tab.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tab.needsInput ? { keyword: minerInput.trim() } : {})
      });
      setMinerResults(Array.isArray(data) ? data : []);
    } catch (err) {
      setSeedMessage(`词根发现失败：${err.message}`);
    } finally {
      setMinerBusy(false);
    }
  };

  const useVerifiedKeywordForTitle = (row = {}) => {
    const keyword = candidateKeyword(row);
    if (!keyword) return;
    setTitleForm((current) => ({ ...current, keyword }));
  };

  const generateTitleFromNode = async (event) => {
    event.preventDefault();
    setTitleLoading(true);
    setTitleError('');
    setTitleResult(null);
    try {
      const peerTitles = titleForm.peerTitles.split('\n').map((item) => item.trim()).filter(Boolean);
      const data = await fetchJson('/api/title/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: titleForm.keyword,
          maxLength: titleForm.maxLength,
          useImageSearch: false,
          peerTitles: peerTitles.length > 0 ? peerTitles : null
        })
      });
      setTitleResult(data);
    } catch (err) {
      setTitleError(`${err.message}。可以补充同行标题后重试。`);
    } finally {
      setTitleLoading(false);
    }
  };

  const retryWorkflowNode = async (nodeId) => {
    if (!currentRunId) return;
    await runWorkflowOperation('retry-node', nodeId);
  };

  const confirmKeywordReview = async (rows = [], manualKeywords = []) => {
    if (!currentRunId) return;
    const approvedKeywords = rows
      .filter((row) => row.reviewDecision !== 'rejected')
      .map((row) => candidateKeyword(row))
      .filter(Boolean);
    const rejectedKeywords = rows
      .filter((row) => row.reviewDecision === 'rejected')
      .map((row) => candidateKeyword(row))
      .filter(Boolean);
    try {
      const res = await fetch(`/api/workflows/runs/${currentRunId}/keyword-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedKeywords, rejectedKeywords, manualKeywords })
      });
      const payload = await res.json();
      if (!res.ok || payload.ok === false) {
        throw new Error(payload.error || '人工筛词确认失败');
      }
      setLogs((prev) => [...prev, {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: `人工筛词完成，保留 ${approvedKeywords.length} 个，筛除 ${rejectedKeywords.length} 个关键词。`
      }]);
      if (activeTemplateMode === 'manual') {
        await runWorkflowOperation('resume');
      } else {
        await loadHistoryRun(currentRunId);
      }
      setArtifactState((current) => ({ ...current, status: 'loading' }));
      const artifactRes = await fetch(`/api/workflows/runs/${currentRunId}/artifacts/keywordReview`);
      const artifactPayload = await artifactRes.json();
      if (artifactRes.ok && artifactPayload.ok !== false) {
        const artifact = unwrapApiData(artifactPayload)?.artifact || unwrapApiData(artifactPayload);
        setArtifactState({ status: artifact ? 'ready' : 'empty', nodeId: 'keywordReview', artifact, error: '' });
      }
    } catch (err) {
      const message = `人工筛词确认失败: ${err.message}`;
      setLogs((prev) => [...prev, { timestamp: new Date().toISOString(), level: 'error', message }]);
      alert(message);
    }
  };

  const confirmProductReview = async ({ approvedProductIds = [], manualProducts = [] } = {}) => {
    if (!currentRunId) return;
    try {
      const res = await fetch(`/api/workflows/runs/${currentRunId}/product-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedProductIds, manualProducts })
      });
      const payload = await res.json();
      if (!res.ok || payload.ok === false) throw new Error(payload.error || '人工选品确认失败');
      const selectedCount = payload.data?.selected?.length || payload.selected?.length || 0;
      setLogs((prev) => [...prev, {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: `人工选品完成，已确认 ${selectedCount} 个商品，流程将继续生成标题。`
      }]);
      await loadHistoryRun(currentRunId);
      setArtifactState({ status: 'loading', nodeId: 'select', artifact: null, error: '' });
      const artifactRes = await fetch(`/api/workflows/runs/${currentRunId}/artifacts/select`);
      const artifactPayload = await artifactRes.json();
      if (artifactRes.ok && artifactPayload.ok !== false) {
        const artifact = unwrapApiData(artifactPayload)?.artifact || unwrapApiData(artifactPayload);
        setArtifactState({ status: artifact ? 'ready' : 'empty', nodeId: 'select', artifact, error: '' });
      }
    } catch (err) {
      const message = `人工选品确认失败: ${err.message}`;
      setLogs((prev) => [...prev, { timestamp: new Date().toISOString(), level: 'error', message }]);
      alert(message);
    }
  };

  const consolePanel = (
    <div className="workflow-console-panel">
      <div className="workflow-console-head">
        <span>
          <FileText size={13} /> 实时运行控制台日志
        </span>
        <button
          onClick={() => setLogs([])}
          className="text-[10px] text-slate-500 hover:text-slate-300 uppercase tracking-wider font-bold transition-all"
        >
          清空控制台
        </button>
      </div>

      <div
        id="console-terminal"
        className="workflow-console-terminal"
      >
        {logs.length === 0 ? (
          <div className="text-slate-600 italic">控制台处于闲置状态。点击“运行工作流”后即可捕获步骤执行的实时流式日志。</div>
        ) : (
          logs.map((log, index) => {
            const levelColors = {
              info: 'text-slate-300',
              warn: 'text-amber-400',
              error: 'text-rose-400 font-semibold'
            }[log.level || 'info'];

            return (
              <div key={index} className="flex gap-2 leading-relaxed">
                <span className="text-slate-600 shrink-0 select-none">
                  [{new Date(log.timestamp).toLocaleTimeString()}]
                </span>
                <span className={levelColors}>{log.message}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div className="workflow-studio-root">
      <div className="workflow-main-row">

      {/* 1. Left Sidebar: History and templates */}
      <div className={`w-80 border-r border-slate-800 bg-slate-900/60 flex flex-col h-full shrink-0 workflow-left-sidebar ${leftSidebarCollapsed ? 'is-collapsed' : ''}`}>
        <button
          type="button"
          className="workflow-sidebar-toggle"
          title={leftSidebarCollapsed ? '展开选品流水线' : '收起选品流水线'}
          aria-label={leftSidebarCollapsed ? '展开选品流水线' : '收起选品流水线'}
          onClick={() => setLeftSidebarCollapsed((collapsed) => !collapsed)}
        >
          <ChevronLeft size={15} className={leftSidebarCollapsed ? 'rotate-180' : ''} />
        </button>
        <div className="p-4 border-b border-slate-800 bg-slate-900 space-y-3">
          <div className="flex items-center gap-2">
            <Layers className="text-blue-500" size={20} />
            <h1 className="font-bold text-sm tracking-wider text-slate-200">
              选品流水线
            </h1>
          </div>
          <div className="text-[11px] leading-relaxed text-slate-400">
            同一张真实流程图里查看运行、处理阻塞和调整参数。
          </div>
        </div>

        {/* 模板加载 */}
        {templates.length > 0 && (
          <div className="p-4 border-b border-slate-800 bg-slate-900/20">
            <label className="text-xs font-bold tracking-wider text-slate-400 mb-2 block" htmlFor="workflow-template-select">
              流程模板
            </label>
            <select
              id="workflow-template-select"
              value={activeTemplateId || ''}
              onChange={(event) => {
                const template = templates.find((item) => item.id === event.target.value);
                if (template) loadTemplate(template);
              }}
              className="w-full p-2.5 rounded border border-slate-700 bg-slate-800 text-sm text-slate-100 font-medium focus:border-blue-500 focus:outline-none"
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>{template.name}</option>
              ))}
            </select>
            <div className="mt-2 text-[10px] leading-relaxed text-slate-400">
              {activeTemplate?.description || activeTemplateView.scenarioLabel}
            </div>
            <div className="mt-2 rounded border border-slate-800 bg-slate-950/45 p-2 text-[10px] leading-relaxed text-slate-300">
              {activeTemplateView.flowSummary}
            </div>
            <div className="mt-3 rounded border border-slate-800 bg-slate-950/45 p-2 text-[11px] leading-relaxed text-slate-400">
              <strong className="block text-slate-200 mb-1">当前模板</strong>
              {activeTemplateView.modeHint}
            </div>
          </div>
        )}

        {/* 历史运行列表 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
            <Clock size={12} /> 运行历史
          </h2>
          <button
            onClick={fetchHistoryRuns}
            className="w-full py-2 rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 font-semibold flex items-center justify-center gap-1.5"
          >
            <RefreshCw size={13} className={historyLoading ? 'animate-spin' : ''} /> 刷新历史
          </button>
          {historyError && (
            <div className="monitor-alert monitor-alert-error">{historyError}</div>
          )}
          {historyRuns.length === 0 ? (
            <div className="text-xs text-slate-500 italic p-2">暂无历史执行记录</div>
          ) : (
            <div className="space-y-1.5">
              {historyRuns.map((run) => {
                const item = getUnifiedWorkflowHistoryItem(run);
                return (
                  <div className="flex items-stretch gap-1.5" key={item.runId}>
                    <button
                      type="button"
                      onClick={() => loadHistoryRun(item.runId)}
                      className={`monitor-run-card flex-1 text-left ${currentRunId === item.runId ? 'monitor-run-card-active' : ''}`}
                    >
                      <div className="flex justify-between items-center font-mono text-[10px] text-slate-400 mb-1">
                        <span className="truncate w-36">{item.runId}</span>
                        <span className={`monitor-status-pill monitor-status-${item.visualState}`}>
                          {item.statusLabel}
                        </span>
                      </div>
                      <div className="font-semibold text-slate-200 truncate">
                        {item.title}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">
                        {item.subtitle}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1">
                        {formatDateTime(item.updatedAt)}
                      </div>
                    </button>
                    <button
                      type="button"
                      className="workflow-history-delete-button"
                      title="删除运行历史"
                      aria-label={`删除运行历史 ${item.runId}`}
                      disabled={deletingRunId === item.runId}
                      onClick={() => deleteHistoryRun(item.runId)}
                    >
                      {deletingRunId === item.runId ? <RefreshCw size={14} className="mx-auto animate-spin" /> : <Trash2 size={14} className="mx-auto" />}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

      {/* 2. Middle & Right: Canvas, Log panel, and Settings panel */}
      <div className="min-w-0 flex-1 flex flex-col h-full relative">

        {/* 流水线顶部状态区 */}
        <div className="workflow-top-action-strip">
          <div className="workflow-top-context">
            <span>当前流程</span>
            <strong>{activeTemplateLabel}</strong>
            <small>{currentRunId ? `RunId: ${currentRunId}` : '尚未开始运行'} · 当前节点：{selectedNodeLabel}</small>
          </div>

          <div className="workflow-top-status">
            <span className="text-xs text-slate-400 flex items-center gap-2">
              状态
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                runStatus === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                runStatus === 'failed' ? 'bg-rose-500/10 text-rose-400' :
                runStatus === 'blocked' ? 'bg-amber-500/10 text-amber-300' :
                runStatus === 'cancelled' ? 'bg-amber-500/10 text-amber-400' :
                runStatus === 'running' ? 'bg-blue-500/10 text-blue-400 animate-pulse' : 'bg-slate-800 text-slate-400'
              }`}>
                {labelWorkflowNodeStatus(runStatus)}
              </span>
            </span>

            {isRunActive ? (
              <>
                {canPauseRun && (
                  <button
                    type="button"
                    className="secondary-button px-3 py-1.5 text-xs font-semibold"
                    onClick={() => runWorkflowOperation('pause')}
                  >
                    暂停
                  </button>
                )}
                <button
                  onClick={handleCancelWorkflow}
                  disabled={!canCancelRun}
                  className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-md flex items-center gap-1.5 shadow-lg shadow-amber-900/20 transition-all"
                >
                  <Square size={13} fill="currentColor" /> 取消运行
                </button>
              </>
            ) : (
              <button
                onClick={handleRunWorkflow}
                disabled={nodes.length === 0 || isViewingRun}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold rounded-md flex items-center gap-1.5 shadow-lg shadow-blue-900/20 transition-all"
              >
                <Play size={13} fill="currentColor" /> {isViewingRun ? '历史运行只读' : '运行工作流'}
              </button>
            )}
          </div>
        </div>

        {orderedWorkflowNodes.length > 0 && (
          <div className="workflow-order-strip" aria-label="流程顺序">
            {orderedWorkflowNodes.map((node, index) => (
              <button
                type="button"
                key={node.id}
                className={`workflow-order-step ${selectedNodeId === node.id ? 'workflow-order-step-active' : ''}`}
                onClick={() => setSelectedNodeId(node.id)}
              >
                <span>{node.data?.stepIndex || index + 1}</span>
                <strong>{node.data?.label || node.id}</strong>
              </button>
            ))}
          </div>
        )}

        {/* 画布区域 */}
        <div className="flex-1 flex flex-col min-h-0">

          {/* 画布 */}
          <div className="workflow-canvas-scroll">
            <div className="workflow-canvas-surface">
              <ReactFlow
                key="workflow-flow"
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={onNodeClick}
                nodeTypes={nodeTypes}
                defaultViewport={{ x: 0, y: 0, zoom: 0.82 }}
                minZoom={0.5}
                maxZoom={1.5}
                style={{ width: '100%', height: '100%' }}
                nodesDraggable={false}
                nodesConnectable={false}
                edgesReconnectable={false}
              >
                <Background color="#334155" gap={20} size={1} />
                <Controls className="bg-slate-900 border border-slate-800 text-slate-100 rounded" />
                <MiniMap
                  bgColor="#0f172a"
                  nodeColor={(n) => {
                    if (isInputNodeType(n.type)) return '#3b82f6';
                    if (n.type === 'keyword-mining') return '#6366f1';
                    if (n.type === 'title-generator') return '#10b981';
                    return '#64748b';
                  }}
                  maskColor="rgba(15, 23, 42, 0.6)"
                />
              </ReactFlow>
            </div>
          </div>

        </div>

      </div>

      {/* 3. Right Property Panel */}
      <div className={`w-[420px] max-w-[44vw] border-l border-slate-800 bg-slate-900/40 flex flex-col h-full shrink-0 workflow-right-sidebar ${rightSidebarCollapsed ? 'is-collapsed' : ''}`}>
        <button
          type="button"
          className="workflow-sidebar-toggle"
          title={rightSidebarCollapsed ? '展开节点详情' : '收起节点详情'}
          aria-label={rightSidebarCollapsed ? '展开节点详情' : '收起节点详情'}
          onClick={() => setRightSidebarCollapsed((collapsed) => !collapsed)}
        >
          <ChevronLeft size={15} className={rightSidebarCollapsed ? '' : 'rotate-180'} />
        </button>
        <div className="p-4 border-b border-slate-800 bg-slate-900 flex items-center gap-2">
          <Settings className="text-slate-400" size={18} />
          <h2 className="font-bold text-sm tracking-wider text-slate-200">
            节点详情
          </h2>
        </div>

        {selectedNode ? (
          <div className="p-5 flex-1 overflow-y-auto space-y-6">
            <div className="workflow-detail-card">
              <div className="workflow-detail-card-head">
                <span>{selectedNode.data?.label || selectedNode.id}</span>
                <b>{getWorkflowNodeViewModel(selectedNode.id, selectedNode.data).statusLabel}</b>
              </div>
              <div className="workflow-detail-rows">
                <div className="workflow-detail-row">
                  <span>节点</span>
                  <strong>{selectedNode.id} ({selectedNode.data?.originalType || selectedNode.type})</strong>
                </div>
                {getWorkflowNodeDetailRows(selectedNode).map((row) => (
                  <div className="workflow-detail-row" key={row.label}>
                    <span>{row.label}</span>
                    {row.label === '产物位置' ? (
                      <button type="button" className="workflow-detail-link" onClick={() => setArtifactPreviewOpen(true)}>
                        {row.value}
                      </button>
                    ) : (
                      <strong>{row.value}</strong>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <NodeOperationPanel
              selectedNode={selectedNode}
              artifactState={artifactState}
              seedRows={seedRows}
              seedDraft={seedDraft}
              seedLoading={seedLoading}
              seedMessage={seedMessage}
              onSeedDraftChange={setSeedDraft}
              onLoadSeeds={loadSeeds}
              onAddSeed={addSeed}
              onToggleSeed={toggleSeed}
              onDeleteSeed={deleteSeed}
              onSetSeedStatus={setSeedStatus}
              minerTab={minerTab}
              minerInput={minerInput}
              minerResults={minerResults}
              minerBusy={minerBusy}
              onMinerTabChange={setMinerTab}
              onMinerInputChange={setMinerInput}
              onRunMiner={runRootMiner}
              verifiedRows={verifiedRows}
              titleForm={titleForm}
              titleLoading={titleLoading}
              titleResult={titleResult}
              titleError={titleError}
              onTitleFormChange={setTitleForm}
              onUseVerifiedKeyword={useVerifiedKeywordForTitle}
              onGenerateTitle={generateTitleFromNode}
              onCopyText={copyText}
              onConfirmKeywordReview={confirmKeywordReview}
              onConfirmProductReview={confirmProductReview}
              onRetryNode={retryWorkflowNode}
              currentRunId={currentRunId}
              manualMode={activeTemplateMode === 'manual'}
              onDistributionJobChange={updateDistributionNodeJob}
            />

            {artifactPreviewOpen && (
              <div className="workflow-modal-backdrop" role="presentation" onClick={() => setArtifactPreviewOpen(false)}>
                <section className="workflow-modal artifact-preview-modal" role="dialog" aria-modal="true" aria-label="节点产物预览" onClick={(event) => event.stopPropagation()}>
                  <div className="workflow-modal-head">
                    <div>
                      <strong>{selectedNode.data?.label || selectedNode.id}产物</strong>
                      <span>已转换成可读视图；原始文件位置仍保留在上方节点详情中。</span>
                    </div>
                    <button type="button" className="workflow-modal-close" onClick={() => setArtifactPreviewOpen(false)}>×</button>
                  </div>
                  <div className="artifact-preview-modal-body">
                    {getWorkflowNodePanelKind(selectedNode?.id) === 'distribution-export' ? (
                      <DistributionExportPanel
                        artifactState={artifactState}
                        onCopyText={copyText}
                        currentRunId={currentRunId}
                        sourceNodeId={selectedNode?.id}
                        onDistributionJobChange={updateDistributionNodeJob}
                      />
                    ) : (
                      <ArtifactPanel state={artifactState} />
                    )}
                  </div>
                </section>
              </div>
            )}

            {isViewingRun && (
              <div className="p-3 rounded border border-slate-800 bg-slate-950/50 text-[11px] leading-relaxed text-slate-400">
                当前正在查看历史运行。节点状态、产物和恢复动作可以查看，参数编辑请先从左侧选择流程模板。
              </div>
            )}

            {!isViewingRun && selectedNode.id === 'start' && activeTemplateMode === 'keyword' && (
              <div className="space-y-4">
                <div className="rounded border border-slate-800 bg-slate-950/50 p-3 text-[11px] leading-relaxed text-slate-400">
                  {activeTemplateView.modeHint}
                </div>
                <div className="border-t border-slate-800/80 pt-4">
                  <label className="text-xs font-bold text-slate-300 block mb-2">搜索核心关键词</label>
                  <input
                    type="text"
                    value={selectedNode.data.keyword || ''}
                    onChange={(e) => updateNodeData(selectedNode.id, 'keyword', e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-slate-700 bg-slate-950 focus:border-blue-500 focus:outline-none text-slate-100 text-sm transition-all"
                    placeholder="例如: 纯银项链女高级感"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">此词会作为精确关键词流水线的启动参数。</p>
                </div>
              </div>
            )}

            {!isViewingRun && selectedNode.id === 'start' && activeTemplateMode === 'manual' && (
              <div className="space-y-4">
                <div className="rounded border border-slate-800 bg-slate-950/50 p-3 text-[11px] leading-relaxed text-slate-400">
                  {activeTemplateView.modeHint}
                </div>
                <div className="border-t border-slate-800/80 pt-4">
                  <label className="text-xs font-bold text-slate-300 block mb-2">人工输入关键词</label>
                  <textarea
                    value={selectedNode.data.keywords || ''}
                    onChange={(e) => updateNodeData(selectedNode.id, 'keywords', e.target.value)}
                    className="w-full min-h-28 p-2.5 rounded-lg border border-slate-700 bg-slate-950 focus:border-blue-500 focus:outline-none text-slate-100 text-sm transition-all resize-y"
                    placeholder="每行一个关键词，也可以用逗号分隔"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">启动后先人工筛词，再检查 1688 货源并勾选或手动添加商品。</p>
                </div>
              </div>
            )}

            {!isViewingRun && selectedNode.id === 'start' && activeTemplateMode === 'daily' && (
              <div className="space-y-4 border-t border-slate-800/80 pt-4">
                <div className="text-xs font-bold text-slate-300">每日流水线参数</div>
                <div className="rounded border border-slate-800 bg-slate-950/50 p-3 text-[11px] leading-relaxed text-slate-400">
                  {activeTemplateView.modeHint}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {DAILY_START_OPTIONS.map((field) => (
                    <label key={field.key} className="space-y-1 col-span-2">
                      <span className="text-[10px] font-bold text-slate-400 block">{field.label}</span>
                      <select
                        value={selectedNode.data[field.key] ?? field.options[0].value}
                        onChange={(e) => updateNodeData(selectedNode.id, field.key, e.target.value)}
                        className="w-full p-2.5 rounded-lg border border-slate-700 bg-slate-950 focus:border-blue-500 focus:outline-none text-slate-100 text-sm transition-all"
                      >
                        {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                  ))}
                  {DAILY_START_FIELDS.map((field) => (
                    <label key={field.key} className="space-y-1">
                      <span className="text-[10px] font-bold text-slate-400 block">{field.label}</span>
                      <input
                        type="number"
                        value={selectedNode.data[field.key] ?? ''}
                        onChange={(e) => updateNodeData(selectedNode.id, field.key, parseInt(e.target.value, 10) || field.min)}
                        className="w-full p-2.5 rounded-lg border border-slate-700 bg-slate-950 focus:border-blue-500 focus:outline-none text-slate-100 text-sm transition-all"
                        min={field.min}
                        max={field.max}
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* 输入节点独有参数 */}
            {!isViewingRun && isInputNodeType(selectedNode.type) && (
              <div className="space-y-4">
                <div className="border-t border-slate-800/80 pt-4">
                  <label className="text-xs font-bold text-slate-300 block mb-2">搜索核心关键词</label>
                  <input
                    type="text"
                    value={selectedNode.data.keyword || ''}
                    onChange={(e) => updateNodeData(selectedNode.id, 'keyword', e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-slate-700 bg-slate-950 focus:border-blue-500 focus:outline-none text-slate-100 text-sm transition-all"
                    placeholder="例如: 纯银项链女高级感"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">此词作为整个标题分析与1688货源搜索的核心关键词。</p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-300 block">标题最大长度 (字符)</label>
                  <input
                    type="number"
                    value={selectedNode.data.maxLength || 60}
                    onChange={(e) => updateNodeData(selectedNode.id, 'maxLength', parseInt(e.target.value) || 60)}
                    className="w-full p-2.5 rounded-lg border border-slate-700 bg-slate-950 focus:border-blue-500 focus:outline-none text-slate-100 text-sm transition-all"
                    min="10"
                    max="100"
                  />
                  <p className="text-[10px] text-slate-500">最终在淘系发布时限制的最大标题字数。</p>
                </div>
              </div>
            )}

            {/* 关键词挖掘节点参数 */}
            {!isViewingRun && selectedNode.type === 'keyword-mining' && (
              <div className="space-y-4 border-t border-slate-800/80 pt-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-300 block">最大挖掘候选词数量</label>
                  <input
                    type="number"
                    value={selectedNode.data.count || 5}
                    onChange={(e) => updateNodeData(selectedNode.id, 'count', parseInt(e.target.value) || 5)}
                    className="w-full p-2.5 rounded-lg border border-slate-700 bg-slate-950 focus:border-blue-500 focus:outline-none text-slate-100 text-sm transition-all"
                    min="1"
                    max="20"
                  />
                  <p className="text-[10px] text-slate-500">自动从同行或1688热榜抓取的最优词根个数。</p>
                </div>
              </div>
            )}

            {/* 标题生成器节点参数 */}
            {!isViewingRun && selectedNode.type === 'title-generator' && (
              <div className="space-y-4 border-t border-slate-800/80 pt-4 text-xs text-slate-400 leading-relaxed">
                <div>此节点将接收上一节点的关键词挖掘结果，合并淘宝与1688竞品数据，通过 GLM 大模型自动编排生成最符合 SEO 权重的高点击率标题。</div>
                <div className="p-3 bg-slate-950/40 rounded border border-emerald-950/40 text-emerald-400/90 text-[11px]">
                  💡 <b>温馨提示：</b>该步骤运行包含 1688 淘系商品抓取与 LLM 管道融合，有完整的 API key 时大约需 15 秒完成；若无 API 则自动秒级降级为高仿模拟数据，确保原型运行成功。
                </div>
              </div>
            )}

            {/* 重置标签 */}
            {!isViewingRun && (
            <div className="border-t border-slate-800/80 pt-4">
              <label className="text-xs font-bold text-slate-300 block mb-2">画布节点标签</label>
              <input
                type="text"
                value={selectedNode.data.label || ''}
                onChange={(e) => updateNodeData(selectedNode.id, 'label', e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-700 bg-slate-950 focus:border-blue-500 focus:outline-none text-slate-100 text-xs transition-all"
              />
            </div>
            )}
          </div>
        ) : (
          <div className="p-5 flex-grow flex flex-col justify-center items-center text-slate-500 text-xs italic text-center">
            <Settings size={28} className="text-slate-700 mb-2 animate-pulse" />
            在画布中选中一个节点后，这里会显示状态、产物和恢复动作。
          </div>
        )}
      </div>
      </div>
      {consolePanel}
    </div>
  );
}
