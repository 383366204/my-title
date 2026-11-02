/**
 * @file llm-tool-calling.test.js
 * @description 通用 Tool Calling 协议与异构参数清洗单元测试
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { z } = require('zod');

const LLMClient = require('../../../core/llm-client');
const {
  normalizeToolDefinitions,
  normalizeToolCalls
} = LLMClient;

describe('Universal Tool Calling Unit Tests', () => {
  describe('normalizeToolDefinitions', () => {
    it('should convert ToolDefinition with Zod schema to OpenAI function format', () => {
      const toolDef = {
        id: 'workflow.start',
        mcpName: 'workflow_start',
        description: '启动工作流',
        inputSchema: z.object({
          mode: z.enum(['daily', 'keyword']).describe('运行模式'),
          count: z.number().int().optional().default(3).describe('数量')
        })
      };

      const normalized = normalizeToolDefinitions([toolDef]);
      assert.equal(normalized.length, 1);
      assert.equal(normalized[0].type, 'function');
      assert.equal(normalized[0].function.name, 'workflow_start');
      assert.equal(normalized[0].function.description, '启动工作流');
      assert.equal(normalized[0].function.parameters.type, 'object');
      assert.ok(normalized[0].function.parameters.properties.mode);
      assert.ok(normalized[0].function.parameters.properties.count);
      assert.equal(normalized[0].function.parameters.$schema, undefined);
    });

    it('should preserve already formatted OpenAI function schema', () => {
      const openAiTool = {
        type: 'function',
        function: {
          name: 'custom_tool',
          description: 'custom description',
          parameters: { type: 'object', properties: { q: { type: 'string' } } }
        }
      };

      const normalized = normalizeToolDefinitions([openAiTool]);
      assert.deepEqual(normalized[0], openAiTool);
    });
  });

  describe('normalizeToolCalls', () => {
    it('should assign fallback ID if missing', () => {
      const raw = [{
        function: { name: 'test_tool', arguments: '{"a":1}' }
      }];
      const normalized = normalizeToolCalls(raw);
      assert.equal(normalized.length, 1);
      assert.ok(normalized[0].id.startsWith('call_'));
      assert.equal(normalized[0].function.name, 'test_tool');
    });

    it('should stringify object arguments (e.g. from GLM/non-standard proxies)', () => {
      const raw = [{
        id: 'call_1',
        type: 'function',
        function: { name: 'test_tool', arguments: { query: '纯银项链', count: 5 } }
      }];
      const normalized = normalizeToolCalls(raw);
      assert.equal(typeof normalized[0].function.arguments, 'string');
      assert.deepEqual(JSON.parse(normalized[0].function.arguments), { query: '纯银项链', count: 5 });
    });

    it('should repair slightly broken JSON strings using jsonrepair', () => {
      // trailing comma and unquoted key
      const brokenJson = '{query: "纯银项链", count: 5,}';
      const raw = [{
        id: 'call_2',
        type: 'function',
        function: { name: 'test_tool', arguments: brokenJson }
      }];
      const normalized = normalizeToolCalls(raw);
      assert.doesNotThrow(() => JSON.parse(normalized[0].function.arguments));
      assert.equal(JSON.parse(normalized[0].function.arguments).query, '纯银项链');
    });
  });

  describe('chatWithTools HTTP Integration with Mock Server', () => {
    let mockServer;
    let mockServerUrl;
    let lastRequestBody = null;
    let mockResponse = null;

    before(async () => {
      mockServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            lastRequestBody = JSON.parse(body);
          } catch (_) {
            lastRequestBody = body;
          }
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify(mockResponse || { choices: [] }));
        });
      });

      await new Promise(resolve => {
        mockServer.listen(0, '127.0.0.1', () => {
          const port = mockServer.address().port;
          mockServerUrl = `http://127.0.0.1:${port}`;
          resolve();
        });
      });
    });

    after(async () => {
      await new Promise(resolve => mockServer.close(resolve));
    });

    it('should format tool calls payload and extract reasoning content from <think>', async () => {
      mockResponse = {
        choices: [
          {
            index: 0,
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: '<think>正在分析用户需求并查询生意参谋数据...</think>我将为您查询纯银项链的搜索指标。',
              tool_calls: [
                {
                  id: 'call_sycm_1',
                  type: 'function',
                  function: {
                    name: 'sycm_query',
                    arguments: '{"keyword":"纯银项链"}'
                  }
                }
              ]
            }
          }
        ],
        usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 }
      };

      const client = new LLMClient({
        apiKey: 'test-key',
        apiBase: mockServerUrl,
        model: 'deepseek-chat',
        timeout: 5000
      });

      const result = await client.chatWithTools({
        messages: [{ role: 'user', content: '查询纯银项链' }],
        tools: [
          {
            id: 'sycm.query',
            mcpName: 'sycm_query',
            description: '查询生意参谋数据',
            inputSchema: z.object({ keyword: z.string() })
          }
        ]
      });

      // Verify request payload
      assert.equal(lastRequestBody.model, 'deepseek-chat');
      assert.equal(lastRequestBody.tools.length, 1);
      assert.equal(lastRequestBody.tools[0].function.name, 'sycm_query');

      // Verify extracted message and reasoning
      assert.equal(result.message.role, 'assistant');
      assert.equal(result.message.content, '我将为您查询纯银项链的搜索指标。');
      assert.equal(result.message.reasoning_content, '正在分析用户需求并查询生意参谋数据...');
      assert.equal(result.message.tool_calls.length, 1);
      assert.equal(result.message.tool_calls[0].id, 'call_sycm_1');
      assert.equal(result.finishReason, 'tool_calls');
      assert.equal(result.usage.total_tokens, 165);
    });
  });
});
