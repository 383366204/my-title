/**
 * 本地去水印核心算法（纯逻辑，无 DOM 依赖）。
 * 输入为 ImageData 形状的对象 { data, width, height }，所有区域用 0..1 的归一化坐标表示，
 * 这样同一组水印框可以直接应用到不同尺寸的批量图片上。
 */

/** 归一化一个水印框，越界部分裁掉并保证宽高为正。
 * @param {{x:number, y:number, w:number, h:number}} box 归一化水印框
 * @returns {{x:number, y:number, w:number, h:number}} 合法水印框
 */
export function normalizeBox(box) {
  const round = (value) => Math.round(value * 1e6) / 1e6;
  const x = round(Math.min(1, Math.max(0, Number(box?.x) || 0)));
  const y = round(Math.min(1, Math.max(0, Number(box?.y) || 0)));
  const w = round(Math.min(1 - x, Math.max(0.001, Number(box?.w) || 0)));
  const h = round(Math.min(1 - y, Math.max(0.001, Number(box?.h) || 0)));
  return { x, y, w, h };
}

/** 归一化框转成像素矩形。
 * @param {{width:number, height:number}} image 目标图片尺寸
 * @param {{x:number, y:number, w:number, h:number}} box 归一化水印框
 * @returns {{left:number, top:number, right:number, bottom:number}} 像素矩形（含端点）
 */
export function boxToPixels(image, box) {
  const safe = normalizeBox(box);
  return {
    left: Math.floor(safe.x * image.width),
    top: Math.floor(safe.y * image.height),
    right: Math.min(image.width - 1, Math.ceil((safe.x + safe.w) * image.width) - 1),
    bottom: Math.min(image.height - 1, Math.ceil((safe.y + safe.h) * image.height) - 1)
  };
}

function luminanceAt(data, index) {
  return 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
}

/** 生成灰度图（可选降采样，用于自动识别提速）。
 * @param {{data:ArrayLike<number>, width:number, height:number}} image 原始像素
 * @param {number} [maxEdge] 最长边上限，超出则等比降采样
 * @returns {{data:Float32Array, width:number, height:number}} 灰度图
 */
export function grayscale(image, maxEdge = 320) {
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.round(y / scale));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.round(x / scale));
      const index = (sourceY * image.width + sourceX) * 4;
      out[y * width + x] = luminanceAt(image.data, index);
    }
  }
  return { data: out, width, height };
}

/** 盒式模糊（积分图实现，一遍扫完）。
 * @param {{data:Float32Array, width:number, height:number}} gray 灰度图
 * @param {number} radius 模糊半径（像素）
 * @returns {Float32Array} 背景亮度
 */
export function boxBlur(gray, radius) {
  const { data, width, height } = gray;
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += data[y * width + x];
      integral[(y + 1) * (width + 1) + (x + 1)] = integral[y * (width + 1) + (x + 1)] + rowSum;
    }
  }
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const area = (right - left + 1) * (bottom - top + 1);
      const sum = integral[(bottom + 1) * (width + 1) + (right + 1)]
        - integral[top * (width + 1) + (right + 1)]
        - integral[(bottom + 1) * (width + 1) + left]
        + integral[top * (width + 1) + left];
      out[y * width + x] = sum / area;
    }
  }
  return out;
}

/**
 * 3x3 膨胀：把文字水印散落的笔画连成一个连通域，避免每个字各成一个碎框。
 * @param {Uint8Array} mask 二值掩码
 * @param {number} width 图宽
 * @param {number} height 图高
 * @param {number} iterations 膨胀轮数
 * @returns {Uint8Array} 膨胀后的掩码
 */
export function dilateMask(mask, width, height, iterations = 2) {
  let current = mask;
  for (let round = 0; round < iterations; round += 1) {
    const next = new Uint8Array(current.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (current[index]) {
          next[index] = 1;
          continue;
        }
        let hit = 0;
        for (let dy = -1; dy <= 1 && !hit; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            if (current[ny * width + nx]) {
              hit = 1;
              break;
            }
          }
        }
        next[index] = hit;
      }
    }
    current = next;
  }
  return current;
}

