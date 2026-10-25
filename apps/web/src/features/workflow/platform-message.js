/**
 * 将旧运行记录中的平台提示转换为中文，不改写历史文件。
 * @param {string} value 原始提示。
 * @returns {string} 展示提示。
 */
export function formatPlatformMessage(value) {
  return String(value || '')
    .replaceAll('1688 web search requires manual captcha/security verification', '1688 触发安全验证。请在当前 Chrome 的 1688 页面完成验证码或滑块验证，再点击“继续流程”。')
    .replaceAll('1688 web search requires manual login', '1688 需要登录。请在当前 Chrome 登录 1688，再点击“继续流程”。');
}
