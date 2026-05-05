const { BaseAdapter } = require('./base');
const { DWClient, TOPIC_ROBOT } = require('dingtalk-stream');
const axios = require('axios');

/**
 * 钉钉 Stream 模式适配器
 * 使用 Stream 模式（持久连接，无需公网服务器）
 * 支持接收机器人消息并发送回复
 */
class DingtalkAdapter extends BaseAdapter {
  constructor(config) {
    super({ ...config, platform: 'dingtalk' });
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.streamClient = null;
    this.running = false;
    this.sessionWebhooks = new Map(); // 存储 chatId -> sessionWebhook 映射
  }
  
  /**
   * 启动钉钉 Stream 客户端
   * @throws {Error} 如果缺少 clientId 或 clientSecret
   */
  async start() {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('钉钉适配器需要 clientId 和 clientSecret');
    }
    
    try {
      // 创建 Stream 客户端
      this.streamClient = new DWClient({
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        debug: false, // 可以设置为 true 查看调试信息
        autoReconnect: true,
        keepAlive: true
      });
      
      // 注册机器人消息回调
      this.streamClient.registerCallbackListener(TOPIC_ROBOT, (event) => {
        return this._handleBotMessage(event);
      });
      
      // 开始连接
      await this.streamClient.connect();
      this.running = true;
      
      console.error('[dingtalk] 启动成功，等待消息...');
      
      // 监听连接错误和关闭事件
      this.streamClient.on('close', (code, reason) => {
        console.error(`[dingtalk] 连接关闭: ${code} ${reason}`);
        this._scheduleReconnect();
      });
      
      this.streamClient.on('error', (err) => {
        console.error(`[dingtalk] 连接错误:`, err.message);
        this._scheduleReconnect();
      });
      
    } catch (err) {
      console.error('[dingtalk] 启动失败:', err.message);
      this._scheduleReconnect();
      throw err;
    }
  }
  
  /**
   * 停止适配器
   */
  async stop() {
    this.running = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.streamClient) {
      try {
        this.streamClient.disconnect();
      } catch (err) {
        console.error('[dingtalk] 断开连接时出错:', err.message);
      }
      this.streamClient = null;
    }
    
    console.error('[dingtalk] 已停止');
  }
  
  /**
   * 处理机器人消息
   * @private
   * @param {object} event - 钉钉事件对象
   * @returns {object} 响应对象
   */
  async _handleBotMessage(event) {
    try {
      const { headers, data } = event;
      const message = data || {};
      
      // 提取消息内容
      const text = this._extractMessageText(message);
      const chatId = message.conversationId || message.chatId || message.senderStaffId;
      const sessionWebhook = message.sessionWebhook;
      const isAtMe = this._isBotMentioned(message);
      
      if (!text || !chatId) {
        console.error('[dingtalk] 消息缺少必要字段:', { text, chatId });
        return { status: 'SUCCESS' };
      }
      
      // 如果不是@机器人，忽略消息
      if (!isAtMe) {
        console.error('[dingtalk] 忽略非@消息:', text.substring(0, 50));
        return { status: 'SUCCESS' };
      }
      
      // 提取关键词（移除@mention）
      const keyword = this._cleanKeyword(text);
      
      console.error(`[dingtalk] 收到消息: ${keyword} (来自: ${chatId})`);
      
      // 存储 sessionWebhook 以便后续发送消息使用
      if (sessionWebhook) {
        this.sessionWebhooks.set(chatId, sessionWebhook);
      }
      
      // 处理消息
      await this._handleMessage(chatId, keyword, {
        sessionWebhook,
        rawMessage: message
      });
      
    } catch (err) {
      console.error('[dingtalk] 处理消息错误:', err.message);
    }
    
    return { status: 'SUCCESS' };
  }
  
  /**
   * 发送文本消息
   * @param {string} chatId - 聊天 ID
   * @param {string} text - 消息内容
   * @param {object} extras - 额外参数（包含 sessionWebhook）
   */
  async sendMessage(chatId, text, extras = {}) {
    // 优先使用 extras 中的 sessionWebhook，否则从存储中获取
    let sessionWebhook = extras.sessionWebhook;
    if (!sessionWebhook) {
      sessionWebhook = this.sessionWebhooks.get(chatId);
    }
    
    if (!sessionWebhook) {
      console.error('[dingtalk] 缺少 sessionWebhook，无法发送消息');
      return;
    }
    
    try {
      // 钉钉机器人消息格式
      const message = {
        msgtype: 'text',
        text: {
          content: text
        }
      };
      
      await axios.post(sessionWebhook, message, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      console.error(`[dingtalk] 消息发送成功: ${text.substring(0, 50)}...`);
    } catch (err) {
      console.error('[dingtalk] 发送消息错误:', err.message);
      throw err;
    }
  }
  
  /**
   * 发送卡片消息
   * @param {string} chatId - 聊天 ID
   * @param {object|string} cardData - 卡片数据
   * @param {object} extras - 额外参数（包含 sessionWebhook）
   */
  async sendCard(chatId, cardData, extras = {}) {
    // 优先使用 extras 中的 sessionWebhook，否则从存储中获取
    let sessionWebhook = extras.sessionWebhook;
    if (!sessionWebhook) {
      sessionWebhook = this.sessionWebhooks.get(chatId);
    }
    
    if (!sessionWebhook) {
      console.error('[dingtalk] 缺少 sessionWebhook，无法发送卡片');
      return;
    }
    
    try {
      // 如果 cardData 是字符串，转换为文本消息
      if (typeof cardData === 'string') {
        return this.sendMessage(chatId, cardData, extras);
      }
      
      // 使用 formatter 生成钉钉卡片
      const formatter = require('./formatter');
      const dingtalkCard = formatter.formatAsDingtalkCard(cardData);
      
      await axios.post(sessionWebhook, dingtalkCard, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      console.error('[dingtalk] 卡片发送成功');
    } catch (err) {
      console.error('[dingtalk] 发送卡片错误:', err.message);
      throw err;
    }
  }
  
  /**
   * 提取消息文本
   * @private
   * @param {object} message - 钉钉消息对象
   * @returns {string} 消息文本
   */
  _extractMessageText(message) {
    if (message.text && message.text.content) {
      return message.text.content;
    }
    if (typeof message.content === 'string') {
      try {
        const content = JSON.parse(message.content);
        return content.text?.content || content.content || '';
      } catch (e) {
        return message.content;
      }
    }
    return '';
  }
  
  /**
   * 检查消息是否@了机器人
   * @private
   * @param {object} message - 钉钉消息对象
   * @returns {boolean} 是否@机器人
   */
  _isBotMentioned(message) {
    const text = this._extractMessageText(message);
    
    // 检查是否包含@机器人的标识
    // 钉钉消息格式通常包含 robotCode 或 @机器人
    if (message.robotCode || message.isAt) {
      return true;
    }
    
    // 检查文本中是否包含@机器人
    if (text && text.includes('@')) {
      // 简化处理：有@符号就认为是@消息
      return true;
    }
    
    return false;
  }
  
  /**
   * 清理关键词（移除@mention等）
   * @private
   * @param {string} text - 原始消息文本
   * @returns {string} 清理后的关键词
   */
  _cleanKeyword(text) {
    if (!text) return '';
    
    // 移除@机器人及其后面的空格
    let cleaned = text.replace(/@\S+\s*/g, '');
    
    // 移除多余空格
    cleaned = cleaned.trim();
    
    return cleaned;
  }
  
  /**
   * 调度重连
   * @private
   */
  _scheduleReconnect() {
    if (!this.running) return;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    // 使用指数退避策略重连
    const delay = Math.min(3000 * Math.pow(1.5, this.reconnectAttempts || 0), 30000);
    this.reconnectAttempts = (this.reconnectAttempts || 0) + 1;
    
    console.error(`[dingtalk] ${delay}ms 后尝试重连 (尝试次数: ${this.reconnectAttempts})`);
    
    this.reconnectTimer = setTimeout(() => {
      if (this.running) {
        console.error('[dingtalk] 尝试重连...');
        this.start().catch(err => {
          console.error('[dingtalk] 重连失败:', err.message);
        });
      }
    }, delay);
  }
  
  /**
   * 睡眠函数
   * @private
   * @param {number} ms - 毫秒数
   * @returns {Promise}
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { DingtalkAdapter };