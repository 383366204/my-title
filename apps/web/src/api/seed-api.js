import { requestJson } from './http.js';

const seedPath = (keyword) => `/api/seeds/${encodeURIComponent(keyword)}`;

export const listSeeds = () => requestJson('/api/seeds');
export const addSeed = (seed) => requestJson('/api/seeds', { method: 'POST', body: seed });
export const toggleSeed = (keyword) => requestJson(`${seedPath(keyword)}/toggle`, { method: 'POST' });
export const setSeedStatus = (keyword, status) => requestJson(`${seedPath(keyword)}/status`, { method: 'POST', body: { status } });
export const deleteSeed = (keyword) => requestJson(seedPath(keyword), { method: 'DELETE' });
