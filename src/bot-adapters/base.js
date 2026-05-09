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
           '/查词 关键词 — 查询生意参谋热搜词（支持批量）\n' +
           '/查词蓝海 关键词 — 查询相关蓝海词（支持批量）\n' +
           '/选品 关键词 — 生成选品标题\n' +
           '/搜索 关键词 — 搜索1688商品\n' +
           '/分析 关键词 — 分析关键词结构\n\n' +
          '直接发送关键词可生成选品标题'
        );
      }
      if (cmd.value === '链接') {
        return this._handleLink(chatId, cmd.arg);
      }
      if (cmd.value === '查词' || cmd.value.indexOf('查词 ') === 0) {
        var keyword = cmd.value.replace(/^查词\s*/, '') || cmd.arg;
        return this._handleSycmQuery(chatId, keyword);
      }
      if (cmd.value === '查词蓝海' || cmd.value.indexOf('查词蓝海 ') === 0) {
        var blueKeyword = cmd.value.replace(/^查词蓝海\s*/, '') || cmd.arg;
        return this._handleSycmQuery(chatId, blueKeyword, 'blue');
      }
      if (cmd.value === '选品' || cmd.value.indexOf('选品 ') === 0) {
        var selectKeyword = cmd.value.replace(/^选品\s*/, '') || cmd.arg;
        if (!selectKeyword) {
          return this.sendMessage(chatId, '请输入关键词，例如：/选品 纯银项链女');
        }
        try {
          const { run } = require('../index.js');
          const result = await run(selectKeyword, { maxLength: 60, silent: true });
          const formatter = require('./formatter');
          const text = formatter.formatAsText(result);
          return this.sendCard(chatId, text);
        } catch (err) {
          return this.sendError(chatId, err);
        }
      }
      if (cmd.value === '搜索' || cmd.value.indexOf('搜索 ') === 0) {
        var searchKeyword = cmd.value.replace(/^搜索\s*/, '') || cmd.arg;
        if (!searchKeyword) {
          return this.sendMessage(chatId, '请输入关键词，例如：/搜索 纯银项链女');
        }
        try {
          const GLMClient = require('../glm-client.js');
          const glmClient = new GLMClient({ apiKey: process.env.GLM_API_KEY, apiBase: process.env.GLM_API_BASE, model: process.env.GLM_API_MODEL });
          const extraction = await glmClient.extractCoreAndModifiers(searchKeyword);
          const { coreWord, modifiers, semanticGroups } = extraction;
          const searchAll = require('../search-1688').searchAll;
          const products = await searchAll(coreWord, searchKeyword, modifiers, semanticGroups);
          const formatter = require('./formatter');
          const text = formatter.formatSearchResult({ coreWord, blueOceanWord: searchKeyword, modifiers, products });
          return this.sendMessage(chatId, text);
        } catch (error) {
          return this.sendError(chatId, error);
        }
      }
      if (cmd.value === '分析' || cmd.value.indexOf('分析 ') === 0) {
        var analyzeKeyword = cmd.value.replace(/^分析\s*/, '') || cmd.arg;
        if (!analyzeKeyword) {
          return this.sendMessage(chatId, '请输入关键词，例如：/分析 纯银项链女');
        }
        try {
          const GLMClient = require('../glm-client.js');
          const glmClient = new GLMClient({ apiKey: process.env.GLM_API_KEY, apiBase: process.env.GLM_API_BASE, model: process.env.GLM_API_MODEL });
          const extraction = await glmClient.extractCoreAndModifiers(analyzeKeyword);
          const { coreWord, modifiers, semanticGroups } = extraction;
          const formatter = require('./formatter');
          const text = formatter.formatAnalysisResult({ coreWord, blueOceanWord: analyzeKeyword, modifiers, semanticGroups });
          return this.sendMessage(chatId, text);
        } catch (error) {
          return this.sendError(chatId, error);
        }
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
  async _handleSycmQuery(chatId, keyword, mode) {
    if (!keyword) {
      return this.sendMessage(chatId, '请输入查询关键词，例如：\n/查词 耳钉 — 查询相关热搜词\n/查词蓝海 耳钉 — 查询相关蓝海词\n\n支持批量：/查词 耳钉 项链 手链\n需要 Chrome 调试模式运行中。');
    }

    try {
      const { isChromeDevToolsAvailable, generateChromeLaunchCommand } = require('../sycm-browser-helper');
      const { extractSycmData } = require('../sycm-cdp-extractor');

      const chromeAvailable = await isChromeDevToolsAvailable(9222);
      if (!chromeAvailable) {
        const launchCmd = generateChromeLaunchCommand({ port: 9222 });
        return this.sendMessage(chatId, '❌ Chrome 未运行调试模式\n\n请先启动：\n' + launchCmd.command);
      }

      var keywords = keyword.split(/[\s,，]+/).filter(function(k) { return k.trim(); });
      var isBatch = keywords.length > 1;
      var modeLabel = (mode === 'blue') ? '蓝海词' : '热搜词';
      var fields = ['searchPopularity', 'clickRate', 'conversionRate', 'buyerCount', 'demandSupplyRatio', 'tmallClickShare'];
      var fieldLabels = ['搜索人气', '点击率', '支付转化率', '支付买家数', '需求供给比', '天猫商品点击占比'];
      var pctFields = { clickRate: true, conversionRate: true, tmallClickShare: true };
      var allLines = [];
      var displayCount = isBatch ? 5 : 10;

      for (var ki = 0; ki < keywords.length; ki++) {
        var kw = keywords[ki];
        if (isBatch) {
          await this.sendProgress(chatId, '⏳ [' + (ki + 1) + '/' + keywords.length + '] 正在查询 ' + kw + '...');
        } else {
          await this.sendProgress(chatId, '⏳ 正在连接 Chrome 并查询生意参谋...');
        }

        try {
          var result = await extractSycmData(kw, {
            port: 9222,
            maxPages: 1,
            mode: mode || 'hot'
          });

          if (!result.data || result.data.length === 0) {
            allLines.push('📊 ' + kw + ' 【' + modeLabel + '】— 无数据');
            continue;
          }

          allLines.push('📊 ' + kw + ' 【' + modeLabel + '】(' + result.totalCount + '条)');
           var seenKw = {};
           var deduped = [];
           for (var di = 0; di < result.data.length; di++) {
             var dk = result.data[di].keyword;
             if (dk && !seenKw[dk]) { seenKw[dk] = true; deduped.push(result.data[di]); }
           }
           var count = Math.min(deduped.length, displayCount);
           for (var i = 0; i < count; i++) {
             var row = deduped[i];
            var rkw = (row.keyword || '?');
            if (rkw.endsWith('搜索词')) {
              rkw = rkw.replace(/搜索词$/, '') + ' 【搜索词】';
            }
            var line = (i + 1) + '. ' + rkw;
            for (var f = 0; f < fields.length; f++) {
              var v = row[fields[f]];
              var displayVal = v != null ? v : '-';
              if (pctFields[fields[f]] && typeof v === 'number') {
                displayVal = v + '%';
              }
              line += '\n   ' + fieldLabels[f] + ': ' + displayVal;
            }
            allLines.push(line);
          }
          if (deduped.length > displayCount) {
            allLines.push('   ... 还有 ' + Math.max(0, deduped.length - displayCount) + ' 条');
          }
        } catch (err) {
          allLines.push('📊 ' + kw + ' — ❌ ' + (err.message || '查询失败'));
        }

        if (ki < keywords.length - 1) {
          allLines.push('');
        }
      }

      allLines.push('', '⏱ ' + new Date().toLocaleString('zh-CN'));
      return this.sendMessage(chatId, allLines.join('\n'));
    } catch (error) {
      return this.sendError(chatId, error);
    }
  }
}
module.exports = { BaseAdapter };
