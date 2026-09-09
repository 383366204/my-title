import { useState } from 'react';
import { confirmKeywordReview as confirmKeywordReviewRequest, confirmProductReview as confirmProductReviewRequest, confirmOrderSheetProducts as confirmOrderSheetProductsRequest, confirmReviewSheet, getWorkflowArtifact } from '../../../api/workflow-api.js';
import { candidateKeyword } from '../workflow-data.js';
import { useWorkflowRequestScope } from './use-workflow-request-scope.js';

/**
 * 节点人工确认与后续运行同步。
 * @param {object} options Run context and UI callbacks.
 * @returns {object} Confirmation actions and pending flags.
 */
export function useWorkflowConfirmations({ currentRunId, activeTemplateMode, setLogs, setRunStatus, setArtifactState, closeOverlay, listenToRunEvents, reloadRun, loadHistoryRun, runWorkflowOperation }) {
  const scope = useWorkflowRequestScope(currentRunId);
  const [pending, setPending] = useState(null);
  const confirmingReviews = pending?.scope === scope && pending.kind === 'reviews';
  const confirmingOrderSheetProducts = pending?.scope === scope && pending.kind === 'order-products';
  const beginConfirmation = (kind) => {
    if (!currentRunId) return null;
    const ticket = scope.begin('confirmation');
    if (ticket) setPending({ scope, kind });
    return ticket;
  };
  const finishConfirmation = (ticket) => {
    if (ticket.finish()) setPending(null);
  };
  const confirmReviewDrafts = async (reviews) => {
    const ticket = beginConfirmation('reviews');
    if (!ticket) return false;
    try {
      await confirmReviewSheet(currentRunId, reviews);
      if (!ticket.isCurrent()) return false;
      setLogs((previous) => [...previous, {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: `已确认 ${reviews.length} 条评价，正在生成最终评价表。`
      }]);
      setRunStatus('resuming');
      closeOverlay();
      listenToRunEvents(currentRunId);
      await reloadRun(currentRunId, { preserveLogs: true });
      return ticket.isCurrent();
    } catch (error) {
      if (!ticket.isCurrent()) return false;
      alert(`确认评价失败：${error.message}`);
      return false;
    } finally {
      finishConfirmation(ticket);
    }
  };


  const confirmOrderSheetProducts = async (input) => {
    const ticket = beginConfirmation('order-products');
    if (!ticket) return false;
    try {
      const payload = Array.isArray(input) ? { items: input } : input;
      const result = await confirmOrderSheetProductsRequest(currentRunId, payload);
      if (!ticket.isCurrent()) return false;
      const productCount = Number(result?.count) || payload?.groups?.reduce((total, group) => total + 1 + (group.subProducts?.length || 0), 0) || 0;
      const groupCount = Number(result?.groupCount) || payload?.groups?.length || 0;
      setLogs((previous) => [...previous, {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: groupCount > 0
          ? `已确认 ${groupCount} 个任务组、${productCount} 个商品，正在生成刷单表。`
          : `已确认 ${productCount} 个商品资料，正在生成刷单表。`
      }]);
      setRunStatus('resuming');
      closeOverlay();
      listenToRunEvents(currentRunId);
      await reloadRun(currentRunId, { preserveLogs: true });
      return ticket.isCurrent();
    } catch (error) {
      if (!ticket.isCurrent()) return false;
      const message = `保存商品资料失败：${error.message}`;
      setLogs((previous) => [...previous, { timestamp: new Date().toISOString(), level: 'error', message }]);
      alert(message);
      return false;
    } finally {
      finishConfirmation(ticket);
    }
  };


  const confirmKeywordReview = async (rows = [], manualKeywords = []) => {
    const ticket = beginConfirmation('keywords');
    if (!ticket) return false;
    try {
      const approvedKeywords = rows
        .filter((row) => row.reviewDecision !== 'rejected')
        .map((row) => candidateKeyword(row))
        .filter(Boolean);
      const rejectedKeywords = rows
        .filter((row) => row.reviewDecision === 'rejected')
        .map((row) => candidateKeyword(row))
        .filter(Boolean);
      await confirmKeywordReviewRequest(currentRunId, { approvedKeywords, rejectedKeywords, manualKeywords });
      if (!ticket.isCurrent()) return false;
      setLogs((prev) => [...prev, {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: `人工筛词完成，保留 ${approvedKeywords.length} 个，筛除 ${rejectedKeywords.length} 个关键词。`
      }]);
      if (activeTemplateMode === 'manual') {
        await runWorkflowOperation('resume');
      } else {
        await loadHistoryRun(currentRunId);
      }
      if (!ticket.isCurrent()) return false;
      setArtifactState((current) => ({ ...current, status: 'loading' }));
      const artifact = await getWorkflowArtifact(currentRunId, 'keywordReview');
      if (!ticket.isCurrent()) return false;
      setArtifactState({ status: artifact ? 'ready' : 'empty', nodeId: 'keywordReview', artifact, error: '' });
      return true;
    } catch (err) {
      if (!ticket.isCurrent()) return false;
      const message = `人工筛词确认失败: ${err.message}`;
      setLogs((prev) => [...prev, { timestamp: new Date().toISOString(), level: 'error', message }]);
      alert(message);
      return false;
    } finally {
      finishConfirmation(ticket);
    }
  };


  const confirmProductReview = async ({ approvedProductIds = [], manualProducts = [] } = {}) => {
    const ticket = beginConfirmation('products');
    if (!ticket) return false;
    try {
      const response = await confirmProductReviewRequest(currentRunId, { approvedProductIds, manualProducts });
      if (!ticket.isCurrent()) return false;
      const result = response.result || response;
      const selectedCount = result.selected?.length || 0;
      setLogs((prev) => [...prev, {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: `人工选品完成，已确认 ${selectedCount} 个商品。${result.status === 'products_selected' ? '正在继续生成标题。' : '请检查选品结果后再继续。'}`
      }]);
      setArtifactState({ status: 'loading', nodeId: 'select', artifact: null, error: '' });
      const artifact = await getWorkflowArtifact(currentRunId, 'select');
      if (!ticket.isCurrent()) return false;
      setArtifactState({ status: artifact ? 'ready' : 'empty', nodeId: 'select', artifact, error: '' });
      if (result.status === 'products_selected') {
        await runWorkflowOperation('resume', 'select');
      } else {
        await loadHistoryRun(currentRunId);
      }
      return ticket.isCurrent();
    } catch (err) {
      if (!ticket.isCurrent()) return false;
      const message = `人工选品确认失败: ${err.message}`;
      setLogs((prev) => [...prev, { timestamp: new Date().toISOString(), level: 'error', message }]);
      alert(message);
      return false;
    } finally {
      finishConfirmation(ticket);
    }
  };


  return { confirmReviewDrafts, confirmOrderSheetProducts, confirmKeywordReview, confirmProductReview, confirmingReviews, confirmingOrderSheetProducts };
}
