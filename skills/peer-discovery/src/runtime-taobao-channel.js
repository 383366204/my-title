'use strict';
/**
 * 自动模式使用网页通道，显式选择保持不变。
 * @param {object} options 运行配置。
 * @returns {string} web 或 native。
 */
function resolveRuntimeTaobaoChannel(options = {}) {
  const channel = options.params?.resolvedTaobaoChannel || options.resolvedTaobaoChannel || options.channel || options.params?.taobaoChannel || options.taobaoChannel || 'auto';
  if (!['auto', 'web', 'native'].includes(channel)) throw new Error('淘宝采集通道无效');
  return channel === 'auto' ? 'web' : channel;
}
module.exports = { resolveRuntimeTaobaoChannel };
