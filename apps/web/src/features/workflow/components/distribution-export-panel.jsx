import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronRight,
  FileText,
  Play,
  RefreshCw,
  X
} from 'lucide-react';

import { checkDistribution as checkDistributionRequest } from '../../../api/distribution-api.js';
import { copyCategoryContent } from '../../../api/category-api.js';
import { useDistributionJob } from '../hooks/use-distribution-job.js';
import { DistributionRow } from './distribution/distribution-row.jsx';
import { labelDistributionBlocker, buildDistributionText, distributionCopyFormat, distributionCopyIssues, distributionRowUrl } from './distribution/distribution-view-model.js';
import { DistributionCopyButton } from './distribution/distribution-copy-button.jsx';
import { usePersistentMap } from '../hooks/use-persistent-map.js';
import { ExecutionPanel } from './distribution/execution-panel.jsx';
import { useDistributionExportData } from './distribution/use-distribution-export-data.js';
import { DistributionShopPicker } from './distribution/shop-picker.jsx';

function CategoryToolbar({ control, rows, onRemove }) {
  const job = control.state?.job;
  const missing = control.state?.rows?.filter(row => !row.category) || [];
  const activeMissing = rows.filter(row => !row.categoryRecord?.category);
  const hasWork = missing.length > 0 || job?.status === 'running' || job?.status === 'paused' || job?.error || control.error || activeMissing.length > 0;
  if (!hasWork) return null;
  return <div className="flex items-center flex-wrap gap-2 py-3">
    {missing.length > 0 && <span className="text-[11px] text-slate-400">{missing.length} 件商品缺少类目{job?.status === 'running' ? `（正在查询 ${job.completed || 0}/${job.requests?.length || 0}）` : ''}</span>}
    {missing.length > 0 && <button type="button" className="node-secondary-button" disabled={control.busy || control.state?.locked || job?.status === 'running' || job?.inFlight}
      onClick={() => control.act({ action: 'query', urls: missing.map(row => row.url) })}>补全缺失类目</button>}
    {job?.status === 'running' && <button type="button" className="node-secondary-button" disabled={control.busy} onClick={() => control.act({ action: 'pause' })}>暂停获取</button>}
    {job?.status === 'paused' && <button type="button" className="node-secondary-button" disabled={control.busy || job.inFlight} onClick={() => control.act({ action: 'resume' })}>继续获取</button>}
    {job?.error && <button type="button" className="node-secondary-button" disabled={control.busy || job.inFlight || control.state?.locked} onClick={control.startChrome}>启动生意参谋 Chrome</button>}
    {activeMissing.length > 0 && <button type="button" className="node-secondary-button" onClick={() => {
      if (window.confirm(`从当前清单移除 ${activeMissing.length} 件待补类目商品，仅保留已就绪项？`)) activeMissing.forEach(row => onRemove(row.key, true));
    }}>仅保留类目已就绪商品</button>}
    {(control.error || job?.error) && <span role="alert" className="basis-full text-[#efb467] text-[11px]">{control.error || job.error}</span>}
  </div>;
}

