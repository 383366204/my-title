import { ApiError, requestJson, requestPayload } from './http.js';

const workflowRunPath = (runId) => `/api/workflows/runs/${encodeURIComponent(runId)}`;

export const listWorkflowTemplates = () => requestJson('/api/workflows/templates');
export const listWorkflowRuns = () => requestJson('/api/workflows/runs');
export const getWorkflowRun = (runId) => requestJson(workflowRunPath(runId));
export const deleteWorkflowRun = (runId) => requestJson(workflowRunPath(runId), {
  method: 'DELETE',
  body: { confirm: true }
});
export const validateWorkflow = (input) => requestPayload('/api/workflows/validate', {
  method: 'POST',
  body: input,
  allowApiError: true
});
export const startWorkflow = (input) => requestJson('/api/workflows/run', { method: 'POST', body: input });
export const resolve1688Share = (input) => requestJson('/api/1688/resolve-share', { method: 'POST', body: { input } });
export const cancelWorkflow = (runId) => requestJson(`${workflowRunPath(runId)}/cancel`, { method: 'POST' });
export const resumeWorkflow = (runId) => requestJson(`${workflowRunPath(runId)}/resume`, { method: 'POST' });
export const pauseWorkflow = (runId) => requestJson(`${workflowRunPath(runId)}/pause`, { method: 'POST' });
export const retryWorkflowNode = (runId, nodeId) => requestJson(`${workflowRunPath(runId)}/retry-node`, {
  method: 'POST',
  body: { nodeId }
});
export const confirmKeywordReview = (runId, input) => requestJson(`${workflowRunPath(runId)}/keyword-review`, { method: 'POST', body: input });
export const confirmProductReview = (runId, input) => requestJson(`${workflowRunPath(runId)}/product-review`, { method: 'POST', body: input });
export const workflowEventsUrl = (runId) => `${workflowRunPath(runId)}/events`;

export async function uploadReviewSource(file, groupSize) {
  const query = groupSize ? `?groupSize=${encodeURIComponent(groupSize)}` : '';
  const response = await fetch(`/api/review-sheets/upload${query}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'X-File-Name': encodeURIComponent(file.name)
    },
    body: file
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new ApiError(payload.error || `上传失败: ${response.status}`, { status: response.status, payload });
  }
  return payload.data ?? payload;
}

export const regroupReviewSource = (uploadId, groupSize) => requestJson(
  `/api/review-sheets/uploads/${encodeURIComponent(uploadId)}/group-size`,
  { method: 'POST', body: { groupSize } }
);

export const confirmReviewSheet = (runId, reviews) => requestJson(`${workflowRunPath(runId)}/review-confirm`, {
  method: 'POST',
  body: { reviews }
});

// 与后端 MAX_REVIEW_ATTACHMENTS 保持一致：每条评价最多 4 张配图
export const MAX_REVIEW_ATTACHMENTS = 4;

const reviewAssetsPath = (runId) => `${workflowRunPath(runId)}/review-assets`;

export const reviewAttachmentUrl = (runId, attachmentId) => `${reviewAssetsPath(runId)}/${encodeURIComponent(attachmentId)}`;

export async function uploadReviewAttachment(runId, draftId, file) {
  const response = await fetch(`${reviewAssetsPath(runId)}?draftId=${encodeURIComponent(draftId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name)
    },
    body: file
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new ApiError(payload.error || `上传配图失败: ${response.status}`, { status: response.status, payload });
  }
  return payload.data ?? payload;
}

export const listReviewAttachments = (runId) => requestJson(reviewAssetsPath(runId));

export const deleteReviewAttachment = (runId, draftId, attachmentId) => requestJson(
  `${reviewAttachmentUrl(runId, attachmentId)}?draftId=${encodeURIComponent(draftId)}`,
  { method: 'DELETE' }
);
export const getOrderSheetDraft = (runId) => requestJson(`${workflowRunPath(runId)}/order-sheet/draft`);
export const saveOrderSheetDraft = (runId, input) => requestJson(`${workflowRunPath(runId)}/order-sheet/draft`, {
  method: 'POST',
  body: input
});
export const confirmOrderSheetProducts = (runId, input) => requestJson(`${workflowRunPath(runId)}/order-sheet/confirm`, {
  method: 'POST',
  body: Array.isArray(input) ? { items: input } : input
});

export async function getWorkflowArtifact(runId, nodeId, { limit } = {}) {
  const query = limit ? `?limit=${encodeURIComponent(limit)}` : '';
  try {
    const data = await requestJson(`${workflowRunPath(runId)}/artifacts/${encodeURIComponent(nodeId)}${query}`);
    return data?.artifact || data || null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export const runWorkflowOperation = (endpoint, body = {}) => requestJson(endpoint, { method: 'POST', body });
