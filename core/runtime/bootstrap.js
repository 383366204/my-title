/**
 * @file bootstrap.js
 * @description 统一运行时显式装配模块（全量 12 个领域原子工具 + 5 个固定工作流工具）
 * 符合 ADR v1.0 (D2, D3, D4, PR-07 里程碑 1)
 */

'use strict';

const { createToolRegistry } = require('./tool-registry');
const { createToolExecutor } = require('./tool-executor');
const { getLeaseManager } = require('./workbench-lease');
const { createOperationStore } = require('./operation-store');

// 1. 标题生成与挖掘原子工具 (3个)
const { queryTool } = require('../../skills/sycm-research/src/query-tool');
const { suggestTool } = require('../../skills/title-gen/src/suggest-tool');
const { generateTool } = require('../../skills/title-gen/src/generate-tool');
const { batchGenerateTool } = require('../../skills/title-gen/src/batch-tool');

// 2. 淘宝 OPC 工具 (2个)
const { taobaoOpcListTools, taobaoOpcCall } = require('../../skills/taobao-opc/src/taobao-opc-tools');

// 3. 1688 商机与趋势洞察工具 (2个)
const { opportunitiesTool, trendTool } = require('../../skills/alibaba1688/src/insights-tools');

// 4. 生意参谋缓存状态工具 (1个)
const { sycmStatusTool } = require('../../skills/sycm-research/src/status-tool');

// 5. 同行发现与选货工具 (3个)
const {
  discoverPeersTool,
  peerStatusTool,
  peerCancelTool
} = require('../../skills/peer-discovery/src/peer-tools');

// 6. 工作流控制组合工具 (5个)
const {
  workflowStartTool,
  workflowStatusTool,
  workflowSubmitReviewTool,
  workflowResumeTool,
  workflowCancelTool
} = require('../workflow/workflow-tools');

/**
 * 创建并装配默认工具注册表（全量 17 个工具）
 * @returns {import('./tool-registry').createToolRegistry}
 */
function createDefaultToolRegistry() {
  const registry = createToolRegistry();

  // 1. 注册核心原子领域工具
  registry.register(queryTool);
  registry.register(suggestTool);
  registry.register(generateTool);
  registry.register(batchGenerateTool);

  // 2. 注册淘宝 OPC 工具
  registry.register(taobaoOpcListTools);
  registry.register(taobaoOpcCall);

  // 3. 注册 1688 洞察工具
  registry.register(opportunitiesTool);
  registry.register(trendTool);

  // 4. 注册生意参谋状态工具
  registry.register(sycmStatusTool);

  // 5. 注册同行发现工具
  registry.register(discoverPeersTool);
  registry.register(peerStatusTool);
  registry.register(peerCancelTool);

  // 6. 注册 5 个 Workflow 组合工具
  registry.register(workflowStartTool);
  registry.register(workflowStatusTool);
  registry.register(workflowSubmitReviewTool);
  registry.register(workflowResumeTool);
  registry.register(workflowCancelTool);

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
