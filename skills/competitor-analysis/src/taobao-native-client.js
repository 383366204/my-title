'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const { firstElementIndex } = require('./page-parser');

const execFileAsync = promisify(execFile);

class TaobaoNativeError extends Error {
  constructor(message, code = 'TAOBAO_NATIVE_FAILED', details = {}) {
    super(message);
    this.name = 'TaobaoNativeError';
    this.code = code;
    this.details = details;
  }
}

function parseToolOutput(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return {};
  try {
    const payload = JSON.parse(text);
    if (payload.error) {
      const message = String(payload.error);
      let code = 'TAOBAO_NATIVE_TOOL_ERROR';
      if (/未登录|登录页面|login/i.test(message)) {
        code = 'TAOBAO_LOGIN_REQUIRED';
      } else if (/安全验证|验证码|滑块|verify|captcha/i.test(message)) {
        code = 'TAOBAO_SECURITY_VERIFICATION_REQUIRED';
      } else if (/内测期间仅开放部分用户|暂未开放|尚未开放/i.test(message)) {
        code = 'TAOBAO_NATIVE_ACCESS_RESTRICTED';
      } else if (/执行层未就绪|应用已加载完成|tool.*not ready/i.test(message)) {
        code = 'TAOBAO_NATIVE_NOT_READY';
      }
      throw new TaobaoNativeError(message, code, payload);
    }
    return payload.result ?? payload;
  } catch (error) {
    if (error instanceof TaobaoNativeError) throw error;
    throw new TaobaoNativeError(`淘宝客户端返回了无法识别的数据：${error.message}`, 'TAOBAO_NATIVE_INVALID_OUTPUT');
  }
}

/**
 * Thin process adapter around the installed taobao-native CLI.
 */
class TaobaoNativeClient {
  /**
   * @param {object} [options] Client options.
   * @param {string} [options.command] CLI executable.
   * @param {string} [options.sourceApp] Source application label.
   * @param {number} [options.timeoutMs] Per-command timeout.
   */
  constructor(options = {}) {
    this.command = options.command || process.env.TAOBAO_NATIVE_PATH || 'taobao-native';
    this.sourceApp = options.sourceApp || 'ecom-ai-tools';
    this.timeoutMs = Math.max(5000, Number(options.timeoutMs) || 30000);
  }

  async call(tool, args = {}) {
    try {
      const result = await execFileAsync(this.command, [tool, '--args', JSON.stringify({ ...args, sourceApp: this.sourceApp })], {
        timeout: this.timeoutMs,
        maxBuffer: 12 * 1024 * 1024,
        encoding: 'utf8'
      });
      return parseToolOutput(result.stdout);
    } catch (error) {
      if (error instanceof TaobaoNativeError) throw error;
      if (String(error.stdout || '').trim().startsWith('{')) {
        try {
          return parseToolOutput(error.stdout);
        } catch (outputError) {
          if (outputError instanceof TaobaoNativeError) throw outputError;
        }
      }
      const unavailable = error.code === 'ENOENT' || /not found|ENOENT/i.test(String(error.message || ''));
      const timedOut = error.killed || error.code === 'ETIMEDOUT';
      throw new TaobaoNativeError(
        unavailable
          ? '未找到淘宝客户端命令，请先安装或启动淘宝桌面版。'
          : timedOut
            ? '淘宝客户端操作超时，请检查页面是否出现登录或安全验证。'
            : `淘宝客户端操作失败：${error.stderr || error.message}`,
        unavailable ? 'TAOBAO_NATIVE_UNAVAILABLE' : timedOut ? 'TAOBAO_NATIVE_TIMEOUT' : 'TAOBAO_NATIVE_FAILED',
        { tool, stderr: error.stderr || '' }
      );
    }
  }

  navigateToUrl(url) { return this.call('navigate_to_url', { url }); }
  navigate(page = 'home') { return this.call('navigate', { page }); }
  getCurrentTab() { return this.call('get_current_tab'); }
  readPageContent(maxLength = 20000) { return this.call('read_page_content', { maxLength }); }
  scanPageElements(filter = '') { return this.call('scan_page_elements', filter ? { filter } : {}); }
  clickElement(index) { return this.call('click_element', { index }); }
  closePage() { return this.call('close_page'); }
  scrollPage(direction = 'down') { return this.call('scroll_page', { direction }); }

  async clickByText(label) {
    const scan = await this.scanPageElements(label);
    const index = firstElementIndex(scan.dom, label);
    if (!Number.isFinite(index)) {
      throw new TaobaoNativeError(`淘宝页面上没有找到“${label}”按钮。`, 'TAOBAO_ELEMENT_NOT_FOUND', { label });
    }
    return this.clickElement(index);
  }
}

module.exports = {
  TaobaoNativeClient,
  TaobaoNativeError,
  parseToolOutput
};
