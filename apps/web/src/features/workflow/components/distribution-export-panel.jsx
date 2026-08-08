import { useEffect, useState } from 'react';
import {
  Check,
  ChevronRight,
  Copy,
  FileText,
  Play,
  RefreshCw,
  X
} from 'lucide-react';

import { checkDistribution as checkDistributionRequest } from '../../../api/distribution-api.js';
import { useDistributionJob } from '../hooks/use-distribution-job.js';
import { DistributionRow } from './distribution/distribution-row.jsx';
import { labelDistributionBlocker } from './distribution/distribution-view-model.js';
import { ExecutionPanel } from './distribution/execution-panel.jsx';
import { useDistributionExportData } from './distribution/use-distribution-export-data.js';

/**
 * Component to render distribution export panel with manual copy and automatic submission workflow.
 * @param {object} props Component props.
 * @param {object} props.artifactState Artifact state object for export.
 * @param {Function} props.onCopyText Copy text handler function.
 * @param {string} [props.currentRunId] Active run ID.
 * @param {string} [props.sourceNodeId='export'] Source node ID.
 * @param {Function} [props.onDistributionJobChange] Job state change listener.
 * @param {boolean} [props.directPreview=false] Whether rendering as direct preview.
 * @param {Function} [props.onManualComplete] Callback invoked only after manual distribution completes successfully.
 * @returns {import('react').JSX.Element} React component element.
 */
