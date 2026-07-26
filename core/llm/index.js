const GLMClient = require('../glm-client');

const DEFAULTS = {
  glm: {
    apiKeyEnv: 'GLM_API_KEY',
    apiBaseEnv: 'GLM_API_BASE',
    modelEnv: 'GLM_API_MODEL',
    apiBase: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash'
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
    model: 'MiniMax-M2.7'
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

function readProviderConfig(provider, config = {}) {
  const preset = DEFAULTS[provider];
  if (!preset) {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }

  return {
    provider,
    apiKey: config.apiKey || process.env[preset.apiKeyEnv] || process.env.LLM_API_KEY,
    apiBase: config.apiBase || process.env[preset.apiBaseEnv] || process.env.LLM_API_BASE || preset.apiBase,
    model: config.model || process.env[preset.modelEnv] || process.env.LLM_MODEL || preset.model,
    timeout: config.timeout || process.env.LLM_TIMEOUT,
    longTimeout: config.longTimeout || process.env.LLM_LONG_TIMEOUT
  };
}

class OpenAICompatibleClient extends GLMClient {
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
 * @returns {GLMClient|OpenAICompatibleClient}
 */
function createLLMClient(config = {}) {
  const provider = normalizeProvider(config.provider);
  if (provider === 'glm') {
    const client = new GLMClient({
      apiKey: config.apiKey || process.env.GLM_API_KEY,
      apiBase: config.apiBase || process.env.GLM_API_BASE,
      model: config.model || process.env.GLM_API_MODEL
    });
    client.provider = 'glm';
    return client;
  }

  return new OpenAICompatibleClient(readProviderConfig(provider, config));
}

/**
 * Return non-secret information about the active LLM configuration.
 *
 * @param {object} [config] - Optional provider override.
 * @param {string} [config.provider] - LLM provider name.
 * @returns {{provider:string,label:string,model:string,apiBase:string,configured:boolean,recommendedRunTimeoutMs:number}}
 */
function getLLMProviderInfo(config = {}) {
  const provider = normalizeProvider(config.provider);
  const providerConfig = readProviderConfig(provider, config);
  const providerDefaultTimeoutMs = provider === 'minimax' ? 180000 : 120000;
  const configuredTimeoutMs = parseInt(
    config.runTimeoutMs || process.env.TITLE_GEN_RUN_TIMEOUT_MS || process.env.RUN_TIMEOUT,
    10
  );
  return {
    provider,
    label: PROVIDER_LABELS[provider] || provider,
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
 * @param {GLMClient|OpenAICompatibleClient} client - Active LLM client.
 * @returns {string}
 */
function getLLMCacheVersion(client) {
  const provider = client && client.provider ? client.provider : 'glm';
  const apiBase = client && client.apiBase ? client.apiBase : '';
  const model = client && client.model ? client.model : '';
  return `${GLMClient.PROMPT_VERSION}:${provider}:${apiBase}:${model}`;
}

module.exports = {
  DEFAULTS,
  OpenAICompatibleClient,
  createLLMClient,
  getLLMCacheVersion,
  getLLMProviderInfo,
  normalizeProvider,
  PROMPT_VERSION: GLMClient.PROMPT_VERSION
};
