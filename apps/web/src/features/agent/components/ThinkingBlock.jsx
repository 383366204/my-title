import { useState } from 'react';
import { ChevronDown, ChevronRight, Brain, Loader2 } from 'lucide-react';

/**
 * @file ThinkingBlock.jsx
 * @description 深度思考折叠面板组件 (SSE thinking:chunk / <think> 提取内容)
 */
export function ThinkingBlock({ text, isStreaming = false, durationSeconds }) {
  const [collapsed, setCollapsed] = useState(false);

  if (!text && !isStreaming) return null;

  return (
    <div className="my-2 rounded-lg border border-indigo-900/40 bg-indigo-950/20 text-xs overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-indigo-300 hover:text-indigo-200 hover:bg-indigo-900/20 cursor-pointer select-none transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <Brain size={13} className="text-indigo-400" />
          <span className="font-medium text-[11px]">
            {isStreaming ? '正在深度思考...' : '思考过程'}
          </span>
          {isStreaming && <Loader2 size={11} className="animate-spin text-indigo-400" />}
          {durationSeconds !== undefined && durationSeconds > 0 && !isStreaming && (
            <span className="text-[10px] text-slate-400">({durationSeconds}s)</span>
          )}
        </div>
        <div className="text-slate-400 hover:text-slate-200">
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </div>
      </button>

      {!collapsed && (
        <div className="px-3 py-2 border-t border-indigo-900/30 font-mono text-[11px] leading-relaxed text-slate-300 whitespace-pre-wrap max-h-60 overflow-y-auto">
          {text}
          {isStreaming && (
            <span className="inline-block w-1.5 h-3 ml-0.5 bg-indigo-400 animate-pulse align-middle" />
          )}
        </div>
      )}
    </div>
  );
}
