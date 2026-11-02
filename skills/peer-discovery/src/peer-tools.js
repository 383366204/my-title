/**
 * @file peer-tools.js
 * @description peer.discover, peer.status, peer.cancel 原子工具定义
 * 符合 ADR v1.0 (D3, D4)
 */

'use strict';

const { z } = require('zod');
const {
  initializePeerTask,
  enqueuePeerTask,
  requirePublishedPeerTask,
  readPeerTaskStatus,
  requestPeerTaskCancel
} = require('./peer-task-coordinator');
const { normalizePeerDiscoveryParams } = require('./params');

const discoverSchema = z.object({
  discoveryBranch: z.enum(['peer-analysis', 'image-selection']).optional().default('peer-analysis'),
  imagePriceRatioThreshold: z.union([z.number(), z.string()]).optional().default('1'),
  links: z.string().min(1, '淘宝商品链接不能为空'),
  minProducts: z.number().int().positive().optional().default(10),
  minSourcing: z.number().int().positive().optional().default(5),
  minPayment: z.number().int().positive().optional().default(10),
  similarityThreshold: z.number().positive().optional().default(0.45),
  priceRatioThreshold: z.number().positive().optional().default(0.7),
  maxCandidateShops: z.number().int().positive().optional().default(30),
  searchMaxProducts: z.number().int().positive().optional().default(10),
  searchMaxPages: z.number().int().positive().optional().default(1),
  collectLimit: z.number().int().positive().optional().default(40),
  port: z.number().int().positive().optional().default(9222),
  evidenceMaxAgeMs: z.union([z.number(), z.string()]).optional().default(86400000),
  allocationMethod: z.enum(['sequential', 'sequential-average', 'random-average', 'random', 'duplicate', 'repeat']).optional().default('sequential-average')
});

/** @type {import('../../../core/runtime/contracts').ToolDefinition} */
const discoverPeersTool = {
  id: 'peer.discover',
  mcpName: 'discover_peers',
  version: '1.0.0',
  description: '以货找店：从淘宝商品链接发现同行店铺或图搜选货铺货（异步返回 taskId）',
  inputSchema: discoverSchema,
  policy: {
    risk: 'high',
    approval: 'never',
    sideEffect: 'write',
    resourceKeys: ['cdp:9222'],
    platforms: ['taobao', '1688']
  },
  execute: async (input) => {
    const params = normalizePeerDiscoveryParams(input);
    const task = await initializePeerTask(params);
    await enqueuePeerTask(task);
    return readPeerTaskStatus(task);
  }
};

const peerStatusSchema = z.object({
  taskId: z.string().min(1, 'taskId 不能为空')
});

/** @type {import('../../../core/runtime/contracts').ToolDefinition} */
const peerStatusTool = {
  id: 'peer.status',
  mcpName: 'get_peer_discovery_status',
  version: '1.0.0',
  description: '查询同行发现任务进度',
  inputSchema: peerStatusSchema,
  policy: {
    risk: 'low',
    approval: 'never',
    sideEffect: 'read',
    resourceKeys: [],
    platforms: []
  },
  execute: async (input) => {
    const task = await requirePublishedPeerTask(input.taskId);
    return readPeerTaskStatus(task);
  }
};

const peerCancelSchema = z.object({
  taskId: z.string().min(1, 'taskId 不能为空')
});

/** @type {import('../../../core/runtime/contracts').ToolDefinition} */
const peerCancelTool = {
  id: 'peer.cancel',
  mcpName: 'cancel_peer_discovery',
  version: '1.0.0',
  description: '取消运行中的同行发现任务',
  inputSchema: peerCancelSchema,
  policy: {
    risk: 'medium',
    approval: 'never',
    sideEffect: 'write',
    resourceKeys: [],
    platforms: []
  },
  execute: async (input) => {
    return requestPeerTaskCancel(input.taskId);
  }
};

module.exports = {
  discoverPeersTool,
  peerStatusTool,
  peerCancelTool
};
