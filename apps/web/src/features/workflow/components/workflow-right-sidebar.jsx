import { useEffect, useRef } from 'react';
import { ChevronLeft, FileCode2, Settings } from 'lucide-react';

import { getWorkflowNodeDetailRows, getWorkflowNodeViewModel } from '../../../workflow-ui.js';

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
          <p className="workflow-diagnostic-caption">业务操作请直接使用画布节点按钮</p>
        </div>
      </div>

      {selectedNode ? (
        <div ref={detailScrollRef} className="p-4 flex-1 overflow-y-auto space-y-4">
          <div className="workflow-detail-card">
            <div className="workflow-detail-card-head">
              <span>{selectedNode.data?.label || selectedNode.id}</span>
              <b>{getWorkflowNodeViewModel(selectedNode.id, selectedNode.data).statusLabel}</b>
            </div>
            <div className="workflow-detail-rows">
              <div className="workflow-detail-row">
                <span>节点标识</span>
                <strong>{selectedNode.id}</strong>
              </div>
              <div className="workflow-detail-row">
                <span>节点类型</span>
                <strong>{selectedNode.data?.originalType || selectedNode.type}</strong>
              </div>
              {getWorkflowNodeDetailRows(selectedNode).map((row) => (
                <div className="workflow-detail-row" key={row.label}>
                  <span>{row.label}</span>
                  <strong className={row.label === '产物位置' ? 'workflow-diagnostic-path' : ''}>{row.value}</strong>
                </div>
              ))}
            </div>
          </div>

          {isViewingRun && (
            <div className="workflow-diagnostic-notice">
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
