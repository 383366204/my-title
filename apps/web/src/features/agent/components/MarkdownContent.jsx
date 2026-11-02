import { useMemo } from 'react';

/**
 * @file MarkdownContent.jsx
 * @description 轻量级零依赖 Markdown 内容渲染组件
 * 解析粗体 (**text**)、行内代码 (`code`)、多级标题、代码块与有序/无序列表
 */

/**
 * 解析单行/片段内的行内 Markdown 样式
 * @param {string} text
 * @returns {Array<import('react').ReactNode>}
 */
function renderInline(text) {
  if (!text) return null;

  // 正则匹配: 行内代码 `...` | 粗体 **...** | 斜体 *...* | 链接 [text](url)
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(regex);

  return parts.map((part, index) => {
    if (!part) return null;

    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code
          key={index}
          className="mx-0.5 rounded border border-slate-700/80 bg-slate-800/90 px-1.5 py-0.5 font-mono text-[11px] text-sky-300 select-text"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={index} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }

    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      return (
        <em key={index} className="italic text-slate-300">
          {part.slice(1, -1)}
        </em>
      );
    }

    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={index}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-400 underline hover:text-sky-300 transition-colors"
        >
          {linkMatch[1]}
        </a>
      );
    }

    return part;
  });
}

export function MarkdownContent({ content, className = '' }) {
  const elements = useMemo(() => {
    if (!content || typeof content !== 'string') return null;

    const lines = content.split('\n');
    const nodes = [];
    let inCodeBlock = false;
    let codeBlockLang = '';
    let codeLines = [];
    let currentList = null; // { type: 'ul' | 'ol', items: [] }

    const flushList = () => {
      if (currentList) {
        if (currentList.type === 'ol') {
          nodes.push(
            <ol key={`ol_${nodes.length}`} className="my-1.5 list-decimal space-y-1 pl-5 text-slate-200">
              {currentList.items.map((it, idx) => (
                <li key={idx} className="leading-relaxed">
                  {renderInline(it)}
                </li>
              ))}
            </ol>
          );
        } else {
          nodes.push(
            <ul key={`ul_${nodes.length}`} className="my-1.5 list-disc space-y-1 pl-5 text-slate-200">
              {currentList.items.map((it, idx) => (
                <li key={idx} className="leading-relaxed">
                  {renderInline(it)}
                </li>
              ))}
            </ul>
          );
        }
        currentList = null;
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // 代码块判定
      if (trimmed.startsWith('```')) {
        flushList();
        if (inCodeBlock) {
          // 结束代码块
          nodes.push(
            <pre
              key={`code_${nodes.length}`}
              className="my-2 max-h-80 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-2.5 font-mono text-[11px] leading-relaxed text-slate-300"
            >
              <code>{codeLines.join('\n')}</code>
            </pre>
          );
          inCodeBlock = false;
          codeLines = [];
        } else {
          // 开始代码块
          inCodeBlock = true;
          codeBlockLang = trimmed.slice(3).trim();
          codeLines = [];
        }
        continue;
      }

      if (inCodeBlock) {
        codeLines.push(line);
        continue;
      }

      // 空行
      if (!trimmed) {
        flushList();
        continue;
      }

      // 标题
      if (trimmed.startsWith('### ')) {
        flushList();
        nodes.push(
          <h5 key={`h5_${nodes.length}`} className="mt-2.5 mb-1 font-bold text-xs text-white">
            {renderInline(trimmed.slice(4))}
          </h5>
        );
        continue;
      }

      if (trimmed.startsWith('## ')) {
        flushList();
        nodes.push(
          <h4 key={`h4_${nodes.length}`} className="mt-3 mb-1.5 font-bold text-sm text-white">
            {renderInline(trimmed.slice(3))}
          </h4>
        );
        continue;
      }

      if (trimmed.startsWith('# ')) {
        flushList();
        nodes.push(
          <h3 key={`h3_${nodes.length}`} className="mt-3.5 mb-2 font-bold text-base text-white">
            {renderInline(trimmed.slice(2))}
          </h3>
        );
        continue;
      }

      // 有序列表 (如 1. 2. 3.)
      const olMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
      if (olMatch) {
        if (!currentList || currentList.type !== 'ol') {
          flushList();
          currentList = { type: 'ol', items: [] };
        }
        currentList.items.push(olMatch[2]);
        continue;
      }

      // 无序列表 (如 - 或 *)
      const ulMatch = trimmed.match(/^[-*]\s+(.*)$/);
      if (ulMatch) {
        if (!currentList || currentList.type !== 'ul') {
          flushList();
          currentList = { type: 'ul', items: [] };
        }
        currentList.items.push(ulMatch[1]);
        continue;
      }

      // 普通段落
      flushList();
      nodes.push(
        <p key={`p_${nodes.length}`} className="my-1 leading-relaxed">
          {renderInline(line)}
        </p>
      );
    }

    if (inCodeBlock && codeLines.length > 0) {
      nodes.push(
        <pre
          key={`code_${nodes.length}`}
          className="my-2 max-h-80 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-2.5 font-mono text-[11px] leading-relaxed text-slate-300"
        >
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
    }

    flushList();
    return nodes;
  }, [content]);

  return <div className={`text-xs space-y-1 ${className}`}>{elements}</div>;
}
