/**
 * @file bootstrap.js
 * @description 统一运行时显式装配模块
 * 符合 ADR v1.0 (D2, D3)
 */

'use strict';

const { createToolRegistry } = require('./tool-registry');
const { createToolExecutor } = require('./tool-executor');
const { getLeaseManager } = require('./workbench-lease');
const { createOperationStore } = require('./operation-store');

// 导入领域工具实现定义
const { queryTool } = require('../../skills/sycm-research/src/query-tool');
const { suggestTool } = require('../../skills/title-gen/src/suggest-tool');
const { generateTool } = require('../../skills/title-gen/src/generate-tool');

/**
 * 创建并装配默认工具注册表
 * @returns {import('./tool-registry').createToolRegistry}
 */
function createDefaultToolRegistry() {
  const registry = createToolRegistry();

  // 显式注册首批 3 个原子工具
  registry.register(queryTool);
  registry.register(suggestTool);
  registry.register(generateTool);

  return registry;
}

/**
 * 创建并装配默认执行器
 * @param {Object} [deps={}]
 * @returns {import('./tool-executor').createToolExecutor}
 */
function createDefaultToolExecutor(deps = {}) {
  const registry = deps.registry || createDefaultToolRegistry();
  const leaseManager = deps.leaseManager || getLeaseManager();
  const operationStore = deps.operationStore || createOperationStore();
  const logger = deps.logger || console;

  return createToolExecutor({
    registry,
    leaseManager,
    operationStore,
    logger
  });
}

module.exports = {
  createDefaultToolRegistry,
  createDefaultToolExecutor
};
