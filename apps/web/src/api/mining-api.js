import { requestJson } from './http.js';

export const mineKeywordRoots = (endpoint, keyword = '') => requestJson(endpoint, {
  method: 'POST',
  body: keyword ? { keyword } : {}
});
