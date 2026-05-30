const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  createLLMClient,
  normalizeProvider
} = require('../llm');

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
    'DEEPSEEK_API_KEY',
    'DEEPSEEK_API_BASE',
    'DEEPSEEK_MODEL',
    'MINIMAX_API_KEY',
    'MINIMAX_API_BASE',
    'MINIMAX_MODEL',
    'VOLC_API_KEY'
  ]) {
    delete process.env[key];
  }
}

describe('LLM provider factory', () => {
  it('normalizes provider aliases', () => {
    assert.equal(normalizeProvider('openai_compatible'), 'openai-compatible');
    assert.equal(normalizeProvider(' DeepSeek '), 'deepseek');
  });

  it('keeps GLM as the default provider', () => {
    clearProviderEnv();
    process.env.GLM_API_KEY = 'glm-test-key';

    const client = createLLMClient();

    assert.equal(client.provider, 'glm');
    assert.equal(client.apiKey, 'glm-test-key');
    assert.equal(client.model, process.env.GLM_API_MODEL || 'glm-4-flash');
    assert.equal(typeof client.generateTitles, 'function');
  });

  it('creates a DeepSeek OpenAI-compatible client from provider env vars', () => {
    clearProviderEnv();
    process.env.LLM_PROVIDER = 'deepseek';
    process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';

    const client = createLLMClient();

    assert.equal(client.provider, 'deepseek');
    assert.equal(client.apiKey, 'deepseek-test-key');
    assert.equal(client.apiBase, 'https://api.deepseek.com');
    assert.equal(client.model, 'deepseek-v4-flash');
    assert.equal(typeof client.extractCoreAndModifiers, 'function');
  });

  it('creates a MiniMax OpenAI-compatible client from provider env vars', () => {
    clearProviderEnv();
    process.env.LLM_PROVIDER = 'minimax';
    process.env.MINIMAX_API_KEY = 'minimax-test-key';
    process.env.MINIMAX_MODEL = 'MiniMax-test-model';

    const client = createLLMClient();

    assert.equal(client.provider, 'minimax');
    assert.equal(client.apiKey, 'minimax-test-key');
    assert.equal(client.apiBase, 'https://api.minimaxi.com/v1');
    assert.equal(client.model, 'MiniMax-test-model');
    assert.equal(client._buildChatPayload({ messages: [], temperature: 0.1 }).reasoning_split, true);
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
