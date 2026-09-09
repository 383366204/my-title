'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

/**
 * 在业务路由之后挂载静态资源、SPA 兜底和请求体错误处理。
 * @param {object} app Express 应用。
 * @param {object} options 前端目录和 JSON 限制默认值。
 * @returns {void}
 */
function registerHttpFallbacks(app, { reactWebPath, jsonBodyLimit }) {
  const JSON_BODY_LIMIT = jsonBodyLimit;
  // React SPA entry. API routes must stay above this fallback.
  app.use(express.static(reactWebPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ ok: false, error: 'API not found' });
    }
    const indexPath = path.join(reactWebPath, 'index.html');
    if (!fs.existsSync(indexPath)) return next();
    res.sendFile(indexPath);
  });

  // 请求体超限时返回结构化 JSON，避免前端只拿到 HTML 报错页。
  // 注意：err.limit 是 body-parser 报出的真实命中上限——图片/表格走的是路由级 raw 限制，
  // 不是 25mb JSON 限制，混在一起报会让用户误以为还是商品数据超了。
  app.use((err, req, res, next) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413)) {
  // body-parser 把 limit 解析成字节数（如 8388608），换算成 8MB 才能给人看
      const limitBytes = Number(err.limit);
      const limit = Number.isFinite(limitBytes) && limitBytes > 0
        ? `${Number.isInteger(limitBytes / 1024 / 1024) ? limitBytes / 1024 / 1024 : (limitBytes / 1024 / 1024).toFixed(1)}MB`
        : String(err.limit || JSON_BODY_LIMIT);
      const contentType = String(req.headers['content-type'] || '').toLowerCase();
      const isImageUpload = req.path.includes('/review-assets') || contentType.startsWith('image/');
      const isSheetUpload = req.path.includes('/api/review-sheets/upload');
      const [error, userMessage] = isImageUpload
        ? [`单张图片超过上限（${limit}），请压缩图片后重试`, `单张图片不能超过 ${limit}，请压缩（建议转 JPG）后再上传。`]
        : isSheetUpload
          ? [`表格文件超过上限（${limit}），请精简表格后重试`, `表格文件不能超过 ${limit}，请删除多余 sheet 或商品后重新上传。`]
          : [`请求体超过上限（${limit}），请减少商品或规格数量后重试`, `本次提交内容过大（上限 ${limit}），服务器已拒绝，请精简后重试。`];
      return res.status(413).json({ ok: false, code: 'PAYLOAD_TOO_LARGE', error, userMessage });
    }
    return next(err);
  });
}

module.exports = { registerHttpFallbacks };
