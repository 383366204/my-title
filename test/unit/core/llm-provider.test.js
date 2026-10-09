const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  createLLMClient,
  getLLMProviderInfo,
  normalizeProvider
} = require('../../../core/llm');

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

function clearProviderEnv() {
  for (const key of [
    'LLM_PROVIDER',
    'LLM_API_KEY',
    'LLM_API_BASE',
    'LLM_MODEL',
    'LLM_TIMEOUT',
    'LLM_LONG_TIMEOUT',
    'TITLE_GEN_RUN_TIMEOUT_MS',
    'RUN_TIMEOUT'
  ]) {
    delete process.env[key];
  }
}

describe('LLM provider factory', () => {
  it('gives explicit settings precedence over unified environment settings', () => {
    clearProviderEnv();
    Object.assign(process.env, { LLM_PROVIDER: 'minimax', LLM_API_KEY: 'env-key', LLM_API_BASE: 'https://env.test/v1', LLM_MODEL: 'env-model', LLM_TIMEOUT: '1000', LLM_LONG_TIMEOUT: '2000' });
    const client = createLLMClient({ provider: 'deepseek', apiKey: 'explicit-key', apiBase: 'https://explicit.test/v1', model: 'explicit-model', timeout: 3000, longTimeout: 4000 });
    assert.equal(client.provider, 'deepseek');
    assert.equal(client.apiKey, 'explicit-key');
    assert.equal(client.apiBase, 'https://explicit.test/v1');
    assert.equal(client.model, 'explicit-model');
    assert.equal(client._timeout, 3000);
    assert.equal(client._longTimeout, 4000);
  });

  it('uses unified configuration for every supported provider without leaking the key', () => {
    for (const provider of ['glm', 'volc', 'deepseek', 'minimax', 'openai-compatible']) {
      clearProviderEnv();
      Object.assign(process.env, { LLM_PROVIDER: provider, LLM_API_KEY: 'private-test-key', LLM_API_BASE: 'https://example.test/v1', LLM_MODEL: 'test-model' });
      const client = createLLMClient();
      assert.equal(client.provider, provider);
      assert.equal(client.apiKey, 'private-test-key');
      assert.equal(client.apiBase, 'https://example.test/v1');
      assert.equal(client.model, 'test-model');
      assert.equal(getLLMProviderInfo().configured, true);
      assert.equal(JSON.stringify(getLLMProviderInfo()).includes('private-test-key'), false);
      delete process.env.LLM_API_KEY;
      assert.equal(getLLMProviderInfo().configured, false);
    }
  });

  it('normalizes provider aliases', () => {
    assert.equal(normalizeProvider('openai_compatible'), 'openai-compatible');
    assert.equal(normalizeProvider(' DeepSeek '), 'deepseek');
  });

  it('keeps glm as the default provider', () => {
    clearProviderEnv();
    process.env.LLM_API_KEY = 'glm-test-key';

    const client = createLLMClient();

    assert.equal(client.provider, 'glm');
    assert.equal(client.apiKey, 'glm-test-key');
    assert.equal(client.model, process.env.LLM_MODEL || 'glm-4-flash');
    assert.equal(typeof client.generateTitles, 'function');
  });

  it('creates a DeepSeek OpenAI-compatible client from unified env vars', () => {
    clearProviderEnv();
    process.env.LLM_PROVIDER = 'deepseek';
    process.env.LLM_API_KEY = 'deepseek-test-key';

    const client = createLLMClient();

    assert.equal(client.provider, 'deepseek');
    assert.equal(client.apiKey, 'deepseek-test-key');
    assert.equal(client.apiBase, 'https://api.deepseek.com');
    assert.equal(client.model, 'deepseek-v4-flash');
    assert.equal(typeof client.extractCoreAndModifiers, 'function');
  });

  it('creates a MiniMax OpenAI-compatible client from unified env vars', () => {
    clearProviderEnv();
    process.env.LLM_PROVIDER = 'minimax';
    process.env.LLM_API_KEY = 'minimax-test-key';
    process.env.LLM_MODEL = 'MiniMax-test-model';

    const client = createLLMClient();

    assert.equal(client.provider, 'minimax');
    assert.equal(client.apiKey, 'minimax-test-key');
    assert.equal(client.apiBase, 'https://api.minimaxi.com/v1');
    assert.equal(client.model, 'MiniMax-test-model');
    assert.equal(client._buildChatPayload({ messages: [], temperature: 0.1 }).reasoning_split, true);

    const info = getLLMProviderInfo();
    assert.deepEqual(info, {
      provider: 'minimax',
      label: 'MiniMax',
      model: 'MiniMax-test-model',
      apiBase: 'https://api.minimaxi.com/v1',
      configured: true,
      recommendedRunTimeoutMs: 180000
    });
  });

  it('supports a generic OpenAI-compatible provider', () => {
    clearProviderEnv();
    process.env.LLM_PROVIDER = 'openai-compatible';
    process.env.LLM_API_KEY = 'generic-test-key';
    process.env.LLM_API_BASE = 'https://example.test/v1/';
    process.env.LLM_MODEL = 'generic-model';

    const client = createLLMClient();

    assert.equal(client.provider, 'openai-compatible');
    assert.equal(client.apiKey, 'generic-test-key');
    assert.equal(client.apiBase, 'https://example.test/v1');
    assert.equal(client.model, 'generic-model');
  });
});
