class BaseAdapter {
  constructor(config) {
    this.config = config;
    this.platform = config && config.platform;
  }
  async start() { throw new Error('子类实现'); }
  async stop() { throw new Error('子类实现'); }
  async sendMessage(chatId, text) { throw new Error('子类实现'); }
  async sendCard(chatId, cardData) { throw new Error('子类实现'); }
  async sendProgress(chatId, text) { return this.sendMessage(chatId, text); }
  async sendError(chatId, error) { return this.sendMessage(chatId, `❌ 生成失败：${error.message || error}`); }
  
  // Internal
  async _handleMessage(chatId, text, extras) {
    const cmd = this._parseCommand(text);
    if (cmd.type === 'command') {
      if (cmd.value === 'help') {
        return this.sendMessage(chatId, 
          '🤖 my-title 标题生成机器人\\n\\n' +
          '使用方法：直接发送商品关键词\\n' +
          '例如：纯银项链女高级感\\n\\n' +
          '命令：\\n/help — 显示帮助'
        );
      }
      return this.sendMessage(chatId, '未知命令，发送 /help 查看帮助');
    }
    // Keyword mode
    await this.sendProgress(chatId, '⏳ 正在提取核心词...');
    try {
      const { run } = require('../index.js');
      const result = await run(cmd.value, { maxLength: 60, silent: true });
      const formatter = require('./formatter');
      const card = formatter.formatAsCard ? formatter.formatAsCard(result, this.platform) : formatter.formatAsText(result);
      return this.sendCard(chatId, card);
    } catch (err) {
      return this.sendError(chatId, err);
    }
  }
  
  _parseCommand(text) {
    const trimmed = (text || '').trim();
    if (trimmed.startsWith('/')) return { type: 'command', value: trimmed.slice(1).trim() };
    return { type: 'keyword', value: trimmed };
  }
}
module.exports = { BaseAdapter };
