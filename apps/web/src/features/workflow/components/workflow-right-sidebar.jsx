import { useEffect, useRef } from 'react';
import { ChevronLeft, FileCode2, Settings } from 'lucide-react';

import { getWorkflowNodeDetailRows, getWorkflowNodeViewModel } from '../workflow-node-view.js';

export function WorkflowRightSidebar({ collapsed, isViewingRun, onToggle, selectedNode }) {
  const detailScrollRef = useRef(null);

  useEffect(() => {
    detailScrollRef.current?.scrollTo({ top: 0 });
  }, [selectedNode?.id]);

  return (
    <aside className={`w-[360px] max-w-[38vw] border-l border-slate-800 bg-slate-900/40 flex flex-col h-full shrink-0 workflow-right-sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      <button
        type="button"
        className="workflow-sidebar-toggle"
        title={collapsed ? '展开节点诊断' : '收起节点诊断'}
        aria-label={collapsed ? '展开节点诊断' : '收起节点诊断'}
        onClick={onToggle}
      >
        <ChevronLeft size={15} className={collapsed ? '' : 'rotate-180'} />
      </button>
      <div className="p-4 border-b border-slate-800 bg-slate-900 flex items-center gap-2">
        <Settings className="text-slate-400" size={18} />
        <div>
          <h2 className="font-bold text-sm tracking-wider text-slate-200">节点诊断</h2>
          <p className="text-[#64748b] text-[10px] leading-[1.45] mt-[3px]">业务操作请直接使用画布节点按钮</p>
        </div>
      </div>

      {selectedNode ? (
        <div ref={detailScrollRef} className="p-4 flex-1 overflow-y-auto space-y-4">
          <div className="grid gap-2.5 p-3 border border-white/[0.08] rounded-lg bg-slate-900/[0.62]">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[#f3f4f6] font-bold">{selectedNode.data?.label || selectedNode.id}</span>
              <b className="text-[#9ca3af] text-[11px]">{getWorkflowNodeViewModel(selectedNode.id, selectedNode.data).statusLabel}</b>
            </div>
            <div className="grid gap-[7px]">
              <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 items-start text-xs">
                <span className="text-[#94a3b8]">节点标识</span>
                <strong className="min-w-0 text-[#9ca3af] font-medium break-all">{selectedNode.id}</strong>
              </div>
              <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 items-start text-xs">
                <span className="text-[#94a3b8]">节点类型</span>
                <strong className="min-w-0 text-[#9ca3af] font-medium break-all">{selectedNode.data?.originalType || selectedNode.type}</strong>
              </div>
              {getWorkflowNodeDetailRows(selectedNode).map((row) => (
                <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 items-start text-xs" key={row.label}>
                  <span className="text-[#94a3b8]">{row.label}</span>
                  <strong className={`min-w-0 text-[#9ca3af] font-medium break-all ${row.label === '产物位置' ? 'font-mono' : ''}`}>{row.value}</strong>
                </div>
              ))}
            </div>
          </div>

          {isViewingRun && (
            <div className="flex items-start gap-[7px] m-0 border border-blue-500/30 rounded-[7px] bg-blue-900/[0.12] text-[#bfdbfe] text-[11px] leading-[1.55] p-2.5">
              <FileCode2 size={15} />
              <span>正在查看历史运行，诊断信息来自该次运行快照。</span>
            </div>
          )}
        </div>
      ) : (
        <div className="p-5 flex-grow flex flex-col justify-center items-center text-slate-500 text-xs text-center">
          <Settings size={28} className="text-slate-700 mb-2" />
          点击画布节点查看状态和诊断信息。
        </div>
      )}
    </aside>
  );
}
