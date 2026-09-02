'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { fitImageBox } = require('../excel-image');
const { readImageDimensions } = require('../image-format');

function pngHeader(width, height) {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function gifHeader(width, height) {
  const buf = Buffer.alloc(24);
  buf.write('GIF89a', 0, 'ascii');
  buf.writeUInt16LE(width, 6);
  buf.writeUInt16LE(height, 8);
  return buf;
}

function jpegHeader(width, height) {
  // SOI + APP0(含长度) + SOF0(含高宽)
  const buf = Buffer.alloc(2 + 2 + 16 + 2 + 17);
  let i = 0;
  buf[i++] = 0xff; buf[i++] = 0xd8;
  buf[i++] = 0xff; buf[i++] = 0xe0;
  buf.writeUInt16BE(18, i); i += 2; i += 16;
  buf[i++] = 0xff; buf[i++] = 0xc0;
  buf.writeUInt16BE(17, i); i += 2;
  buf[i++] = 8;
  buf.writeUInt16BE(height, i); i += 2;
  buf.writeUInt16BE(width, i);
  return buf;
}

describe('excel image helpers', () => {
  it('reads pixel dimensions from png, gif and jpeg headers', () => {
    assert.deepEqual(readImageDimensions(pngHeader(1600, 1066)), { width: 1600, height: 1066 });
    assert.deepEqual(readImageDimensions(gifHeader(320, 240)), { width: 320, height: 240 });
    assert.deepEqual(readImageDimensions(jpegHeader(960, 540)), { width: 960, height: 540 });
    assert.equal(readImageDimensions(Buffer.alloc(10)), null, '过短的字节流不应猜尺寸');
    assert.equal(readImageDimensions(Buffer.from('524946462400000057454250', 'hex')), null, 'WebP 不参与嵌入');
  });

  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} 应约等于 ${expected}`);

  it('scales down proportionally without distorting the aspect ratio', () => {
    const landscape = fitImageBox({ width: 1600, height: 1066 }, 110, 96);
    near(landscape.width, 110, '横图应按宽撑满');
    assert.ok(Math.abs(landscape.width / landscape.height - 1600 / 1066) < 1e-6, '横图比例必须保持 1600:1066');

    const portrait = fitImageBox({ width: 900, height: 1600 }, 110, 96);
    near(portrait.height, 96, '竖图应按高撑满');
    assert.ok(Math.abs(portrait.width / portrait.height - 900 / 1600) < 1e-6, '竖图比例必须保持 900:1600');

    const ultraWide = fitImageBox({ width: 4000, height: 1000 }, 110, 96);
    near(ultraWide.width, 110);
    assert.ok(Math.abs(ultraWide.width / ultraWide.height - 4) < 1e-6, '超宽图也不能被拉成方形');
  });

  it('never upscales a smaller original and falls back to the full box when size is unknown', () => {
    assert.deepEqual(fitImageBox({ width: 50, height: 40 }, 110, 96), { width: 50, height: 40 }, '小图放大只会更糊');
    assert.deepEqual(fitImageBox(null, 110, 96), { width: 110, height: 96 });
    assert.deepEqual(fitImageBox({ width: 0, height: 10 }, 110, 96), { width: 110, height: 96 });
  });
});
