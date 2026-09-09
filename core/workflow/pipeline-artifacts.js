'use strict';

const fs = require('fs');
const path = require('path');
const summarizePipelineRun = require('../pipeline-run-summary').summarizePipelineRun;
const readJsonlPreview = require('../pipeline-run-summary').readJsonlPreview;
const readTextPreview = require('../pipeline-run-summary').readTextPreview;
const DEFAULT_ORDER_GROUP_SIZE = require('../../skills/order-sheet/src/order-groups').DEFAULT_ORDER_GROUP_SIZE;
const autoGroupOrderProducts = require('../../skills/order-sheet/src/order-groups').autoGroupOrderProducts;
const { WORKFLOW_NODE_IDS, ARTIFACT_BY_NODE } = require('./pipeline-definition-common');

/**
 * 读取 workflow 节点对应的 pipeline artifact。
 * @param {string} runId pipeline runId。
 * @param {string} nodeId workflow 节点 ID。
 * @param {object} options 读取参数。
 * @param {string} [options.dataDir] pipeline 数据目录。
 * @param {number|'all'} [options.limit] JSONL 最大行数，`all` 表示读取全部。
 * @param {number} [options.maxChars] 文本最大字符数。
 * @returns {object|null} artifact 内容。
 */
function normalizeArtifactOptions(runIdOrOptions, nodeId, maybeOptions = {}) {
  if (runIdOrOptions && typeof runIdOrOptions === 'object') {
    return { ...runIdOrOptions };
  }
  return { ...maybeOptions, runId: runIdOrOptions, nodeId };
}

