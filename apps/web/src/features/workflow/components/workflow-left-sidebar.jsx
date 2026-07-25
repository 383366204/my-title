import { ChevronLeft, Layers } from 'lucide-react';

import { WorkflowHistory } from './workflow-history.jsx';

export function WorkflowLeftSidebar({
  collapsed,
  currentRunId,
  deletingRunId,
  historyError,
  historyLoading,
  historyRuns,
  templates,
  activeTemplateId,
  activeTemplate,
  activeTemplateView,
  onToggle,
  onLoadTemplate,
  onDeleteRun,
  onOpenRun,
  onRefreshRuns
}) {
  return (
<div className={`w-80 border-r border-slate-800 bg-slate-900/60 flex flex-col h-full shrink-0 workflow-left-sidebar ${collapsed ? 'is-collapsed' : ''}`}>
        <button
          type="button"
          className="workflow-sidebar-toggle"
          title={collapsed ? '展开选品流水线' : '收起选品流水线'}
          aria-label={collapsed ? '展开选品流水线' : '收起选品流水线'}
          onClick={onToggle}
        >
          <ChevronLeft size={15} className={collapsed ? 'rotate-180' : ''} />
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
                if (template) onLoadTemplate(template);
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

        <WorkflowHistory
          currentRunId={currentRunId}
          deletingRunId={deletingRunId}
          error={historyError}
          loading={historyLoading}
          runs={historyRuns}
          onDelete={onDeleteRun}
          onOpen={onOpenRun}
          onRefresh={onRefreshRuns}
        />

      </div>
  );
}
