const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  buildJsonRpcRequest,
  parseMcpResponse,
  resolveMcpUrl,
  normalizeToolContent
} = require('../src/mcp-client');

describe('taobao-opc MCP client', () => {
  it('builds JSON-RPC 2.0 requests', () => {
    const body = buildJsonRpcRequest('tools/list');
    assert.strictEqual(body.jsonrpc, '2.0');
    assert.strictEqual(body.method, 'tools/list');
    assert.ok(body.id);
  });

  it('parses JSON responses', () => {
    const result = parseMcpResponse(JSON.stringify({ result: { tools: [] } }), 'application/json');
    assert.deepStrictEqual(result, { tools: [] });
  });

  it('parses SSE responses', () => {
    const raw = 'event: message\ndata: {"result":{"ok":true}}\n\n';
    const result = parseMcpResponse(raw, 'text/event-stream');
    assert.deepStrictEqual(result, { ok: true });
  });

  it('prefers explicit URL over environment', () => {
    const result = resolveMcpUrl({ url: 'https://example.com/mcp' });
    assert.strictEqual(result, 'https://example.com/mcp');
  });

  it('normalizes JSON text content', () => {
    const content = normalizeToolContent({
      content: [{ type: 'text', text: '{"ok":true}' }]
    });
    assert.deepStrictEqual(content[0].json, { ok: true });
  });
});
