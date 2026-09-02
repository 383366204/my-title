'use strict';

/**
 * 可以安全写进 xlsx 的图片格式。WebP 不在其中：新版 Excel 会嗅探字节所以本机能看到，
 * 旧版 Excel、WPS 和手机端按声明的 jpeg 解码会直接画成空白。
 * @type {ReadonlyArray<string>}
 */
const EMBEDDABLE_IMAGE_FORMATS = Object.freeze(['jpeg', 'png', 'gif']);

/**
 * 按字节魔数判定图片真实格式，不信任 Content-Type 与 URL 后缀。
 * @param {Buffer|ArrayBuffer|Uint8Array} buffer 图片字节
 * @returns {'jpeg'|'png'|'gif'|'webp'|''} 真实格式，无法识别时返回空串
 */
function sniffImageFormat(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  // 各格式只需读到自己的魔数即可判定，WebP 靠 subarray 越界返回空串自然落空
  if (bytes.length < 4) return '';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.subarray(0, 3).toString('ascii') === 'GIF') return 'gif';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return '';
}

/**
 * 判断给定字节是否为可嵌入的图片。
 * @param {Buffer} buffer 图片字节
 * @returns {boolean} true 表示格式在 EMBEDDABLE_IMAGE_FORMATS 内
 */
function isEmbeddableImage(buffer) {
  return EMBEDDABLE_IMAGE_FORMATS.includes(sniffImageFormat(buffer));
}

/**
 * 读取图片像素尺寸，用于按比例缩放嵌入。
 * 只解析文件头，不解码像素；WebP 一律返回 null（它本来就不允许嵌入 xlsx）。
 * @param {Buffer} buffer 图片字节
 * @returns {{width:number, height:number}|null} 尺寸，读不出时返回 null
 */
function readImageDimensions(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (bytes.length < 24) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.subarray(0, 3).toString('ascii') === 'GIF') {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    // JPEG：逐段扫描到 SOFn（0xc0~0xcf，排除 DHT/DAC/DNL）才能拿到宽高
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i += 1; continue; }
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
      i += 2 + bytes.readUInt16BE(i + 2);
    }
    return null;
  }
  return null;
}

module.exports = {
  EMBEDDABLE_IMAGE_FORMATS,
  isEmbeddableImage,
  readImageDimensions,
  sniffImageFormat
};
