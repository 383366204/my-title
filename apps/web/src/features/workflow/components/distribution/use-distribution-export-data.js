import { useEffect, useState } from 'react';

import { getWorkflowArtifact } from '../../../../api/workflow-api.js';
import { getWorkflowArtifactView } from '../../../../workflow-ui.js';
import { usePersistentMap } from '../../hooks/use-persistent-map.js';
import {
  buildDistributionText,
  distributionRowCategory,
  distributionRowUrl,
  exportReviewRowToDistributionRow
} from './distribution-view-model.js';

/**
 * Custom hook to aggregate export artifact data, review blockers, and persistent user edits.
 * @param {object} props Hook options.
 * @param {object} [props.artifactState] Artifact state for source node.
 * @param {string} [props.currentRunId] Current workflow run ID.
 * @param {string} [props.sourceNodeId='export'] Source node identifier.
 * @returns {object} Export data state, active rows, blocker rows, and handler functions.
 */
export function useDistributionExportData({
  artifactState,
  currentRunId,
  sourceNodeId = 'export'
}) {
  const [exportArtifactState, setExportArtifactState] = useState({ status: 'empty', artifact: null, error: '' });
  const [reviewArtifactState, setReviewArtifactState] = useState({ status: 'empty', artifact: null, error: '' });

  const sourceIsReview = sourceNodeId === 'review';
  const exportArtifact = sourceIsReview ? exportArtifactState.artifact : artifactState?.artifact;
  const exportStatus = sourceIsReview ? exportArtifactState.status : artifactState?.status;
  const exportError = sourceIsReview ? exportArtifactState.error : artifactState?.error;
  const view = getWorkflowArtifactView(exportArtifact, 'export');

  const storageKey = `ecom.exportSelection.${currentRunId || artifactState?.artifact?.runId || 'draft'}`;
  const includeStorageKey = `ecom.exportManualInclude.${currentRunId || artifactState?.artifact?.runId || 'draft'}`;
  const editStorageKey = `ecom.exportEdits.${currentRunId || artifactState?.artifact?.runId || 'draft'}`;

  const [removed, setRemoved] = usePersistentMap(storageKey);
  const [included, setIncluded] = usePersistentMap(includeStorageKey);
  const [edits, setEdits] = usePersistentMap(editStorageKey);

  useEffect(() => {
    if (!sourceIsReview) {
      setExportArtifactState({ status: 'empty', artifact: null, error: '' });
      return;
    }
    if (!currentRunId) {
      setExportArtifactState({ status: 'empty', artifact: null, error: '' });
      return;
    }
    let cancelled = false;
    setExportArtifactState((previous) => ({ ...previous, status: 'loading', error: '' }));
    getWorkflowArtifact(currentRunId, 'export')
      .then((artifact) => {
        if (!cancelled) setExportArtifactState({ status: artifact ? 'ready' : 'empty', artifact, error: '' });
      })
      .catch((error) => {
        if (!cancelled) setExportArtifactState({ status: 'error', artifact: null, error: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, [currentRunId, sourceIsReview]);

  useEffect(() => {
    if (sourceIsReview) {
      setReviewArtifactState({ status: artifactState?.status || 'empty', artifact: artifactState?.artifact || null, error: artifactState?.error || '' });
      return;
    }
    if (!currentRunId) {
      setReviewArtifactState({ status: 'empty', artifact: null, error: '' });
      return;
    }
    let cancelled = false;
    setReviewArtifactState((previous) => ({ ...previous, status: 'loading', error: '' }));
    getWorkflowArtifact(currentRunId, 'review')
      .then((artifact) => {
        if (!cancelled) setReviewArtifactState({ status: artifact ? 'ready' : 'empty', artifact, error: '' });
      })
      .catch((error) => {
        if (!cancelled) setReviewArtifactState({ status: 'error', artifact: null, error: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, [artifactState, currentRunId, sourceIsReview]);

  const sourceRows = view.kind === 'business-list' ? (view.rows || []) : [];
  const applyEdits = (row) => ({ ...row, ...(edits[row.key] || {}) });
  const readyRows = sourceRows.map((row, index) => {
    const key = `${distributionRowUrl(row) || row.title || 'row'}:${index}`;
    return { ...row, key, removed: Boolean(removed[key]), fromReview: false };
  }).map(applyEdits);

  const reviewView = getWorkflowArtifactView(reviewArtifactState.artifact, 'review');
  const blockedRows = reviewView.kind === 'review-list'
    ? reviewView.rows
      .filter((row) => row.group === 'manual' || row.group === 'rejected')
      .map(exportReviewRowToDistributionRow)
    : [];

  const manuallyIncludedRows = blockedRows
    .filter((row) => included[row.key])
    .map((row) => applyEdits({ ...row, removed: Boolean(removed[row.key]) }));

  const rows = [...readyRows, ...manuallyIncludedRows];
  const activeRows = rows.filter((row) => !row.removed);
  const removedRows = rows.filter((row) => row.removed);
  const pendingBlockedRows = blockedRows.filter((row) => !included[row.key]).map(applyEdits);
  const copyTextValue = buildDistributionText(activeRows);

  const manualIncompleteCount = activeRows.filter((row) => (
    !distributionRowUrl(row) || !String(row.title || '').trim()
  )).length;
  const manualMissingCategoryCount = activeRows.filter((row) => !String(distributionRowCategory(row) || '').trim()).length;
  const canManualCopy = Boolean(currentRunId) && activeRows.length > 0 && manualIncompleteCount === 0;

  const markRemoved = (key, value) => {
    setRemoved((previous) => ({ ...previous, [key]: value }));
  };

  const markIncluded = (key, value) => {
    setIncluded((previous) => ({ ...previous, [key]: value }));
    if (value) {
      setRemoved((previous) => ({ ...previous, [key]: false }));
    }
  };

  const updateRowEdit = (key, field, value) => {
    setEdits((previous) => ({
      ...previous,
      [key]: { ...(previous[key] || {}), [field]: value }
    }));
  };

  const resetRemoved = () => {
    setRemoved({});
  };

  return {
    exportStatus,
    exportError,
    reviewArtifactState,
    rows,
    activeRows,
    removedRows,
    pendingBlockedRows,
    copyTextValue,
    manualIncompleteCount,
    manualMissingCategoryCount,
    canManualCopy,
    markRemoved,
    markIncluded,
    updateRowEdit,
    resetRemoved
  };
}