function detectBoxesOnce(image, options) {
  const gray = grayscale(image, 320);
  const brightnessThreshold = Number(options.brightnessThreshold) || 22;
  // 面积阈值必须按降采样后的识别图计算：大图按原图面积算会把小水印全部过滤掉
  const minArea = Math.max(4, Math.floor(gray.width * gray.height * (Number(options.minAreaRatio) || 0.0004)));
  const background = boxBlur(gray, Math.max(4, Math.round(Math.max(gray.width, gray.height) / 24)));
  let mask = new Uint8Array(gray.width * gray.height);
  for (let y = 2; y < gray.height - 2; y += 1) {
    for (let x = 2; x < gray.width - 2; x += 1) {
      const index = y * gray.width + x;
      const bright = gray.data[index] - background[index];
      const gx = Math.abs(gray.data[index + 2] - gray.data[index - 2]);
      const gy = Math.abs(gray.data[index + gray.width * 2] - gray.data[index - gray.width * 2]);
      if (bright > brightnessThreshold && gx + gy > 8) mask[index] = 1;
    }
  }
  mask = dilateMask(mask, gray.width, gray.height, 2);
  const seen = new Uint8Array(mask.length);
  const components = [];
  const queue = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail += 1] = start;
    seen[start] = 1;
    let area = 0;
    let minX = gray.width;
    let maxX = 0;
    let minY = gray.height;
    let maxY = 0;
    while (head < tail) {
      const index = queue[head += 1];
      const x = index % gray.width;
      const y = (index - x) / gray.width;
      area += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const neighbors = [index - 1, index + 1, index - gray.width, index + gray.width];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || neighbor >= mask.length || seen[neighbor] || !mask[neighbor]) continue;
        seen[neighbor] = 1;
        queue[tail += 1] = neighbor;
      }
    }
    if (area >= minArea) components.push({ minX, maxX, minY, maxY, area });
  }
  // 同一行、间距与字高相当的字符框合并成一个水印框（"某某旗舰店"不该拆成 5 个框）
  let merged = components.map((component) => ({ ...component }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < merged.length && !changed; i += 1) {
      for (let j = i + 1; j < merged.length; j += 1) {
        const a = merged[i];
        const b = merged[j];
        const gapX = Math.max(a.minX - b.maxX, b.minX - a.maxX);
        const gapY = Math.max(a.minY - b.maxY, b.minY - a.maxY);
        const referenceHeight = Math.max(4, Math.min(a.maxY - a.minY, b.maxY - b.minY));
        if (gapX <= Math.max(12, referenceHeight * 1.2) && gapY <= Math.max(6, referenceHeight * 0.5)) {
          merged[i] = {
            minX: Math.min(a.minX, b.minX),
            maxX: Math.max(a.maxX, b.maxX),
            minY: Math.min(a.minY, b.minY),
            maxY: Math.max(a.maxY, b.maxY),
            area: a.area + b.area
          };
          merged.splice(j, 1);
          changed = true;
          break;
        }
      }
    }
  }
  merged = merged.filter((component) => component.area >= minArea || (component.maxX - component.minX) * (component.maxY - component.minY) >= minArea);
  components.length = 0;
  components.push(...merged);
  components.sort((left, right) => right.area - left.area);
  const padding = 0.012;
  return components.slice(0, Math.max(1, Number(options.maxBoxes) || 6)).map(({ minX, maxX, minY, maxY }) => normalizeBox({
    x: (minX - 2) / gray.width - padding,
    y: (minY - 2) / gray.height - padding,
    w: (maxX - minX + 5) / gray.width + padding * 2,
    h: (maxY - minY + 5) / gray.height + padding * 2
  }));
}

/**
 * 自动识别疑似水印区域：半透明白色水印会局部抬高亮度且带文字边缘，
 * 用「局部亮于背景 + 梯度活跃」的连通域找外接矩形，返回归一化坐标供人工确认。
 * 第一档阈值找不到时会用更低的第二档重试一次，覆盖对比度较弱的半透明水印。
 * @param {{data:ArrayLike<number>, width:number, height:number}} image 原始像素
 * @param {object} [options] 选项
 * @param {number} [options.maxBoxes] 最多返回区域数
 * @param {number} [options.brightnessThreshold] 高于背景的亮度阈值
 * @param {number} [options.minAreaRatio] 最小连通域面积占比
 * @returns {{x:number, y:number, w:number, h:number}[]} 归一化水印框
 */
