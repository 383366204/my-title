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
    <div className="workflow-console-panel">
      <div className="workflow-console-head">
        <span><FileText size={13} /> 实时运行控制台日志</span>
        <button onClick={onClear} className="text-[10px] text-slate-500 hover:text-slate-300 uppercase tracking-wider font-bold transition-all">
          清空控制台
        </button>
      </div>
      <div id="console-terminal" ref={terminalRef} className="workflow-console-terminal">
        {logs.length === 0 ? (
          <div className="text-slate-600 italic">控制台处于闲置状态。点击“运行工作流”后即可捕获步骤执行的实时流式日志。</div>
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
