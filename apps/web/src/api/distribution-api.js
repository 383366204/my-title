import { requestJson } from './http.js';

const distributionRunPath = (jobId) => `/api/distribution/runs/${encodeURIComponent(jobId)}`;

export const checkDistribution = (input) => requestJson('/api/distribution/check', { method: 'POST', body: input });
export const submitDistribution = (input) => requestJson('/api/distribution/submit', { method: 'POST', body: input });
export const completeManualDistribution = (input) => requestJson('/api/distribution/manual-complete', { method: 'POST', body: input });
export const getDistributionRun = (jobId) => requestJson(distributionRunPath(jobId));
export const controlDistributionRun = (jobId, action) => requestJson(`${distributionRunPath(jobId)}/${action}`, { method: 'POST' });
export const startDistributionChrome = () => requestJson('/api/distribution/chrome/start', { method: 'POST', body: {} });
