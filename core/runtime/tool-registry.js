/**
 * @file tool-registry.js
 * @description 轻量级工具注册表，维护工具定义双索引 (id & mcpName)
 * 符合 ADR v1.0 (D3)
 */

'use strict';

const { validateToolDefinition } = require('./contracts');

/**
 * 创建工具注册表实例
 * @returns {Object}
 */
function createToolRegistry() {
  /** @type {Map<string, import('./contracts').ToolDefinition>} */
  const toolsById = new Map();
  /** @type {Map<string, import('./contracts').ToolDefinition>} */
  const toolsByMcpName = new Map();

  /**
   * 注册工具
   * @param {import('./contracts').ToolDefinition} def
   * @returns {import('./contracts').ToolDefinition}
   */
  function register(def) {
    const validated = validateToolDefinition(def);

    if (toolsById.has(validated.id)) {
      throw new Error(`工具 ID 冲突: [${validated.id}] 已注册`);
    }

    if (validated.mcpName) {
      if (toolsByMcpName.has(validated.mcpName)) {
        throw new Error(`MCP 工具名冲突: [${validated.mcpName}] 已被工具 [${toolsByMcpName.get(validated.mcpName).id}] 占用`);
      }
      toolsByMcpName.set(validated.mcpName, validated);
    }

    toolsById.set(validated.id, validated);
    return validated;
  }

  /**
   * 根据规范 ID 或 MCP 别名获取工具定义
   * @param {string} idOrName
   * @returns {import('./contracts').ToolDefinition|null}
   */
  function get(idOrName) {
    if (!idOrName || typeof idOrName !== 'string') return null;
    const key = idOrName.trim();
    return toolsById.get(key) || toolsByMcpName.get(key) || null;
  }

  /**
   * 判断工具是否存在
   * @param {string} idOrName
   * @returns {boolean}
   */
  function has(idOrName) {
    return Boolean(get(idOrName));
  }

  /**
   * 列出所有已注册工具清单
   * @returns {import('./contracts').ToolDefinition[]}
   */
  function list() {
    return Array.from(toolsById.values());
  }

  /**
   * 清理注册表（仅供测试套件使用）
   */
  function _clear() {
    toolsById.clear();
    toolsByMcpName.clear();
  }

  return {
    register,
    get,
    has,
    list,
    _clear
  };
}

module.exports = {
  createToolRegistry
};
