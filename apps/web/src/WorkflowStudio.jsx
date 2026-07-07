import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  getStartNodeParams,
  getWorkflowBlockerActions,
  getWorkflowArtifactView,
  getWorkflowLaunchBlocker,
  getWorkflowNodeDetailRows,
  getWorkflowNodeViewModel,
  getWorkflowOperationMessage,
  getWorkflowRunActiveNodeId,
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

const getTemplateMode = (template) => template?.mode || template?.workflow?.mode || DEFAULT_WORKFLOW_MODE;

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
      nextRecommendedAction: node.data?.nextRecommendedAction || null,
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
  const view = getWorkflowArtifactView(artifact, state.nodeId);

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
        <div className="artifact-empty">{state.error || view.emptyText}</div>
      )}
      {state.status === 'ready' && artifact && view.kind === 'candidate-list' && (
        <div className="artifact-candidate-list">
          {view.rows.length === 0 ? (
            <div className="artifact-empty">{view.emptyText}</div>
          ) : view.rows.map((item, index) => (
            <div className="artifact-candidate-row" key={`${item.title}-${index}`}>
              <strong>{item.title}</strong>
              {item.meta && <span>{item.meta}</span>}
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

const formatDateTime = (value) => {
  if (!value) return '未知时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

export default function WorkflowStudio({ initialMode: _initialMode, onNavigate }) {
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
    fetch(`/api/workflows/runs/${currentRunId}/artifacts/${selectedNodeId}`)
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

  // 选中节点对象
  const selectedNode = useMemo(() => {
    return nodes.find(n => n.id === selectedNodeId) || null;
  }, [nodes, selectedNodeId]);

  const isRunActive = runStatus === 'running' || runStatus === 'pending';
  const isViewingRun = Boolean(currentRunId);
  const canCancelRun = Boolean(currentRunId) && isRunActive;
  const canPauseRun = Boolean(currentRunId) && runStatus === 'running';
  const selectedNodeCanRecover = Boolean(currentRunId && selectedNode) && (
    isLegacyWorkflowRun(currentRunId)
    || isPipelineRecoverableNode(selectedNode.id)
  );
  const selectedNodeBlockerActions = useMemo(() => {
    if (!selectedNode?.data?.status || !selectedNodeCanRecover) return [];
    return getWorkflowBlockerActions(selectedNode.id, selectedNode.data);
  }, [selectedNode, selectedNodeCanRecover]);

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
                  nextRecommendedAction: state.nextRecommendedAction || null,
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
              nextRecommendedAction: state.nextRecommendedAction || null,
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
      const defaultWorkflow = run.workflow || { nodes: [], edges: [] };

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
            nextRecommendedAction: state.nextRecommendedAction || null,
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

  const runBlockerAction = async (action, nodeId) => {
    if (action === 'mine-more') {
      onNavigate?.('mine');
      const message = '已切到挖词选品页。补充候选词后回到流程画布重跑验真。';
      setLogs((prev) => [...prev, {
        timestamp: new Date().toISOString(),
        level: 'info',
        message
      }]);
      return;
    }
    if (action === 'retry-node') {
      await runWorkflowOperation('retry-node', nodeId);
      return;
    }
    if (action === 'resume' || action === 'resume-after-manual' || action === 'continue-or-fix-sycm') {
      await runWorkflowOperation('resume', nodeId);
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
              工作流中心
            </h1>
          </div>
          <div className="text-[11px] leading-relaxed text-slate-400">
            同一张真实流程图里查看运行、处理阻塞和调整参数。
          </div>
        </div>

        {/* 节点库 */}
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

        {/* 模板加载 */}
        {templates.length > 0 && (
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
                <button
                  key={item.runId}
                  onClick={() => loadHistoryRun(item.runId)}
                  className={`monitor-run-card ${currentRunId === item.runId ? 'monitor-run-card-active' : ''}`}
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
                );
              })}
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
            {currentRunId && (
              <span className="text-xs font-mono text-slate-500">RunId: {currentRunId}</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {selectedNodeId && !isViewingRun && (
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
                disabled={nodes.length === 0 || isViewingRun}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold rounded-md flex items-center gap-1.5 shadow-lg shadow-blue-900/20 transition-all"
              >
                <Play size={13} fill="currentColor" /> {isViewingRun ? '历史运行只读' : '运行工作流'}
              </button>
            )}
          </div>
        </div>

        {/* 画布与日志面板的上下分栏布局 */}
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
                onConnect={onConnect}
                onNodeClick={onNodeClick}
                nodeTypes={nodeTypes}
                defaultViewport={{ x: 0, y: 0, zoom: 0.82 }}
                minZoom={0.5}
                maxZoom={1.5}
                style={{ width: '100%', height: '100%' }}
                nodesDraggable={!isViewingRun}
                nodesConnectable={!isViewingRun}
                edgesReconnectable={!isViewingRun}
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

          {/* 底部控制台日志面板 */}
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

        </div>

      </div>

      {/* 3. Right Property Panel */}
      <div className="w-80 border-l border-slate-800 bg-slate-900/40 flex flex-col h-full shrink-0">
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
                    <strong>{row.value}</strong>
                  </div>
                ))}
              </div>
            </div>

            {selectedNodeBlockerActions.length > 0 && (
              <div className="workflow-blocker-actions">
                {selectedNodeBlockerActions.map((action) => (
                  <button
                    type="button"
                    className="workflow-blocker-action"
                    key={`${action.action}-${action.label}`}
                    onClick={() => runBlockerAction(action.action, selectedNode.id)}
                  >
                    <span>{action.label}</span>
                    {action.description && <small>{action.description}</small>}
                  </button>
                ))}
              </div>
            )}

            <ArtifactPanel state={artifactState} />

            {isViewingRun && (
              <div className="p-3 rounded border border-slate-800 bg-slate-950/50 text-[11px] leading-relaxed text-slate-400">
                当前正在查看历史运行。节点状态、产物和恢复动作可以查看，参数编辑请先从左侧选择流程模板。
              </div>
            )}

            {!isViewingRun && selectedNode.id === 'start' && activeTemplateMode === 'keyword' && (
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

            {!isViewingRun && selectedNode.id === 'start' && activeTemplateMode === 'daily' && (
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
            在左侧添加节点，或在中间画布中选中一个节点以展示其高级属性配置。
          </div>
        )}
      </div>

    </div>
  );
}
