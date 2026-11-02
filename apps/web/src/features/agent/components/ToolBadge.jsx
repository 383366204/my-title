import { useState } from 'react';
import { Wrench, CheckCircle2, AlertTriangle, Loader2, ChevronDown, ChevronRight } from 'lucide-react';

const TOOL_DISPLAY_NAMES = {
  workflow_start: '启动选品工作流',
  workflow_status: '查询流程状态',
  workflow_resume: '恢复流程推进',
  workflow_submit_review: '提交业务复核',
  workflow_cancel: '取消工作流',
  sycm_query: '生意参谋查询',
  sycm_status: '生意参谋状态',
  suggest_keywords: '选词策略挖掘',
  generate_title: '生成标题',
  batch_generate_titles: '批量生成标题',
  discover_peers: '以货找店/同行发现',
  trend: '品类趋势分析',
  opportunities: '1688热榜商机'
};

/**
 * @file ToolBadge.jsx
 * @description Agent 工具调用状态徽章 (tool:call / tool:result / tool:error)
 */
export function ToolBadge({ toolCall }) {
  const [expanded, setExpanded] = useState(false);

  if (!toolCall) return null;

  const { name, input, result, error, status, durationMs } = toolCall;
  const isRunning = status === 'running';
  const isError = status === 'error' || Boolean(error);
  const isSuccess = status === 'success' || (Boolean(result) && !isError);

  const displayName = TOOL_DISPLAY_NAMES[name] || name;

  return (
    <div className="my-1.5 rounded border border-slate-800 bg-slate-900/70 text-xs overflow-hidden">
      <div
        className="flex items-center justify-between px-2.5 py-1.5 cursor-pointer hover:bg-slate-800/40 select-none transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-1.5">
          {isRunning ? (
            <Loader2 size={12} className="animate-spin text-sky-400" />
          ) : isError ? (
            <AlertTriangle size={12} className="text-rose-400" />
          ) : (
            <CheckCircle2 size={12} className="text-emerald-400" />
          )}

          <span className="font-mono text-[11px] text-slate-300">
            {displayName}
          </span>

          {durationMs !== undefined && durationMs > 0 && (
            <span className="text-[10px] text-slate-500 font-mono">
              {durationMs}ms
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 text-slate-500 hover:text-slate-300">
          <span className="text-[10px]">
            {isRunning ? '执行中...' : isError ? '异常' : '详情'}
          </span>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </div>
      </div>

      {expanded && (
        <div className="px-2.5 py-2 border-t border-slate-800/80 bg-black/30 font-mono text-[11px] space-y-1.5 max-h-48 overflow-y-auto">
          {input && (
            <div>
              <div className="text-[10px] text-slate-500 font-sans">输入参数:</div>
              <pre className="text-slate-300 text-[10px] overflow-x-auto whitespace-pre-wrap">
                {typeof input === 'string' ? input : JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}

          {error && (
            <div>
              <div className="text-[10px] text-rose-400 font-sans">错误信息:</div>
              <pre className="text-rose-300 text-[10px] whitespace-pre-wrap">{error}</pre>
            </div>
          )}

          {result && !error && (
            <div>
              <div className="text-[10px] text-emerald-400 font-sans">返回摘要:</div>
              <pre className="text-slate-300 text-[10px] overflow-x-auto whitespace-pre-wrap">
                {typeof result === 'string'
                  ? result
                  : JSON.stringify(result, null, 2).slice(0, 500) + (JSON.stringify(result).length > 500 ? '...' : '')}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
