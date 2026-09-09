'use strict';

const WORKBENCH_OUTPUT_LIMIT_BYTES = 200 * 1024;

function addNumericCliOption(args, flag, value) {
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) {
    args.push(flag, String(num));
  }
}

/**
 * 将旧工作台参数转换为 CLI 参数数组，不经 shell 拼接。
 * @param {string} mode 流水线模式。
 * @param {string} keyword 用户关键词。
 * @param {object} options 数值选项。
 * @returns {string[]} CLI 参数。
 */
function buildWorkbenchCliArgs(mode, keyword, options) {
  const args = ['bin/cli.js', 'flow', mode];
  if (mode === 'keyword') args.push(keyword);
  args.push('--json');

  if (mode === 'daily') {
    addNumericCliOption(args, '--mine', options.mine);
    addNumericCliOption(args, '--verify', options.verify);
    addNumericCliOption(args, '--generate', options.generate);
  }
  addNumericCliOption(args, '--export', options.export);
  addNumericCliOption(args, '--products-per-keyword', options.productsPerKeyword);
  addNumericCliOption(args, '--length', options.length);
  addNumericCliOption(args, '--port', options.port);
  addNumericCliOption(args, '--pages', options.pages);

  return args;
}

/**
 * 保留日志末尾的有界输出，沿用原字节截断行为。
 * @param {string} current 已有日志。
 * @param {*} chunk 新日志片段。
 * @returns {string} 截断后的日志。
 */
function appendCappedOutput(current, chunk) {
  const buffer = Buffer.concat([Buffer.from(current), Buffer.from(String(chunk))]);
  if (buffer.length <= WORKBENCH_OUTPUT_LIMIT_BYTES) return buffer.toString('utf8');
  return buffer.subarray(buffer.length - WORKBENCH_OUTPUT_LIMIT_BYTES).toString('utf8');
}

module.exports = { buildWorkbenchCliArgs, appendCappedOutput };
