import { requestJson } from './http.js';

export const generateTitle = (input) => requestJson('/api/title/generate', { method: 'POST', body: input });
