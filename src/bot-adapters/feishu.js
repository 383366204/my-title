const { BaseAdapter } = require('./base');
const lark = require('@larksuiteoapi/node-sdk');

/**
 * 飞书适配器，使用 WebSocket 长连接
 * 文档：https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/event-subscription-guide/long-connection-mode
 */
class FeishuAdapter extends BaseAdapter {
  constructor(config) {
    super({ ...config, platform: 'feishu' });
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.client = null;
    this.wsClient = null;
    this.running = false;
  }

  async start() {
    if (!this.appId || !this.appSecret) {
      throw new Error('飞书适配器需要 appId 和 appSecret');
    }

    this.client = new lark.Client({
      appId: this.appId,
      appSecret: this.appSecret,
      disableTokenCache: false,
    });

    this.wsClient = new lark.WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
      loggerLevel: lark.LoggerLevel.info,
    });

    try {
      await this.wsClient.start({
        eventDispatcher: new lark.EventDispatcher({}).register({
          'im.message.receive_v1': async (data) => {
            await this._handleIncomingEvent(data);
          }
        })
      });
      
      this.running = true;
      console.error('[feishu] WebSocket 长连接已启动');
    } catch (error) {
      console.error('[feishu] 启动失败:', error.message);
      throw error;
    }
  }

  async stop() {
    this.running = false;
    if (this.wsClient) {
      this.wsClient.close({ force: true });
      this.wsClient = null;
    }
    console.error('[feishu] 已停止');
  }

  /**
   * 发送文本消息
   * @param {string} chatId - 聊天 ID（群聊或私聊）
   * @param {string} text - 消息内容
   */
  async sendMessage(chatId, text) {
    if (!this.client) {
      throw new Error('飞书客户端未初始化');
    }

    try {
      const response = await this.client.im.v1.messages.create({
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
        params: {
          receive_id_type: chatId.startsWith('oc_') ? 'chat_id' : 'open_id',
        },
      });
      
      return response;
    } catch (error) {
      console.error('[feishu] 发送消息失败:', error.message);
      throw error;
    }
  }

  /**
   * 发送卡片消息
   * @param {string} chatId - 聊天 ID
   * @param {object} cardData - 卡片数据，来自 formatter.formatAsFeishuCard
   */
  async sendCard(chatId, cardData) {
    if (!this.client) {
      throw new Error('飞书客户端未初始化');
    }

    try {
      const response = await this.client.im.v1.messages.create({
        data: {
          receive_id: chatId,
          msg_type: 'interactive',
          content: JSON.stringify(cardData),
        },
        params: {
          receive_id_type: chatId.startsWith('oc_') ? 'chat_id' : 'open_id',
        },
      });
      
      return response;
    } catch (error) {
      console.error('[feishu] 发送卡片失败:', error.message);
      throw error;
    }
  }

  async _handleIncomingEvent(event) {
    try {
      if (event.header.event_type !== 'im.message.receive_v1') {
        return;
      }

      const message = event.event.message;
      const chatId = message.chat_id;
      const msgType = message.message_type;
      const chatType = message.chat_type;

      if (msgType !== 'text') {
        return;
      }

      if (chatType !== 'group' && chatType !== 'p2p') {
        return;
      }

      let content;
      try {
        content = JSON.parse(message.content);
      } catch (e) {
        console.error('[feishu] 消息内容解析失败:', e.message);
        return;
      }

      const text = this._extractTextFromContent(content);
      
      if (text && text.trim()) {
        await this._handleMessage(chatId, text.trim(), { rawEvent: event });
      }
    } catch (error) {
      console.error('[feishu] 处理消息事件失败:', error.message);
    }
  }

  _extractTextFromContent(content) {
    if (!content || !content.text) {
      return '';
    }

    const text = content.text.replace(/@_user_\d+\s*/g, '').trim();
    return text;
  }
}

module.exports = { FeishuAdapter };