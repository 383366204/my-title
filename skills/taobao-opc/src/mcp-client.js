const { randomUUID } = require('crypto');

const DEFAULT_TIMEOUT_MS = 60000;

/**
 * Resolve the Taobao OPC MCP gateway URL from explicit options or environment.
 * @param {object} [options={}] - Client options.
 * @param {string} [options.url] - Explicit MCP gateway URL.
 * @returns {string} Resolved MCP gateway URL.
 */
function resolveMcpUrl(options = {}) {
  const url = options.url || process.env.TAOBAO_OPC_URL || process.env.TAOBAO_OPT_URL;
  if (!url || typeof url !== 'string') {
    throw new Error('TAOBAO_OPC_URL 未配置，请在 .env 中填入淘宝 OPC/OPT MCP 网关 URL');
  }
  return url;
}

/**
 * Build a JSON-RPC 2.0 request body.
 * @param {string} method - JSON-RPC method name.
 * @param {object} [params] - Optional method params.
 * @returns {object} JSON-RPC request payload.
 */
function buildJsonRpcRequest(method, params) {
  const body = {
    jsonrpc: '2.0',
    id: randomUUID(),
    method
  };
  if (params !== undefined) {
    body.params = params;
  }
  return body;
}

/**
 * Parse an MCP HTTP response that may be JSON or server-sent events.
 * @param {string} text - Raw response text.
 * @param {string} contentType - Response content type.
 * @returns {object} Parsed JSON-RPC result object.
 */
function parseMcpResponse(text, contentType = '') {
  if (contentType.includes('text/event-stream')) {
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      const data = JSON.parse(payload);
      if (data.error) {
        const message = data.error.message || JSON.stringify(data.error);
        throw new Error(`MCP error: ${message}`);
      }
      if ('result' in data) return data.result;
    }
    throw new Error('MCP SSE 响应中没有 result');
  }

  const data = JSON.parse(text);
  if (data.error) {
    const message = data.error.message || JSON.stringify(data.error);
    throw new Error(`MCP error: ${message}`);
  }
  return data.result;
}

/**
 * Send a JSON-RPC request to the Taobao OPC MCP gateway.
 * @param {string} method - MCP method name, such as tools/list or tools/call.
 * @param {object} [params] - Method params.
 * @param {object} [options={}] - Request options.
 * @param {string} [options.url] - Explicit MCP gateway URL.
 * @param {number} [options.timeoutMs=60000] - Request timeout in milliseconds.
 * @returns {Promise<object>} MCP result.
 */
async function sendMcpRequest(method, params, options = {}) {
  const url = resolveMcpUrl(options);
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify(buildJsonRpcRequest(method, params)),
      signal: controller.signal
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text}`);
    }
    return parseMcpResponse(text, response.headers.get('content-type') || '');
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`淘宝 OPC MCP 请求超时（${timeoutMs}ms）`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * List tools exposed by the Taobao OPC MCP service.
 * @param {object} [options={}] - Request options.
 * @returns {Promise<Array>} MCP tool definitions.
 */
async function listTools(options = {}) {
  const result = await sendMcpRequest('tools/list', undefined, options);
  return Array.isArray(result && result.tools) ? result.tools : [];
}

/**
 * Call a tool exposed by the Taobao OPC MCP service.
 * @param {string} name - Remote MCP tool name.
 * @param {object} [args={}] - Tool arguments matching the remote inputSchema.
 * @param {object} [options={}] - Request options.
 * @returns {Promise<object>} Raw MCP tools/call result.
 */
async function callTool(name, args = {}, options = {}) {
  if (!name || typeof name !== 'string') {
    throw new Error('tool name 必须是非空字符串');
  }
  return sendMcpRequest('tools/call', {
    name,
    arguments: args || {}
  }, options);
}

/**
 * Extract text and JSON payloads from an MCP tools/call response.
 * @param {object} result - Raw tools/call result.
 * @returns {Array} Normalized content items.
 */
function normalizeToolContent(result) {
  const items = Array.isArray(result && result.content) ? result.content : [];
  return items.map((item) => {
    if (!item || item.type !== 'text') return item;
    const text = item.text || '';
    try {
      return { ...item, json: JSON.parse(text) };
    } catch (_) {
      return item;
    }
  });
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  resolveMcpUrl,
  buildJsonRpcRequest,
  parseMcpResponse,
  sendMcpRequest,
  listTools,
  callTool,
  normalizeToolContent
};
