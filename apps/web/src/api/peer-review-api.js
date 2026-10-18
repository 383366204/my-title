import { requestJson } from './http.js';

const reviewPath = runId => `/api/workflows/runs/${encodeURIComponent(runId)}/peer-review`;

export const getPeerReview = runId => requestJson(reviewPath(runId));
export const savePeerReview = (runId, body) => requestJson(`${reviewPath(runId)}/drafts`, { method: 'POST', body });
export const allocatePeerReview = (runId, body) => requestJson(`${reviewPath(runId)}/allocation`, { method: 'POST', body });
