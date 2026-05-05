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
    if (!process.env.WECHAT_BOT_TOKEN) errors.push('WECHAT_BOT_TOKEN 未配置');
    config.wechat = { botToken: process.env.WECHAT_BOT_TOKEN };
  }
  
  return { ...config, errors };
}
module.exports = { loadBotConfig };
