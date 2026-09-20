import { parseExactKeywords, parseRootKeywords } from './workflow-launch-params.js';

export const SELECTION_MODES = [
  { mode: 'daily', label: 'AI选词', action: '配置灵感' },
  { mode: 'keyword', label: '精确关键词', action: '输入关键词' },
  { mode: 'root-keyword', label: '词根拓词', action: '输入词根' }
];

/**
 * 获取选词模式的节点摘要。
 * @param {object} data 开始节点配置。
 * @returns {string} 配置摘要。
 */
export function selectionSourceSummary(data = {}) {
  if (data.selectionMode === 'daily') return `已选 ${data.enabledDimensions?.length || 0} 个灵感方向`;
  const words = data.selectionMode === 'keyword'
    ? parseExactKeywords(data.keywordsText ?? data.keywords ?? data.keyword)
    : parseRootKeywords(data.rootsText ?? data.roots);
  if (!words.length) return '尚未录入';
  return `${words.slice(0, 3).join('、')}${words.length > 3 ? '…' : ''} · 共 ${words.length} 个`;
}

/**
 * 用目标模式的图与独立草稿构建模板，不混入另一模式的配置。
 * @param {object} template 统一选品模板。
 * @param {string} mode 目标模式。
 * @param {object} draft 此模式已保存的输入。
 * @returns {object|null} 可加载模板。
 */
export function selectionModeTemplate(template, mode, draft = {}) {
  const variant = template?.selectionModes?.find(item => item.mode === mode);
  if (!variant?.workflow) return null;
  return {
    ...template,
    mode,
    workflow: {
      ...variant.workflow,
      nodes: variant.workflow.nodes.map(node => node.id === 'start'
        ? { ...node, data: { ...node.data, ...draft, selectionMode: mode } }
        : node)
    }
  };
}
