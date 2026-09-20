import { Clock, RefreshCw, Square } from 'lucide-react';
import distributionModes from '../../../../../../../core/distribution-modes.json';

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
  const confirmation = distributionJob.confirmationCheck?.confirmation;
  const successIds = new Set(confirmation?.foundOfferIds || []);
  const issueIds = new Set(confirmation?.issueOfferIds || []);
  const resultRows = confirmation ? (distributionJob.items || []).map(item => ({
    ...item,
    status: issueIds.has(item.offerId) ? '失败' : successIds.has(item.offerId) ? '成功' : '待确认',
    details: (confirmation.byShop || []).flatMap(shop => {
      const result = shop.perOfferId?.[item.offerId];
      return result && result.status !== 'unknown' ? [{
        shopName: shop.shopName,
        label: ({ success: '成功', failed: '失败', copying: '复制中', skipped: '已跳过', cancelled: '已取消', stopped: '已停止' })[result.status] || '待确认',
        reason: result.reason || '',
        failed: ['failed', 'skipped', 'stopped', 'cancelled'].includes(result.status)
      }] : [];
    })
  })) : [];
  const completedCount = confirmation ? resultRows.filter(row => row.status === '成功').length : distributionJob.completed || 0;
  const failedCount = confirmation ? resultRows.filter(row => row.status === '失败').length : distributionJob.failed || 0;

  return (
    <section className={`distribution-execution-panel ${isBlockedStyle ? 'blocked' : ''}`}>
      <div className="distribution-execution-head">
        <div>
          <strong>{statusTitle}</strong>
          {(distributionJob.targetShops || (distributionJob.shop ? [distributionJob.shop] : [])).map(shop => <span key={shop.id || shop.platformShopName}>店铺：{shop.name} · {shop.platformShopName}</span>)}
          {distributionJob.distributionMode && <span>商品分配方式：{distributionModes.find(mode => mode.value === distributionJob.distributionMode)?.label || distributionJob.distributionMode}</span>}
          <span role="status" className="distribution-result-summary">
            <span className="distribution-result-success">成功 {completedCount}</span> · <span className="distribution-result-failed">失败 {failedCount}</span> · <span className="distribution-result-pending">待确认 {Math.max(0, (distributionJob.total || activeRowsCount) - completedCount - failedCount)}</span>
          </span>
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
        <span style={{ width: `${Math.min(100, Math.round((completedCount / Math.max(1, distributionJob.total || 1)) * 100))}%` }} />
      </div>
      <p>第 {distributionJob.progress?.batchIndex || 0} / {distributionJob.progress?.batchTotal || 0} 批 · {distributionJob.progress?.phase || '等待状态更新'}</p>
      {distributionJob.error && <p className="distribution-error-text">{distributionJob.error}</p>}
      {distributionJob.confirmationError && <p className="distribution-error-text">结果核对失败：{distributionJob.confirmationError}</p>}
      {distributionSubmitError && <p className="distribution-error-text">{distributionSubmitError}</p>}
      {confirmation && <div className="distribution-confirmation-results" aria-label="铺货核对明细">
        {resultRows.map(row => <div key={row.offerId} className={`distribution-confirmation-row distribution-result-${row.status === '成功' ? 'success' : row.status === '失败' ? 'failed' : 'pending'}`}>
          <div className="distribution-confirmation-heading">
            <strong><span className="distribution-result-label">{row.status}</span> · {row.title || '商品'}</strong>
            <span className="distribution-confirmation-id">ID：{row.offerId}</span>
          </div>
          {row.details.map(detail => <div key={detail.shopName}>
            <p>{detail.shopName}：{detail.label}</p>
            {detail.failed && <p className="distribution-confirmation-reason">失败原因：{detail.reason || '历史记录未保存具体原因，请点击“重新核对铺货结果”获取；若仍未返回，请查看平台复制日志。'}</p>}
          </div>)}
        </div>)}
      </div>}
      {!confirmation && Array.isArray(distributionJob.results) && distributionJob.results.some(row => row.status && row.status !== 'confirmed' && !row.skipped) && (
        <p className="distribution-error-text">存在未确认成功的批次，请查看结果后再处理，不会自动重复提交。</p>
      )}
      {!confirmation && Array.isArray(distributionJob.results) && distributionJob.results.length > 0 && (
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
