import {
  Background,
  Controls,
  MiniMap,
  ReactFlow
} from '@xyflow/react';
import { CopyPlus, Play, Square } from 'lucide-react';

import { isWorkflowInputNodeType, labelWorkflowNodeStatus } from '../../../workflow-ui.js';
import { nodeTypes } from '../workflow-node-types.js';

const isInputNodeType = isWorkflowInputNodeType;

export function WorkflowCanvasWorkspace({
  activeTemplateLabel,
  canCancelRun,
  canPauseRun,
  currentRunId,
  edges,
  isRunActive,
  isViewingRun,
  nodes,
  onCancel,
  onEdgesChange,
  onNodeClick,
  onNodesChange,
  onPause,
  onPrepareNewRun,
  onRun,
  onSelectNode,
  orderedWorkflowNodes,
  runStatus,
  selectedNodeId,
  selectedNodeLabel
}) {
  return (
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
                    onClick={onPause}
                  >
                    暂停
                  </button>
                )}
                <button
                  onClick={onCancel}
                  disabled={!canCancelRun}
                  className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-md flex items-center gap-1.5 shadow-lg shadow-amber-900/20 transition-all"
                >
                  <Square size={13} fill="currentColor" /> 取消运行
                </button>
              </>
            ) : (
              isViewingRun ? (
                <button
                  type="button"
                  onClick={onPrepareNewRun}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-md flex items-center gap-1.5 shadow-lg shadow-blue-900/20 transition-all"
                >
                  <CopyPlus size={13} /> 按此配置新建
                </button>
              ) : (
                <button
                  onClick={onRun}
                  disabled={nodes.length === 0}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold rounded-md flex items-center gap-1.5 shadow-lg shadow-blue-900/20 transition-all"
                >
                  <Play size={13} fill="currentColor" /> 运行工作流
                </button>
              )
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
                onClick={() => onSelectNode(node.id)}
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
  );
}
