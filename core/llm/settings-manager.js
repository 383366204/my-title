/**
 * @file settings-manager.js
 * @description 动态 LLM 设置管理器 (前端动态配置优先 + .env 兜底 + 脱敏与连通性探针)
 * 符合 PR-08 架构设计
 */

'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { writeJsonAtomic } = require('../../skills/pipeline-flow/runtime/store');

const DEFAULT_DATA_DIR = path.resolve(__dirname, '../../data/runtime');

/**
 * 掩码 API 密钥
 * @param {string} key
 * @returns {string}
 */
function maskApiKey(key) {
  if (!key || typeof key !== 'string') return '';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '********';

  if (trimmed.startsWith('sk-')) {
    const prefix = trimmed.slice(0, 5); // 'sk-xx'
    const suffix = trimmed.slice(-4);
    return `${prefix}******${suffix}`;
  }

  const prefix = trimmed.slice(0, 3);
  const suffix = trimmed.slice(-4);
  return `${prefix}******${suffix}`;
}

/**
 * 判断是否为掩码形式的密钥
 * @param {string} key
 * @returns {boolean}
 */
function isMaskedKey(key) {
  if (!key || typeof key !== 'string') return false;
  return key.includes('***') || key.includes('******');
}

/**
 * 获取设置文件路径
 * @param {string} [dataDir]
 * @returns {string}
 */
function getSettingsFilePath(dataDir) {
  const baseDir = dataDir ? path.resolve(dataDir) : DEFAULT_DATA_DIR;
  return path.join(baseDir, 'llm-settings.json');
}

/**
 * 读取动态配置文件
 * @param {object} [options]
 * @param {string} [options.dataDir]
 * @returns {object}
 */
function readDynamicSettings(options = {}) {
  const filePath = getSettingsFilePath(options.dataDir);
  try {
    if (!fs.existsSync(filePath)) return {};
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

/**
 * 写入动态配置（原子写入）
 * @param {object} newSettings
 * @param {object} [options]
 * @param {string} [options.dataDir]
 * @returns {object} 写入后的完整动态配置
 */
function writeDynamicSettings(newSettings = {}, options = {}) {
  const filePath = getSettingsFilePath(options.dataDir);
  const existing = readDynamicSettings(options);

  // 解析并保护 apiKey：若新值为空或仍为掩码，保留原值或 .env
  let resolvedApiKey = newSettings.apiKey;
  if (!resolvedApiKey || isMaskedKey(resolvedApiKey)) {
    resolvedApiKey = existing.apiKey || process.env.LLM_API_KEY || '';
  }

  const payload = {
    provider: (newSettings.provider || existing.provider || process.env.LLM_PROVIDER || 'glm').trim().toLowerCase(),
    apiKey: resolvedApiKey ? resolvedApiKey.trim() : '',
    apiBase: (newSettings.apiBase !== undefined ? newSettings.apiBase : (existing.apiBase || process.env.LLM_API_BASE || '')).trim(),
    model: (newSettings.model !== undefined ? newSettings.model : (existing.model || process.env.LLM_MODEL || '')).trim(),
    timeout: Number(newSettings.timeout) > 0 ? Number(newSettings.timeout) : (Number(existing.timeout) || Number(process.env.LLM_TIMEOUT) || 30000),
    updatedAt: new Date().toISOString()
  };

  writeJsonAtomic(filePath, payload);
  return payload;
}

/**
 * 重置动态配置
 * @param {object} [options]
 * @returns {boolean}
 */
function resetDynamicSettings(options = {}) {
  const filePath = getSettingsFilePath(options.dataDir);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * 获取生效的完整配置（显式传入 > 动态文件 > .env > 内置预设）
 * @param {object} [explicitConfig={}]
 * @param {object} [options={}]
 * @returns {object}
 */
function getActiveSettings(explicitConfig = {}, options = {}) {
  const { DEFAULTS, normalizeProvider } = require('./index');
  const dynamic = readDynamicSettings(options);

  const provider = normalizeProvider(
    explicitConfig.provider || dynamic.provider || process.env.LLM_PROVIDER || 'glm'
  );
  const preset = DEFAULTS[provider] || DEFAULTS['openai-compatible'];

  const apiKey = explicitConfig.apiKey || dynamic.apiKey || process.env.LLM_API_KEY || '';
  const apiBase = explicitConfig.apiBase || dynamic.apiBase || process.env.LLM_API_BASE || (preset ? preset.apiBase : '');
  const model = explicitConfig.model || dynamic.model || process.env.LLM_MODEL || (preset ? preset.model : '');
  const timeout = Number(explicitConfig.timeout) || Number(dynamic.timeout) || Number(process.env.LLM_TIMEOUT) || 30000;
  const longTimeout = Number(explicitConfig.longTimeout) || Number(process.env.LLM_LONG_TIMEOUT) || timeout * 2;

  return {
    provider,
    apiKey,
    apiBase: String(apiBase || '').replace(/\/+$/, ''),
    model,
    timeout,
    longTimeout,
    source: explicitConfig.apiKey ? 'explicit' : (dynamic.apiKey || dynamic.provider ? 'dynamic' : 'env')
  };
}

/**
 * 获取对前端安全的公共设置信息（掩码 apiKey）
 * @param {object} [options]
 * @returns {object}
 */
function getPublicSettings(options = {}) {
  const active = getActiveSettings({}, options);
  const dynamic = readDynamicSettings(options);

  return {
    provider: active.provider,
    model: active.model,
    apiBase: active.apiBase,
    timeout: active.timeout,
    apiKeyMasked: maskApiKey(active.apiKey),
    hasApiKey: Boolean(active.apiKey),
    configured: Boolean(active.apiKey),
    isDynamic: Boolean(dynamic.apiKey || dynamic.provider || dynamic.apiBase || dynamic.model),
    source: active.source,
    updatedAt: dynamic.updatedAt || null
  };
}

/**
 * 测试 LLM 服务连通性探针
 * @param {object} candidateConfig 候选配置
 * @param {number} [timeoutMs=8000]
 * @returns {Promise<{ ok: boolean, latencyMs: number, error?: string, status?: number, model?: string }>}
 */
async function testConnectivity(candidateConfig = {}, timeoutMs = 8000) {
  const active = getActiveSettings(candidateConfig);
  if (!active.apiKey) {
    return { ok: false, error: '缺少 API Key', latencyMs: 0 };
  }
  if (!active.apiBase) {
    return { ok: false, error: '缺少 API Base', latencyMs: 0 };
  }

  const startTime = Date.now();
  try {
    const url = `${active.apiBase}/chat/completions`;
    const res = await axios.post(
      url,
      {
        model: active.model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 5,
        temperature: 0.1
      },
      {
        headers: {
          Authorization: `Bearer ${active.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: timeoutMs
      }
    );

    const latencyMs = Date.now() - startTime;
    if (res.status >= 200 && res.status < 300) {
      return {
        ok: true,
        latencyMs,
        model: active.model,
        provider: active.provider,
        status: res.status
      };
    }

    return {
      ok: false,
      latencyMs,
      error: `服务返回状态码: ${res.status}`,
      status: res.status
    };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    const errorMsg = err.response?.data?.error?.message || err.response?.data?.message || err.message;
    return {
      ok: false,
      latencyMs,
      error: errorMsg || '连接失败',
      status: err.response?.status || 500
    };
  }
}

module.exports = {
  maskApiKey,
  isMaskedKey,
  getSettingsFilePath,
  readDynamicSettings,
  writeDynamicSettings,
  resetDynamicSettings,
  getActiveSettings,
  getPublicSettings,
  testConnectivity
};
