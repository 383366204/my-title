const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

function loadBotConfig() {
  const platforms = (process.env.BOT_PLATFORMS || 'feishu').split(',').map(s => s.trim()).filter(Boolean);
  const config = { platforms };
  const errors = [];
  
  if (platforms.includes('feishu')) {
    if (!process.env.FEISHU_APP_ID) errors.push('FEISHU_APP_ID 未配置');
    if (!process.env.FEISHU_APP_SECRET) errors.push('FEISHU_APP_SECRET 未配置');
    config.feishu = { appId: process.env.FEISHU_APP_ID, appSecret: process.env.FEISHU_APP_SECRET };
  }
  if (platforms.includes('dingtalk')) {
    if (!process.env.DINGTALK_CLIENT_ID) errors.push('DINGTALK_CLIENT_ID 未配置');
    if (!process.env.DINGTALK_CLIENT_SECRET) errors.push('DINGTALK_CLIENT_SECRET 未配置');
    config.dingtalk = { clientId: process.env.DINGTALK_CLIENT_ID, clientSecret: process.env.DINGTALK_CLIENT_SECRET };
  }
  if (platforms.includes('wechat')) {
    // Support multiple WeChat credential paths with backward compatibility
    // New preferred env: WECHAT_CREDENTIALS_PATHS (comma-separated)
    // Fallback: WECHAT_CREDENTIALS_PATH (single)
    // Default: [{ credentialsPath: '', label: '微信1' }]
    const pathsEnv = process.env.WECHAT_CREDENTIALS_PATHS;
    const singlePath = process.env.WECHAT_CREDENTIALS_PATH;

    let rawPaths = [];
    if (pathsEnv && pathsEnv.trim()) {
      rawPaths = pathsEnv.split(',').map(s => s.trim()).filter(Boolean);
    } else if (singlePath && singlePath.trim()) {
      rawPaths = [singlePath.trim()];
    } else {
      rawPaths = [];
    }

    let wechatList;
    if (rawPaths.length === 0) {
      wechatList = [{ credentialsPath: '', label: '微信1' }];
    } else {
      // Deduplicate while preserving order; log warning on duplicates
      const seen = new Set();
      wechatList = [];
      for (let i = 0; i < rawPaths.length; i++) {
        const p = rawPaths[i];
        if (seen.has(p)) {
          console.error(`微信凭据路径重复检测到: ${p}`);
          continue;
        }
        seen.add(p);
        wechatList.push({ credentialsPath: p, label: `微信${wechatList.length + 1}` });
      }
      if (wechatList.length === 0) {
        wechatList = [{ credentialsPath: '', label: '微信1' }];
      }
    }

    config.wechat = wechatList;
  }
  
  return { ...config, errors };
}
module.exports = { loadBotConfig };
