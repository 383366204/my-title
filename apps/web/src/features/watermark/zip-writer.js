/**
 * 极简 ZIP 打包器（仅 store 存储，不压缩）。
 * 图片本身已是压缩格式，store 即可；避免为了打包引入额外依赖。
 * 生成结构：本地文件头 + 数据 + 中央目录 + EOCD，兼容主流解压软件。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * 计算 CRC32 校验值。
 * @param {Uint8Array} bytes 输入字节
 * @returns {number} CRC32（无符号 32 位）
 */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  return { time, day };
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value & 0xffff, true);
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

/**
 * 把多个文件打包成 ZIP。
 * @param {Array<{name:string, bytes:Uint8Array}>} files 文件列表
 * @param {object} [options] 选项
 * @param {Date} [options.date] 文件时间戳
 * @returns {Uint8Array} ZIP 字节流
 */
export function createZipStore(files, options = {}) {
  const list = (Array.isArray(files) ? files : []).filter((file) => file && file.name && file.bytes);
  const encoder = new TextEncoder();
  const { time, day } = dosDateTime(options.date || new Date());
  const entries = list.map((file) => {
    const nameBytes = encoder.encode(String(file.name));
    return { nameBytes, bytes: file.bytes, crc: crc32(file.bytes) };
  });
  const localBytes = entries.reduce((total, entry) => total + 30 + entry.nameBytes.length + entry.bytes.length, 0);
  const centralBytes = entries.reduce((total, entry) => total + 46 + entry.nameBytes.length, 0);
  const buffer = new ArrayBuffer(localBytes + centralBytes + 22);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  const centralDirectory = [];

  for (const entry of entries) {
    centralDirectory.push({ offset, nameBytes: entry.nameBytes, crc: entry.crc, size: entry.bytes.length });
    writeUint32(view, offset, 0x04034b50);
    writeUint16(view, offset + 4, 20);            // version needed
    writeUint16(view, offset + 6, 0x0800);        // UTF-8 文件名
    writeUint16(view, offset + 8, 0);             // store
    writeUint16(view, offset + 10, time);
    writeUint16(view, offset + 12, day);
    writeUint32(view, offset + 14, entry.crc);
    writeUint32(view, offset + 18, entry.bytes.length);
    writeUint32(view, offset + 22, entry.bytes.length);
    writeUint16(view, offset + 26, entry.nameBytes.length);
    writeUint16(view, offset + 28, 0);            // extra length
    bytes.set(entry.nameBytes, offset + 30);
    bytes.set(entry.bytes, offset + 30 + entry.nameBytes.length);
    offset += 30 + entry.nameBytes.length + entry.bytes.length;
  }

  const centralStart = offset;
  for (const entry of centralDirectory) {
    writeUint32(view, offset, 0x02014b50);
    writeUint16(view, offset + 4, 20);            // version made by
    writeUint16(view, offset + 6, 20);            // version needed
    writeUint16(view, offset + 8, 0x0800);        // UTF-8 文件名
    writeUint16(view, offset + 10, 0);            // store
    writeUint16(view, offset + 12, time);
    writeUint16(view, offset + 14, day);
    writeUint32(view, offset + 16, entry.crc);
    writeUint32(view, offset + 20, entry.size);
    writeUint32(view, offset + 24, entry.size);
    writeUint16(view, offset + 28, entry.nameBytes.length);
    writeUint16(view, offset + 30, 0);            // extra
    writeUint16(view, offset + 32, 0);            // comment
    writeUint16(view, offset + 34, 0);            // disk number
    writeUint16(view, offset + 36, 0);            // internal attrs
    writeUint32(view, offset + 38, 0);            // external attrs
    writeUint32(view, offset + 42, entry.offset);
    bytes.set(entry.nameBytes, offset + 46);
    offset += 46 + entry.nameBytes.length;
  }

  writeUint32(view, offset, 0x06054b50);
  writeUint16(view, offset + 4, 0);
  writeUint16(view, offset + 6, 0);
  writeUint16(view, offset + 8, centralDirectory.length);
  writeUint16(view, offset + 10, centralDirectory.length);
  writeUint32(view, offset + 12, offset - centralStart);
  writeUint32(view, offset + 16, centralStart);
  writeUint16(view, offset + 20, 0);
  return bytes;
}