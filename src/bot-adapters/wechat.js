const { BaseAdapter } = require('./base');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * 微信 iLink Bot 适配器
 * 基于 weixin-bot-sdk（ESM 模块，动态导入）
 * 启动时扫码登录，凭证自动持久化，支持会话过期重连
 */
class WechatAdapter extends BaseAdapter {
  /**
   * @param {object} config - 适配器配置
   * @param {string} [config.credentialsPath] - 凭证文件路径，默认项目根目录 .wx-credentials.json
   * @param {string} [config.label] - 账号标签，用于多实例日志区分，默认'微信'
   */
  constructor(config) {
    super({ ...config, platform: 'wechat' });
    this.label = config.label || '微信';
    this.bot = null;
    this.credentialsPath = config.credentialsPath || path.resolve(process.cwd(), '.wx-credentials.json');
    
    // 实例化 GLMClient 用于聊天和关键词分析
    const GLMClient = require('../glm-client.js');
    this.glmClient = new GLMClient({
      apiKey: process.env.GLM_API_KEY,
      apiBase: process.env.GLM_API_BASE,
      model: process.env.GLM_API_MODEL
    });
  }

  // weixin-bot-sdk 是 ESM 模块，CJS 环境需要动态导入
  async start() {
    const { WeixinBot } = await import('weixin-bot-sdk');

    this.bot = new WeixinBot({
      credentialsPath: this.credentialsPath,
    });

    this.bot.on('message', async (msg) => {
      if (msg.type !== 'text') return; // 标题生成只处理文本
      await this._handleMessage(msg.from, msg.text, {
        contextToken: msg.contextToken,
        rawMessage: msg.raw,
      });
    });

    this.bot.on('session:expired', async () => {
      console.error(`[${this.label}] 会话已过期，正在重新登录...`);
      try {
        await this._login();
        this.bot.start();
      } catch (err) {
        console.error(`[${this.label}] 重新登录失败:`, err.message);
      }
    });

    this.bot.on('error', (err) => {
      console.error(`[${this.label}] SDK 错误:`, err.message);
    });

    if (!this.bot.isLoggedIn) {
      await this._login();
    } else {
      console.error(`[${this.label}] 使用已保存的凭证登录...`);
    }

    console.error(`[${this.label}] 登录成功，开始接收消息...`);
    this.bot.start();
  }

  /**
   * @private
   */
  async _login() {
    console.error(`[${this.label}] 需要扫码登录，请用微信扫描二维码...`);
    await this.bot.login({
      onQrCode: (qrDataUrl) => {
        this._displayQrCode(qrDataUrl);
      },
      onStatus: (status) => {
        console.error(`[${this.label}] 登录状态:`, status);
      },
    });
  }

  /**
   * @private
   * @param {string} qrData - 二维码数据，可能是 data:image/png;base64,... 或 URL
   */
  _displayQrCode(qrData) {
    try {
      const base64Match = qrData.match(/^data:image\/png;base64,(.+)$/);
      if (base64Match) {
        const tmpFile = path.join(os.tmpdir(), 'wechat-bot-qr.png');
        fs.writeFileSync(tmpFile, Buffer.from(base64Match[1], 'base64'));
        console.error(`[${this.label}] 二维码已保存: ${tmpFile}`);
        if (process.env.WSL_DISTRO_NAME) {
          console.error(`[${this.label}] WSL 用户可执行: explorer.exe ${tmpFile}`);
        }
      }

      // iLink API 返回的是 URL，在终端直接渲染二维码
      if (qrData.startsWith('http')) {
        this._renderQrInTerminal(qrData);
      }
    } catch (err) {
      console.error(`[${this.label}] 显示二维码失败:`, err.message);
    }
  }

  /**
   * @private
   * @param {string} url - 二维码内容 URL
   */
  async _renderQrInTerminal(url) {
    try {
      const QRCode = await import('qrcode');
      const terminal = await QRCode.toString(url, { type: 'terminal', small: true });
      console.error('\n' + terminal);
      console.error(`[${this.label}] 请用微信扫描上方二维码登录\n`);
    } catch {
      // qrcode 包不可用时，回退到保存 URL
      console.error(`[${this.label}] 扫码链接:`, url);
    }
  }

  /**
   * 停止适配器
   */
  async stop() {
    if (this.bot) {
      this.bot.stop();
    }
    console.error(`[${this.label}] 已停止`);
  }

  /**
   * 发送文本消息（长文本自动分块）
   * @param {string} chatId - 用户 ID
   * @param {string} text - 消息内容
   */
  async sendMessage(chatId, text) {
    if (!this.bot) throw new Error('微信适配器未启动');
    // 单条消息发送，保留真实换行符（iLink API 可能渲染为分行）
    const chunks = this._chunkText(text, 3800);
    for (let i = 0; i < chunks.length; i++) {
      await this.bot.sendText(chatId, chunks[i]);
      if (i < chunks.length - 1) {
        await this._sleep(500);
      }
    }
  }

  /**
   * 发送卡片（iLink 不支持卡片，降级为文本）
   * @param {string} chatId
   * @param {object|string} cardData
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

  /**
   * 处理微信消息，支持命令路由和自由聊天
   * @override
   */
  async _handleMessage(chatId, text, extras) {
    // 命令解析：如果以 / 开头，按第一个空格分割
    if (text.startsWith('/')) {
      const spaceIndex = text.indexOf(' ');
      const command = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
      const arg = spaceIndex === -1 ? '' : text.slice(spaceIndex + 1).trim();
      
      // 处理不同命令
      switch (command) {
        case '选品':
          return await this._handleSelectProduct(chatId, arg);
        case '搜索':
          return await this._handleSearch(chatId, arg);
        case '分析':
          return await this._handleAnalyze(chatId, arg);
        case 'help':
          return await this._handleHelp(chatId);
        case '链接':
          return await this._handleLink(chatId, arg);
        default:
          return await this.sendMessage(chatId, '未知命令，发送 /help 查看帮助');
      }
    }
    
    // 自由文本：GLM 聊天
    return await this._handleChat(chatId, text);
  }

