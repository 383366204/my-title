import { Check, FileText } from 'lucide-react';

/**
 * Component to render node progress bar and label.
 * @param {object} props Component props.
 * @param {object} props.view Node view model object.
 * @returns {import('react').JSX.Element|null} React component element or null.
 */
export const WorkflowProgressStrip = ({ view }) => {
  if (!view.progress) return null;
  return (
    <div className="workflow-node-progress" aria-label={view.progressLabel || '节点进度'}>
      <div className="workflow-node-progress-bar">
        <span style={{ width: `${view.progressPercent}%` }} />
      </div>
      {view.progressLabel && <div className="workflow-node-progress-label">{view.progressLabel}</div>}
    </div>
  );
};

/**
 * Component to render node blocker message callout box.
 * @param {object} props Component props.
 * @param {object} props.view Node view model object.
 * @returns {import('react').JSX.Element|null} React component element or null.
 */
export const WorkflowBlockerCallout = ({ view }) => {
  if (!view.hasBlocker) return null;
  return (
    <div className={`workflow-node-callout workflow-node-callout-${view.tone}`}>
      <strong>{view.blockerTitle}</strong>
      <span>{view.blockerMessage}</span>
    </div>
  );
};

/**
 * Component to render node primary action chip button.
 * @param {object} props Component props.
 * @param {object} props.view Node view model object.
 * @param {Function} [props.onAction] Action handler callback.
 * @returns {import('react').JSX.Element} React component element.
 */
export const WorkflowNodeActionChip = ({ view, onAction }) => (
  <span
    className={`production-node-action production-node-action-${view.primaryAction.tone}`}
    role="button"
    tabIndex={0}
    onPointerDown={(event) => event.stopPropagation()}
    onClick={(event) => {
      event.stopPropagation();
      onAction?.(view.primaryAction.action);
    }}
    onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        onAction?.(view.primaryAction.action);
      }
    }}
  >
    {view.primaryAction.action === 'confirm-distribution' && <Check size={11} />}
    {view.primaryAction.label}
  </span>
);

const ARTIFACT_NODE_IDS = new Set(['mine', 'keywordReview', 'verify', 'select', 'generate', 'collectRank', 'generateSheet']);

/**
 * Component to render button for viewing node artifact.
 * @param {object} props Component props.
 * @param {object} props.data Node data object.
 * @returns {import('react').JSX.Element|null} React component element or null.
 */
export const WorkflowNodeArtifactButton = ({ data }) => {
  const status = String(data?.status || data?.state || '').toLowerCase();
  const output = data?.output;
  const hasOutput = Array.isArray(output)
    ? output.length > 0
    : output && typeof output === 'object'
      ? Object.keys(output).length > 0
      : Boolean(output);
  const hasResult = ['completed', 'blocked', 'failed', 'retryable', 'needs_review', 'waiting_confirmation', 'waiting_manual'].includes(status)
    && (hasOutput || status !== 'completed');
  if (!data?.onViewArtifact || !hasResult || !ARTIFACT_NODE_IDS.has(String(data.id || ''))) return null;
  return (
    <span
      className="production-node-artifact-action"
      role="button"
      tabIndex={0}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        data.onViewArtifact();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          data.onViewArtifact();
        }
      }}
    >
      <FileText size={11} /> 查看产物
    </span>
  );
};

/**
 * Component to render workflow step index badge.
 * @param {object} props Component props.
 * @param {object} props.data Node data object.
 * @returns {import('react').JSX.Element|null} React component element or null.
 */
export const WorkflowStepBadge = ({ data }) => {
  if (!data.stepIndex || !data.stepTotal) return null;
  return (
    <span className="workflow-step-badge">
      步骤 {data.stepIndex}/{data.stepTotal}
    </span>
  );
};

/**
 * Component to render node output success summary text.
 * @param {object} props Component props.
 * @param {object} props.view Node view model object.
 * @returns {import('react').JSX.Element|null} React component element or null.
 */
export const WorkflowNodeOutputSummary = ({ view }) => {
  if (!view.successLabel) return null;
  return (
    <div className="workflow-node-output-summary">
      {view.successLabel}
    </div>
  );
};

/**
 * Component to render node diversity metrics summary strip.
 * @param {object} props Component props.
 * @param {string} props.nodeId Canvas node ID.
 * @param {object} props.data Node data object.
 * @returns {import('react').JSX.Element|null} React component element or null.
 */
export const WorkflowNodeDiversitySummary = ({ nodeId, data }) => {
  const diversity = data?.output?.diversity || data?.diversity || null;
  if (!diversity) return null;
  const rows = nodeId === 'mine'
    ? [
        Number(data?.output?.inspirationCount || diversity.inspirations || 0) > 0 ? `${data?.output?.inspirationCount || diversity.inspirations} 条灵感` : '',
        Number(data?.output?.selectedRoots || diversity.selectedRoots || 0) > 0 ? `${data?.output?.selectedRoots || diversity.selectedRoots} 个词根` : '',
        Number(data?.output?.inspirationRejected || diversity.inspirationRejected || 0) > 0 ? `拦截 ${data?.output?.inspirationRejected || diversity.inspirationRejected} 条` : '',
        Number(diversity.familyCount || 0) > 0 ? `${diversity.familyCount} 个词族` : '',
        Number(diversity.newFamilyCount || 0) > 0 ? `新增 ${diversity.newFamilyCount} 个` : '',
        Number(diversity.seedReplenished || 0) > 0 ? `补充种子 ${diversity.seedReplenished} 个` : '',
        Number(diversity.seenFiltered || 0) > 0 ? `过滤旧词 ${diversity.seenFiltered} 个` : ''
      ]
    : nodeId === 'select'
      ? [
          Number(diversity.newOffers || 0) > 0 ? `新货源 ${diversity.newOffers} 个` : '',
          Number(diversity.uniqueOffers || 0) > 0 ? `独立货源 ${diversity.uniqueOffers} 个` : '',
          Number(diversity.suppliers || 0) > 0 ? `${diversity.suppliers} 家供应商` : '',
          Number(diversity.historyFallbackCount || 0) > 0 ? `历史回退 ${diversity.historyFallbackCount} 个` : ''
        ]
      : [];
  const visible = rows.filter(Boolean);
  if (visible.length === 0) return null;
  return <div className="workflow-node-diversity-summary">{visible.join(' · ')}</div>;
};
