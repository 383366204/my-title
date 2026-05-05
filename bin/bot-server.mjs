#!/usr/bin/env node

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { loadBotConfig } = require('../src/bot-adapters/config.js');
const { FeishuAdapter } = require('../src/bot-adapters/feishu.js');
const { DingtalkAdapter } = require('../src/bot-adapters/dingtalk.js');
const { WechatAdapter } = require('../src/bot-adapters/wechat.js');

// Parse args
const args = process.argv.slice(2);
let platforms = [];
let dryRun = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--platform' && i + 1 < args.length) {
    platforms = args[i + 1].split(',').map(s => s.trim()).filter(Boolean);
  }
  if (args[i] === '--dry-run') dryRun = true;
}

if (platforms.length === 0) {
  console.error('Usage: node bin/bot-server.mjs --platform <feishu,dingtalk,wechat> [--dry-run]');
  console.error('');
  console.error('Examples:');
  console.error('  node bin/bot-server.mjs --platform feishu');
  console.error('  node bin/bot-server.mjs --platform feishu,dingtalk');
  console.error('  node bin/bot-server.mjs --platform feishu,dingtalk,wechat');
  console.error('  node bin/bot-server.mjs --platform feishu --dry-run');
  process.exit(1);
}

// Set BOT_PLATFORMS env var so config.js can validate the right platforms
process.env.BOT_PLATFORMS = platforms.join(',');

const config = loadBotConfig();
if (config.errors.length > 0) {
  config.errors.forEach(e => console.error(`[bot-server] ${e}`));
  process.exit(1);
}

const adapters = [];

for (const platform of platforms) {
  let adapter;
  if (platform === 'feishu') {
    if (!config.feishu) {
      console.error(`[bot-server] 飞书配置缺失，请检查 FEISHU_APP_ID 和 FEISHU_APP_SECRET 环境变量`);
      continue;
    }
    adapter = new FeishuAdapter(config.feishu);
  } else if (platform === 'dingtalk') {
    if (!config.dingtalk) {
      console.error(`[bot-server] 钉钉配置缺失，请检查 DINGTALK_CLIENT_ID 和 DINGTALK_CLIENT_SECRET 环境变量`);
      continue;
    }
    adapter = new DingtalkAdapter(config.dingtalk);
  } else if (platform === 'wechat') {
    if (!config.wechat) {
      console.error(`[bot-server] 微信配置缺失，请检查 WECHAT_BOT_TOKEN 环境变量`);
      continue;
    }
    adapter = new WechatAdapter(config.wechat);
  } else {
    console.error(`[bot-server] 未知平台: ${platform}`);
    continue;
  }
  adapters.push({ platform, adapter });
}

if (adapters.length === 0) {
  console.error('[bot-server] 没有有效的适配器可启动');
  process.exit(1);
}

if (dryRun) {
  console.error('[bot-server] Dry-run 模式，适配器已初始化但未连接:');
  adapters.forEach(({ platform }) => console.error(`  - ${platform}`));
  process.exit(0);
}

// Start all adapters
async function startAdapters() {
  const startedAdapters = [];
  
  for (const { platform, adapter } of adapters) {
    try {
      await adapter.start();
      console.error(`[bot-server] ${platform} 适配器已启动`);
      startedAdapters.push({ platform, adapter });
    } catch (err) {
      console.error(`[bot-server] ${platform} 适配器启动失败:`, err.message);
    }
  }
  
  if (startedAdapters.length === 0) {
    console.error('[bot-server] 所有适配器启动失败');
    process.exit(1);
  }
  
  return startedAdapters;
}

// Graceful shutdown
async function shutdown(signal, startedAdapters) {
  console.error(`\n[bot-server] 收到 ${signal} 信号，正在关闭...`);
  
  for (const { platform, adapter } of startedAdapters) {
    try {
      await adapter.stop();
      console.error(`[bot-server] ${platform} 适配器已停止`);
    } catch (e) {
      console.error(`[bot-server] ${platform} 适配器停止时出错:`, e.message);
    }
  }
  
  console.error('[bot-server] 所有适配器已停止');
  process.exit(0);
}

// Start the server
async function main() {
  const startedAdapters = await startAdapters();
  
  // Register signal handlers
  process.on('SIGINT', () => shutdown('SIGINT', startedAdapters));
  process.on('SIGTERM', () => shutdown('SIGTERM', startedAdapters));
  
  console.error('[bot-server] 所有适配器已启动。按 Ctrl+C 停止。');
}

main().catch((err) => {
  console.error('[bot-server] 启动失败:', err.message);
  process.exit(1);
});