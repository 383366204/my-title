import { useEffect, useRef } from 'react';
import { FileText } from 'lucide-react';

export function WorkflowConsole({ logs = [], onClear }) {
  const terminalRef = useRef(null);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="workflow-console-panel flex-none basis-[220px] min-h-[180px] max-h-[260px] border-t border-slate-800 bg-[rgba(15,23,42,0.92)] flex flex-col">
      <div className="h-9 shrink-0 border-b border-slate-800 bg-[var(--bg-panel)] flex items-center justify-between px-4">
        <span className="inline-flex items-center gap-1.5 text-[var(--text-muted)] text-xs font-extrabold tracking-wide">
          <FileText size={13} /> 实时运行控制台日志
        </span>
        <button onClick={onClear} className="text-[10px] text-slate-500 hover:text-slate-300 uppercase tracking-wider font-bold transition-all">
          清空控制台
        </button>
      </div>
      <div
        ref={terminalRef}
        className="flex-1 min-h-0 overflow-y-auto bg-[rgba(2,6,23,0.82)] text-[var(--text-subtle)] font-mono text-xs py-3.5 px-4"
      >
        {logs.length === 0 ? (
          <div className="text-slate-600 italic">控制台处于闲置状态。点击"运行工作流"后即可捕获步骤执行的实时流式日志。</div>
        ) : logs.map((log, index) => {
          const levelColors = {
            info: 'text-slate-300',
            warn: 'text-amber-400',
            error: 'text-rose-400 font-semibold'
          }[log.level || 'info'];
          return (
            <div key={`${log.timestamp || ''}-${index}`} className="flex gap-2 leading-relaxed">
              <span className="text-slate-600 shrink-0 select-none">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
              <span className={levelColors}>{log.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
