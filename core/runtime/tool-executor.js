/**
 * @file tool-executor.js
 * @description 统一工具执行器（参数校验 -> 幂等去重 -> 租约获取 -> 执行审计）
 * 符合 ADR v1.0 (D3, D5)
 */

'use strict';

const crypto = require('crypto');
const { getLeaseManager } = require('./workbench-lease');
const { createOperationStore } = require('./operation-store');

class ToolExecutionError extends Error {
  constructor(message, originalError, code) {
    super(message);
    this.name = 'ToolExecutionError';
    this.code = code || originalError?.code || 'TOOL_EXECUTION_ERROR';
    this.originalError = originalError;
  }
}

/**
 * 创建统一工具执行器
 * @param {Object} [deps]
 * @param {import('./tool-registry').createToolRegistry} deps.registry
 * @param {import('./workbench-lease').createWorkbenchLeaseManager} [deps.leaseManager]
 * @param {import('./operation-store').createOperationStore} [deps.operationStore]
 * @param {Object} [deps.logger]
 */
function createToolExecutor(deps = {}) {
  const registry = deps.registry;
  if (!registry || typeof registry.get !== 'function') {
    throw new Error('createToolExecutor 必须提供有效的 registry 实例');
  }

  const leaseManager = deps.leaseManager || getLeaseManager();
  const operationStore = deps.operationStore || createOperationStore();
  const logger = deps.logger || console;

  /**
   * 校验并归一化入参
   * @param {import('./contracts').ToolDefinition} tool
   * @param {any} input
   * @returns {any}
   */
  function validateInput(tool, input) {
    if (!tool.inputSchema) {
      return input || {};
    }

    // 若为 Zod Schema
    if (typeof tool.inputSchema.safeParse === 'function') {
      const res = tool.inputSchema.safeParse(input || {});
      if (!res.success) {
        const issues = res.error?.issues ? res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ') : res.error.message;
        const err = new Error(`参数校验失败: [${issues}]`);
        err.code = 'INVALID_ARGUMENT';
        err.status = 400;
        throw err;
      }
      return res.data;
    }

    // 若为自定义校验函数
    if (typeof tool.inputSchema === 'function') {
      return tool.inputSchema(input);
    }

    return input || {};
  }

  /**
   * 执行指定工具
   * @param {string} idOrName
   * @param {any} [rawInput={}]
   * @param {Object} [options={}]
   * @returns {Promise<any>}
   */
  async function execute(idOrName, rawInput = {}, options = {}) {
    const tool = registry.get(idOrName);
    if (!tool) {
      const err = new Error(`未找到工具: [${idOrName}]`);
      err.code = 'TOOL_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    // 1. 参数校验与归一化
    const normalizedInput = validateInput(tool, rawInput);

    // 2. 幂等性受理
    const requestId = options.requestId || (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
    const caller = options.caller || 'unknown';
    const inputDigest = operationStore.computeInputDigest(tool.id, normalizedInput);

    const existing = operationStore.get(requestId);
    if (existing) {
      if (existing.inputDigest === inputDigest) {
        if (existing.status === 'completed') {
          return existing.result;
        }
        if (existing.status === 'failed') {
          const prevErr = new Error(existing.error?.message || '操作此前已失败');
          prevErr.code = existing.error?.code || 'OPERATION_FAILED';
          throw prevErr;
        }
        if (existing.status === 'running') {
          return {
            operationId: existing.operationId,
            status: 'running',
            duplicate: true,
            message: '操作正在执行中'
          };
        }
      } else {
        // 同 requestId，参数不同：抛出 409 Conflict
        const conflictErr = new Error(`请求 ID 冲突: 相同 requestId [${requestId}] 提交了不同的参数摘要`);
        conflictErr.code = 'IDEMPOTENCY_CONFLICT';
        conflictErr.status = 409;
        throw conflictErr;
      }
    }

    const operationId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    const opRecord = {
      requestId,
      operationId,
      toolId: tool.id,
      caller,
      inputDigest,
      pid: process.pid,
      status: 'running',
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now
    };
    operationStore.save(opRecord);

    // 3. 构建执行上下文
    const ctx = {
      requestId,
      operationId,
      caller,
      abortSignal: options.abortSignal,
      logger,
      leaseManager
    };

    // 4. 执行函数（若声明了静态 resourceKeys，统一在外层持租约）
    const runBusinessLogic = async () => {
      try {
        const result = await tool.execute(normalizedInput, ctx);
        opRecord.status = 'completed';
        opRecord.result = result;
        opRecord.updatedAt = new Date().toISOString();
        operationStore.save(opRecord);
        return result;
      } catch (err) {
        opRecord.status = 'failed';
        opRecord.error = {
          message: err.message,
          code: err.code,
          stack: err.stack
        };
        opRecord.updatedAt = new Date().toISOString();
        operationStore.save(opRecord);
        throw err;
      }
    };

    const declaredResourceKeys = tool.policy?.resourceKeys || [];
    if (declaredResourceKeys.length > 0) {
      // 串行获取声明的物理资源锁（如 cdp:9222）
      let runner = runBusinessLogic;
      for (const resKey of declaredResourceKeys) {
        const currentRunner = runner;
        runner = () => leaseManager.withLease(resKey, { purpose: tool.id }, currentRunner);
      }
      return await runner();
    }

    return await runBusinessLogic();
  }

  return {
    execute,
    registry,
    operationStore,
    leaseManager
  };
}

module.exports = {
  createToolExecutor,
  ToolExecutionError
};
