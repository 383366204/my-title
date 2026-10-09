import {
  Background,
  Controls,
  MiniMap,
  ReactFlow
} from '@xyflow/react';
import { Play, RotateCcw, Settings2, Square } from 'lucide-react';

import { isWorkflowInputNodeType } from '../workflow-launch-params.js';
import { labelWorkflowNodeStatus } from '../workflow-node-view.js';
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
  onRepeatRun,
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
                <>
                  <button
                    type="button"
                    onClick={() => onPrepareNewRun()}
                    className="secondary-button px-3 py-1.5 text-xs font-semibold"
                  >
                    <Settings2 size={13} /> 新建并调整
                  </button>
                  <button
                    type="button"
                    onClick={onRepeatRun}
                    disabled={nodes.length === 0}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold rounded-md flex items-center gap-1.5 shadow-lg shadow-blue-900/20 transition-all"
                  >
                    <RotateCcw size={13} /> {nodes.some(node => node.data?.selectionMode) ? '再选一批' : '再次运行'}
                  </button>
                </>
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
          <div className="flex items-center gap-2 min-h-[48px] py-2 px-4 border-b border-slate-800 bg-slate-950/[0.92] overflow-x-auto shrink-0" aria-label="流程顺序">
            {orderedWorkflowNodes.map((node, index, all) => {
              const isActive = selectedNodeId === node.id;
              return (
                <button
                  type="button"
                  key={node.id}
                  data-testid="workflow-order-step"
                  className={`shrink-0 inline-flex items-center gap-[7px] min-h-[30px] max-w-[180px] py-[5px] px-[9px] border rounded-lg bg-slate-900/80 transition-colors duration-[160ms] ${
                    isActive
                      ? 'border-blue-500/75 bg-blue-900/[0.28] text-[#e2e8f0]'
                      : 'border-slate-700/[0.95] text-[#94a3b8] hover:border-blue-500/75 hover:bg-blue-900/[0.28] hover:text-[#e2e8f0]'
                  }`}
                  onClick={() => onSelectNode(node.id)}
                >
                  <span className={`shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-black ${
                    isActive ? 'bg-blue-600 text-white' : 'bg-slate-800 text-blue-200'
                  }`}>{node.data?.stepIndex || index + 1}</span>
                  <strong className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-extrabold">{node.data?.label || node.id}</strong>
                  {index < all.length - 1 && <span className="shrink-0 ml-0.5 text-slate-600 text-xs">→</span>}
                </button>
              );
            })}
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
