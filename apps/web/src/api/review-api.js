import { requestJson, requestUpload } from './http.js';

const workflowRunPath = (runId) => `/api/workflows/runs/${encodeURIComponent(runId)}`;

// --- Review source upload ---

export function uploadReviewSource(file, groupSize) {
  const query = groupSize ? `?groupSize=${encodeURIComponent(groupSize)}` : '';
  return requestUpload(`/api/review-sheets/upload${query}`, file, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}

export const regroupReviewSource = (uploadId, groupSize) => requestJson(
  `/api/review-sheets/uploads/${encodeURIComponent(uploadId)}/group-size`,
  { method: 'POST', body: { groupSize } }
);

// --- Review confirmation & drafts ---

export const confirmReviewSheet = (runId, reviews) => requestJson(`${workflowRunPath(runId)}/review-confirm`, {
  method: 'POST',
  body: { reviews }
});

// options 透传 fetch 参数（如 keepalive），供关窗前兜底保存使用
export const saveReviewDrafts = (runId, reviews, options = {}) => requestJson(`${workflowRunPath(runId)}/review-drafts`, {
  method: 'POST',
  body: { reviews },
  ...options
});

// --- Review attachments ---

// 与后端 MAX_REVIEW_ATTACHMENTS 保持一致：每条评价最多 4 张配图
export const MAX_REVIEW_ATTACHMENTS = 4;

// 与服务端 review-assets 路由的 8mb express.raw 上限保持一致，上传前先在前端拦截
export const MAX_REVIEW_ATTACHMENT_BYTES = 8 * 1024 * 1024;

const reviewAssetsPath = (runId) => `${workflowRunPath(runId)}/review-assets`;

export const reviewAttachmentUrl = (runId, attachmentId) => `${reviewAssetsPath(runId)}/${encodeURIComponent(attachmentId)}`;

export function uploadReviewAttachment(runId, draftId, file) {
  return requestUpload(`${reviewAssetsPath(runId)}?draftId=${encodeURIComponent(draftId)}`, file, {
    errorPrefix: '上传配图失败'
  });
}

export const listReviewAttachments = (runId) => requestJson(reviewAssetsPath(runId));

export const deleteReviewAttachment = (runId, draftId, attachmentId) => requestJson(
  `${reviewAttachmentUrl(runId, attachmentId)}?draftId=${encodeURIComponent(draftId)}`,
  { method: 'DELETE' }
);