export function autoDetectWatermarkBoxes(image, options = {}) {
  const primary = Number(options.brightnessThreshold) || 22;
  const primaryBoxes = detectBoxesOnce(image, { ...options, brightnessThreshold: primary });
  if (primaryBoxes.length > 0) return primaryBoxes;
  return detectBoxesOnce(image, { ...options, brightnessThreshold: Math.max(10, Math.round(primary * 0.6)) });
}
/**
 * 基于边界扩散的图像修复：先用已知像素从掩码边界向内逐层填充，
 * 再做若干轮拉普拉斯松弛，让水印区域被周围内容自然"长"过去。
 * @param {{data:ArrayLike<number>, width:number, height:number}} image 原始像素
 * @param {Array<{x:number, y:number, w:number, h:number}>} boxes 归一化水印框
 * @param {object} [options] 选项
 * @param {number} [options.relaxPasses] 松弛轮数
 * @returns {Uint8ClampedArray} 修复后的 RGBA 像素
 */
export function inpaintImageData(image, boxes, options = {}) {
  const { width, height } = image;
  const output = new Uint8ClampedArray(image.data);
  if (!Array.isArray(boxes) || boxes.length === 0 || width < 2 || height < 2) return output;

  // hole 标记原始水印位置，整个修复过程保持不变；filled 表示该像素是否已有可用颜色。
  const hole = new Uint8Array(width * height);
  const filled = new Uint8Array(width * height);
  for (let index = 0; index < hole.length; index += 1) filled[index] = 1;
  for (const box of boxes) {
    const rect = boxToPixels(image, box);
    for (let y = rect.top; y <= rect.bottom; y += 1) {
      for (let x = rect.left; x <= rect.right; x += 1) {
        const index = y * width + x;
        hole[index] = 1;
        filled[index] = 0;
      }
    }
  }
  const isHole = (index) => hole[index] === 1;

  // 第一阶段：洋葱式填充。每轮把「挨着已填充像素」的洞设为邻居均值，由边界向内推进。
  let remaining = 0;
  for (let index = 0; index < hole.length; index += 1) if (isHole(index)) remaining += 1;
  let guard = 0;
  while (remaining > 0 && guard < 4096) {
    guard += 1;
    const fills = [];
    for (let index = 0; index < hole.length; index += 1) {
      if (filled[index]) continue;
      const x = index % width;
      const y = (index - x) / width;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let count = 0;
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1
      ];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || !filled[neighbor]) continue;
        const offset = neighbor * 4;
        sumR += output[offset];
        sumG += output[offset + 1];
        sumB += output[offset + 2];
        count += 1;
      }
      if (count > 0) fills.push([index, sumR / count, sumG / count, sumB / count]);
    }
    if (fills.length === 0) break;
    for (const [index, r, g, b] of fills) {
      const offset = index * 4;
      output[offset] = r;
      output[offset + 1] = g;
      output[offset + 2] = b;
      output[offset + 3] = 255;
      filled[index] = 1;
    }
    remaining -= fills.length;
  }

  // 第二阶段：高斯-赛德尔松弛。原地更新洞内像素，立即使用本轮新值，
  // 免去双缓冲的大数组拷贝，对扩散类修复收敛也更快。
  const relaxPasses = Math.min(1200, Math.max(120, Number(options.relaxPasses) || 400));
  const blend = 0.95;
  for (let pass = 0; pass < relaxPasses; pass += 1) {
    for (let index = 0; index < hole.length; index += 1) {
      if (!isHole(index)) continue;
      const x = index % width;
      const y = (index - x) / width;
      const hasLeft = x > 0;
      const hasRight = x < width - 1;
      const hasUp = y > 0;
      const hasDown = y < height - 1;
      const neighborCount = (hasLeft ? 1 : 0) + (hasRight ? 1 : 0) + (hasUp ? 1 : 0) + (hasDown ? 1 : 0);
      if (neighborCount === 0) continue;
      const base = index * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0;
        if (hasLeft) sum += output[base - 4 + channel];
        if (hasRight) sum += output[base + 4 + channel];
        if (hasUp) sum += output[base - width * 4 + channel];
        if (hasDown) sum += output[base + width * 4 + channel];
        const average = sum / neighborCount;
        output[base + channel] = output[base + channel] * (1 - blend) + average * blend;
      }
    }
  }
  return output;
}