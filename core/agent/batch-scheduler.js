/**
 * @file batch-scheduler.js
 * @description 资源感知冲突分桶调度器 (Conflict-Aware Tool Scheduler)
 * 根据 ToolPolicy（物理资源键、副作用、外部平台）将 tool_calls 智能划分为并行与串行批次
 * 兼顾执行性能与物理租约防死锁。
 */

'use strict';

const MAX_PARALLEL_CONCURRENCY = 4;

/**
 * 将一轮 LLM 返回的 tool_calls 进行冲突感知分桶规划
 * @param {Array<object>} toolCalls
 * @param {import('../runtime/tool-registry').createToolRegistry} registry
 * @returns {Array<{ type: 'parallel' | 'sequential', calls: Array<object> }>}
 */
function planToolExecutionBatches(toolCalls, registry) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return [];
  }

  const batches = [];
  let currentParallelBatch = [];

  for (const call of toolCalls) {
    const fnName = call.function?.name || call.name || '';
    const tool = registry.get(fnName);
    const policy = tool ? tool.policy : { sideEffect: 'write', resourceKeys: [], platforms: [] };

    const isExclusive = Array.isArray(policy.resourceKeys) && policy.resourceKeys.length > 0;
    const isWrite = policy.sideEffect === 'write';

    // 若存在独占物理锁或写副作用，必须排队串行
    if (isExclusive || isWrite) {
      if (currentParallelBatch.length > 0) {
        batches.push({ type: 'parallel', calls: currentParallelBatch });
        currentParallelBatch = [];
      }
      batches.push({ type: 'sequential', calls: [call] });
    } else {
      // 纯只读无锁工具，可与同类并行
      currentParallelBatch.push(call);
      // 并发度上限熔断，防止过大并发打爆底层
      if (currentParallelBatch.length >= MAX_PARALLEL_CONCURRENCY) {
        batches.push({ type: 'parallel', calls: currentParallelBatch });
        currentParallelBatch = [];
      }
    }
  }

  if (currentParallelBatch.length > 0) {
    batches.push({ type: 'parallel', calls: currentParallelBatch });
  }

  return batches;
}

/**
 * 顺序执行规划好的批次，并返回按原序对齐的结果列表
 * @param {object} options
 * @param {Array<{ type: string, calls: Array<object> }>} options.batches
 * @param {(call: object) => Promise<any>} options.executeCall
 * @returns {Promise<Array<{ call: object, result: any, error: any, isError: boolean }>>}
 */
async function executeToolBatches({ batches, executeCall }) {
  const orderedResults = [];

  for (const batch of batches) {
    if (batch.type === 'parallel' && batch.calls.length > 1) {
      // 并发执行无锁只读工具 (使用 Promise.allSettled 确保隔离)
      const settled = await Promise.allSettled(
        batch.calls.map(call => executeCall(call))
      );

      for (let i = 0; i < batch.calls.length; i++) {
        const call = batch.calls[i];
        const res = settled[i];
        if (res.status === 'fulfilled') {
          orderedResults.push({
            call,
            result: res.value,
            error: null,
            isError: false
          });
        } else {
          orderedResults.push({
            call,
            result: null,
            error: res.reason,
            isError: true
          });
        }
      }
    } else {
      // 串行执行独占工具或单个工具
      for (const call of batch.calls) {
        try {
          const result = await executeCall(call);
          orderedResults.push({
            call,
            result,
            error: null,
            isError: false
          });
        } catch (err) {
          orderedResults.push({
            call,
            result: null,
            error: err,
            isError: true
          });
        }
      }
    }
  }

  return orderedResults;
}

module.exports = {
  planToolExecutionBatches,
  executeToolBatches,
  MAX_PARALLEL_CONCURRENCY
};
