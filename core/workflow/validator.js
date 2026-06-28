'use strict';

const { getNodeDefinition } = require('./registry');

function pushError(errors, code, message, details = {}) {
  errors.push({ code, message, ...details });
}

function validateWorkflow(workflow) {
  const errors = [];
  const warnings = [];

  if (!workflow || !Array.isArray(workflow.nodes)) {
    pushError(errors, 'invalid_workflow', '工作流必须包含 nodes 数组');
    return { ok: false, errors, warnings };
  }

  const nodes = workflow.nodes;
  const edges = Array.isArray(workflow.edges) ? workflow.edges : [];
  const nodeById = new Map();

  if (nodes.length === 0) {
    pushError(errors, 'empty_workflow', '工作流至少需要一个节点');
  }

  for (const node of nodes) {
    if (!node || !node.id) {
      pushError(errors, 'missing_node_id', '节点缺少 id');
      continue;
    }

    if (nodeById.has(node.id)) {
      pushError(errors, 'duplicate_node_id', `节点 id 重复: ${node.id}`, { nodeId: node.id });
      continue;
    }
    nodeById.set(node.id, node);

    const def = getNodeDefinition(node.type);
    if (!def) {
      pushError(errors, 'unknown_node_type', `未知节点类型: ${node.type}`, { nodeId: node.id, nodeType: node.type });
      continue;
    }

    for (const param of def.requiredParams || []) {
      const value = node.data ? node.data[param] : undefined;
      if (value == null || String(value).trim() === '') {
        pushError(errors, 'missing_required_param', `节点 ${node.id} 缺少必填参数: ${param}`, {
          nodeId: node.id,
          nodeType: node.type,
          param
        });
      }
    }
  }

  const incoming = new Map(nodes.map(node => [node.id, 0]));
  const outgoing = new Map(nodes.map(node => [node.id, 0]));
  const adjacency = new Map(nodes.map(node => [node.id, []]));

  for (const edge of edges) {
    if (!edge || !edge.source || !edge.target) {
      pushError(errors, 'invalid_edge', '连线缺少 source 或 target', { edgeId: edge && edge.id });
      continue;
    }
    if (!nodeById.has(edge.source)) {
      pushError(errors, 'edge_missing_source', `连线来源节点不存在: ${edge.source}`, { edgeId: edge.id, source: edge.source });
      continue;
    }
    if (!nodeById.has(edge.target)) {
      pushError(errors, 'edge_missing_target', `连线目标节点不存在: ${edge.target}`, { edgeId: edge.id, target: edge.target });
      continue;
    }
    outgoing.set(edge.source, (outgoing.get(edge.source) || 0) + 1);
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
    adjacency.get(edge.source).push(edge.target);
  }

  for (const node of nodes) {
    if (!getNodeDefinition(node.type)) continue;
    const inCount = incoming.get(node.id) || 0;
    const outCount = outgoing.get(node.id) || 0;
    if (inCount === 0 && outCount === 0 && node.type !== 'input') {
      pushError(errors, 'isolated_node', `非输入节点未连接: ${node.id}`, { nodeId: node.id, nodeType: node.type });
    }
  }

  const permanent = new Set();
  const temporary = new Set();
  const stack = [];

  function visit(nodeId) {
    if (permanent.has(nodeId)) return false;
    if (temporary.has(nodeId)) {
      const cycleStart = stack.indexOf(nodeId);
      const cycle = cycleStart >= 0 ? stack.slice(cycleStart).concat(nodeId) : [nodeId];
      pushError(errors, 'cycle_detected', `工作流不能包含环: ${cycle.join(' -> ')}`, { nodeIds: cycle });
      return true;
    }
    temporary.add(nodeId);
    stack.push(nodeId);
    for (const next of adjacency.get(nodeId) || []) {
      visit(next);
    }
    stack.pop();
    temporary.delete(nodeId);
    permanent.add(nodeId);
    return false;
  }

  for (const node of nodes) {
    visit(node.id);
  }

  return { ok: errors.length === 0, errors, warnings };
}

module.exports = {
  validateWorkflow
};
