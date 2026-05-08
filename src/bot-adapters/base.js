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
          '🤖 my-title 标题生成机器人\n\n' +
          '命令：\n' +
          '/help — 显示帮助\n' +
          '/链接 1688链接 — 从1688商品链接生成标题\n' +
          '/查词 关键词 — 查询生意参谋搜索分析数据\n\n' +
          '直接发送关键词可生成选品标题'
        );
      }
      if (cmd.value === '链接') {
        return this._handleLink(chatId, cmd.arg);
      }
      if (cmd.value.indexOf('查词') === 0) {
        var keyword = cmd.value.replace(/^查词\s*/, '') || cmd.arg;
        return this._handleSycmQuery(chatId, keyword);
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
    if (trimmed.startsWith('/')) {
      const rest = trimmed.slice(1).trim();
      const spaceIdx = rest.indexOf(' ');
      if (spaceIdx === -1) return { type: 'command', value: rest, arg: '' };
      return { type: 'command', value: rest.slice(0, spaceIdx).trim(), arg: rest.slice(spaceIdx + 1).trim() };
    }
    return { type: 'keyword', value: trimmed };
  }

  /**
   * 处理 /链接 命令 — 从1688商品详情页URL生成标题（飞书/钉钉共用）
   * @private
   */
  async _handleLink(chatId, url) {
    if (!url) {
      return this.sendMessage(chatId, '请输入1688商品链接，例如：/链接 https://detail.1688.com/offer/123456.html');
    }
    if (!url.includes('1688') && !url.includes('detail.1688.com')) {
      return this.sendMessage(chatId, '❌ 请提供1688商品详情页链接（detail.1688.com）');
    }
    try {
      await this.sendProgress(chatId, '⏳ 正在解析1688链接并搜图...');
      const { runFromImage } = require('../index.js');
      const result = await runFromImage(url, { maxLength: 60, silent: true });
      if (!result || !result.titles || result.titles.length === 0) {
        return this.sendMessage(chatId, '❌ 未能从该链接生成标题，请确认链接有效');
      }
      const formatter = require('./formatter');
      const text = formatter.formatAsText(result);
      return this.sendMessage(chatId, text);
    } catch (error) {
      return this.sendError(chatId, error);
    }
  }

  /**
   * 处理 /查词 命令 — 查询生意参谋搜索分析数据（飞书/钉钉共用）
   * @private
   */
  async _handleSycmQuery(chatId, keyword) {
    if (!keyword) {
      return this.sendMessage(chatId, '请输入查询关键词，例如：/查词 耳钉\n\n返回生意参谋搜索分析数据（搜索人气、点击率、支付转化率等），需要 Chrome 调试模式运行中。');
    }

    try {
      await this.sendProgress(chatId, '⏳ 正在连接 Chrome 并查询生意参谋...');

      const { isChromeDevToolsAvailable, generateChromeLaunchCommand } = require('../sycm-browser-helper');
      const { extractSycmData } = require('../sycm-cdp-extractor');

      const chromeAvailable = await isChromeDevToolsAvailable(9222);
      if (!chromeAvailable) {
        const launchCmd = generateChromeLaunchCommand({ port: 9222 });
        return this.sendMessage(chatId, '❌ Chrome 未运行调试模式\n\n请先启动：\n' + launchCmd.command + '\n\n启动后重新发送 /查词 ' + keyword);
      }

      const result = await extractSycmData(keyword, {
        port: 9222,
        maxPages: 5
      });

      if (!result.data || result.data.length === 0) {
        return this.sendMessage(chatId, '❌ 未查询到数据，可能原因：\n1. Chrome 未登录生意参谋\n2. 关键词无搜索数据\n3. 页面加载超时');
      }

      var fields = ['searchPopularity', 'clickRate', 'conversionRate', 'buyerCount', 'demandSupplyRatio', 'tmallClickShare'];
      var fieldLabels = ['搜索人气', '点击率', '转化率', '买家数', '供需比', '天猫占比'];
      var lines = ['📊 生意参谋 — ' + keyword + ' (' + result.totalCount + '条/' + result.totalPages + '页)', ''];

      var displayCount = Math.min(result.data.length, 10);
      for (var i = 0; i < displayCount; i++) {
        var row = result.data[i];
        var line = (i + 1) + '. ' + (row.keyword || '?');
        for (var f = 0; f < fields.length; f++) {
          var v = row[fields[f]];
          var t = row[fields[f] + '_trend'];
          line += '\n   ' + fieldLabels[f] + ': ' + (v != null ? v : '-') + (t ? ' (' + t + ')' : '');
        }
        lines.push(line);
      }

      if (result.data.length > 10) {
        lines.push('', '... 还有 ' + (result.data.length - 10) + ' 条 ...');
      }
      lines.push('', '⏱ ' + new Date(result.extractedAt).toLocaleString('zh-CN'));

      return this.sendMessage(chatId, lines.join('\n'));
    } catch (error) {
      return this.sendError(chatId, error);
    }
  }
}
module.exports = { BaseAdapter };
