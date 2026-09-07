/**
 * 评价配图自动压缩：超过服务端单张上限（8MB）的 JPG/PNG 在浏览器端降尺寸 + 降质量重编码。
 * GIF 会被压成静态首帧，因此不做自动压缩，由面板提示用户转 JPG。
 */

// 逐步收紧：先只降质量，仍超限再同步降分辨率，截图凭证类图片一般第一步就能过
export const COMPRESSION_STEPS = [
  { maxEdge: 2560, quality: 0.85 },
  { maxEdge: 2048, quality: 0.72 },
  { maxEdge: 1600, quality: 0.6 },
  { maxEdge: 1280, quality: 0.5 },
  { maxEdge: 1024, quality: 0.42 }
];

export const DEFAULT_IMAGE_LIMIT_BYTES = 8 * 1024 * 1024;

/**
 * 判断文件能否自动压缩：只处理 JPG/PNG。
 * @param {File} file 待上传文件
 * @returns {boolean} true 表示可走 canvas 重编码
 */
export function canAutoCompress(file) {
  return /^image\/(jpeg|png)$/i.test(String(file?.type || ''));
}

/**
 * 按最长边计算缩放后的尺寸；小于 maxEdge 时保持原尺寸（不放大）。
 * @param {number} width 原宽
 * @param {number} height 原高
 * @param {number} maxEdge 目标最长边
 * @returns {{width:number, height:number}} 缩放后尺寸
 */
export function compressionSize(width, height, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(Number(width) || 1, Number(height) || 1));
  return {
    width: Math.max(1, Math.round((Number(width) || 1) * scale)),
    height: Math.max(1, Math.round((Number(height) || 1) * scale))
  };
}

/**
 * 压缩后文件名：统一换成 .jpg 后缀。
 * @param {string} name 原文件名
 * @returns {string} 新文件名
 */
export function compressedFileName(name) {
  const base = String(name || '图片').replace(/\.[^.]+$/, '');
  return `${base}.jpg`;
}

/**
 * 压缩图片：依序尝试 COMPRESSION_STEPS，返回第一个不超过 limitBytes 的结果；
 * 全部尝试后仍超限则返回最后一步（由调用方判断并提示）。
 * @param {File} file 原始文件
 * @param {object} [options] 选项
 * @param {number} [options.limitBytes] 目标字节数上限
 * @returns {Promise<{blob:Blob, width:number, height:number, quality:number}|null>} 压缩结果
 */
export async function compressReviewImage(file, { limitBytes = DEFAULT_IMAGE_LIMIT_BYTES } = {}) {
  const bitmap = await createImageBitmap(file);
  try {
    let best = null;
    for (const step of COMPRESSION_STEPS) {
      const { width, height } = compressionSize(bitmap.width, bitmap.height, step.maxEdge);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      // PNG 透明底转 JPG 会变黑，先铺白底
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', step.quality));
      if (!blob) continue;
      best = { blob, width, height, quality: step.quality };
      if (blob.size <= limitBytes) break;
    }
    return best;
  } finally {
    if (typeof bitmap.close === 'function') bitmap.close();
  }
}