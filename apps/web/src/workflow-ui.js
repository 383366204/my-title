/**
 * 工作流兼容导出层
 *
 * 职责已拆分到以下模块：
 * - features/workflow/workflow-node-actions.js: 主次按钮选择及节点动作文案
 * - features/workflow/workflow-launch-params.js: 启动输入解析、参数收集、前端校验
 * - features/workflow/workflow-node-view.js: 节点摘要、状态文案、诊断行
 * - features/workflow/workflow-history-view.js: 历史运行名称、状态与当前步骤展示
 * - features/workflow/artifact-view.js: 产物结构化视图与摘要
 */

export {
  BUSINESS_FUNNEL,
  getCanvasNodeTone,
  getWorkflowNodeAction,
  getWorkflowBlockerActions,
  getMiningRecoveryHint,
  getMiningRecoveryAction,
  getWorkflowRuntimeActions,
  getWorkflowOperationMessage,
  getPipelineFirstNavItems,
  getWorkflowNodeIdForLegacyTarget,
  getPipelineFirstActionTarget,
  mapPipelineStageToFunnel,
  getWorkflowAction
} from "./features/workflow/workflow-node-actions.js";

export { buildWorkflowOperationRequest, buildWorkflowDeleteRunRequest } from './api/workflow-api.js';

export {
  isWorkflowInputNodeType,
  getStartNodeParams,
  parseExactKeywords,
  parseRootKeywords,
  parseCompetitorShareInputs,
  parseOrderSheetManualItems,
  getWorkflowLaunchParams,
  getWorkflowLaunchBlocker
} from "./features/workflow/workflow-launch-params.js";

export {
  labelWorkflowNodeStatus,
  getWorkflowBlockerView,
  getCompetitorConfigSummary,
  getRootKeywordConfigSummary,
  getOrderSheetConfigSummary,
  getSheetConfigSummary,
  getWorkflowNodeSuccessLabel,
  getWorkflowNodeResultLocation,
  getWorkflowResultSummaryView,
  labelWorkflowBlockerReason,
  getWorkflowNodeDetailRows,
  getWorkflowNodePanelKind,
  getWorkflowTemplateView,
  normalizeCandidateForTitle,
  buildReviewProduct,
  formatWorkflowProgressLabel,
  normalizeWorkflowProgressEvent,
  getWorkflowNodeViewModel
} from "./features/workflow/workflow-node-view.js";

export {
  getWorkflowRunActiveNodeId,
  getPipelineSummaryVisualState,
  getPipelineMonitorNodeStatus,
  getUnifiedWorkflowHistoryItem
} from "./features/workflow/workflow-history-view.js";

export {
  getWorkflowArtifactView,
  summarizeWorkflowArtifact
} from "./features/workflow/artifact-view.js";