/**
 * Component to render distribution export panel with manual copy and automatic submission workflow.
 * @param {object} props Component props.
 * @param {object} props.artifactState Artifact state object for export.
 * @param {Function} props.onCopyText Copy text handler function.
 * @param {string} [props.currentRunId] Active run ID.
 * @param {string} [props.sourceNodeId='export'] Source node ID.
 * @param {Function} [props.onDistributionJobChange] Job state change listener.
 * @param {string} [props.workflowRunStatus] Current workflow runtime status.
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
  workflowRunStatus = '',
  directPreview = false,
  onManualComplete
}) => {
  const {
    categoryControl,
    exportStatus,
    exportError,
    reviewArtifactState,
    rows,
    activeRows,
    removedRows,
    pendingBlockedRows,
    copyTextValue,
    manualMissingCategoryCount,
    canManualCopy: canRecordManualComplete,
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
  const [selectedShops, setSelectedShops] = useState(null);
  const [selectedMode, setSelectedMode] = useState('random-average');
  const [editingShop, setEditingShop] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [distributionCheck, setDistributionCheck] = useState({ status: 'idle', result: null, error: '' });
  const [manualCopiedText, setManualCopiedText] = useState('');
  const [manualCompleteStatus, setManualCompleteStatus] = useState({ status: 'idle', message: '' });
  const [copyPreference, setCopyPreference] = usePersistentMap('ecom.distributionCopyFormat');
  const copyFormat = distributionCopyFormat(copyPreference.format);
  const manualText = buildDistributionText(activeRows, copyFormat.value);
  const copyIssues = distributionCopyIssues(activeRows, copyFormat.value);
  const canManualCopy = Boolean(currentRunId) && activeRows.length > 0 && copyIssues.length === 0;
  const changeCopyFormat = format => {
    setCopyPreference({ format });
    setManualCompleteStatus({ status: 'idle', message: '' });
  };
  const copyValidation = copyIssues.length > 0 && (
    <div className="grid gap-0.5 border border-red-400/40 bg-red-900/15 text-red-200 px-2.5 py-2 rounded-md text-[11px] leading-normal break-all" role="alert">
      当前格式有 {copyIssues.length} 条商品需要补充或修正：
      {copyIssues.map(issue => <div key={issue.index}>第 {issue.index} 条「{issue.title}」：{issue.fields.join('、')}</div>)}
    </div>
  );

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
    notifyCompletedOnRestore: String(workflowRunStatus).toLowerCase() !== 'completed',
    onJobChange: onDistributionJobChange
  });

  const lockedShops = useMemo(() => distributionJob?.targetShops || (distributionJob?.shop ? [distributionJob.shop] : null), [distributionJob?.targetShops, distributionJob?.shop]);
  const targetShops = lockedShops || selectedShops || [];
  const distributionMode = distributionJob?.distributionMode || selectedMode;
  const selection = { shopIds: targetShops.map(shop => shop.id), shopRevisions: Object.fromEntries(targetShops.map(shop => [shop.id, shop.revision])), distributionMode };
  const selectionIdentity = JSON.stringify(selection);
  const copyIdentity = JSON.stringify([currentRunId, copyFormat.value, manualText, copyTextValue, selectionIdentity]);
  const manualCopyCurrent = Boolean(manualText) && manualCopiedText === copyIdentity;
  const targetsValid = targetShops.length > 0 && targetShops.every(shop => shop.enabled) && new Set(targetShops.map(shop => shop.port)).size === 1;
  const shopBusy = submitting || distributionCheck.status === 'loading' || ['submitting', 'checking_confirmation'].includes(distributionJob?.status);

  useEffect(() => {
    setDistributionCheck({ status: 'idle', result: null, error: '' });
  }, [copyTextValue, selectionIdentity]);

  const checkDistribution = async () => {
    if (editingShop || !targetsValid) {
      setDistributionCheck({ status: 'error', result: null, error: '请选择同一 Chrome 调试端口下的已启用店铺。' });
      return null;
    }
    if (!copyTextValue) {
      setDistributionCheck({ status: 'error', result: null, error: '当前清单为空，请先保留或加入至少 1 个商品。' });
      return null;
    }
    setDistributionCheck({ status: 'loading', result: null, error: '' });
    try {
      const payload = await checkDistributionRequest({ input: copyTextValue, runId: currentRunId, ...selection });
      setDistributionCheck({ status: 'ready', result: payload, error: '' });
      return payload;
    } catch (error) {
      setDistributionCheck({ status: 'error', result: null, error: error.message });
      return null;
    }
  };

  const submitDistribution = async (checkResult = distributionCheck.result) => {
    if (!copyTextValue || !checkResult?.canSubmit) return;
    const job = await submitDistributionJob({ input: copyTextValue, runId: currentRunId || '', ...selection });
    if (job) setPreviewOpen(false);
  };

  const confirmAndSubmitDistribution = async () => {
    if (!copyTextValue || editingShop || shopBusy || distributionJob?.status === 'completed') return;
    setSubmitting(true);
    try {
      const checkResult = await checkDistribution();
      if (checkResult?.canSubmit) await submitDistribution(checkResult);
    } finally { setSubmitting(false); }
  };

  const copyManualDistribution = async () => {
    if (!canManualCopy) return;
    try {
      const latest = await copyCategoryContent(currentRunId, { format: copyFormat.value,
        items: activeRows.map(row => ({ url: distributionRowUrl(row), title: row.title })) });
      await onCopyText(latest.text);
      setManualCopiedText(latest.text === manualText ? copyIdentity : '');
      setManualCompleteStatus({
        status: 'copied',
        message: `已复制 ${activeRows.length} 条：${copyFormat.label}。完成外部铺货后，再点击"标记人工铺货完成"。`
      });
      return true;
    } catch (error) {
      setManualCopiedText('');
      setManualCompleteStatus({ status: 'error', message: `复制失败：${error.message}` });
      return false;
    }
  };

  const confirmManualDistributionComplete = async () => {
    if (!manualCopyCurrent || !canRecordManualComplete || !currentRunId || manualCompleteStatus.status === 'completing') return;
    const categoryReminder = manualMissingCategoryCount > 0
      ? `其中 ${manualMissingCategoryCount} 条类目为空，请确认你已在人工铺货时选择了正确类目。\n\n`
      : '';
    const confirmed = window.confirm(`${categoryReminder}确认已经按照刚复制的清单，${targetShops.length ? `在「${targetShops.map(shop => shop.name).join('、')}」` : ''}手动完成 ${activeRows.length} 个商品的铺货？确认后本次流水线将进入完成状态。`);
    if (!confirmed) return;
    setManualCompleteStatus({ status: 'completing', message: '正在记录人工铺货结果...' });
    const job = await completeManualDistributionJob({ input: copyTextValue, runId: currentRunId, ...selection });
    if (job) {
      setManualCompleteStatus({ status: 'completed', message: '人工铺货已确认，流水线正在进入完成节点。' });
      setPreviewOpen(false);
      onManualComplete?.();
    } else {
      setManualCompleteStatus({ status: 'error', message: '人工铺货完成状态记录失败，请查看下方错误后重试。' });
    }
  };

  const startDistributionChrome = async () => {
    await startDistributionChromeJob({ port: targetShops[0]?.port });
  };

  const distributionNeedsChrome = distributionCheck.result?.blockers?.includes('browser_cdp_unavailable');

  const controlDistribution = async (action) => {
    await controlDistributionJob(action);
  };

  const previewPanelContent = (
    <>
      <DistributionShopPicker key={currentRunId || 'new'} value={selectedShops} onChange={setSelectedShops} onEditingChange={setEditingShop} disabled={shopBusy} lockedShops={lockedShops} mode={distributionMode} onModeChange={setSelectedMode} />
      <div className="flex flex-wrap gap-2 relative z-[1]">
        <DistributionCopyButton label="复制铺货内容" primary disabled={!canManualCopy} onCopy={copyManualDistribution} format={copyFormat} onFormatChange={changeCopyFormat} successMessage={`已复制 ${activeRows.length} 条铺货内容，格式：${copyFormat.label}`} />
        <button type="button" className="node-secondary-button success" disabled={!manualCopyCurrent || !canRecordManualComplete || manualCompleteStatus.status === 'completing' || distributionJob?.status === 'submitting'} onClick={confirmManualDistributionComplete}>
          {manualCompleteStatus.status === 'completing' ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
          {manualCompleteStatus.status === 'completing' ? '正在确认' : '标记人工铺货完成'}
        </button>
        <button type="button" className="node-secondary-button" disabled={removedRows.length === 0} onClick={resetRemoved}>
          <RefreshCw size={13} /> 恢复全部
        </button>
        <button type="button" className="node-primary-button danger" disabled={!copyTextValue || editingShop || !targetsValid || shopBusy || distributionJob?.status === 'completed'} onClick={confirmAndSubmitDistribution}>
          {distributionCheck.status === 'loading' ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
          {distributionCheck.status === 'loading' ? '正在检查铺货环境' : '确认并开始自动铺货'}
        </button>
      </div>
      <div className="grid gap-2 min-w-0 relative">
        {targetShops.length > 0 && !targetsValid && <div role="alert" className="grid gap-0.5 border border-red-400/40 bg-red-900/15 text-red-200 px-2.5 py-2 rounded-md text-[11px] leading-normal break-all">请选择已启用且使用同一 Chrome 调试端口的店铺。</div>}
        <ExecutionPanel distributionJob={distributionJob} activeRowsCount={activeRows.length} distributionSubmitError={distributionSubmitError} onControlJob={controlDistribution} />
        {copyValidation}
        {!canRecordManualComplete && activeRows.length > 0 && <div className="flex items-start gap-[7px] px-2.5 py-2 rounded-md text-[11px] leading-normal break-all border border-blue-400/30 bg-blue-900/15 text-blue-200">标记人工铺货完成前，清单仍需补齐链接和标题。</div>}
        {manualCopiedText && !manualCopyCurrent && <div className="grid gap-0.5 border border-red-400/40 bg-red-900/15 text-red-200 px-2.5 py-2 rounded-md text-[11px] leading-normal break-all">清单已经修改，请重新复制最新内容后再确认完成。</div>}
        {manualCompleteStatus.status !== 'copied' && manualCompleteStatus.message && (manualCopyCurrent || manualCompleteStatus.status === 'error') && <div role="status" className={`${manualCompleteStatus.status === 'error' ? 'grid gap-0.5 border border-red-400/40 bg-red-900/15 text-red-200' : 'flex items-start gap-[7px] border border-blue-400/30 bg-blue-900/15 text-blue-200'} px-2.5 py-2 rounded-md text-[11px] leading-normal break-all`}>{manualCompleteStatus.message}</div>}
        {distributionCheck.status === 'loading' && (
          <div className="flex items-start gap-[7px] px-2.5 py-2 rounded-md text-[11px] leading-normal break-all border border-blue-400/30 bg-blue-900/15 text-blue-200">
            <RefreshCw size={13} className="animate-spin" /> 正在检查清单、Chrome 调试端口和登录状态，请稍候...
          </div>
        )}
        {distributionCheck.status === 'error' && (
          <div className="grid gap-0.5 border border-red-400/40 bg-red-900/15 text-red-200 px-2.5 py-2 rounded-md text-[11px] leading-normal break-all">铺货检查失败：{distributionCheck.error || '未知错误'}</div>
        )}
        {distributionCheck.status === 'ready' && !distributionCheck.result?.canSubmit && (
          <div className="grid gap-0.5 border border-red-400/40 bg-red-900/15 text-red-200 px-2.5 py-2 rounded-md text-[11px] leading-normal break-all">
            <strong>暂时无法开始自动铺货</strong>
            {distributionCheck.result?.shopError && <span>{distributionCheck.result.shopError}</span>}
            {Array.isArray(distributionCheck.result?.blockers) && distributionCheck.result.blockers.length > 0
              ? <span>阻塞原因：{distributionCheck.result.blockers.map(labelDistributionBlocker).join('，')}</span>
              : <span>请检查 Chrome 登录状态、CDP 端口和清单格式。</span>}
            {distributionNeedsChrome && (
              <div className="flex flex-wrap gap-2 mt-1.5">
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
          <div className="grid gap-0.5 border border-red-400/40 bg-red-900/15 text-red-200 px-2.5 py-2 rounded-md text-[11px] leading-normal break-all">提交失败：{distributionSubmitError}</div>
        )}
        {distributionChromeMessage && !distributionSubmitError && (
          <div className="flex items-start gap-[7px] px-2.5 py-2 rounded-md text-[11px] leading-normal break-all border border-blue-400/30 bg-blue-900/15 text-blue-200">{distributionChromeMessage}</div>
        )}
      </div>

      <CategoryToolbar control={categoryControl} rows={activeRows} onRemove={markRemoved} />
      <div className="min-h-0 grid content-start gap-[9px] overflow-auto pr-0.5">
        {exportStatus === 'loading' && <div className="artifact-empty"><RefreshCw size={13} className="animate-spin" /> 正在加载铺货清单...</div>}
        {exportStatus === 'error' && <div className="artifact-error">{exportError || '铺货清单加载失败'}</div>}
        {exportStatus !== 'loading' && rows.length === 0 && (
          <div className="artifact-empty">当前导出清单为空，通常表示前面的生成或复核没有产出可铺货商品。</div>
        )}
        {rows.map((row, index) => (
          <DistributionRow
            key={row.key}
            index={index + 1}
            row={row}
            variant="preview"
            isBlocked={false}
            onUpdateEdit={updateRowEdit}
            onMarkRemoved={markRemoved}
          />
        ))}
        {pendingBlockedRows.map((row, index) => (
          <DistributionRow
            key={row.key}
            index={index + 1 + rows.length}
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
      <div className="flex flex-col overflow-y-auto gap-3 h-full min-h-0">
        <div className="flex items-center justify-between gap-2.5 min-w-0 pb-[9px] border-b border-slate-700/70 [&>strong]:text-slate-50 [&>strong]:text-[13px] [&>span]:text-[var(--text-muted)] [&>span]:text-[11px] [&>span]:text-right">
          <strong>{activeRows.length} 条待铺货</strong>
          <span>{removedRows.length} 条已移除 · {pendingBlockedRows.length} 条待人工加入</span>
        </div>
        {previewPanelContent}
      </div>
    );
  }

  return (
    <div className="grid gap-3 min-w-0">
      <CategoryToolbar control={categoryControl} rows={activeRows} onRemove={markRemoved} />
      <section className={`distribution-ready-hero ${activeRows.length > 0 ? 'has-items' : 'is-empty'}`}>
        <div className="min-w-0 [&>strong]:text-slate-50 [&>strong]:block [&>strong]:text-[18px] [&>p]:text-[var(--text-subtle)] [&>p]:text-[11px] [&>p]:leading-normal [&>p]:mt-[5px]">
          <span className="text-blue-300 block text-[10px] font-extrabold mb-1">当前要处理</span>
          <strong>{activeRows.length} 个待铺货商品</strong>
          <p>
            {activeRows.length > 0
              ? '先查看并确认清单，再检查铺货环境。被拦截的商品不会自动进入铺货。'
              : '当前没有可铺货商品，请先完成标题生成或把下方合适的复核项加入清单。'}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-[7px] justify-end">
          <button type="button" className="node-primary-button" disabled={!copyTextValue} onClick={() => setPreviewOpen(true)}>
            <FileText size={14} /> 查看并确认清单
          </button>
        </div>
      </section>

      <div className="flex items-center flex-wrap text-[10px] gap-1.5 mb-3 text-[var(--text-disabled)] [&>span]:inline-flex [&>span]:items-center [&>span]:gap-1 [&>b]:inline-flex [&>b]:items-center [&>b]:justify-center [&>b]:w-[18px] [&>b]:h-[18px] [&>b]:rounded-full [&>b]:bg-slate-500/20" aria-label="铺货操作步骤">
        <span className="text-blue-200 font-extrabold [&>b]:bg-blue-600 [&>b]:text-white"><b>1</b>确认商品</span>
        <ChevronRight size={13} />
        <span><b>2</b>选择人工或自动铺货</span>
        <ChevronRight size={13} />
        <span><b>3</b>确认完成</span>
      </div>

      <section className="grid grid-cols-2 gap-2.5 mb-3" aria-label="选择铺货方式">
        <article className="grid content-between gap-3 min-w-0 p-3 border border-green-500/30 rounded-lg bg-green-900/10 [&>div>span]:text-[var(--text-muted)] [&>div>span]:block [&>div>span]:text-[10px] [&>div>span]:font-extrabold [&>div>span]:mb-[3px] [&>div>strong]:text-slate-100 [&>div>strong]:block [&>div>strong]:text-[13px]">
          <div>
            <span>人工铺货</span>
            <strong>复制清单后手动铺货</strong>
          </div>
          <div className="flex flex-wrap gap-[7px]">
            <DistributionCopyButton label="人工复制铺货" disabled={!canManualCopy} onCopy={copyManualDistribution} format={copyFormat} onFormatChange={changeCopyFormat} successMessage={`已复制 ${activeRows.length} 条铺货内容，格式：${copyFormat.label}`} />
            <button type="button" className="node-secondary-button success" disabled={!manualCopyCurrent || !canRecordManualComplete || manualCompleteStatus.status === 'completing' || distributionJob?.status === 'submitting'} onClick={confirmManualDistributionComplete}>
              {manualCompleteStatus.status === 'completing' ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
              {manualCompleteStatus.status === 'completing' ? '正在确认' : '标记人工铺货完成'}
            </button>
          </div>
          {copyValidation}
          {!canRecordManualComplete && activeRows.length > 0 && <small className="block text-[10px] leading-normal break-all text-amber-400">标记人工铺货完成前，清单仍需补齐链接和标题。</small>}
          {manualCopiedText && !manualCopyCurrent && <small className="block text-[10px] leading-normal break-all text-amber-400">清单已经修改，请重新复制最新内容后再确认完成。</small>}
          {manualCompleteStatus.status !== 'copied' && manualCompleteStatus.message && (manualCopyCurrent || manualCompleteStatus.status === 'error') && <small role="status" className={`block text-[10px] leading-normal break-all ${manualCompleteStatus.status === 'error' ? 'text-amber-400' : manualCompleteStatus.status === 'completing' ? 'text-blue-300' : 'text-green-300'}`}>{manualCompleteStatus.message}</small>}
          {manualCompleteStatus.status === 'error' && distributionSubmitError && <small className="block text-[10px] leading-normal break-all text-amber-400">{distributionSubmitError}</small>}
        </article>
        <article className="grid content-between gap-3 min-w-0 p-3 border border-blue-400/30 rounded-lg bg-blue-900/10 [&>div>span]:text-[var(--text-muted)] [&>div>span]:block [&>div>span]:text-[10px] [&>div>span]:font-extrabold [&>div>span]:mb-[3px] [&>div>strong]:text-slate-100 [&>div>strong]:block [&>div>strong]:text-[13px] [&>div>p]:text-[var(--text-muted)] [&>div>p]:text-[11px] [&>div>p]:leading-normal [&>div>p]:mt-[5px]">
          <div>
            <span>自动铺货</span>
            <strong>使用当前 Chrome 登录态</strong>
            <p>先检查 Chrome、登录状态和重复批次，再在清单预览中确认提交。</p>
          </div>
          <div className="flex flex-wrap gap-[7px]">
            <button type="button" className="node-secondary-button" disabled={!copyTextValue || shopBusy} onClick={() => setPreviewOpen(true)}>
              {distributionCheck.status === 'loading' ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
              选择店铺并检查
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

      <div className="grid grid-cols-4 gap-2 [&>div]:min-w-0 [&>div]:border [&>div]:border-slate-800/90 [&>div]:rounded-lg [&>div]:bg-slate-900/60 [&>div]:p-[9px] [&>div>strong]:block [&>div>strong]:text-[var(--text-body)] [&>div>strong]:text-[18px] [&>div>strong]:leading-tight [&>div>span]:block [&>div>span]:mt-1 [&>div>span]:text-[var(--text-muted)] [&>div>span]:text-[10px]">
        <div><strong>{rows.length}</strong><span>清单项</span></div>
        <div><strong>{activeRows.length}</strong><span>将导出</span></div>
        <div><strong>{pendingBlockedRows.length}</strong><span>待人工加入</span></div>
        <div><strong>{copyTextValue ? '可复制' : '无内容'}</strong><span>清单状态</span></div>
      </div>

      <div className="flex flex-wrap gap-2">
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

      <div className="grid gap-[9px] max-h-[440px] overflow-auto pr-0.5">
        {exportStatus === 'loading' && <div className="artifact-empty"><RefreshCw size={13} className="animate-spin" /> 正在加载铺货清单...</div>}
        {exportStatus === 'error' && <div className="artifact-error">{exportError || '铺货清单加载失败'}</div>}
        {(exportStatus === 'ready' || exportStatus === 'empty') && rows.length === 0 && (
          <div className="artifact-empty">当前导出清单为空，通常表示前面的生成或复核没有产出可铺货商品。</div>
        )}
        {rows.map((row, index) => (
          <DistributionRow
            key={row.key}
            index={index + 1}
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
          <section className="grid gap-[9px] mt-1 border-t border-slate-700/70 pt-3">
            <div className="node-workbench-head">
              <strong>被拦截但可人工判断</strong>
              <span>{pendingBlockedRows.length} 条</span>
            </div>
            <div className="grid gap-[9px] max-h-[360px] overflow-auto pr-0.5">
              {pendingBlockedRows.map((row, index) => (
                <DistributionRow
                  key={row.key}
                  index={index + 1 + rows.length}
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
          <section className="workflow-modal flex flex-col overflow-y-auto" role="dialog" aria-modal="true" aria-label="导出清单预览" onClick={(event) => event.stopPropagation()}>
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
