/**
 * @file contracts.js
 * @description Agent 平台核心契约定义 (ToolDefinition, ToolPolicy, ToolExecutionContext)
 * 符合 ADR v1.0 (D3, D4)
 */

'use strict';

/**
 * @typedef {'low' | 'medium' | 'high'} ToolRiskLevel
 * @typedef {'never' | 'conditional' | 'always'} ToolApprovalRequirement
 * @typedef {'none' | 'read' | 'write'} ToolSideEffect
 *
 * @typedef {Object} ToolPolicy
 * @property {ToolRiskLevel} risk - 风险级别
 * @property {ToolApprovalRequirement} approval - 人工授权要求
 * @property {ToolSideEffect} sideEffect - 副作用分类
 * @property {string[]} resourceKeys - 独占物理资源键（如 ['cdp:9222']）
 * @property {Array<'sycm' | 'taobao' | '1688'>} platforms - 依赖的外部平台
 */

/**
 * @typedef {Object} ToolExecutionContext
 * @property {string} requestId - 客户端全局请求标识
 * @property {string} operationId - 执行器生成的唯一运行实例标识
 * @property {string} caller - 调用方标识 ('cli' | 'mcp' | 'server' | 'agent')
 * @property {AbortSignal} [abortSignal] - 中止控制信号
 * @property {Object} [logger] - 审计与运行日志输出器
 * @property {Object} [lease] - 获取到的跨进程租约对象 (若有)
 * @property {Object} [serverInfo] - 远端服务发现信息 (若有)
 */

/**
 * @typedef {Object} ToolDefinition
 * @property {string} id - 标准工具标识，如 'sycm.query'
 * @property {string} [mcpName] - 兼容现有 MCP 工具名，如 'sycm_query'
 * @property {string} version - 语义化版本号，如 '1.0.0'
 * @property {string} description - 工具功能描述
 * @property {Object|Function} [inputSchema] - Zod schema 或参数校验函数
 * @property {ToolPolicy} policy - 工具策略声明
 * @property {(input: any, ctx: ToolExecutionContext) => Promise<any>} execute - 工具执行函数
 */

/**
 * 创建并归一化 ToolPolicy
 * @param {Partial<ToolPolicy>} [policy={}]
 * @returns {ToolPolicy}
 */
function createToolPolicy(policy = {}) {
  const risk = ['low', 'medium', 'high'].includes(policy.risk) ? policy.risk : 'low';
  const approval = ['never', 'conditional', 'always'].includes(policy.approval) ? policy.approval : 'never';
  const sideEffect = ['none', 'read', 'write'].includes(policy.sideEffect) ? policy.sideEffect : 'none';
  const resourceKeys = Array.isArray(policy.resourceKeys) ? [...new Set(policy.resourceKeys.filter(Boolean))] : [];
  const platforms = Array.isArray(policy.platforms) ? [...new Set(policy.platforms.filter(Boolean))] : [];

  return {
    risk,
    approval,
    sideEffect,
    resourceKeys,
    platforms
  };
}

/**
 * 校验并标准化 ToolDefinition
 * @param {ToolDefinition} def
 * @returns {ToolDefinition}
 */
function validateToolDefinition(def) {
  if (!def || typeof def !== 'object') {
    throw new Error('ToolDefinition 必须是非空对象');
  }
  if (!def.id || typeof def.id !== 'string' || !def.id.trim()) {
    throw new Error('ToolDefinition 缺少有效 id 标识');
  }
  if (def.mcpName && (typeof def.mcpName !== 'string' || !def.mcpName.trim())) {
    throw new Error('ToolDefinition mcpName 必须是非空字符串');
  }
  if (typeof def.execute !== 'function') {
    throw new Error(`工具 [${def.id}] 缺少 execute 执行函数`);
  }

  return {
    id: def.id.trim(),
    mcpName: def.mcpName ? def.mcpName.trim() : undefined,
    version: def.version || '1.0.0',
    description: def.description || '',
    inputSchema: def.inputSchema,
    policy: createToolPolicy(def.policy),
    execute: def.execute
  };
}

module.exports = {
  createToolPolicy,
  validateToolDefinition
};
