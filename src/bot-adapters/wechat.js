const { BaseAdapter } = require('./base');
const axios = require('axios');

/**
 * 微信 iLink API 适配器
 * 使用 HTTP long-polling 接收消息
 */
class WechatAdapter extends BaseAdapter {
  constructor(config) {
    super({ ...config, platform: 'wechat' });
    this.botToken = config.botToken;
    this.apiBase = config.apiBase || 'https://api.ilink.com';
    this.pollingInterval = config.pollingInterval || 5000;
    this.running = false;
    this.syncBuf = null;
    this.contextTokens = new Map(); // 存储每个 chatId 的 context_token
  }

  /**
   * 启动适配器，开始轮询消息
   */
  async start() {
    if (!this.botToken) {
      throw new Error('微信适配器需要 botToken');
    }
    this.running = true;
    this._pollLoop();
    console.error('[wechat] 启动中...');
  }

  /**
   * 停止适配器
   */
  async stop() {
    this.running = false;
    console.error('[wechat] 已停止');
  }

  /**
   * 轮询获取消息
   * @private
   */
  async _pollLoop() {
    while (this.running) {
      try {
        const response = await axios.post(
          `${this.apiBase}/ilink/bot/getupdates`,
          {
            bot_token: this.botToken,
            sync_buf: this.syncBuf
          },
          { timeout: 30000 }
        );

        const { Msgs, GetUpdatesBuf } = response.data || {};
        if (GetUpdatesBuf) {
          this.syncBuf = GetUpdatesBuf;
        }

        if (Msgs && Array.isArray(Msgs)) {
          for (const msg of Msgs) {
            await this._processIncomingMessage(msg);
          }
        }
      } catch (err) {
        console.error('[wechat] 轮询错误:', err.message);
      }

      if (this.running) {
        await this._sleep(this.pollingInterval);
      }
    }
  }

  /**
   * 处理接收到的消息
   * @private
   * @param {object} msg - 消息对象
   */
  async _processIncomingMessage(msg) {
    try {
      const chatId = msg.FromUserName || msg.UserName;
      const text = msg.Content || '';
      const contextToken = msg.ContextToken || msg.context_token;

      if (contextToken) {
        this.contextTokens.set(chatId, contextToken);
      }

      if (text && chatId) {
        await this._handleMessage(chatId, text, { rawMessage: msg });
      }
    } catch (err) {
      console.error('[wechat] 处理消息错误:', err.message);
    }
  }

  /**
   * 发送文本消息
   * @param {string} chatId - 聊天 ID
   * @param {string} text - 消息内容
   */
  async sendMessage(chatId, text) {
    const contextToken = this.contextTokens.get(chatId);
    if (!contextToken) {
      console.error('[wechat] 缺少 context_token，无法发送消息');
      return;
    }

    // 分块发送，每块约 3800 字符
    const chunks = this._chunkText(text, 3800);
    for (let i = 0; i < chunks.length; i++) {
      try {
        await axios.post(
          `${this.apiBase}/ilink/bot/sendmessage`,
          {
            bot_token: this.botToken,
            context_token: contextToken,
            text: chunks[i]
          },
          { timeout: 10000 }
        );

        // 块之间添加延迟
        if (i < chunks.length - 1) {
          await this._sleep(500);
        }
      } catch (err) {
        console.error('[wechat] 发送消息错误:', err.message);
        throw err;
      }
    }
  }

  /**
   * 发送卡片（微信 iLink 不支持卡片，降级为文本）
   * @param {string} chatId - 聊天 ID
   * @param {object|string} cardData - 卡片数据
   */
  async sendCard(chatId, cardData) {
    const formatter = require('./formatter');
    const text = typeof cardData === 'string' ? cardData : formatter.formatAsText(cardData);
    return this.sendMessage(chatId, text);
  }

  /**
   * 将文本分块
   * @private
   * @param {string} text - 原文本
   * @param {number} maxLength - 每块最大长度
   * @returns {string[]} 分块后的文本数组
   */
  _chunkText(text, maxLength) {
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
      chunks.push(remaining.slice(0, maxLength));
      remaining = remaining.slice(maxLength);
    }
    return chunks;
  }

  /**
   * 睡眠函数
   * @private
   * @param {number} ms - 毫秒数
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { WechatAdapter };
