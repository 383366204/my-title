import { Clock, RefreshCw, Square } from 'lucide-react';

/**
 * Component to render active distribution job progress and execution controls.
 * @param {object} props Component props.
 * @param {object} props.distributionJob Active distribution job state.
 * @param {number} [props.activeRowsCount=0] Count of active items in queue.
 * @param {string} [props.distributionSubmitError] Submission error text.
 * @param {Function} [props.onControlJob] Control action handler (pause/cancel/recheck).
 * @returns {import('react').JSX.Element|null} React component element or null.
 */
export function ExecutionPanel({
  distributionJob,
  activeRowsCount = 0,
  distributionSubmitError,
  onControlJob
}) {
  if (!distributionJob) return null;

  const statusTitle = distributionJob.status === 'submitting'
    ? '正在自动铺货'
    : distributionJob.status === 'checking_confirmation'
      ? '正在核对铺货结果'
      : distributionJob.status === 'paused'
        ? '铺货已暂停'
        : distributionJob.status === 'completed' && distributionJob.mode === 'manual'
          ? '人工铺货已确认'
          : distributionJob.status === 'completed'
            ? '铺货已完成'
            : distributionJob.status === 'cancelled'
              ? '铺货已取消'
              : '铺货结果';

  const isBlockedStyle = distributionJob.status === 'failed' || distributionJob.status === 'completed_with_issues';

  return (
    <section className={`distribution-execution-panel ${isBlockedStyle ? 'blocked' : ''}`}>
      <div className="distribution-execution-head">
        <div>
          <strong>{statusTitle}</strong>
          <span>{distributionJob.completed || 0} / {distributionJob.total || activeRowsCount} 个商品已处理</span>
        </div>
        {distributionJob.status === 'submitting' && (
          <div className="distribution-execution-actions">
            <button type="button" className="node-secondary-button" onClick={() => onControlJob?.('pause')}>
              <Clock size={13} /> 批次完成后暂停
            </button>
            <button type="button" className="node-secondary-button danger" onClick={() => onControlJob?.('cancel')}>
              <Square size={13} /> 取消后续批次
            </button>
          </div>
        )}
        {distributionJob.status === 'completed_with_issues' && (
          <div className="distribution-execution-actions">
            <button type="button" className="node-secondary-button" onClick={() => onControlJob?.('recheck')}>
              <RefreshCw size={13} /> 重新核对铺货结果
            </button>
          </div>
        )}
      </div>
      <div className="distribution-progress-track">
        <span style={{ width: `${Math.min(100, Math.round(((distributionJob.completed || 0) / Math.max(1, distributionJob.total || 1)) * 100))}%` }} />
      </div>
      <p>第 {distributionJob.progress?.batchIndex || 0} / {distributionJob.progress?.batchTotal || 0} 批 · {distributionJob.progress?.phase || '等待状态更新'}</p>
      {distributionJob.error && <p className="distribution-error-text">{distributionJob.error}</p>}
      {distributionJob.confirmationError && <p className="distribution-error-text">结果核对失败：{distributionJob.confirmationError}</p>}
      {distributionSubmitError && <p className="distribution-error-text">{distributionSubmitError}</p>}
      {Array.isArray(distributionJob.results) && distributionJob.results.some(row => row.status && row.status !== 'confirmed' && !row.skipped) && (
        <p className="distribution-error-text">存在未确认成功的批次，请查看结果后再处理，不会自动重复提交。</p>
      )}
      {Array.isArray(distributionJob.results) && distributionJob.results.length > 0 && (
        <div className="distribution-batch-results">
          {distributionJob.results.map((batch) => (
            <span key={`${batch.batchIndex}-${batch.batchHash || batch.status}`} className={batch.status === 'confirmed' ? 'success' : 'failed'}>
              第 {batch.batchIndex} 批：{batch.status === 'confirmed' ? '已确认' : batch.skipped ? '已跳过' : '需处理'}（{batch.count || 0} 个）
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
