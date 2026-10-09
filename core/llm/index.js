const LLMClient = require('../llm-client');

const DEFAULTS = {
  glm: {
    apiBase: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash'
  },
  volc: {
    apiBase: 'https://ark.cn-beijing.volces.com/api/plan/v3',
    model: 'doubao-seed-2-0-lite-260428'
  },
  deepseek: {
    apiBase: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash'
  },
  minimax: {
    apiBase: 'https://api.minimaxi.com/v1',
    model: 'MiniMax-M3'
  },
  'openai-compatible': {
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
 * 所有服务商统一使用 LLM_* 环境变量，显式配置优先。
 *
 * @param {string} provider - 已标准化的 provider 名称
 * @param {object} [config] - 调用方显式传入的配置
 * @returns {object} 解析后的完整配置
 */
function readProviderConfig(provider, config = {}) {
  const preset = DEFAULTS[provider];
  if (!preset) {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }

  return {
    provider,
    apiKey: config.apiKey || process.env.LLM_API_KEY,
    apiBase: config.apiBase || process.env.LLM_API_BASE || preset.apiBase,
    model: config.model || process.env.LLM_MODEL || preset.model,
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
