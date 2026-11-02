/**
 * @file llm-settings-manager.test.js
 * @description 动态 LLM 设置管理器单元测试
 */

'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  maskApiKey,
  isMaskedKey,
  readDynamicSettings,
  writeDynamicSettings,
  resetDynamicSettings,
  getActiveSettings,
  getPublicSettings
} = require('../../../core/llm/settings-manager');

describe('LLMSettingsManager Unit Tests', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-settings-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  describe('API Key Masking', () => {
    it('should mask standard sk- API keys preserving prefix and last 4 chars', () => {
      const masked = maskApiKey('sk-1234567890abcdef');
      assert.equal(masked, 'sk-12******cdef');
      assert.equal(isMaskedKey(masked), true);
    });

    it('should mask non-sk keys preserving first 3 and last 4 chars', () => {
      const masked = maskApiKey('mysecrettoken1234');
      assert.equal(masked, 'mys******1234');
      assert.equal(isMaskedKey(masked), true);
    });

    it('should return stars for short keys', () => {
      const masked = maskApiKey('12345');
      assert.equal(masked, '********');
      assert.equal(isMaskedKey(masked), true);
    });

    it('should return false for unmasked keys', () => {
      assert.equal(isMaskedKey('sk-real-secret-key-1234'), false);
    });
  });

  describe('Dynamic Settings Read/Write & Atomic Persistence', () => {
    it('should write and read dynamic settings', () => {
      const written = writeDynamicSettings({
        provider: 'openai-compatible',
        apiKey: 'sk-custom-api-key-9999',
        apiBase: 'https://api.siliconflow.cn/v1',
        model: 'deepseek-ai/DeepSeek-V3',
        timeout: 45000
      }, { dataDir: tmpDir });

      assert.equal(written.provider, 'openai-compatible');
      assert.equal(written.apiKey, 'sk-custom-api-key-9999');
      assert.equal(written.apiBase, 'https://api.siliconflow.cn/v1');

      const readBack = readDynamicSettings({ dataDir: tmpDir });
      assert.equal(readBack.provider, 'openai-compatible');
      assert.equal(readBack.apiKey, 'sk-custom-api-key-9999');
      assert.equal(readBack.timeout, 45000);
    });

    it('should preserve existing apiKey when saving with a masked key or empty key', () => {
      // 1. Initial write
      writeDynamicSettings({
        provider: 'deepseek',
        apiKey: 'sk-original-secret-8888',
        model: 'deepseek-chat'
      }, { dataDir: tmpDir });

      // 2. Subsequent write with masked key
      const updated = writeDynamicSettings({
        provider: 'deepseek',
        apiKey: 'sk-or******8888',
        model: 'deepseek-reasoner'
      }, { dataDir: tmpDir });

      assert.equal(updated.model, 'deepseek-reasoner');
      assert.equal(updated.apiKey, 'sk-original-secret-8888');

      const readBack = readDynamicSettings({ dataDir: tmpDir });
      assert.equal(readBack.apiKey, 'sk-original-secret-8888');
    });

    it('should reset dynamic settings when requested', () => {
      writeDynamicSettings({
        provider: 'glm',
        apiKey: 'test-key'
      }, { dataDir: tmpDir });

      const cleared = resetDynamicSettings({ dataDir: tmpDir });
      assert.equal(cleared, true);
      const readBack = readDynamicSettings({ dataDir: tmpDir });
      assert.deepEqual(readBack, {});
    });
  });

  describe('Resolution Priority (getActiveSettings & getPublicSettings)', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      process.env.LLM_PROVIDER = 'volc';
      process.env.LLM_API_KEY = 'env-api-key-1234';
      process.env.LLM_MODEL = 'env-doubao-model';
    });

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('should fallback to env when no dynamic config is present', () => {
      const active = getActiveSettings({}, { dataDir: tmpDir });
      assert.equal(active.provider, 'volc');
      assert.equal(active.apiKey, 'env-api-key-1234');
      assert.equal(active.model, 'env-doubao-model');
      assert.equal(active.source, 'env');

      const publicInfo = getPublicSettings({ dataDir: tmpDir });
      assert.equal(publicInfo.provider, 'volc');
      assert.equal(publicInfo.hasApiKey, true);
      assert.equal(publicInfo.apiKeyMasked.includes('******'), true);
      assert.equal(publicInfo.isDynamic, false);
    });

    it('should prefer dynamic config over env', () => {
      writeDynamicSettings({
        provider: 'openai-compatible',
        apiKey: 'sk-dynamic-key-5678',
        model: 'dynamic-gpt-4o'
      }, { dataDir: tmpDir });

      const active = getActiveSettings({}, { dataDir: tmpDir });
      assert.equal(active.provider, 'openai-compatible');
      assert.equal(active.apiKey, 'sk-dynamic-key-5678');
      assert.equal(active.model, 'dynamic-gpt-4o');
      assert.equal(active.source, 'dynamic');

      const publicInfo = getPublicSettings({ dataDir: tmpDir });
      assert.equal(publicInfo.isDynamic, true);
      assert.equal(publicInfo.apiKeyMasked, 'sk-dy******5678');
    });

    it('should prefer explicit call arguments over both dynamic and env', () => {
      writeDynamicSettings({
        provider: 'deepseek',
        apiKey: 'dynamic-key'
      }, { dataDir: tmpDir });

      const active = getActiveSettings({
        provider: 'minimax',
        apiKey: 'explicit-minimax-key'
      }, { dataDir: tmpDir });

      assert.equal(active.provider, 'minimax');
      assert.equal(active.apiKey, 'explicit-minimax-key');
      assert.equal(active.source, 'explicit');
    });
  });
});
