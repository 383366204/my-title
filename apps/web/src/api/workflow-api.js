import { ApiError, requestJson, requestPayload } from './http.js';

const workflowRunPath = (runId) => `/api/workflows/runs/${encodeURIComponent(runId)}`;

export const listWorkflowTemplates = () => requestJson('/api/workflows/templates');
export const listWorkflowRuns = () => requestJson('/api/workflows/runs');
export const getWorkflowRun = (runId) => requestJson(workflowRunPath(runId));
export const deleteWorkflowRun = (runId) => requestJson(workflowRunPath(runId), { method: 'DELETE' });
export const validateWorkflow = (input) => requestPayload('/api/workflows/validate', {
  method: 'POST',
  body: input,
  allowApiError: true
});
export const startWorkflow = (input) => requestJson('/api/workflows/run', { method: 'POST', body: input });
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
