import { useState, useRef, useEffect } from 'react';
import {
  Send,
  Square,
  RotateCcw,
  Settings,
  Sparkles,
  Bot,
  User,
  Crosshair,
  AlertCircle
} from 'lucide-react';
import { useAgentChat } from '../hooks/use-agent-chat.js';
import { ThinkingBlock } from './ThinkingBlock.jsx';
import { ToolBadge } from './ToolBadge.jsx';
import { MarkdownContent } from './MarkdownContent.jsx';
import { WorkflowCard } from './cards/WorkflowCard.jsx';
import { ReviewCard } from './cards/ReviewCard.jsx';
import { ApprovalCard } from './cards/ApprovalCard.jsx';
import { ModelSettingsModal } from './ModelSettingsModal.jsx';

const QUICK_PROMPTS = [
  { label: '🚀 启动选品', prompt: '帮我启动一个纯银项链的选品工作流，按标准流程推进。' },
  { label: '📈 查品类趋势', prompt: '查询近期项链饰品类目的热搜词与增长趋势。' },
  { label: '💡 诊断当前节点', prompt: '请根据当前选中的节点和运行状态，给出优化建议。' },
  { label: '🔍 检查生意参谋', prompt: '检查生意参谋连接状态与浏览器 CDP 是否就绪。' }
];

/**
 * @file AgentChatPanel.jsx
 * @description AI 副驾驶对话面板 (右侧栏 Tab 嵌入)
 */