  /**
   * 处理 /选品 命令
   * @private
   */
  async _handleSelectProduct(chatId, keyword) {
    if (!keyword) {
      return await this.sendMessage(chatId, '请输入关键词，例如：/选品 纯银项链女');
    }
    
    try {
      await this.sendProgress(chatId, '⏳ 正在提取核心词...');
      const { run } = require('../index.js');
      const result = await run(keyword, { maxLength: 60, silent: true });
      const formatter = require('./formatter');
      const text = formatter.formatAsText(result);
      return await this.sendMessage(chatId, text);
    } catch (error) {
      return await this.sendError(chatId, error);
    }
  }

  /**
   * 处理 /搜索 命令
   * @private
   */
  async _handleSearch(chatId, keyword) {
    if (!keyword) {
      return await this.sendMessage(chatId, '请输入关键词，例如：/搜索 纯银项链女');
    }
    
    try {
      await this.sendProgress(chatId, '⏳ 正在搜索1688...');
      
      // 提取核心词和修饰词
      const extraction = await this.glmClient.extractCoreAndModifiers(keyword);
      const { coreWord, modifiers, semanticGroups } = extraction;
      
      // 搜索商品
      const searchAll = require('../search-1688.js').searchAll;
      const products = await searchAll(coreWord, keyword, modifiers, semanticGroups);
      
      // 格式化结果
      const formatter = require('./formatter');
      const text = formatter.formatSearchResult({
        coreWord,
        blueOceanWord: keyword,
        modifiers,
        products
      });
      
      return await this.sendMessage(chatId, text);
    } catch (error) {
      return await this.sendError(chatId, error);
    }
  }

  /**
   * 处理 /分析 命令
   * @private
   */
  async _handleAnalyze(chatId, keyword) {
    if (!keyword) {
      return await this.sendMessage(chatId, '请输入关键词，例如：/分析 纯银项链女');
    }
    
    try {
      await this.sendProgress(chatId, '⏳ 正在分析关键词...');
      
      // 提取核心词和修饰词
      const extraction = await this.glmClient.extractCoreAndModifiers(keyword);
      const { coreWord, modifiers, semanticGroups } = extraction;
      
      // 格式化分析结果
      const formatter = require('./formatter');
      const text = formatter.formatAnalysisResult({
        coreWord,
        blueOceanWord: keyword,
        modifiers,
        semanticGroups
      });
      
      return await this.sendMessage(chatId, text);
    } catch (error) {
      return await this.sendError(chatId, error);
    }
  }

  /**
   * 处理 /help 命令
   * @private
   */
  async _handleHelp(chatId) {
    const helpText = `🤖 my-title 选品助手

📋 命令列表：
/选品 关键词 - 生成选品标题（例如：/选品 纯银项链女）
/搜索 关键词 - 搜索1688商品（例如：/搜索 纯银项链女）
/分析 关键词 - 分析关键词结构（例如：/分析 纯银项链女）
/链接 1688链接 - 从1688商品链接生成标题（例如：/链接 https://detail.1688.com/offer/xxx.html）
/help - 显示此帮助信息

💬 自由聊天：
直接发送文字即可与 AI 助手对话
如果提到选品、找货等意图，助手会引导您使用 /选品 命令`;
    
    return await this.sendMessage(chatId, helpText);
  }

  /**
   * 处理 /链接 命令 — 从1688商品详情页URL生成标题
   * @private
   */
  async _handleLink(chatId, url) {
    if (!url) {
      return await this.sendMessage(chatId, '请输入1688商品链接，例如：/链接 https://detail.1688.com/offer/123456.html');
    }
    
    // 简单校验是否像1688链接
    if (!url.includes('1688') && !url.includes('detail.1688.com')) {
      return await this.sendMessage(chatId, '❌ 请提供1688商品详情页链接（detail.1688.com）');
    }
    
    try {
      await this.sendProgress(chatId, '⏳ 正在解析1688链接并搜图...');
      const { runFromImage } = require('../index.js');
      const result = await runFromImage(url, { maxLength: 60, silent: true });
      
      if (!result || !result.titles || result.titles.length === 0) {
        return await this.sendMessage(chatId, '❌ 未能从该链接生成标题，请确认链接有效');
      }
      
      const formatter = require('./formatter');
      const text = formatter.formatAsText(result);
      return await this.sendMessage(chatId, text);
    } catch (error) {
      return await this.sendError(chatId, error);
    }
  }

  /**
   * 处理自由文本聊天
   * @private
   */
  async _handleChat(chatId, text) {
    try {
      const { chat, isProductIntent } = require('./chat-handler');
      const response = await chat(text, this.glmClient);
      
      // 如果检测到产品意图，追加引导
      let finalResponse = response;
      if (isProductIntent(text)) {
        finalResponse += '\n\n💡 要生成选品标题？发送 /选品 关键词';
      }
      
      return await this.sendMessage(chatId, finalResponse);
    } catch (error) {
      return await this.sendError(chatId, error);
    }
  }
}

module.exports = { WechatAdapter };
