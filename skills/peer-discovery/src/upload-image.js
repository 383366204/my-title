'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

/**
 * 将已校验的 WebP 转换成平台通用 PNG；digest 始终代表原图。
 * @param {object} image 下载器返回的 bytes、extension。
 * @param {object} options 取消信号及可注入的转换执行器。
 * @returns {Promise<object>} 可上传的图片内容。
 */
async function prepareUploadImage(image, options = {}) {
  options.signal?.throwIfAborted();
  if (['jpg', 'jpeg', 'png'].includes(image.extension)) return image;
  if (image.extension !== 'webp' || (options.platform || process.platform) !== 'darwin') {
    throw new Error('当前环境无法转换商品主图，请提供 JPEG 或 PNG 图片');
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-image-convert-'));
  try {
    const input = path.join(dir, 'source.webp');
    const output = path.join(dir, 'source.png');
    await fs.writeFile(input, image.bytes);
    await (options.execute || promisify(execFile))('/usr/bin/sips', ['-s', 'format', 'png', input, '--out', output], {
      timeout: 20000, signal: options.signal, maxBuffer: 65536,
    });
    options.signal?.throwIfAborted();
    const stat = await fs.stat(output);
    if (stat.size > 10 * 1024 * 1024) throw new Error('转换后的图片超过 10MB');
    const bytes = await fs.readFile(output);
    if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('图片转换没有生成有效 PNG');
    return { ...image, bytes, extension: 'png' };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

module.exports = { prepareUploadImage };
