/**
 * @file taobao-opc-tools.js
 * @description taobao_opc.list_tools 与 taobao_opc.call 原子工具定义
 * 符合 ADR v1.0 (D3, D4)
 */

'use strict';

const { z } = require('zod');
const taobaoOpc = require('./mcp-client');

const listToolsSchema = z.object({
  timeout_ms: z.number().int().positive().optional().default(60000).describe('请求超时时间，毫秒，默认 60000')
});

/** @type {import('../../../core/runtime/contracts').ToolDefinition} */
const taobaoOpcListTools = {
  id: 'taobao_opc.list_tools',
  mcpName: 'taobao_opc_list_tools',
  version: '1.0.0',
  description: '列出远端淘宝 OPC/OPT 图片服务 MCP 网关暴露的工具。首次接入或调用新工具前先用它查看 inputSchema。',
  inputSchema: listToolsSchema,
  policy: {
    risk: 'low',
    approval: 'never',
    sideEffect: 'read',
    resourceKeys: [],
    platforms: ['taobao']
  },
  execute: async (input) => {
    const timeoutMs = input.timeout_ms || 60000;
    const tools = await taobaoOpc.listTools({ timeoutMs });
    return { ok: true, tools };
  }
};

const callToolSchema = z.object({
  tool: z.string().min(1, 'tool 不能为空').describe('远端 MCP 工具名，例如 query_item_more_info'),
  arguments: z.record(z.string(), z.any()).optional().default({}).describe('远端工具参数，必须符合远端 inputSchema'),
  timeout_ms: z.number().int().positive().optional().default(60000).describe('请求超时时间，毫秒，默认 60000')
});

/** @type {import('../../../core/runtime/contracts').ToolDefinition} */
const taobaoOpcCall = {
  id: 'taobao_opc.call',
  mcpName: 'taobao_opc_call',
  version: '1.0.0',
  description: '调用远端淘宝 OPC/OPT 图片服务 MCP 工具。调用前请先用 taobao_opc_list_tools 查看目标工具 inputSchema。',
  inputSchema: callToolSchema,
  policy: {
    risk: 'medium',
    approval: 'never',
    sideEffect: 'write',
    resourceKeys: [],
    platforms: ['taobao']
  },
  execute: async (input) => {
    const { tool, arguments: toolArguments = {}, timeout_ms: timeoutMs = 60000 } = input;
    const result = await taobaoOpc.callTool(tool, toolArguments, { timeoutMs });
    return {
      ok: !result.isError,
      result,
      normalizedContent: taobaoOpc.normalizeToolContent(result)
    };
  }
};

module.exports = {
  taobaoOpcListTools,
  taobaoOpcCall
};
