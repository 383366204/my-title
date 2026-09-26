const LLMClient = require('../llm-client');

const DEFAULTS = {
  glm: {
    apiKeyEnv: 'GLM_API_KEY',
    apiBaseEnv: 'GLM_API_BASE',
    modelEnv: 'GLM_API_MODEL',
    apiBase: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash'
  },
  volc: {
    apiKeyEnv: 'VOLC_API_KEY',
    apiBaseEnv: 'VOLC_API_BASE',
    modelEnv: 'VOLC_MODEL',
    apiBase: 'https://ark.cn-beijing.volces.com/api/plan/v3',
    model: 'doubao-seed-2-0-lite-260428'
  },
  deepseek: {
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    apiBaseEnv: 'DEEPSEEK_API_BASE',
    modelEnv: 'DEEPSEEK_MODEL',
    apiBase: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash'
  },
  minimax: {
    apiKeyEnv: 'MINIMAX_API_KEY',
    apiBaseEnv: 'MINIMAX_API_BASE',
    modelEnv: 'MINIMAX_MODEL',
    apiBase: 'https://api.minimaxi.com/v1',
    model: 'MiniMax-M3'
  },
  'openai-compatible': {
    apiKeyEnv: 'LLM_API_KEY',
    apiBaseEnv: 'LLM_API_BASE',
    modelEnv: 'LLM_MODEL',
    apiBase: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini'
  }
};

const PROVIDER_LABELS = {
  glm: 'GLM',
  volc: '火山引擎 (Doubao)',
  deepseek: 'DeepSeek',
  minimax: 'MiniMax',
  'openai-compatible': '兼容 OpenAI 的模型服务'
};

function normalizeProvider(provider) {
  return String(provider || process.env.LLM_PROVIDER || 'glm')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
}

/**
 * 解析指定 provider 的配置。
 * 对于 glm provider：若调用方未显式传入 apiKey 且存在 VOLC_API_KEY，
 * 则自动切换到火山引擎配置（向后兼容旧的 VOLC_API_KEY 用法）。
 * 若调用方显式传入了 apiKey/apiBase，则尊重显式配置，不做自动切换。
 *
 * @param {string} provider - 已标准化的 provider 名称
 * @param {object} [config] - 调用方显式传入的配置
 * @returns {object} 解析后的完整配置
 */
function readProviderConfig(provider, config = {}) {
  // glm provider 的 VOLC_API_KEY 自动检测：仅在未显式传入 apiKey 时触发
  let effectiveProvider = provider;
  if (provider === 'glm' && !config.apiKey && !config.apiBase && process.env.VOLC_API_KEY) {
    effectiveProvider = 'volc';
  }

  const preset = DEFAULTS[effectiveProvider];
  if (!preset) {
    throw new Error(`Unsupported LLM provider: ${effectiveProvider}`);
  }

  return {
    provider: effectiveProvider,
    apiKey: config.apiKey || process.env[preset.apiKeyEnv] || process.env.LLM_API_KEY,
    apiBase: config.apiBase || process.env[preset.apiBaseEnv] || process.env.LLM_API_BASE || preset.apiBase,
    model: config.model || process.env[preset.modelEnv] || process.env.LLM_MODEL || preset.model,
    timeout: config.timeout || process.env.LLM_TIMEOUT,
    longTimeout: config.longTimeout || process.env.LLM_LONG_TIMEOUT
  };
}

class OpenAICompatibleClient extends LLMClient {
  /**
   * @param {object} config - OpenAI compatible provider config.
   * @param {string} config.provider - Provider name.
   * @param {string} config.apiKey - API key.
   * @param {string} config.apiBase - API base URL without /chat/completions.
   * @param {string} config.model - Model name.
   */
  constructor(config = {}) {
    super({});
    this.provider = config.provider || 'openai-compatible';
    this.apiKey = config.apiKey;
    this.apiBase = String(config.apiBase || '').replace(/\/+$/, '');
    this.model = config.model;
    this._timeout = parseInt(config.timeout, 10) || 30000;
    this._longTimeout = parseInt(config.longTimeout, 10) || this._timeout * 2;
  }
}

/**
 * Create an LLM client compatible with the existing title-generation prompts.
 *
 * @param {object} [config] - Optional provider override.
 * @param {string} [config.provider] - glm, deepseek, minimax, or openai-compatible.
 * @param {string} [config.apiKey] - Provider API key.
 * @param {string} [config.apiBase] - Provider API base URL.
 * @param {string} [config.model] - Provider model name.
 * @returns {LLMClient|OpenAICompatibleClient}
 */
function createLLMClient(config = {}) {
  const provider = normalizeProvider(config.provider);
  const providerConfig = readProviderConfig(provider, config);

  // glm 和 volc 使用原生 LLMClient，其他 provider 使用 OpenAICompatibleClient
  if (providerConfig.provider === 'glm' || providerConfig.provider === 'volc') {
    return new LLMClient(providerConfig);
  }

  return new OpenAICompatibleClient(providerConfig);
}

/**
 * Return non-secret information about the active LLM configuration.
 *
 * @param {object} [config] - Optional provider override.
 * @param {string} [config.provider] - LLM provider name.
 * @returns {{provider:string,label:string,model:string,apiBase:string,configured:boolean,recommendedRunTimeoutMs:number}}
 */
function getLLMProviderInfo(config = {}) {
  const requestedProvider = normalizeProvider(config.provider);
  const providerConfig = readProviderConfig(requestedProvider, config);
  // 使用解析后的实际 provider（可能与请求的不同，如 glm → volc 自动切换）
  const actualProvider = providerConfig.provider;
  const providerDefaultTimeoutMs = actualProvider === 'minimax' ? 180000 : 120000;
  const configuredTimeoutMs = parseInt(
    config.runTimeoutMs || process.env.TITLE_GEN_RUN_TIMEOUT_MS || process.env.RUN_TIMEOUT,
    10
  );
  return {
    provider: actualProvider,
    label: PROVIDER_LABELS[actualProvider] || actualProvider,
    model: providerConfig.model || '',
    apiBase: providerConfig.apiBase || '',
    configured: Boolean(providerConfig.apiKey),
    recommendedRunTimeoutMs: Number.isFinite(configuredTimeoutMs)
      ? Math.max(providerDefaultTimeoutMs, configuredTimeoutMs)
      : providerDefaultTimeoutMs
  };
}

/**
 * Build a non-secret cache discriminator for the active LLM configuration.
 *
 * @param {LLMClient|OpenAICompatibleClient} client - Active LLM client.
 * @returns {string}
 */
function getLLMCacheVersion(client) {
  const provider = client && client.provider ? client.provider : 'glm';
  const apiBase = client && client.apiBase ? client.apiBase : '';
  const model = client && client.model ? client.model : '';
  return `${LLMClient.PROMPT_VERSION}:${provider}:${apiBase}:${model}`;
}

module.exports = {
  DEFAULTS,
  OpenAICompatibleClient,
  createLLMClient,
  getLLMCacheVersion,
  getLLMProviderInfo,
  normalizeProvider
};