export const DistributionExportPanel = ({
  artifactState,
  onCopyText,
  currentRunId,
  sourceNodeId = 'export',
  onDistributionJobChange,
  directPreview = false,
  onManualComplete
}) => {
  const {
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
  } = useDistributionExportData({
    artifactState,
    currentRunId,
    sourceNodeId
  });

  const [previewOpen, setPreviewOpen] = useState(false);
  const [distributionCheck, setDistributionCheck] = useState({ status: 'idle', result: null, error: '' });
  const [manualCopiedText, setManualCopiedText] = useState('');
  const [manualCompleteStatus, setManualCompleteStatus] = useState({ status: 'idle', message: '' });

  const {
    job: distributionJob,
    error: distributionSubmitError,
    chromeStarting: distributionChromeStarting,
    chromeMessage: distributionChromeMessage,
    submit: submitDistributionJob,
    completeManual: completeManualDistributionJob,
    control: controlDistributionJob,
    startChrome: startDistributionChromeJob
  } = useDistributionJob({
    initialJobId: currentRunId ? `${currentRunId}-distribution` : '',
    onJobChange: onDistributionJobChange
  });

  const manualCopyCurrent = Boolean(copyTextValue) && manualCopiedText === copyTextValue;

  useEffect(() => {
    setDistributionCheck({ status: 'idle', result: null, error: '' });
  }, [copyTextValue]);

  const checkDistribution = async () => {
    if (!copyTextValue) {
      setDistributionCheck({ status: 'error', result: null, error: '当前清单为空，请先保留或加入至少 1 个商品。' });
      return null;
    }
    setDistributionCheck({ status: 'loading', result: null, error: '' });
    try {
      const payload = await checkDistributionRequest({ input: copyTextValue });
      setDistributionCheck({ status: 'ready', result: payload, error: '' });
      return payload;
    } catch (error) {
      setDistributionCheck({ status: 'error', result: null, error: error.message });
      return null;
    }
  };

  const submitDistribution = async (checkResult = distributionCheck.result) => {
    if (!copyTextValue || !checkResult?.canSubmit) return;
    const job = await submitDistributionJob({ input: copyTextValue, runId: currentRunId || '' });
    if (job) setPreviewOpen(false);
  };

  const confirmAndSubmitDistribution = async () => {
    if (!copyTextValue || distributionJob?.status === 'submitting') return;
    const checkResult = distributionCheck.result?.canSubmit
      ? distributionCheck.result
      : await checkDistribution();
    if (checkResult?.canSubmit) await submitDistribution(checkResult);
  };

  const copyManualDistribution = async () => {
    if (!canManualCopy) return;
    try {
      await onCopyText(copyTextValue);
      setManualCopiedText(copyTextValue);
      setManualCompleteStatus({
        status: 'copied',
        message: `已复制 ${activeRows.length} 条人工铺货清单${manualMissingCategoryCount > 0 ? `，其中 ${manualMissingCategoryCount} 条类目为空` : ''}。完成外部铺货后，再点击“标记人工铺货完成”。`
      });
    } catch (error) {
      setManualCompleteStatus({ status: 'error', message: `复制失败：${error.message}` });
    }
  };

  const confirmManualDistributionComplete = async () => {
    if (!manualCopyCurrent || !currentRunId || manualCompleteStatus.status === 'completing') return;
    const categoryReminder = manualMissingCategoryCount > 0
      ? `其中 ${manualMissingCategoryCount} 条类目为空，请确认你已在人工铺货时选择了正确类目。\n\n`
      : '';
    const confirmed = window.confirm(`${categoryReminder}确认已经按照刚复制的清单，手动完成 ${activeRows.length} 个商品的铺货？确认后本次流水线将进入完成状态。`);
    if (!confirmed) return;
    setManualCompleteStatus({ status: 'completing', message: '正在记录人工铺货结果...' });
    const job = await completeManualDistributionJob({ input: copyTextValue, runId: currentRunId });
    if (job) {
      setManualCompleteStatus({ status: 'completed', message: '人工铺货已确认，流水线正在进入完成节点。' });
      setPreviewOpen(false);
      onManualComplete?.();
    } else {
      setManualCompleteStatus({ status: 'error', message: '人工铺货完成状态记录失败，请查看下方错误后重试。' });
    }
  };

  const startDistributionChrome = async () => {
    await startDistributionChromeJob();
  };

  const distributionNeedsChrome = distributionCheck.result?.blockers?.includes('browser_cdp_unavailable');

  const controlDistribution = async (action) => {
    await controlDistributionJob(action);
  };

  const previewPanelContent = (
    <>
      <div className="export-preview-actions">
        <button type="button" className="node-primary-button" disabled={!canManualCopy} onClick={copyManualDistribution}>
          <Copy size={13} /> 复制铺货内容
        </button>
        <button type="button" className="node-secondary-button success" disabled={!manualCopyCurrent || manualCompleteStatus.status === 'completing' || distributionJob?.status === 'submitting'} onClick={confirmManualDistributionComplete}>
          {manualCompleteStatus.status === 'completing' ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
          {manualCompleteStatus.status === 'completing' ? '正在确认' : '标记人工铺货完成'}
        </button>
        <button type="button" className="node-secondary-button" disabled={removedRows.length === 0} onClick={resetRemoved}>
          <RefreshCw size={13} /> 恢复全部
        </button>
        <button type="button" className="node-primary-button danger" disabled={!copyTextValue || distributionJob?.status === 'submitting' || distributionCheck.status === 'loading'} onClick={confirmAndSubmitDistribution}>
          {distributionCheck.status === 'loading' ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
          {distributionCheck.status === 'loading' ? '正在检查铺货环境' : '确认并开始自动铺货'}
        </button>
      </div>
      <div className="export-preview-status">
        <p className="distribution-confirm-warning">人工铺货请先复制“链接$$标题$$类目”，完成外部铺货后再标记完成；自动铺货会使用当前 Chrome 登录态。</p>
        {manualIncompleteCount > 0 && <div className="distribution-modal-feedback blocked">有 {manualIncompleteCount} 条缺少链接或标题，请在下方补充后再复制。</div>}
        {manualMissingCategoryCount > 0 && <div className="distribution-modal-feedback checking">有 {manualMissingCategoryCount} 条历史清单没有类目，复制内容会保留第三段为空。可在下方补充，或在人工铺货时选择正确类目。</div>}
        {manualCopiedText && !manualCopyCurrent && <div className="distribution-modal-feedback blocked">清单已经修改，请重新复制最新内容后再确认完成。</div>}
        {manualCompleteStatus.message && manualCopyCurrent && <div className={`distribution-modal-feedback ${manualCompleteStatus.status === 'error' ? 'blocked' : 'checking'}`}>{manualCompleteStatus.message}</div>}
        {distributionCheck.status === 'loading' && (
          <div className="distribution-modal-feedback checking">
            <RefreshCw size={13} className="animate-spin" /> 正在检查清单、Chrome 调试端口和登录状态，请稍候...
          </div>
        )}
        {distributionCheck.status === 'error' && (
          <div className="distribution-modal-feedback blocked">铺货检查失败：{distributionCheck.error || '未知错误'}</div>
        )}
        {distributionCheck.status === 'ready' && !distributionCheck.result?.canSubmit && (
          <div className="distribution-modal-feedback blocked">
            <strong>暂时无法开始自动铺货</strong>
            {Array.isArray(distributionCheck.result?.blockers) && distributionCheck.result.blockers.length > 0
              ? <span>阻塞原因：{distributionCheck.result.blockers.map(labelDistributionBlocker).join('，')}</span>
              : <span>请检查 Chrome 登录状态、CDP 端口和清单格式。</span>}
            {distributionNeedsChrome && (
              <div className="distribution-modal-feedback-actions">
                <button type="button" className="node-secondary-button" onClick={startDistributionChrome} disabled={distributionChromeStarting}>
                  {distributionChromeStarting ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
                  {distributionChromeStarting ? '正在启动 Chrome' : '启动铺货 Chrome'}
                </button>
                <button type="button" className="node-secondary-button" onClick={checkDistribution} disabled={distributionChromeStarting || distributionCheck.status === 'loading'}>
                  <RefreshCw size={13} /> 重新检查
                </button>
              </div>
            )}
          </div>
        )}
        {distributionSubmitError && (
          <div className="distribution-modal-feedback blocked">提交失败：{distributionSubmitError}</div>
        )}
        {distributionChromeMessage && !distributionSubmitError && (
          <div className="distribution-modal-feedback checking">{distributionChromeMessage}</div>
        )}
      </div>

      <div className="export-preview-list">
        {exportStatus === 'loading' && <div className="artifact-empty"><RefreshCw size={13} className="animate-spin" /> 正在加载铺货清单...</div>}
        {exportStatus === 'error' && <div className="artifact-error">{exportError || '铺货清单加载失败'}</div>}
        {exportStatus !== 'loading' && rows.length === 0 && (
          <div className="artifact-empty">当前导出清单为空，通常表示前面的生成或复核没有产出可铺货商品。</div>
        )}
        {rows.map((row) => (
          <DistributionRow
            key={row.key}
            row={row}
            variant="preview"
            isBlocked={false}
            onUpdateEdit={updateRowEdit}
            onMarkRemoved={markRemoved}
          />
        ))}
        {pendingBlockedRows.map((row) => (
          <DistributionRow
            key={row.key}
            row={row}
            variant="preview"
            isBlocked={true}
            onUpdateEdit={updateRowEdit}
            onMarkIncluded={markIncluded}
          />
        ))}
      </div>
    </>
  );

  if (directPreview) {
    return (
      <div className="export-preview-direct">
        <div className="export-preview-direct-summary">
          <strong>{activeRows.length} 条待铺货</strong>
          <span>{removedRows.length} 条已移除 · {pendingBlockedRows.length} 条待人工加入</span>
        </div>
        {previewPanelContent}
      </div>
    );
  }

  return (
    <div className="export-workbench">
      <section className={`distribution-ready-hero ${activeRows.length > 0 ? 'has-items' : 'is-empty'}`}>
        <div className="distribution-ready-hero-copy">
          <span className="distribution-ready-eyebrow">当前要处理</span>
          <strong>{activeRows.length} 个待铺货商品</strong>
          <p>
            {activeRows.length > 0
              ? '先查看并确认清单，再检查铺货环境。被拦截的商品不会自动进入铺货。'
              : '当前没有可铺货商品，请先完成标题生成或把下方合适的复核项加入清单。'}
          </p>
        </div>
        <div className="distribution-ready-hero-actions">
          <button type="button" className="node-primary-button" disabled={!copyTextValue} onClick={() => setPreviewOpen(true)}>
            <FileText size={14} /> 查看并确认清单
          </button>
        </div>
      </section>

      <div className="distribution-next-steps" aria-label="铺货操作步骤">
        <span className="is-current"><b>1</b>确认商品</span>
        <ChevronRight size={13} />
        <span><b>2</b>选择人工或自动铺货</span>
        <ChevronRight size={13} />
        <span><b>3</b>确认完成</span>
      </div>

      <section className="distribution-method-grid" aria-label="选择铺货方式">
        <article className="distribution-method-card manual">
          <div>
            <span>人工铺货</span>
            <strong>复制清单后手动铺货</strong>
            <p>复制为“链接$$标题$$类目”，在外部工具完成铺货后手动确认流程完成。</p>
          </div>
          <div className="distribution-method-actions">
            <button type="button" className="node-secondary-button" disabled={!canManualCopy} onClick={copyManualDistribution}>
              <Copy size={13} /> 人工复制铺货
            </button>
            <button type="button" className="node-secondary-button success" disabled={!manualCopyCurrent || manualCompleteStatus.status === 'completing' || distributionJob?.status === 'submitting'} onClick={confirmManualDistributionComplete}>
              {manualCompleteStatus.status === 'completing' ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
              {manualCompleteStatus.status === 'completing' ? '正在确认' : '标记人工铺货完成'}
            </button>
          </div>
          {manualIncompleteCount > 0 && <small className="distribution-method-warning">有 {manualIncompleteCount} 条缺少链接或标题，请补充后再复制。</small>}
          {manualMissingCategoryCount > 0 && <small className="distribution-method-warning">有 {manualMissingCategoryCount} 条类目为空，复制时第三段会留空，请在人工铺货时选择正确类目。</small>}
          {manualCopiedText && !manualCopyCurrent && <small className="distribution-method-warning">清单已经修改，请重新复制最新内容后再确认完成。</small>}
          {manualCompleteStatus.message && manualCopyCurrent && <small className={`distribution-method-feedback ${manualCompleteStatus.status}`}>{manualCompleteStatus.message}</small>}
          {manualCompleteStatus.status === 'error' && distributionSubmitError && <small className="distribution-method-feedback error">{distributionSubmitError}</small>}
        </article>
        <article className="distribution-method-card automatic">
          <div>
            <span>自动铺货</span>
            <strong>使用当前 Chrome 登录态</strong>
            <p>先检查 Chrome、登录状态和重复批次，再在清单预览中确认提交。</p>
          </div>
          <div className="distribution-method-actions">
            <button type="button" className="node-secondary-button" disabled={!copyTextValue || distributionCheck.status === 'loading'} onClick={checkDistribution}>
              {distributionCheck.status === 'loading' ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
              检查自动铺货环境
            </button>
          </div>
        </article>
      </section>

      <ExecutionPanel
        distributionJob={distributionJob}
        activeRowsCount={activeRows.length}
        distributionSubmitError={distributionSubmitError}
        onControlJob={controlDistribution}
      />

      <div className="review-summary-grid">
        <div><strong>{rows.length}</strong><span>清单项</span></div>
        <div><strong>{activeRows.length}</strong><span>将导出</span></div>
        <div><strong>{pendingBlockedRows.length}</strong><span>待人工加入</span></div>
        <div><strong>{copyTextValue ? '可复制' : '无内容'}</strong><span>清单状态</span></div>
      </div>

      <div className="export-toolbar">
        <button type="button" className="node-secondary-button" onClick={() => setPreviewOpen(true)} disabled={!copyTextValue}>
          <FileText size={13} /> 打开清单预览
        </button>
        <button type="button" className="node-secondary-button" disabled={removedRows.length === 0} onClick={resetRemoved}>
          <RefreshCw size={13} /> 恢复全部
        </button>
      </div>

      {distributionCheck.status !== 'idle' && (
        <div className={`distribution-check-panel ${distributionCheck.status === 'error' || distributionCheck.result?.ok === false ? 'blocked' : ''}`}>
          {distributionCheck.status === 'loading' ? (
            <span><RefreshCw size={13} className="animate-spin" /> 正在检查 Chrome、登录状态和重复提交...</span>
          ) : distributionCheck.status === 'error' ? (
            <span>{distributionCheck.error}</span>
          ) : (
            <>
              <strong>{distributionCheck.result?.canSubmit ? '检查通过，可以进入最终确认' : '检查未通过，需要先处理阻塞'}</strong>
              <p>
                清单 {distributionCheck.result?.total || 0} 条
                {Array.isArray(distributionCheck.result?.batches) ? ` · ${distributionCheck.result.batches.length} 个批次` : ''}
              </p>
              {Array.isArray(distributionCheck.result?.blockers) && distributionCheck.result.blockers.length > 0 && (
                <p>阻塞原因：{distributionCheck.result.blockers.map(labelDistributionBlocker).join('，')}</p>
              )}
              {distributionCheck.result?.canSubmit && <p>检查通过。打开清单预览后，确认商品无误即可启动自动铺货。</p>}
            </>
          )}
        </div>
      )}

      <div className="export-row-list">
        {exportStatus === 'loading' && <div className="artifact-empty"><RefreshCw size={13} className="animate-spin" /> 正在加载铺货清单...</div>}
        {exportStatus === 'error' && <div className="artifact-error">{exportError || '铺货清单加载失败'}</div>}
        {(exportStatus === 'ready' || exportStatus === 'empty') && rows.length === 0 && (
          <div className="artifact-empty">当前导出清单为空，通常表示前面的生成或复核没有产出可铺货商品。</div>
        )}
        {rows.map((row) => (
          <DistributionRow
            key={row.key}
            row={row}
            variant="workbench"
            isBlocked={false}
            onUpdateEdit={updateRowEdit}
            onMarkRemoved={markRemoved}
            onCopyText={onCopyText}
          />
        ))}
        {reviewArtifactState.status === 'loading' && <div className="artifact-empty"><RefreshCw size={13} className="animate-spin" /> 正在读取拦截原因...</div>}
        {reviewArtifactState.status === 'error' && <div className="artifact-error">{reviewArtifactState.error || '拦截原因加载失败'}</div>}
        {pendingBlockedRows.length > 0 && (
          <section className="export-blocked-section">
            <div className="node-workbench-head">
              <strong>被拦截但可人工判断</strong>
              <span>{pendingBlockedRows.length} 条</span>
            </div>
            <div className="export-row-list compact">
              {pendingBlockedRows.map((row) => (
                <DistributionRow
                  key={row.key}
                  row={row}
                  variant="workbench"
                  isBlocked={true}
                  onUpdateEdit={updateRowEdit}
                  onMarkIncluded={markIncluded}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {previewOpen && (
        <div className="workflow-modal-backdrop" role="presentation" onClick={() => setPreviewOpen(false)}>
          <section className="workflow-modal export-preview-modal" role="dialog" aria-modal="true" aria-label="导出清单预览" onClick={(event) => event.stopPropagation()}>
            <div className="workflow-modal-head">
              <div>
                <strong>导出清单预览</strong>
                <span>{activeRows.length} 条将导出 · {removedRows.length} 条已移除 · {pendingBlockedRows.length} 条待人工加入</span>
              </div>
              <button type="button" className="node-icon-button" title="关闭弹窗" onClick={() => setPreviewOpen(false)}>
                <X size={14} />
              </button>
            </div>

            {previewPanelContent}
          </section>
        </div>
      )}
    </div>
  );
};