function readArtifactJsonl(file, limit) {
  if (limit !== 'all') return readJsonlPreview(file, limit || 50);
  if (!file || !fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(line => {
      try {
        return [JSON.parse(line)];
      } catch (_error) {
        return [];
      }
    });
}

/**
 * @param {string|object} runIdOrOptions 运行 ID 或读取选项。
 * @param {string} nodeId 节点 ID。
 * @param {object} [options] 运行数据目录等读取选项。
 * @returns {object|null} 结构化产物预览及其文件信息。
 */
function readWorkflowNodeArtifact(runIdOrOptions, nodeId, options = {}) {
  const normalized = normalizeArtifactOptions(runIdOrOptions, nodeId, options);
  const summary = summarizePipelineRun({ dataDir: normalized.dataDir, runId: normalized.runId, previewLimit: 0, reviewChars: 1 });
  const artifact = ARTIFACT_BY_NODE[normalized.nodeId];
  if (!summary || !artifact) return null;
  const file = summary.files && summary.files[artifact.fileKey];
  if (!file) return null;
  if (artifact.type === 'json') {
    if (fs.existsSync(file)) {
      try {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        return {
          runId: summary.runId,
          nodeId: normalized.nodeId,
          file,
          type: 'json',
          ...value
        };
      } catch (_error) {
        return null;
      }
    }
    if (normalized.nodeId === WORKFLOW_NODE_IDS.confirmProducts) {
      const rankFile = summary.files?.productRank;
      if (rankFile && fs.existsSync(rankFile)) {
        const rankRows = readJsonlPreview(rankFile, normalized.limit || 100);
        const dragCount = Number.isFinite(Number(summary.options?.dragCount))
          ? Math.max(1, Number(summary.options.dragCount))
          : DEFAULT_ORDER_GROUP_SIZE;
        const groups = autoGroupOrderProducts(rankRows, { dragCount });
        return {
          runId: summary.runId,
          nodeId: normalized.nodeId,
          file: rankFile,
          type: 'json',
          groups,
          items: rankRows,
          totalCount: rankRows.length,
          groupCount: groups.length
        };
      }
    }
    return null;
  }
  if (artifact.type === 'jsonl') {
    if (normalized.nodeId === WORKFLOW_NODE_IDS.mine) {
      return {
        runId: summary.runId,
        nodeId: normalized.nodeId,
        file,
        type: 'jsonl',
        rows: readArtifactJsonl(file, normalized.limit),
        inspirationRows: readArtifactJsonl(summary.files?.inspirations, normalized.limit),
        rootRows: readArtifactJsonl(summary.files?.rootCandidates, normalized.limit),
        discovery: summary.discovery || null
      };
    }
    if (normalized.nodeId === WORKFLOW_NODE_IDS.keywordReview) {
      if (summary.options?.mode === 'manual') {
        const selectedFile = summary.files?.selectedProducts;
        const selectedRows = readArtifactJsonl(selectedFile, normalized.limit);
        if (selectedRows.length > 0) {
          return {
            runId: summary.runId,
            nodeId: normalized.nodeId,
            file: selectedFile || file,
            type: 'jsonl',
            rows: selectedRows
          };
        }
      }
      const reviewedRows = readArtifactJsonl(file, normalized.limit);
      if (reviewedRows.length > 0) {
        return {
          runId: summary.runId,
          nodeId: normalized.nodeId,
          file,
          type: 'jsonl',
          rows: reviewedRows
        };
      }
      const candidateRows = readArtifactJsonl(summary.files?.candidates, normalized.limit);
      return {
        runId: summary.runId,
        nodeId: normalized.nodeId,
        file: summary.files?.candidates || file,
        type: 'jsonl',
        derivedFrom: 'candidates',
        rows: candidateRows.map(row => ({
          ...row,
          reviewStatus: 'pending',
          status: row.status || 'keyword_pending_review'
        }))
      };
    }
    if (normalized.nodeId === WORKFLOW_NODE_IDS.select) {
      const rows = readJsonlPreview(file, normalized.limit || 50);
      if (rows.length > 0) {
        return {
          runId: summary.runId,
          nodeId: normalized.nodeId,
          file,
          type: 'jsonl',
          rows
        };
      }
      const generatedFile = summary.files && summary.files.generatedProducts;
      const generatedRows = readJsonlPreview(generatedFile, normalized.limit || 50);
      if (generatedRows.length > 0) {
        return {
          runId: summary.runId,
          nodeId: normalized.nodeId,
          file: generatedFile,
          type: 'jsonl',
          derivedFrom: 'generatedProducts',
          rows: generatedRows.map(row => ({
            status: 'selected',
            keyword: row.keyword || row.selectedKeyword || '',
            selectedKeyword: row.selectedKeyword || row.keyword || '',
            product: row.selectedProduct?.product || row.product || {},
            url: row.url || row.product?.['产品链接'] || row.product?.detailUrl || '',
            sourceTitle: row.selectedProduct?.sourceTitle || row.product?.['链接原标题'] || row.product?.subject || row.product?.title || row.title || '',
            title: row.selectedProduct?.sourceTitle || row.product?.['链接原标题'] || row.product?.subject || row.product?.title || row.title || '',
            price: row.selectedProduct?.price || row.product?.['商品原价'] || row.product?.price || '',
            sales30days: row.selectedProduct?.sales30days || row.product?.['30天销量'] || row.product?.sales30days || row.product?.monthlySales || '',
            imageUrl: row.selectedProduct?.imageUrl || row.product?.['主图链接'] || row.product?.imageUrl || row.product?.image || '',
            productOpportunity: row.selectedProduct?.productOpportunity || row.productOpportunity || null,
            keywordOpportunity: row.keywordOpportunity || null,
            opportunityScore: row.opportunityScore || row.productOpportunity?.score || '',
            decision: row.decision || row.productOpportunity?.decision || '',
            nextAction: row.nextAction || row.productOpportunity?.nextAction || '',
            derivedFrom: 'generated-products'
          }))
        };
      }
    }
    return {
      runId: summary.runId,
      nodeId: normalized.nodeId,
      file,
      type: 'jsonl',
      rows: readJsonlPreview(file, normalized.limit || 50)
    };
  }
  if (artifact.type === 'competitor-products') {
    return {
      runId: summary.runId,
      nodeId: normalized.nodeId,
      file,
      type: 'competitor-products',
      hotRows: readJsonlPreview(summary.files?.competitorHotProducts, normalized.limit || 50),
      newRows: readJsonlPreview(summary.files?.competitorNewProducts, normalized.limit || 50)
    };
  }
  if (artifact.type === 'xlsx') {
    if (!fs.existsSync(file)) return null;
    return {
      runId: summary.runId,
      nodeId: normalized.nodeId,
      file,
      filename: path.basename(file),
      type: 'xlsx',
      count: normalized.nodeId === WORKFLOW_NODE_IDS.competitorReport
        ? Number(summary.counts?.competitorReportRows || 0)
        : Number(summary.counts?.orderSheetRows || 0),
      downloadUrl: `/api/workflows/runs/${encodeURIComponent(summary.runId)}/artifacts/${encodeURIComponent(normalized.nodeId)}/raw`
    };
  }
  return {
    runId: summary.runId,
    nodeId: normalized.nodeId,
    file,
    type: 'text',
    text: readTextPreview(file, normalized.maxChars || 10000)
  };
}

module.exports = { readWorkflowNodeArtifact };
