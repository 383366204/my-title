/**
 * @deprecated 请改用 require('./llm') 的 createLLMClient() 工厂函数。
 * 此文件仅为向后兼容保留，确保旧代码 new GLMClient() 仍能正常工作。
 */
const LLMClient = require('./llm-client');

/**
 * 向后兼容的 GLMClient 包装类。
 * 构造函数从环境变量解析配置（支持 VOLC_API_KEY 自动检测），
 * 行为等同于旧版 GLMClient 构造函数。
 *
 * @deprecated 请使用 createLLMClient() 替代
 */
class GLMClientCompat extends LLMClient {
  constructor(config = {}) {
    // 仅在未显式传入 apiKey 时检测 VOLC_API_KEY（与 readProviderConfig 行为一致）
    let resolved;
    if (!config.apiKey && !config.apiBase && process.env.VOLC_API_KEY) {
      resolved = {
        provider: 'volc',
        apiKey: process.env.VOLC_API_KEY,
        apiBase: config.apiBase || process.env.VOLC_API_BASE || 'https://ark.cn-beijing.volces.com/api/plan/v3',
        model: config.model || process.env.VOLC_MODEL || 'doubao-seed-2-0-lite-260428'
      };
    } else {
      resolved = {
        provider: config.provider || 'glm',
        apiKey: config.apiKey || process.env.GLM_API_KEY || '',
        apiBase: config.apiBase || process.env.GLM_API_BASE || 'https://open.bigmodel.cn/api/paas/v4',
        model: config.model || process.env.GLM_API_MODEL || 'glm-4-flash'
      };
    }
    super(resolved);
  }
}

module.exports = GLMClientCompat;
module.exports.GLMClient = GLMClientCompat;
module.exports.LLMClient = LLMClient;
module.exports.PROMPT_VERSION = LLMClient.PROMPT_VERSION;
