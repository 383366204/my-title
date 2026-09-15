import assert from 'node:assert/strict';
import test from 'node:test';

import {
  autoDetectWatermarkBoxes,
  boxBlur,
  boxToPixels,
  grayscale,
  inpaintImageData,
  normalizeBox
} from '../../../apps/web/src/features/watermark/watermark-inpaint.js';

function solidImage(width = 40, height = 30, value = 100) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = value;
    data[index * 4 + 1] = value;
    data[index * 4 + 2] = value;
    data[index * 4 + 3] = 255;
  }
  return { data, width, height };
}

function paintRegion(image, rect, value) {
  for (let y = rect.top; y <= rect.bottom; y += 1) {
    for (let x = rect.left; x <= rect.right; x += 1) {
      const index = (y * image.width + x) * 4;
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
    }
  }
}

test('normalizeBox clamps coordinates into the image and keeps positive size', () => {
  assert.deepEqual(normalizeBox({ x: -0.2, y: 0.9, w: 0.5, h: -1 }), { x: 0, y: 0.9, w: 0.5, h: 0.001 });
  assert.deepEqual(normalizeBox({ x: 0.7, y: 0.1, w: 0.6, h: 0.2 }), { x: 0.7, y: 0.1, w: 0.3, h: 0.2 });
});

test('boxToPixels maps normalized boxes onto image pixels', () => {
  const rect = boxToPixels({ width: 200, height: 100 }, { x: 0.1, y: 0.2, w: 0.5, h: 0.3 });
  assert.equal(rect.left, 20);
  assert.equal(rect.top, 20);
  assert.equal(rect.right, 119);
  assert.equal(rect.bottom, 49);
});

test('grayscale downsamples and keeps dimensions under the cap', () => {
  const gray = grayscale(solidImage(400, 300), 100);
  assert.equal(gray.width <= 100 || gray.height <= 100, true);
  assert.equal(Math.abs(gray.width / gray.height - 4 / 3) < 0.02, true);
});

test('boxBlur returns a background estimate of the same size', () => {
  const gray = grayscale(solidImage(60, 40), 60);
  const blurred = boxBlur(gray, 4);
  assert.equal(blurred.length, gray.width * gray.height);
  assert.equal(Math.max(...blurred), 100);
});

test('auto detection finds a bright overlay on a dark background', () => {
  const image = solidImage(400, 300, 60);
  paintRegion(image, { left: 300, top: 20, right: 360, bottom: 70 }, 235);
  const boxes = autoDetectWatermarkBoxes(image, { minAreaRatio: 0.002 });
  assert.equal(boxes.length >= 1, true);
  const box = boxes[0];
  assert.equal(box.x > 0.6 && box.y < 0.4 && box.w > 0.05 && box.h > 0.05, true);
});

test('auto detection works on large images after downsampling', () => {
  // 回归：面积阈值曾按原图计算，3000x2000 大图会把降采样后的小水印全部过滤掉
  const image = solidImage(3000, 2000, 80);
  paintRegion(image, { left: 400, top: 900, right: 750, bottom: 960 }, 230);
  const boxes = autoDetectWatermarkBoxes(image);
  assert.equal(boxes.length >= 1, true);
  assert.equal(boxes[0].x > 0.08 && boxes[0].x < 0.16, true);
  assert.equal(boxes[0].y > 0.38 && boxes[0].y < 0.48, true);
});

test('auto detection merges separated text strokes into one watermark box', () => {
  // 模拟五个独立笔画组成的文字水印（间隙 50px），应合并为一个框而不是 5 个碎框
  const image = solidImage(1600, 1200, 70);
  for (let stroke = 0; stroke < 5; stroke += 1) {
    paintRegion(image, { left: 300 + stroke * 90, top: 500, right: 340 + stroke * 90, bottom: 540 }, 225);
  }
  const boxes = autoDetectWatermarkBoxes(image);
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].x < 0.2 && boxes[0].x + boxes[0].w > 0.42, true);
});test('inpaint fills a bright watermark region with surrounding content', () => {
  const image = solidImage(80, 60, 90);
  paintRegion(image, { left: 10, top: 10, right: 40, bottom: 30 }, 250);
// 框必须完整罩住水印并留出暗色边缘，否则边缘残留会被扩散回洞里（与真实表现一致）
  const repaired = inpaintImageData(image, [{ x: 0.1, y: 0.11, w: 0.42, h: 0.4 }]);
  let maxLuminance = 0;
  for (let y = 12; y <= 28; y += 1) {
    for (let x = 12; x <= 38; x += 1) {
      const index = (y * 80 + x) * 4;
      maxLuminance = Math.max(maxLuminance, repaired[index]);
    }
  }
  assert.equal(maxLuminance < 130, true, `修复区域应接近背景 90，实际峰值 ${maxLuminance}`);
});

test('inpaint keeps pixels outside watermark boxes untouched', () => {
  const image = solidImage(40, 30, 120);
  const repaired = inpaintImageData(image, [{ x: 0.6, y: 0.6, w: 0.2, h: 0.2 }]);
  assert.deepEqual(Array.from(repaired.slice(0, 8)), Array.from(image.data.slice(0, 8)));
});

test('inpaint returns a copy and does not mutate the source', () => {
  const image = solidImage(30, 20, 50);
  const before = Array.from(image.data.slice());
  inpaintImageData(image, [{ x: 0.2, y: 0.2, w: 0.3, h: 0.3 }]);
  assert.deepEqual(Array.from(image.data), before);
});