export function AgentChatPanel({
  selectedNodeId,
  selectedNodeLabel,
  currentRunId,
  onSelectStep,
  onInspectStep,
  onHighlightRow
}) {
  const [input, setInput] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  const {
    messages,
    sessionId,
    isStreaming,
    error,
    currentModel,
    setCurrentModel,
    sendMessage,
    stopStream,
    clearChat,
    handleConfirmReview,
    handleGrantApproval,
    handleRejectApproval
  } = useAgentChat({ onSelectStep, onHighlightRow });

  // 消息更新或流式输出时自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  // 自适应文本框高度
  const handleInputChange = (e) => {
    setInput(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  };

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    sendMessage(input, {
      contextNodeId: selectedNodeId,
      currentRunId
    });
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePromptClick = (promptText) => {
    sendMessage(promptText, {
      contextNodeId: selectedNodeId,
      currentRunId
    });
  };

  return (
    <div className="flex h-full flex-col bg-slate-950 text-slate-100 overflow-hidden">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between border-b border-slate-800/80 px-3.5 py-2.5 bg-slate-900/60 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 font-medium text-xs text-white">
            <Bot size={15} className="text-sky-400" />
            <span>AI 副驾驶</span>
          </div>
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-1 rounded bg-slate-800/80 hover:bg-slate-700/80 px-2 py-0.5 text-[10px] font-mono text-slate-300 hover:text-white cursor-pointer transition-colors border border-slate-700/50"
            title="点击切换或配置模型"
          >
            <span>{currentModel || 'glm-4-flash'}</span>
            <Settings size={10} className="text-slate-400" />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={clearChat}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer transition-colors"
            title="清空对话"
          >
            <RotateCcw size={13} />
          </button>
        </div>
      </div>

      {/* 画布上下文条 (如果当前选中节点) */}
      {(selectedNodeId || currentRunId) && (
        <div className="flex items-center justify-between px-3.5 py-1.5 bg-sky-950/30 border-b border-sky-900/30 text-[11px] text-sky-300 shrink-0">
          <div className="flex items-center gap-1.5 truncate">
            <Crosshair size={12} className="text-sky-400 shrink-0" />
            <span className="truncate">
              聚焦节点: <span className="font-semibold text-white">{selectedNodeLabel || selectedNodeId}</span>
              {currentRunId && <span className="text-sky-400/80 font-mono text-[10px] ml-1.5">({currentRunId})</span>}
            </span>
          </div>
        </div>
      )}

      {/* 消息滚动流 */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 text-xs">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 py-8 text-slate-400 space-y-4">
            <div className="rounded-full bg-slate-900 border border-slate-800 p-3 shadow-inner">
              <Sparkles size={24} className="text-sky-400" />
            </div>
            <div>
              <div className="font-medium text-slate-200 text-xs mb-1">
                智能工作流副驾驶就绪
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed max-w-xs">
                你可以通过自然语言控制选品流水线、查询词根热度、诊断节点，或直接执行审核与发布。
              </p>
            </div>

            <div className="w-full space-y-1.5 pt-2">
              <div className="text-[10px] text-slate-500 font-medium">推荐操作:</div>
              <div className="grid grid-cols-1 gap-1.5">
                {QUICK_PROMPTS.map((p, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handlePromptClick(p.prompt)}
                    className="flex items-center gap-1.5 w-full rounded border border-slate-800 bg-slate-900/50 hover:bg-slate-850 px-2.5 py-1.5 text-left text-[11px] text-slate-300 hover:text-white cursor-pointer transition-colors"
                  >
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${
                msg.role === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              {msg.role === 'user' ? (
                <div className="flex items-end gap-1.5 max-w-[85%]">
                  <div className="rounded-2xl rounded-br-xs bg-sky-600 px-3.5 py-2 text-white shadow-md leading-relaxed whitespace-pre-wrap select-text">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col w-full max-w-[100%] space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                    <Bot size={12} className="text-sky-400" />
                    <span>AI 副驾驶</span>
                    {msg.timestamp && <span>{msg.timestamp}</span>}
                  </div>

                  {/* 深度思考面板 */}
                  {Boolean(msg.thinking || msg.isThinking) && (
                    <ThinkingBlock
                      text={msg.thinking}
                      isStreaming={msg.isThinking}
                      durationSeconds={msg.durationSeconds}
                    />
                  )}

                  {/* 工具调用状态徽章 */}
                  {Array.isArray(msg.toolCalls) &&
                    msg.toolCalls.map((tc) => (
                      <ToolBadge key={tc.id} toolCall={tc} />
                    ))}

                  {/* 回复文本内容 */}
                  {Boolean(msg.content) && (
                    <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-3 text-slate-200 leading-relaxed select-text">
                      <MarkdownContent content={msg.content} />
                      {isStreaming && msg.id === messages[messages.length - 1]?.id && (
                        <span className="inline-block w-1.5 h-3.5 ml-1 bg-sky-400 animate-pulse align-middle" />
                      )}
                    </div>
                  )}

                  {/* 结构化卡片协议 (WorkflowCard / ReviewCard / ApprovalCard) */}
                  {Array.isArray(msg.cards) &&
                    msg.cards.map((card, idx) => {
                      if (card.type === 'WorkflowCard') {
                        return (
                          <WorkflowCard
                            key={idx}
                            card={card}
                            onSelectStep={onSelectStep}
                          />
                        );
                      }
                      if (card.type === 'ReviewCard') {
                        return (
                          <ReviewCard
                            key={idx}
                            card={card}
                            onConfirmReview={handleConfirmReview}
                            onInspectStep={onInspectStep || onSelectStep}
                          />
                        );
                      }
                      if (card.type === 'ApprovalCard') {
                        return (
                          <ApprovalCard
                            key={idx}
                            card={card}
                            onGrantApproval={handleGrantApproval}
                            onRejectApproval={handleRejectApproval}
                            onInspectStep={onInspectStep || onSelectStep}
                          />
                        );
                      }
                      return null;
                    })}

                  {/* 正在运行中的实时动态 Loading 指示器 (让用户直观看到正在运行中) */}
                  {isStreaming && msg.id === messages[messages.length - 1]?.id && (
                    <div className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-sky-950/20 border border-sky-900/30 text-xs text-sky-400 select-none">
                      <span className="flex gap-1 items-center">
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                      </span>
                      <span className="text-[11px] text-slate-300 font-mono">
                        {(msg.toolCalls || []).some((tc) => tc.status === 'running')
                          ? `正在执行 ${(msg.toolCalls || []).find((tc) => tc.status === 'running')?.name}...`
                          : msg.isThinking
                          ? 'AI 正在深度思考中...'
                          : 'AI 正在分析并组织回复...'}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}

        {/* 错误提示横幅 */}
        {error && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-xs">
            <AlertCircle size={14} className="shrink-0 text-rose-400" />
            <span className="flex-1">{error}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 底部输入框区 */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-900/40 shrink-0">
        <div className="relative rounded-lg border border-slate-700 bg-slate-950 p-1.5 focus-within:border-sky-500 transition-colors">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={
              selectedNodeId
                ? `问问 AI 关于节点 [${selectedNodeLabel || selectedNodeId}]...`
                : '输入自然语言指令或问题 (Enter 发送)...'
            }
            className="w-full resize-none bg-transparent px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-hidden max-h-32 leading-relaxed"
          />

          <div className="flex items-center justify-between px-2 pt-1 border-t border-slate-800/40">
            <div className="text-[10px] text-slate-500">
              Shift+Enter 换行
            </div>

            <div className="flex items-center gap-1.5">
              {isStreaming ? (
                <button
                  type="button"
                  onClick={stopStream}
                  className="flex items-center gap-1 rounded bg-rose-600/80 hover:bg-rose-500 px-2.5 py-1 text-[11px] font-medium text-white cursor-pointer transition-colors"
                >
                  <Square size={11} />
                  <span>停止</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!input.trim()}
                  onClick={handleSend}
                  className="flex items-center gap-1 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:hover:bg-sky-600 px-2.5 py-1 text-[11px] font-medium text-white cursor-pointer transition-colors"
                >
                  <Send size={11} />
                  <span>发送</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 动态模型配置模态框 */}
      <ModelSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSettingsUpdated={(updated) => {
          if (updated?.model) setCurrentModel(updated.model);
        }}
      />
    </div>
  );
}
