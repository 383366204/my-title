/**
 * @file tool-compactor.js
 * @description 上下文膨胀防护卫士：智能提炼紧凑摘要并执行硬顶截断 (Hard Cap 2048 chars)
 * 确保全量业务事实落盘的同时，避免 LLM 上下文雪崩与高昂 Token 消耗。
 */

'use strict';

const DEFAULT_MAX_CHARS = 2048;

/**
 * 提炼并压缩工具返回结果
 * @param {string} toolId 工具标识
 * @param {any} rawResult 工具执行的原始返回值
 * @param {object} [options]
 * @param {number} [options.maxChars=2048] 最大字符数阈值
 * @returns {string} 可直接写入 role: 'tool' content 的紧凑 JSON 或字符串
 */
function compactToolResult(toolId, rawResult, options = {}) {
  const maxChars = options.maxChars || DEFAULT_MAX_CHARS;

  if (rawResult === null || rawResult === undefined) {
    return JSON.stringify({ ok: true, data: null });
  }

  if (typeof rawResult !== 'object') {
    const str = String(rawResult);
    if (str.length <= maxChars) return str;
    return str.slice(0, maxChars - 40) + '... [Truncated]';
  }

  // 1. 若为错误结构
  if (rawResult.ok === false || rawResult instanceof Error) {
    const errObj = {
      ok: false,
      error: rawResult.message || rawResult.error || '操作失败',
      code: rawResult.code || 'TOOL_ERROR',
      hint: rawResult.hint || undefined
    };
    return JSON.stringify(errObj);
  }

  let compacted = null;

  // 2. 若为 Workflow 组合工具
  if (toolId && (toolId.startsWith('workflow.') || toolId.startsWith('workflow_'))) {
    compacted = {
      ok: rawResult.ok !== false,
      runId: rawResult.runId || rawResult.run?.id || rawResult.id,
      status: rawResult.status || rawResult.run?.status,
      currentStep: rawResult.currentStep || rawResult.run?.currentStep,
      message: rawResult.message || rawResult.summary || '工作流状态已更新',
      pendingReview: rawResult.pendingReview || (rawResult.status === 'needs_review' ? {
        stepId: rawResult.currentStep,
        version: rawResult.run?.reviewDrafts?.[rawResult.currentStep]?.version || 1
      } : null)
    };
  }

  // 3. 若为商品列表 (1688 / 选品 / 标题生成)
  else if (Array.isArray(rawResult.products)) {
    compacted = {
      ok: rawResult.ok !== false,
      coreWord: rawResult.coreWord || undefined,
      blueOceanWord: rawResult.blueOceanWord || undefined,
      totalFound: rawResult.products.length,
      preview: rawResult.products.slice(0, 3).map(p => ({
        title: p.铺货标题 || p.title || p.链接原标题,
        price: p.商品原价 || p.price,
        sales30d: p['30天销量'] || p.sales
      })),
      _artifact: {
        operationId: rawResult.operationId || undefined,
        note: '完整商品列表已落盘，前端可通过 operationId 查询'
      }
    };
  }

  // 4. 若为词表挖掘 (sycm.query / keyword.suggest)
  else if (Array.isArray(rawResult.data) || Array.isArray(rawResult.keywords) || Array.isArray(rawResult.candidates)) {
    const items = rawResult.data || rawResult.keywords || rawResult.candidates;
    compacted = {
      ok: rawResult.ok !== false,
      totalItems: items.length,
      sampleItems: items.slice(0, 5),
      _artifact: {
        operationId: rawResult.operationId || undefined,
        note: '词表详情已落盘存储'
      }
    };
  }

  // 5. 其它对象结构保留浅层字段
  else {
    compacted = { ...rawResult };
    // 剔除明显的巨型字段
    delete compacted.rawResponse;
    delete compacted.traceLog;
    delete compacted.html;
    delete compacted.base64;
  }

  const str = JSON.stringify(compacted);
  if (str.length <= maxChars) {
    return str;
  }

  // 超过阈值进行安全截断
  return str.slice(0, maxChars - 50) + '... [已截断，完整数据已落盘]';
}

module.exports = {
  compactToolResult,
  DEFAULT_MAX_CHARS
};
