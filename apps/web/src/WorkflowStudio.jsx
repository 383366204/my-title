import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
  MarkerType
} from '@xyflow/react';
import {
  Play,
  Square,
  RefreshCw,
  Plus,
  Trash2,
  FileText,
  Clock,
  Sparkles,
  Settings,
  Layers,
  ChevronRight,
  Database,
  Tag
} from 'lucide-react';

import '@xyflow/react/dist/style.css';
import './App.css';
import {
  formatWorkflowProgressLabel,
  getPipelineMonitorNodeStatus,
  getPipelineSummaryVisualState,
  getStartNodeParams,
  getWorkflowLaunchBlocker,
  getWorkflowNodeDetailRows,
  getWorkflowNodeViewModel,
  getWorkflowOperationMessage,
  isWorkflowInputNodeType,
  labelWorkflowNodeStatus,
  normalizeWorkflowProgressEvent,
  summarizeWorkflowArtifact
} from './workflow-ui.js';
import {
  labelPipelineStatus,
  labelPipelineStage
} from './pipeline-labels.js';
import {
  getPipelineActionView
} from './pipeline-action-view.js';

// ==================== Custom Flow Nodes ====================

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

const WorkflowNodeActionChip = ({ view }) => (
  <div className={`production-node-action production-node-action-${view.primaryAction.tone}`}>
    {view.primaryAction.label}
  </div>
);

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
      {shouldShowNodeActionChip(data.status) && <WorkflowNodeActionChip view={view} />}

      <Handle type="source" position={Position.Right} id="a" style={{ background: '#3b82f6', width: 8, height: 8 }} />
    </div>
  );
};

// 2. Mining Node (关键词挖掘节点)
const MiningNode = ({ data }) => {
  const statusColor = getStatusBorderColor(data.status);
  const dotColor = getStatusDotColor(data.status);
  const view = getWorkflowNodeViewModel(data.id || data.label, data);

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
      <WorkflowBlockerCallout view={view} />
      {shouldShowNodeActionChip(data.status) && <WorkflowNodeActionChip view={view} />}

      <Handle type="source" position={Position.Right} id="out" style={{ background: '#3b82f6', width: 8, height: 8 }} />
    </div>
  );
};

// 3. Title Generator Node (标题生成与选品卡片)
const TitleGeneratorNode = ({ data }) => {
  const statusColor = getStatusBorderColor(data.status);
  const dotColor = getStatusDotColor(data.status);
  const view = getWorkflowNodeViewModel(data.id || data.label, data);

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
      <WorkflowBlockerCallout view={view} />
      {shouldShowNodeActionChip(data.status) && <WorkflowNodeActionChip view={view} />}

      <Handle type="source" position={Position.Right} id="out" style={{ background: '#3b82f6', width: 8, height: 8 }} />
    </div>
  );
};

// 4. Monitor Node (只读日常流程节点)
const MonitorStageNode = ({ data }) => {
  const view = getWorkflowNodeViewModel(data.id, data);
  const statusLabel = view.statusLabel;

  return (
    <button
      type="button"
      className={`monitor-node monitor-node-${data.status || 'idle'}`}
      onClick={data.onSelect}
    >
      {data.hasTarget && <Handle type="target" position={Position.Left} id="in" />}
      <div className="monitor-node-index">{data.stageIndex + 1}</div>
      <div className="monitor-node-body">
        <div className="monitor-node-label">{data.label}</div>
        <div className="monitor-node-stage">{data.stage}</div>
      </div>
      <span className="monitor-node-status">{statusLabel}</span>
      {data.manualAction?.userMessage && (
        <div className="monitor-node-hint">{data.manualAction.userMessage}</div>
      )}
      {data.hasSource && <Handle type="source" position={Position.Right} id="out" />}
    </button>
  );
};

const ProductionNode = ({ id, data }) => {
  const status = data.status || data.state || 'idle';
  const view = getWorkflowNodeViewModel(id, data);
  const tone = view.tone;
  const label = data.label || data.name || data.title || id;

  return (
    <button
      type="button"
      className={`production-node production-node-${tone}`}
      onPointerDown={(event) => {
        event.stopPropagation();
        data.onSelect?.();
      }}
      onClick={data.onSelect}
    >
      <Handle type="target" position={Position.Left} id="in" />
      <div className="production-node-head">
        <span>{data.stage || data.kind || data.action || data.type || 'workflow'}</span>
        <b>{labelPipelineStatus(status)}</b>
      </div>
      <div className="production-node-title">{label}</div>
      {data.description && <div className="production-node-description">{data.description}</div>}

      <WorkflowProgressStrip view={view} />
      <WorkflowBlockerCallout view={view} />
      <WorkflowNodeActionChip view={view} />
      <Handle type="source" position={Position.Right} id="out" />
    </button>
  );
};

