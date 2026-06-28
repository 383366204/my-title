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
  ExternalLink,
  Tag
} from 'lucide-react';

import '@xyflow/react/dist/style.css';
import './App.css';

// ==================== Custom Flow Nodes ====================

// 1. Input Node (输入参数节点)
const InputNode = ({ data }) => {
  const statusColor = {
    idle: 'border-slate-700 bg-slate-900',
    running: 'border-blue-500 bg-slate-900 shadow-[0_0_12px_rgba(59,130,246,0.5)]',
    completed: 'border-emerald-500 bg-slate-900',
    failed: 'border-rose-500 bg-slate-900'
  }[data.status || 'idle'];

  return (
    <div className={`p-4 rounded-xl border-2 w-64 text-slate-100 ${statusColor} transition-all duration-300`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold tracking-wider text-blue-400 uppercase flex items-center gap-1">
          <Layers size={12} /> 输入节点
        </span>
        <span className={`h-2 w-2 rounded-full ${
          data.status === 'running' ? 'bg-blue-500 animate-ping' :
          data.status === 'completed' ? 'bg-emerald-500' :
          data.status === 'failed' ? 'bg-rose-500' : 'bg-slate-500'
        }`} />
      </div>
      <div className="text-sm font-semibold mb-1 truncate text-slate-200">
        关键词: {data.keyword || <span className="text-slate-500 italic">未设置</span>}
      </div>
      <div className="text-xs text-slate-400">
        最大长度: {data.maxLength || 60} 字符
      </div>
      <Handle type="source" position={Position.Right} id="a" style={{ background: '#3b82f6', width: 8, height: 8 }} />
    </div>
  );
};

// 2. Mining Node (关键词挖掘节点)
const MiningNode = ({ data }) => {
  const statusColor = {
    idle: 'border-slate-700 bg-slate-900',
    running: 'border-blue-500 bg-slate-900 shadow-[0_0_12px_rgba(59,130,246,0.5)]',
    completed: 'border-emerald-500 bg-slate-900',
    failed: 'border-rose-500 bg-slate-900'
  }[data.status || 'idle'];

  const keywords = data.output?.keywords || [];

  return (
    <div className={`p-4 rounded-xl border-2 w-64 text-slate-100 ${statusColor} transition-all duration-300`}>
      <Handle type="target" position={Position.Left} id="in" style={{ background: '#3b82f6', width: 8, height: 8 }} />
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold tracking-wider text-indigo-400 uppercase flex items-center gap-1">
          <Database size={12} /> 关键词挖掘
        </span>
        <span className={`h-2 w-2 rounded-full ${
          data.status === 'running' ? 'bg-blue-500 animate-ping' :
          data.status === 'completed' ? 'bg-emerald-500' :
          data.status === 'failed' ? 'bg-rose-500' : 'bg-slate-500'
        }`} />
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
      <Handle type="source" position={Position.Right} id="out" style={{ background: '#3b82f6', width: 8, height: 8 }} />
    </div>
  );
};

// 3. Title Generator Node (标题生成与选品卡片)
const TitleGeneratorNode = ({ data }) => {
  const statusColor = {
    idle: 'border-slate-700 bg-slate-900',
    running: 'border-blue-500 bg-slate-900 shadow-[0_0_12px_rgba(59,130,246,0.5)]',
    completed: 'border-emerald-500 bg-slate-900',
    failed: 'border-rose-500 bg-slate-900'
  }[data.status || 'idle'];

  const result = data.output || {};
  const titles = result.titles || [];
  const product = result.products?.[0] || null;

  return (
    <div className={`p-4 rounded-xl border-2 w-72 text-slate-100 ${statusColor} transition-all duration-300`}>
      <Handle type="target" position={Position.Left} id="in" style={{ background: '#3b82f6', width: 8, height: 8 }} />
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold tracking-wider text-emerald-400 uppercase flex items-center gap-1">
          <Sparkles size={12} /> 标题与选品生成
        </span>
        <span className={`h-2 w-2 rounded-full ${
          data.status === 'running' ? 'bg-blue-500 animate-ping' :
          data.status === 'completed' ? 'bg-emerald-500' :
          data.status === 'failed' ? 'bg-rose-500' : 'bg-slate-500'
        }`} />
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
    </div>
  );
};

// ==================== Node Types Map ====================
const nodeTypes = {
  'keyword-input': InputNode,
  'keyword-mining': MiningNode,
  'title-generator': TitleGeneratorNode
};

const isInputNodeType = (type) => type === 'keyword-input' || type === 'input';
const NODE_LAYOUT = {
  'keyword-input': { x: 80, y: 160 },
  'keyword-mining': { x: 520, y: 160 },
  'title-generator': { x: 980, y: 160 }
};
const NODE_ROW_GAP = 190;

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);

  // 工作流执行状态
  const [currentRunId, setCurrentRunId] = useState(null);
  const [runStatus, setRunStatus] = useState('idle'); // 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'
  const [logs, setLogs] = useState([]);
  const [historyRuns, setHistoryRuns] = useState([]);
  const [templates, setTemplates] = useState([]);

  // 1. 获取模板列表
  const fetchTemplates = async () => {
    try {
      const res = await fetch('/api/workflows/templates');
      const data = await res.json();
      if (data.ok) {
        setTemplates(data.data);
        // 默认加载第一个模板
        if (data.data.length > 0 && nodes.length === 0) {
          loadTemplate(data.data[0]);
        }
      }
    } catch (err) {
      console.error('获取工作流模板失败', err);
    }
  };

  // 2. 获取历史运行记录
  const fetchHistoryRuns = async () => {
    try {
      const res = await fetch('/api/workflows/runs');
      const data = await res.json();
      if (data.ok) {
        setHistoryRuns(data.data);
      }
    } catch (err) {
      console.error('获取运行历史失败', err);
    }
  };

  useEffect(() => {
    fetchTemplates();
    fetchHistoryRuns();
    // The initial boot should run once. The helpers intentionally read the
    // current empty canvas state and then hydrate it from the default template.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 加载工作流模板
  const loadTemplate = (template) => {
    const defaultWorkflow = template.workflow;
    // 重置节点状态为 idle
    const formattedNodes = defaultWorkflow.nodes.map(n => ({
      ...n,
      data: {
        ...n.data,
        status: 'idle',
        output: null,
        error: null
      }
    }));
    setNodes(formattedNodes);
    setEdges(defaultWorkflow.edges.map(e => ({
      ...e,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' },
      style: { stroke: '#3b82f6', strokeWidth: 2 }
    })));
    setSelectedNodeId(null);
    setRunStatus('idle');
    setCurrentRunId(null);
    setLogs([]);
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

  // 选中节点对象
  const selectedNode = useMemo(() => {
    return nodes.find(n => n.id === selectedNodeId) || null;
  }, [nodes, selectedNodeId]);

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
                  error: state.error
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
        const state = nodeStates[node.id];
        if (state) {
          return {
            ...node,
            data: {
              ...node.data,
              status: state.status,
              output: state.output,
              error: state.error
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
        const run = data.data;
        // 把工作流图载入画布
        const defaultWorkflow = run.workflow;

        // 载入节点和边，附带运行时状态
        setNodes(defaultWorkflow.nodes.map(n => {
          const state = run.nodeStates[n.id] || {};
          return {
            ...n,
            data: {
              ...n.data,
              status: state.status || 'idle',
              output: state.output || null,
              error: state.error || null
            }
          };
        }));

        setEdges(defaultWorkflow.edges.map(e => ({
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

    // 格式化工作流的 nodes/edges
    const workflowDef = {
      nodes: nodes.map(n => ({
        id: n.id,
        type: n.type,
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
        body: JSON.stringify({ workflow: workflowDef })
      });
      const validationPayload = await validationRes.json();
      if (!validationPayload.ok) {
        const errors = validationPayload.data?.errors || [{ message: validationPayload.error || '工作流校验失败' }];
        setRunStatus('failed');
        setLogs(errors.map(error => ({
          timestamp: new Date().toISOString(),
          level: 'error',
          message: `[${error.code || 'validation_error'}] ${error.message}`
        })));
        return;
      }

      const res = await fetch('/api/workflows/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow: workflowDef })
      });
      const data = await res.json();

      if (data.ok) {
        const runId = data.data.runId;
        setCurrentRunId(runId);
        // 开始 SSE 监听运行事件
        listenToRunEvents(runId);
      } else {
        alert(`启动失败: ${data.error}`);
        setRunStatus('failed');
      }
    } catch (err) {
      alert(`启动请求失败: ${err.message}`);
      setRunStatus('failed');
    }
  };

  // 取消当前正在执行的工作流
  const handleCancelWorkflow = async () => {
    if (!currentRunId) return;
    try {
      await fetch(`/api/workflows/runs/${currentRunId}/cancel`, {
        method: 'POST'
      });
    } catch (err) {
      console.error('取消工作流失败', err);
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

  // 返回原原生 Web 界面
  const handleGoBack = () => {
    window.location.href = '/index.html';
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 font-sans text-slate-100">

      {/* 1. Left Sidebar: History and Node library */}
      <div className="w-80 border-r border-slate-800 bg-slate-900/60 flex flex-col h-full shrink-0">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900">
          <div className="flex items-center gap-2">
            <Layers className="text-blue-500" size={20} />
            <h1 className="font-bold text-sm tracking-wider text-slate-200">标题生成工作流画布</h1>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-bold">MVP</span>
        </div>

        {/* 节点库 */}
        <div className="p-4 border-b border-slate-800 space-y-3 bg-slate-900/40">
          <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase">节点库 (点击添加)</h2>
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
            <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase mb-2">预设链模板</h2>
            <button
              onClick={() => loadTemplate(templates[0])}
              className="w-full text-left p-2.5 rounded border border-slate-700 bg-slate-800 hover:bg-slate-750 text-xs font-medium flex items-center justify-between transition-all"
            >
              <div>
                <div className="text-slate-200 font-semibold">{templates[0].name}</div>
                <div className="text-[10px] text-slate-400 truncate w-56">{templates[0].description}</div>
              </div>
              <ChevronRight size={14} className="text-slate-500" />
            </button>
          </div>
        )}

        {/* 历史运行列表 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
            <Clock size={12} /> 运行历史
          </h2>
          {historyRuns.length === 0 ? (
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
                      {run.status.toUpperCase()}
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

        {/* 返回原生 web */}
        <div className="p-4 border-t border-slate-800 bg-slate-900">
          <button
            onClick={handleGoBack}
            className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-all"
          >
            返回原生选品页 <ExternalLink size={12} />
          </button>
        </div>
      </div>

      {/* 2. Middle & Right: Canvas, Log panel, and Settings panel */}
      <div className="flex-1 flex flex-col h-full relative">

        {/* 控制工具条 */}
        <div className="h-14 border-b border-slate-800 bg-slate-900 flex justify-between items-center px-6 z-10 shrink-0">
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-400 flex items-center gap-2">
              当前状态:
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                runStatus === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                runStatus === 'failed' ? 'bg-rose-500/10 text-rose-400' :
                runStatus === 'cancelled' ? 'bg-amber-500/10 text-amber-400' :
                runStatus === 'running' ? 'bg-blue-500/10 text-blue-400 animate-pulse' : 'bg-slate-800 text-slate-400'
              }`}>
                {runStatus}
              </span>
            </span>
            {currentRunId && (
              <span className="text-xs font-mono text-slate-500">RunId: {currentRunId}</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {selectedNodeId && (
              <button
                onClick={handleDeleteSelected}
                className="px-3 py-1.5 bg-rose-950/20 hover:bg-rose-950/40 text-rose-300 border border-rose-500/30 hover:border-rose-500 text-xs font-semibold rounded-md flex items-center gap-1 transition-all"
              >
                <Trash2 size={13} /> 删除选中
              </button>
            )}

            {runStatus === 'running' || runStatus === 'pending' ? (
              <button
                onClick={handleCancelWorkflow}
                className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-md flex items-center gap-1.5 shadow-lg shadow-amber-900/20 transition-all"
              >
                <Square size={13} fill="currentColor" /> 终止运行
              </button>
            ) : (
              <button
                onClick={handleRunWorkflow}
                disabled={nodes.length === 0}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold rounded-md flex items-center gap-1.5 shadow-lg shadow-blue-900/20 transition-all"
              >
                <Play size={13} fill="currentColor" /> 运行工作流
              </button>
            )}
          </div>
        </div>

        {/* 画布与日志面板的上下分栏布局 */}
        <div className="flex-1 flex flex-col min-h-0">

          {/* 画布 */}
          <div className="flex-1 bg-slate-950 position-relative min-h-[300px]">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.25, includeHiddenNodes: false, minZoom: 0.7, maxZoom: 1 }}
              minZoom={0.5}
              maxZoom={1.5}
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
          <h2 className="font-bold text-sm tracking-wider text-slate-200">属性配置面板</h2>
        </div>

        {selectedNode ? (
          <div className="p-5 flex-1 overflow-y-auto space-y-6">
            <div>
              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500 block mb-1">
                节点 ID & 类型
              </span>
              <div className="font-mono text-xs text-slate-400 bg-slate-950/50 p-2 rounded border border-slate-800 break-all">
                {selectedNode.id} ({selectedNode.type})
              </div>
            </div>

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
