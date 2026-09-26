import { requestJson } from './http.js';

const route = runId => `/api/workflows/runs/${encodeURIComponent(runId)}/categories`;
/** @param {string} runId 运行。 @returns {Promise<object>} 后端类目快照。 */
export const getCategories = runId => requestJson(route(runId));
/** @param {string} runId 运行。 @param {object} input 类目操作。 @returns {Promise<object>} 更新后快照。 */
export const updateCategories = (runId, input) => requestJson(route(runId), { method: 'POST', body: input });
/** @param {string} runId 运行。 @param {object} input 复制范围。 @returns {Promise<object>} 使用当前类目的复制内容。 */
export const copyCategoryContent = (runId, input) => requestJson(`${route(runId)}/copy`, { method: 'POST', body: input });