// ==================== Node Types Map ====================
const nodeTypes = {
  'keyword-input': InputNode,
  'input': ProductionNode,
  'keyword-mining': MiningNode,
  'title-generator': TitleGeneratorNode,
  'monitor-stage': MonitorStageNode,
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
const MODE_MONITOR = 'monitor';
const MODE_EXPERIMENT = 'experiment';
const MONITOR_STAGES = [
  { id: 'seed', label: '种子/启动', stage: 'seed', stageIndex: 0, position: { x: 40, y: 180 } },
  { id: 'mined', label: '挖词', stage: 'mined', stageIndex: 1, position: { x: 300, y: 180 } },
  { id: 'verified', label: '多指标验真', stage: 'verified', stageIndex: 2, position: { x: 560, y: 180 } },
  { id: 'generated', label: '标题货源', stage: 'generated', stageIndex: 3, position: { x: 820, y: 180 } },
  { id: 'review', label: '人工复核', stage: 'review', stageIndex: 4, position: { x: 1080, y: 180 } },
  { id: 'ready', label: '待铺货批次', stage: 'ready', stageIndex: 5, position: { x: 1340, y: 180 } },
  { id: 'submitted', label: '已提交', stage: 'submitted', stageIndex: 6, position: { x: 1600, y: 180 } }
];
const MONITOR_EDGES = MONITOR_STAGES.slice(0, -1).map((stage, index) => ({
  id: `monitor-${stage.id}-${MONITOR_STAGES[index + 1].id}`,
  source: stage.id,
  target: MONITOR_STAGES[index + 1].id,
  markerEnd: { type: MarkerType.ArrowClosed, color: '#475569' },
  style: { stroke: '#475569', strokeWidth: 2 }
}));
const NODE_LAYOUT = {
  'keyword-input': { x: 80, y: 160 },
  'keyword-mining': { x: 520, y: 160 },
  'title-generator': { x: 980, y: 160 }
};
const PIPELINE_RECOVERABLE_NODE_IDS = new Set(['mine', 'verify', 'generate', 'export']);
const NODE_ROW_GAP = 190;
const DAILY_START_FIELDS = [
  { key: 'mine', label: '挖掘候选词', min: 1, max: 200 },
  { key: 'verify', label: '生意参谋校验', min: 1, max: 200 },
  { key: 'generate', label: '生成标题货源', min: 1, max: 100 },
  { key: 'export', label: '导出清单数量', min: 1, max: 100 },
  { key: 'productsPerKeyword', label: '每词货源数', min: 1, max: 50 },
  { key: 'length', label: '标题长度', min: 30, max: 80 },
  { key: 'pages', label: '采集页数', min: 1, max: 5 }
];

const unwrapApiData = (payload) => payload?.data || payload || {};

const isPipelineRecoverableNode = (nodeId) => PIPELINE_RECOVERABLE_NODE_IDS.has(String(nodeId || ''));

const isLegacyWorkflowRun = (runId) => String(runId || '').startsWith('run_');

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

const getTemplateMode = (template) => template?.mode || template?.workflow?.mode || MODE_EXPERIMENT;

const normalizeCanvasNode = (node, selectNode) => {
  const renderType = nodeTypes[node.type] ? node.type : 'task';
  return {
    ...node,
    type: renderType,
    data: {
      ...node.data,
      originalType: node.data?.originalType || node.type,
      status: node.data?.status || 'idle',
      output: node.data?.output || null,
      error: node.data?.error || null,
      progress: node.data?.progress || null,
      blocker: node.data?.blocker || null,
      actionHint: node.data?.actionHint || null,
      platformStatus: node.data?.platformStatus || null,
      durationMs: node.data?.durationMs || null,
      outputSummary: node.data?.outputSummary || null,
      cooldownRemainingMs: node.data?.cooldownRemainingMs || 0,
      onSelect: () => selectNode(node.id)
    }
  };
};

const ArtifactPanel = ({ state }) => {
  const artifact = state.artifact;
  const type = String(artifact?.type || '').toLowerCase();
  const items = Array.isArray(artifact?.items) ? artifact.items : artifact?.rows;
  const text = typeof artifact?.text === 'string'
    ? artifact.text
    : typeof artifact?.content === 'string'
      ? artifact.content
      : '';

  return (
    <div className="workflow-artifact-panel">
      <div className="workflow-artifact-head">
        <span>节点产物</span>
        {artifact && <b>{summarizeWorkflowArtifact(artifact)}</b>}
      </div>
      {state.status === 'loading' && (
        <div className="artifact-empty"><RefreshCw size={13} className="animate-spin" /> 正在加载节点产物...</div>
      )}
      {state.status === 'error' && (
        <div className="artifact-error">{state.error || '节点产物加载失败'}</div>
      )}
      {state.status === 'empty' && (
        <div className="artifact-empty">{state.error || '运行完成后显示产物，请到运行监控查看。'}</div>
      )}
      {state.status === 'ready' && artifact && Array.isArray(items) && (
        <div className="artifact-list">
          {items.length === 0 ? (
            <div className="artifact-empty">暂无 JSON 数据项</div>
          ) : items.map((item, index) => (
            <pre key={index}>{JSON.stringify(item, null, 2)}</pre>
          ))}
        </div>
      )}
      {state.status === 'ready' && artifact && !Array.isArray(items) && (
        <pre className="artifact-text">
          {text || (type === 'json' ? JSON.stringify(artifact, null, 2) : '暂无文本产物')}
        </pre>
      )}
    </div>
  );
};

const getSummaryVisualState = (summary) => {
  return getPipelineSummaryVisualState(summary);
};

const resolveSummaryStageIndex = (summary) => {
  if (!summary) return -1;
  if (Number.isFinite(summary.stageIndex)) return summary.stageIndex;
  return MONITOR_STAGES.findIndex((stage) => stage.stage === summary.stage);
};

const getMonitorNodeStatus = (stage, summary) => {
  return getPipelineMonitorNodeStatus(stage, {
    ...(summary || {}),
    stageIndex: resolveSummaryStageIndex(summary)
  });
};

const formatDateTime = (value) => {
  if (!value) return '未知时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

export default function WorkflowStudio({ initialMode = MODE_MONITOR }) {
  const [mode, setMode] = useState(initialMode);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedMonitorNodeId, setSelectedMonitorNodeId] = useState('seed');

  // 工作流执行状态
  const [currentRunId, setCurrentRunId] = useState(null);
  const [runStatus, setRunStatus] = useState('idle'); // 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'
  const [logs, setLogs] = useState([]);
  const [historyRuns, setHistoryRuns] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [activeTemplateId, setActiveTemplateId] = useState(null);
  const [activeTemplateMode, setActiveTemplateMode] = useState(MODE_EXPERIMENT);
  const [monitorRuns, setMonitorRuns] = useState([]);
  const [monitorLatestRun, setMonitorLatestRun] = useState(null);
  const [selectedMonitorRunId, setSelectedMonitorRunId] = useState(null);
  const [selectedMonitorRun, setSelectedMonitorRun] = useState(null);
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [monitorError, setMonitorError] = useState('');
  const [artifactState, setArtifactState] = useState({
    status: 'empty',
    nodeId: null,
    artifact: null,
    error: ''
  });

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
    try {
      const res = await fetch('/api/workflows/runs');
      const payload = await res.json();
      if (payload.ok === false) throw new Error(payload.error || '获取运行历史失败');
      setHistoryRuns(normalizeRunList(payload));
    } catch (err) {
      console.error('获取运行历史失败', err);
      setHistoryRuns([]);
    }
  };

  const loadWorkbenchRuns = async () => {
    setMonitorLoading(true);
    setMonitorError('');
    try {
      const res = await fetch('/api/pipeline/current?limit=20');
      const payload = await res.json();
      if (payload.ok === false) throw new Error(payload.error || '加载流程监控失败');
      const data = unwrapApiData(payload);
      const runs = Array.isArray(data.runs) ? data.runs : [];
      const latest = data.latest || runs[0] || null;
      const selectedFreshRun = selectedMonitorRunId
        ? runs.find((run) => run.runId === selectedMonitorRunId) || null
        : null;
      setMonitorRuns(runs);
      setMonitorLatestRun(latest);
      if (selectedFreshRun) {
        setSelectedMonitorRun(selectedFreshRun);
        loadWorkbenchRunDetail(selectedFreshRun.runId);
      } else if (latest?.runId) {
        setSelectedMonitorRunId(latest.runId);
        setSelectedMonitorRun(latest);
      } else {
        setSelectedMonitorRunId(null);
        setSelectedMonitorRun(null);
      }
    } catch (err) {
      setMonitorError(err.message);
    } finally {
      setMonitorLoading(false);
    }
  };

  const loadWorkbenchRunDetail = async (runId) => {
    if (!runId) return;
    setMonitorLoading(true);
    setMonitorError('');
    try {
      const res = await fetch(`/api/pipeline/runs/${runId}`);
      const payload = await res.json();
      if (payload.ok === false) throw new Error(payload.error || '加载流程详情失败');
      setSelectedMonitorRun(unwrapApiData(payload));
    } catch (err) {
      setMonitorError(err.message);
      setSelectedMonitorRun((current) => (
        selectedMonitorRunId === runId || current?.runId === runId ? null : current
      ));
    } finally {
      setMonitorLoading(false);
    }
  };

  useEffect(() => {
    if (mode === MODE_MONITOR) {
      loadWorkbenchRuns();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (mode === MODE_EXPERIMENT) {
      fetchTemplates();
      fetchHistoryRuns();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (mode === MODE_MONITOR && selectedMonitorRunId) {
      loadWorkbenchRunDetail(selectedMonitorRunId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedMonitorRunId]);

  // 加载工作流模板
  const loadTemplate = (template) => {
    const defaultWorkflow = template?.workflow || { nodes: [], edges: [] };
    // 重置节点状态为 idle
    const formattedNodes = (defaultWorkflow.nodes || []).map(n => normalizeCanvasNode({
      ...n,
      data: {
        ...n.data,
        status: 'idle',
        output: null,
        error: null
      }
    }, setSelectedNodeId));
    setNodes(formattedNodes);
    setEdges((defaultWorkflow.edges || []).map(e => ({
      ...e,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' },
      style: { stroke: '#3b82f6', strokeWidth: 2 }
    })));
    setActiveTemplateId(template?.id || null);
    setActiveTemplateMode(getTemplateMode(template));
    setSelectedNodeId(null);
    setRunStatus('idle');
    setCurrentRunId(null);
    setLogs([]);
    setArtifactState({ status: 'empty', nodeId: null, artifact: null, error: '' });
  };

  // 添加新连接
  const onConnect = useCallback((params) => {
    const newEdge = {
      ...params,
      id: `e_${Date.now()}`,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' },
      style: { stroke: '#3b82f6', strokeWidth: 2 }
    };
    setEdges((eds) => addEdge(newEdge, eds));
  }, [setEdges]);

  // 点击节点事件
  const onNodeClick = useCallback((event, node) => {
    setSelectedNodeId(node.id);
  }, []);

  useEffect(() => {
    if (mode !== MODE_EXPERIMENT || !selectedNodeId) return;
    if (!currentRunId) {
      setArtifactState({
        status: 'empty',
        nodeId: selectedNodeId,
        artifact: null,
        error: '运行完成后显示产物，请到运行监控查看。'
      });
      return;
    }

    let cancelled = false;
    setArtifactState({ status: 'loading', nodeId: selectedNodeId, artifact: null, error: '' });
    fetch(`/api/workflows/runs/${currentRunId}/artifacts/${selectedNodeId}`)
      .then(async (res) => {
        const payload = await res.json();
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
  }, [mode, selectedNodeId, currentRunId]);

  // 选中节点对象
  const selectedNode = useMemo(() => {
    return nodes.find(n => n.id === selectedNodeId) || null;
  }, [nodes, selectedNodeId]);

  const activeMonitorSummary = selectedMonitorRun || monitorLatestRun;
  const activeMonitorAction = getPipelineActionView(activeMonitorSummary);
  const isRunActive = runStatus === 'running' || runStatus === 'pending';
  const canCancelRun = Boolean(currentRunId) && isRunActive;
  const canPauseRun = Boolean(currentRunId) && runStatus === 'running';
  const selectedNodeCanRecover = Boolean(currentRunId && selectedNode) && (
    isLegacyWorkflowRun(currentRunId)
    || isPipelineRecoverableNode(selectedNode.id)
  );
  const selectedMonitorStage = MONITOR_STAGES.find((stage) => stage.id === selectedMonitorNodeId) || MONITOR_STAGES[0];
  const monitorNodes = useMemo(() => {
    return MONITOR_STAGES.map((stage, index) => ({
      id: stage.id,
      type: 'monitor-stage',
      position: stage.position,
      draggable: false,
      selectable: true,
      data: {
        ...stage,
        status: getMonitorNodeStatus(stage, activeMonitorSummary),
        hasTarget: index > 0,
        hasSource: index < MONITOR_STAGES.length - 1,
        onSelect: () => setSelectedMonitorNodeId(stage.id),
        manualAction: (stage.stageIndex === resolveSummaryStageIndex(activeMonitorSummary))
          ? (activeMonitorSummary?.manualAction || activeMonitorSummary?.runtime?.manualAction)
          : null
      }
    }));
  }, [activeMonitorSummary]);

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
    const eventSource = new EventSource(`/api/workflows/runs/${runId}/events`);

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
          fetchHistoryRuns();
        }
      } else if (data.event === 'node_change') {
        const { nodeId, state } = data.payload;
        setNodes((nds) =>
          nds.map((node) => {
            if (node.id === nodeId) {
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
                  platformStatus: state.platformStatus || null,
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
        const nodeId = progress.step || progress.nodeId;
        if (nodeId) {
          setNodes((nds) =>
            nds.map((node) => {
              if (node.id !== nodeId) return node;
              return {
                ...node,
                data: {
                  ...node.data,
                  status: progress.status || node.data.status,
                  progress
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
    };

    return eventSource;
  };

  // 同步工作流节点状态到前端组件
  const syncNodeStates = (nodeStates) => {
    setNodes((nds) =>
      nds.map((node) => {
        const state = nodeStates?.[node.id];
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
              platformStatus: state.platformStatus || null,
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
      setSelectedNodeId(null);
      setLogs([]);
      setCurrentRunId(runId);
      setRunStatus('running');

      const res = await fetch(`/api/workflows/runs/${runId}`);
      const data = await res.json();

      if (data.ok) {
        const run = unwrapApiData(data);
        // 把工作流图载入画布
        const defaultWorkflow = run.workflow || { nodes: [], edges: [] };

        // 载入节点和边，附带运行时状态
        setNodes((defaultWorkflow.nodes || []).map(n => {
          const state = run.nodeStates?.[n.id] || {};
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
              platformStatus: state.platformStatus || null,
              durationMs: state.durationMs || null,
              outputSummary: state.outputSummary || null,
              cooldownRemainingMs: state.cooldownRemainingMs || 0
            }
          }, setSelectedNodeId);
        }));

        setEdges((defaultWorkflow.edges || []).map(e => ({
          ...e,
          markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' },
          style: { stroke: '#3b82f6', strokeWidth: 2 }
        })));

        setRunStatus(run.status);

        // 开启 SSE 监听这个运行的实时变动（如果它是未完成的）或者直接拉日志
        if (run.status === 'running' || run.status === 'pending') {
          listenToRunEvents(runId);
        } else {
          // 直接把历史日志塞入 logs 状态中
          if (run.logs) {
            setLogs(run.logs);
          }
        }
      }
    } catch (err) {
      console.error('加载历史记录失败', err);
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

      const res = await fetch('/api/pipeline/start', {
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
          await Promise.allSettled([loadWorkbenchRuns(), fetchHistoryRuns()]);
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
    if (!currentRunId) return;
    const targetNodeId = nodeId || selectedNodeId;
    const shouldUsePipelineStep = (action === 'retry-node' || action === 'resume')
      && isPipelineRecoverableNode(targetNodeId)
      && !isLegacyWorkflowRun(currentRunId);
    const endpoint = action === 'pause' && !isLegacyWorkflowRun(currentRunId)
      ? `/api/pipeline/runs/${currentRunId}/pause`
      : action === 'resume' && !isLegacyWorkflowRun(currentRunId)
        ? `/api/pipeline/runs/${currentRunId}/resume`
        : shouldUsePipelineStep && action === 'retry-node'
          ? `/api/pipeline/runs/${currentRunId}/${targetNodeId}/retry`
          : shouldUsePipelineStep
            ? `/api/pipeline/runs/${currentRunId}/resume`
            : (action === 'retry-node'
                ? `/api/workflows/runs/${currentRunId}/retry-node`
                : `/api/workflows/runs/${currentRunId}/${action}`);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: action === 'retry-node' && !shouldUsePipelineStep
          ? JSON.stringify({ nodeId: targetNodeId })
          : '{}'
      });
      const payload = await res.json();
      if (!res.ok || payload.ok === false) {
        throw new Error(payload.error || '工作流操作失败');
      }
      setLogs((prev) => [...prev, {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: getWorkflowOperationMessage(action, 'success')
      }]);
      await loadHistoryRun(currentRunId);
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

  // 画布添加新节点
  const handleAddNode = (type) => {
    const labels = {
      'keyword-input': '输入参数',
      'keyword-mining': '长尾词挖掘',
      'title-generator': '标题生成器'
    };
    const basePosition = NODE_LAYOUT[type] || { x: 120, y: 160 };
    const sameTypeCount = nodes.filter((node) => node.type === type).length;

    const newId = `${type}_${Date.now()}`;
    const newNode = {
      id: newId,
      type,
      position: {
        x: basePosition.x,
        y: basePosition.y + sameTypeCount * NODE_ROW_GAP
      },
      data: {
        label: labels[type],
        status: 'idle',
        keyword: type === 'keyword-input' ? '纯银项链' : '',
        count: type === 'keyword-mining' ? 5 : undefined,
        maxLength: type === 'keyword-input' ? 60 : undefined
      }
    };
    setNodes((nds) => nds.concat(newNode));
  };

  // 删除选中节点或连接
  const handleDeleteSelected = () => {
    if (!selectedNodeId) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
    setEdges((eds) => eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId));
    setSelectedNodeId(null);
  };

  return (
    <div className="flex min-h-screen w-full min-w-0 bg-slate-950 font-sans text-slate-100">

      {/* 1. Left Sidebar: History and Node library */}
      <div className="w-80 border-r border-slate-800 bg-slate-900/60 flex flex-col h-full shrink-0">
        <div className="p-4 border-b border-slate-800 bg-slate-900 space-y-3">
          <div className="flex items-center gap-2">
            <Layers className="text-blue-500" size={20} />
            <h1 className="font-bold text-sm tracking-wider text-slate-200">
              流程画布
            </h1>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setMode(MODE_MONITOR)}
              className={`mode-toggle ${mode === MODE_MONITOR ? 'mode-toggle-active' : ''}`}
            >
              运行监控
            </button>
            <button
              onClick={() => setMode(MODE_EXPERIMENT)}
              className={`mode-toggle ${mode === MODE_EXPERIMENT ? 'mode-toggle-active' : ''}`}
            >
              流程编排
            </button>
          </div>
        </div>

        {/* 节点库 */}
        {mode === MODE_EXPERIMENT && (
        <div className="p-4 border-b border-slate-800 space-y-3 bg-slate-900/40">
          <h2 className="text-xs font-bold tracking-wider text-slate-400">节点库</h2>
          <div className="grid grid-cols-1 gap-2">
            <button
              onClick={() => handleAddNode('keyword-input')}
              className="flex items-center justify-between p-2.5 rounded-lg border border-blue-500/30 hover:border-blue-500 bg-blue-950/20 hover:bg-blue-950/40 text-blue-300 text-xs font-semibold transition-all"
            >
              <span className="flex items-center gap-2"><Plus size={14} /> 输入节点</span>
              <span className="text-[10px] text-blue-500/60">Input</span>
            </button>
            <button
              onClick={() => handleAddNode('keyword-mining')}
              className="flex items-center justify-between p-2.5 rounded-lg border border-indigo-500/30 hover:border-indigo-500 bg-indigo-950/20 hover:bg-indigo-950/40 text-indigo-300 text-xs font-semibold transition-all"
            >
              <span className="flex items-center gap-2"><Plus size={14} /> 关键词挖掘</span>
              <span className="text-[10px] text-indigo-500/60">Mining</span>
            </button>
            <button
              onClick={() => handleAddNode('title-generator')}
              className="flex items-center justify-between p-2.5 rounded-lg border border-emerald-500/30 hover:border-emerald-500 bg-emerald-950/20 hover:bg-emerald-950/40 text-emerald-300 text-xs font-semibold transition-all"
            >
              <span className="flex items-center gap-2"><Plus size={14} /> 标题生成器</span>
              <span className="text-[10px] text-emerald-500/60">Generator</span>
            </button>
          </div>
        </div>
        )}

        {/* 模板加载 */}
        {mode === MODE_EXPERIMENT && templates.length > 0 && (
          <div className="p-4 border-b border-slate-800 bg-slate-900/20">
            <h2 className="text-xs font-bold tracking-wider text-slate-400 mb-2">流程模板</h2>
            <div className="space-y-2">
              {templates.map((template) => (
                <button
                  key={template.id}
                  onClick={() => loadTemplate(template)}
                  className={`w-full text-left p-2.5 rounded border text-xs font-medium flex items-center justify-between transition-all ${
                    activeTemplateId === template.id
                      ? 'border-blue-500 bg-blue-950/30'
                      : 'border-slate-700 bg-slate-800 hover:bg-slate-750'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-slate-200 font-semibold truncate">{template.name}</div>
                    <div className="text-[10px] text-slate-400 truncate w-56">{template.description}</div>
                  </div>
                  <ChevronRight size={14} className="text-slate-500 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 历史运行列表 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
            <Clock size={12} /> {mode === MODE_MONITOR ? '流程批次历史' : '运行历史'}
          </h2>
          {mode === MODE_MONITOR ? (
            <div className="space-y-2">
              <button
                onClick={loadWorkbenchRuns}
                className="w-full py-2 rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 font-semibold flex items-center justify-center gap-1.5"
              >
                <RefreshCw size={13} className={monitorLoading ? 'animate-spin' : ''} /> 刷新批次
              </button>
              {monitorError && (
                <div className="monitor-alert monitor-alert-error">{monitorError}</div>
              )}
              {monitorRuns.length === 0 ? (
                <div className="text-xs text-slate-500 italic p-2">暂无真实流程运行记录</div>
              ) : (
                <div className="space-y-1.5">
                  {monitorRuns.map((run) => (
                    <button
                      key={run.runId}
                      onClick={() => {
                        setSelectedMonitorRun(run);
                        setSelectedMonitorRunId(run.runId);
                      }}
                      className={`monitor-run-card ${selectedMonitorRunId === run.runId ? 'monitor-run-card-active' : ''}`}
                    >
                      <div className="flex justify-between items-center font-mono text-[10px] text-slate-400 mb-1">
                        <span className="truncate w-36">{run.runId}</span>
                        <span className={`monitor-status-pill monitor-status-${getSummaryVisualState(run)}`}>
                          {labelPipelineStatus(run.status)}
                        </span>
                      </div>
                      <div className="font-semibold text-slate-200 truncate">
                        {labelPipelineStage(run.stage)} · 第 {(resolveSummaryStageIndex(run) + 1) || 0} 阶段
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1">
                        {formatDateTime(run.updatedAt || run.startedAt)}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : historyRuns.length === 0 ? (
            <div className="text-xs text-slate-500 italic p-2">暂无历史执行记录</div>
          ) : (
            <div className="space-y-1.5">
              {historyRuns.map((run) => (
                <button
                  key={run.runId}
                  onClick={() => loadHistoryRun(run.runId)}
                  className={`w-full text-left p-2.5 rounded text-xs border transition-all ${
                    currentRunId === run.runId
                      ? 'bg-blue-950/40 border-blue-500 text-blue-100'
                      : 'bg-slate-800/40 border-slate-800/80 hover:bg-slate-800/90 text-slate-300'
                  }`}
                >
                  <div className="flex justify-between items-center font-mono text-[10px] text-slate-400 mb-1">
                    <span className="truncate w-32">{run.runId}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${
                      run.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                      run.status === 'failed' ? 'bg-rose-500/10 text-rose-400' :
                      run.status === 'cancelled' ? 'bg-amber-500/10 text-amber-400' : 'bg-blue-500/10 text-blue-400'
                    }`}>
                      {labelPipelineStatus(run.status)}
                    </span>
                  </div>
                  <div className="font-semibold text-slate-200 truncate">
                    词: {run.keyword || <span className="italic text-slate-500">未命名图</span>}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    {new Date(run.startedAt).toLocaleString()}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* 2. Middle & Right: Canvas, Log panel, and Settings panel */}
      <div className="min-w-0 flex-1 flex flex-col h-full relative">

        {/* 控制工具条 */}
        <div className="h-14 border-b border-slate-800 bg-slate-900 flex justify-between items-center px-6 z-10 shrink-0">
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-400 flex items-center gap-2">
              当前状态:
              {mode === MODE_MONITOR ? (
                <span className={`monitor-status-pill monitor-status-${getSummaryVisualState(activeMonitorSummary)}`}>
                  {activeMonitorSummary ? labelPipelineStatus(activeMonitorSummary.status) : '暂无批次'}
                </span>
              ) : (
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                  runStatus === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                  runStatus === 'failed' ? 'bg-rose-500/10 text-rose-400' :
                  runStatus === 'blocked' ? 'bg-amber-500/10 text-amber-300' :
                  runStatus === 'cancelled' ? 'bg-amber-500/10 text-amber-400' :
                  runStatus === 'running' ? 'bg-blue-500/10 text-blue-400 animate-pulse' : 'bg-slate-800 text-slate-400'
                }`}>
                  {labelWorkflowNodeStatus(runStatus)}
                </span>
              )}
            </span>
            {mode === MODE_MONITOR && activeMonitorSummary?.runId && (
              <span className="text-xs font-mono text-slate-500">RunId: {activeMonitorSummary.runId}</span>
            )}
            {mode === MODE_EXPERIMENT && currentRunId && (
              <span className="text-xs font-mono text-slate-500">RunId: {currentRunId}</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {mode === MODE_MONITOR ? (
              <div className="text-xs text-slate-500">只读监控 · 点击节点查看阶段详情</div>
            ) : (
              <>
            {selectedNodeId && (
              <button
                onClick={handleDeleteSelected}
                className="px-3 py-1.5 bg-rose-950/20 hover:bg-rose-950/40 text-rose-300 border border-rose-500/30 hover:border-rose-500 text-xs font-semibold rounded-md flex items-center gap-1 transition-all"
              >
                <Trash2 size={13} /> 删除选中
              </button>
            )}

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
                disabled={nodes.length === 0}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold rounded-md flex items-center gap-1.5 shadow-lg shadow-blue-900/20 transition-all"
              >
                <Play size={13} fill="currentColor" /> 运行工作流
              </button>
            )}
              </>
            )}
          </div>
        </div>

        {/* 画布与日志面板的上下分栏布局 */}
        <div className="flex-1 flex flex-col min-h-0">

          {/* 画布 */}
          <div className="workflow-canvas-scroll">
            <div className="workflow-canvas-surface">
            {mode === MODE_MONITOR ? (
              <ReactFlow
                key="workflow-monitor-flow"
                nodes={monitorNodes}
                edges={MONITOR_EDGES}
                onNodeClick={(event, node) => setSelectedMonitorNodeId(node.id)}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.18, includeHiddenNodes: false, minZoom: 0.6, maxZoom: 0.95 }}
                minZoom={0.35}
                maxZoom={1.2}
                style={{ width: '100%', height: '100%' }}
                nodesDraggable={false}
                nodesConnectable={false}
                edgesReconnectable={false}
                deleteKeyCode={null}
              >
                <Background color="#334155" gap={24} size={1} />
                <Controls className="bg-slate-900 border border-slate-800 text-slate-100 rounded" showInteractive={false} />
              </ReactFlow>
            ) : (
              <ReactFlow
                key="workflow-experiment-flow"
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={onNodeClick}
                nodeTypes={nodeTypes}
                defaultViewport={{ x: 0, y: 0, zoom: 0.82 }}
                minZoom={0.5}
                maxZoom={1.5}
                style={{ width: '100%', height: '100%' }}
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
            )}
            </div>
          </div>

          {/* 底部控制台日志面板 */}
          {mode === MODE_EXPERIMENT && (
          <div className="h-64 border-t border-slate-800 bg-slate-900/80 flex flex-col shrink-0">
            <div className="h-9 border-b border-slate-800 bg-slate-900 flex items-center justify-between px-4">
              <span className="text-xs font-bold tracking-wider text-slate-400 flex items-center gap-1.5">
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
              className="flex-1 p-4 overflow-y-auto font-mono text-xs bg-slate-950/80 space-y-1.5 selection:bg-slate-800 selection:text-white"
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
          )}

        </div>

      </div>

      {/* 3. Right Property Panel */}
      <div className="w-80 border-l border-slate-800 bg-slate-900/40 flex flex-col h-full shrink-0">
        <div className="p-4 border-b border-slate-800 bg-slate-900 flex items-center gap-2">
          <Settings className="text-slate-400" size={18} />
          <h2 className="font-bold text-sm tracking-wider text-slate-200">
            {mode === MODE_MONITOR ? '流程详情' : '属性配置面板'}
          </h2>
        </div>

        {mode === MODE_MONITOR ? (
          <div className="p-5 flex-1 overflow-y-auto space-y-5">
            {!activeMonitorSummary ? (
              <div className="p-4 rounded border border-slate-800 bg-slate-950/50 text-xs text-slate-500 italic">
                暂无可展示的流程批次。新的 daily pipeline 运行完成阶段写入后会出现在这里。
              </div>
            ) : (
              <>
                <div className="monitor-detail-block">
                  <span className="monitor-detail-label">当前批次</span>
                  <div className="font-mono text-xs text-slate-300 break-all">{activeMonitorSummary.runId}</div>
                  <div className="text-[11px] text-slate-500 mt-2">
                    更新于 {formatDateTime(activeMonitorSummary.updatedAt || activeMonitorSummary.startedAt)}
                  </div>
                </div>

                <div className="workflow-detail-card">
                  <div className="workflow-detail-card-head">
                    <span>{activeMonitorSummary.runId}</span>
                    <b>{labelPipelineStatus(activeMonitorSummary.status)}</b>
                  </div>
                  <div className="workflow-detail-rows">
                    <div className="workflow-detail-row">
                      <span>阶段</span>
                      <strong>{labelPipelineStage(activeMonitorSummary.stage)}</strong>
                    </div>
                    <div className="workflow-detail-row">
                      <span>更新时间</span>
                      <strong>{formatDateTime(activeMonitorSummary.updatedAt || activeMonitorSummary.startedAt)}</strong>
                    </div>
                    {activeMonitorSummary.nextAction?.label && (
                      <div className="workflow-detail-row">
                        <span>下一步</span>
                        <strong>{activeMonitorSummary.nextAction.label}</strong>
                      </div>
                    )}
                  </div>
                </div>

                <div className="monitor-detail-grid">
                  <div>
                    <span className="monitor-detail-label">状态</span>
                    <span className={`monitor-status-pill monitor-status-${getSummaryVisualState(activeMonitorSummary)}`}>
                      {labelPipelineStatus(activeMonitorSummary.status)}
                    </span>
                  </div>
                  <div>
                    <span className="monitor-detail-label">阶段</span>
                    <div className="text-sm font-semibold text-slate-200">{labelPipelineStage(activeMonitorSummary.stage)}</div>
                  </div>
                </div>

                <div className={`monitor-alert ${activeMonitorAction.tone === 'warn' ? 'monitor-alert-warning' : ''}`}>
                  <div className="font-bold mb-1">{activeMonitorAction.label}</div>
                  <div>{activeMonitorAction.description}</div>
                </div>

                {activeMonitorSummary.requiresUserAction && (
                  <div className="monitor-alert monitor-alert-warning">
                    <div className="font-bold text-amber-200 mb-1">{activeMonitorSummary.nextActionCode || '需要人工处理'}</div>
                    <div>{activeMonitorSummary.userMessage || '请检查流程输出并继续下一步。'}</div>
                    {(activeMonitorSummary.blockers || []).length > 0 && (
                      <div className="mt-2 font-mono text-[10px] text-amber-100/80">
                        {activeMonitorSummary.blockers.join(', ')}
                      </div>
                    )}
                    {activeMonitorSummary.nextCommand && (
                      <div className="monitor-command mt-2">{activeMonitorSummary.nextCommand}</div>
                    )}
                  </div>
                )}

                <div className="monitor-detail-block">
                  <span className="monitor-detail-label">选中节点</span>
                  <div className="text-sm font-semibold text-slate-200">{selectedMonitorStage.label}</div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    {selectedMonitorStage.stage} · 阶段 {selectedMonitorStage.stageIndex + 1}
                  </div>
                  <div className={`monitor-stage-state monitor-stage-state-${getMonitorNodeStatus(selectedMonitorStage, activeMonitorSummary)}`}>
                    {labelWorkflowNodeStatus(getMonitorNodeStatus(selectedMonitorStage, activeMonitorSummary))}
                  </div>
                </div>

                <div className="monitor-detail-block">
                  <span className="monitor-detail-label">关键计数</span>
                  <div className="monitor-count-list">
                    {Object.entries(activeMonitorSummary.counts || {}).slice(0, 8).map(([key, value]) => (
                      <div key={key} className="monitor-count-row">
                        <span>{key}</span>
                        <b>{value}</b>
                      </div>
                    ))}
                    {Object.keys(activeMonitorSummary.counts || {}).length === 0 && (
                      <div className="text-xs text-slate-500 italic">暂无计数数据</div>
                    )}
                  </div>
                </div>

                {activeMonitorSummary.previews?.generatedProducts?.length > 0 && (
                  <div className="monitor-detail-block">
                    <span className="monitor-detail-label">标题货源预览</span>
                    <div className="space-y-2">
                      {activeMonitorSummary.previews.generatedProducts.slice(0, 3).map((item, index) => (
                        <div key={index} className="monitor-preview-row">
                          {item.title || item.铺货标题 || item.keyword || JSON.stringify(item).slice(0, 80)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : selectedNode ? (
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
                    <strong>{row.value}</strong>
                  </div>
                ))}
              </div>
            </div>

            {selectedNode.data?.status && ['waiting_manual', 'retryable', 'paused', 'blocked', 'failed'].includes(selectedNode.data.status) && selectedNodeCanRecover && (
              <div className="flex gap-2">
                {['retryable', 'failed'].includes(selectedNode.data.status) && (
                  <button
                    type="button"
                    className="secondary-button px-3 py-1.5 text-xs font-semibold w-full"
                    onClick={() => runWorkflowOperation('retry-node', selectedNode.id)}
                  >
                    重试节点
                  </button>
                )}
                {['waiting_manual', 'paused', 'blocked'].includes(selectedNode.data.status) && (
                  <button
                    type="button"
                    className="secondary-button px-3 py-1.5 text-xs font-semibold w-full"
                    onClick={() => runWorkflowOperation('resume', selectedNode.id)}
                  >
                    继续流程
                  </button>
                )}
              </div>
            )}

            <ArtifactPanel state={artifactState} />

            {selectedNode.id === 'start' && activeTemplateMode === 'keyword' && (
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
                  <p className="text-[10px] text-slate-500 mt-1">此词会作为精确关键词流水线的启动参数。</p>
                </div>
              </div>
            )}

            {selectedNode.id === 'start' && activeTemplateMode === 'daily' && (
              <div className="space-y-4 border-t border-slate-800/80 pt-4">
                <div className="text-xs font-bold text-slate-300">每日流水线参数</div>
                <div className="grid grid-cols-2 gap-3">
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
            {isInputNodeType(selectedNode.type) && (
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
            {selectedNode.type === 'keyword-mining' && (
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
            {selectedNode.type === 'title-generator' && (
              <div className="space-y-4 border-t border-slate-800/80 pt-4 text-xs text-slate-400 leading-relaxed">
                <div>此节点将接收上一节点的关键词挖掘结果，合并淘宝与1688竞品数据，通过 GLM 大模型自动编排生成最符合 SEO 权重的高点击率标题。</div>
                <div className="p-3 bg-slate-950/40 rounded border border-emerald-950/40 text-emerald-400/90 text-[11px]">
                  💡 <b>温馨提示：</b>该步骤运行包含 1688 淘系商品抓取与 LLM 管道融合，有完整的 API key 时大约需 15 秒完成；若无 API 则自动秒级降级为高仿模拟数据，确保原型运行成功。
                </div>
              </div>
            )}

            {/* 重置标签 */}
            <div className="border-t border-slate-800/80 pt-4">
              <label className="text-xs font-bold text-slate-300 block mb-2">画布节点标签</label>
              <input
                type="text"
                value={selectedNode.data.label || ''}
                onChange={(e) => updateNodeData(selectedNode.id, 'label', e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-700 bg-slate-950 focus:border-blue-500 focus:outline-none text-slate-100 text-xs transition-all"
              />
            </div>
          </div>
        ) : (
          <div className="p-5 flex-grow flex flex-col justify-center items-center text-slate-500 text-xs italic text-center">
            <Settings size={28} className="text-slate-700 mb-2 animate-pulse" />
            在左侧添加节点，或在中间画布中选中一个节点以展示其高级属性配置。
          </div>
        )}
      </div>

    </div>
  );
}
