import { useEffect, useState } from 'react';
import {
  Check,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  Play,
  RefreshCw,
  Square,
  X
} from 'lucide-react';

import { checkDistribution as checkDistributionRequest } from '../../../api/distribution-api.js';
import { getWorkflowArtifact } from '../../../api/workflow-api.js';
import { getWorkflowArtifactView } from '../../../workflow-ui.js';
import { useDistributionJob } from '../hooks/use-distribution-job.js';
import { usePersistentMap } from '../hooks/use-persistent-map.js';

function rowSelectedKeyword(row = {}) {
  return String(row.selectedKeyword || row.keyword || row.blueOceanWord || row.product?.蓝海词 || row['蓝海词'] || '').trim();
}

function distributionRowUrl(row = {}) {
  return row.url
    || row.raw?.url
    || row.raw?.productUrl
    || row.raw?.['产品链接']
    || row.raw?.product?.['产品链接']
    || row.description
    || '';
}

function distributionRowCategory(row = {}) {
  return row.category
    || row.raw?.category
    || row.raw?.recommendedCategory
    || row.raw?.productCategory
    || row.raw?.product?.类目
    || row.raw?.product?.category
    || row.raw?.product?.categoryName
    || row.raw?.product?.categoryListName
    || row.raw?.product?.stats?.categoryListName
    || '';
}

function buildDistributionText(rows) {
  return rows
    .map((row) => {
      const url = distributionRowUrl(row);
      const category = distributionRowCategory(row);
      return [url, row.title || '', category && category !== '-' ? category : ''].join('$$');
    })
    .filter((line) => line.replace(/\$/g, '').trim())
    .join('\n');
}

const EXPORT_STATUS_LABELS = {
  ready: '可直接导出',
  review_candidate: '待人工复核',
  rejected_before_distribution: '导出前拦截'
};

const EXPORT_REASON_LABELS = {
  missing_category: '缺少商品或推荐类目',
  keyword_opportunity_reject: '关键词机会评分未通过',
  keyword_opportunity_observe: '关键词需要观察',
  keyword_opportunity_review: '关键词需要人工复核',
  legacy_keyword_opportunity_reject: '历史产物：关键词机会未通过，新流程会在校验节点拦截',
  legacy_keyword_opportunity_observe: '历史产物：关键词需要观察，新流程会在校验节点提示',
  legacy_keyword_opportunity_review: '历史产物：关键词需要复核，新流程会在校验节点提示',
  product_opportunity_candidate: '货源只是候选级别',
  product_opportunity_manual_review: '货源需要人工复核',
  hot_keyword_product: '热搜词货源，需要谨慎铺货',
  sales_missing_or_zero: '销量缺失或为 0',
  fallback_hot: '蓝海数据不足，降级使用热搜趋势',
  missing_url: '缺少 1688 货源链接',
  invalid_1688_url: '1688 货源链接无效',
  missing_title: '缺少铺货标题',
  title_missing_keyword: '标题未包含核心关键词',
  missing_category_product: '商品类目缺失',
  category_conflict: '推荐类目与商品类目冲突',
  duplicate_url: '货源链接重复',
  duplicate_title: '标题重复',
  hot_export_limit: '热搜趋势词超过自动导出上限'
};

const EXPORT_VALUE_LABELS = {
  reject: '未通过',
  continue: '继续',
  stop: '停止',
  candidate: '候选',
  strong_recommend: '强推荐',
  manual_review: '人工复核',
  generate_title: '生成标题',
  trend: '趋势参考',
  high: '高',
  medium: '中',
  low: '低',
  unknown: '未知',
  trend_reference: '仅作趋势参考',
  title_core: '可作为标题核心词',
  title_optional: '可作为标题辅助词'
};

const DISTRIBUTION_BLOCKER_LABELS = {
  empty_input: '铺货清单为空',
  login_expired: '铺货工具登录已过期',
  browser_cdp_unavailable: 'Chrome 调试连接不可用',
  distribution_quota_exhausted: '铺货平台剩余额度为 0',
  recent_duplicate_batch: '近期已提交过相同批次'
};

function labelExportValue(value) {
  const normalized = String(value || '').trim();
  return EXPORT_VALUE_LABELS[normalized] || normalized;
}

function labelDistributionBlocker(value) {
  const normalized = String(value || '').trim();
  return DISTRIBUTION_BLOCKER_LABELS[normalized] || normalized;
}

function labelExportStatus(status) {
  return EXPORT_STATUS_LABELS[String(status || '').trim()] || String(status || '待处理');
}

function labelExportReasons(reasonText) {
  return String(reasonText || '')
    .split(',')
    .map((reason) => reason.trim())
    .filter(Boolean)
    .map((reason) => {
      const titleTooShort = reason.match(/^title_too_short:(.+)$/);
      if (titleTooShort) return `标题过短（${titleTooShort[1]}）`;
      const bannedWords = reason.match(/^banned_words:(.+)$/);
      if (bannedWords) return `包含违禁词：${bannedWords[1]}`;
      return EXPORT_REASON_LABELS[reason] || reason;
    })
    .join('，');
}

function labelOpportunitySummary(value) {
  const parts = String(value || '').split('/').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3) {
    return `评分 ${parts[0]}，判断 ${labelExportValue(parts[1])}，下一步 ${labelExportValue(parts[2])}`;
  }
  return labelExportValue(value);
}

function exportReviewRowToDistributionRow(row = {}, index = 0) {
  const statusLabel = labelExportStatus(row.status);
  const reasonLabel = labelExportReasons(row.reason);
  const keyword = rowSelectedKeyword(row);
  return {
    ...row,
    selectedKeyword: keyword,
    key: `blocked:${row.url || row.title || row.heading || 'row'}:${index}`,
    title: row.title || row.heading || '未命名拦截项',
    meta: `${row.group === 'rejected' ? '系统拦截' : '待人工复核'} · ${statusLabel}`,
    metrics: [
      keyword ? `选词：${keyword}` : '',
      row.category && row.category !== '-' ? `类目 ${row.category}` : '',
      row.confidence ? `置信度 ${labelExportValue(row.confidence)}` : '',
      row.usage ? `用途 ${labelExportValue(row.usage)}` : '',
      row.productOpportunity ? `货源机会：${labelOpportunitySummary(row.productOpportunity)}` : '',
      row.keywordOpportunity ? `关键词机会：${labelOpportunitySummary(row.keywordOpportunity)}` : ''
    ].filter(Boolean),
    description: reasonLabel || row.risk || row.decision || '',
    riskText: row.risk || '',
    decisionText: row.decision || '',
    fromReview: true
  };
}

export const DistributionExportPanel = ({ artifactState, onCopyText, currentRunId, sourceNodeId = 'export', onDistributionJobChange, directPreview = false }) => {
  const [exportArtifactState, setExportArtifactState] = useState({ status: 'empty', artifact: null, error: '' });
  const sourceIsReview = sourceNodeId === 'review';
  const exportArtifact = sourceIsReview ? exportArtifactState.artifact : artifactState.artifact;
  const exportStatus = sourceIsReview ? exportArtifactState.status : artifactState.status;
  const exportError = sourceIsReview ? exportArtifactState.error : artifactState.error;
  const view = getWorkflowArtifactView(exportArtifact, 'export');
  const storageKey = `ecom.exportSelection.${currentRunId || artifactState.artifact?.runId || 'draft'}`;
  const includeStorageKey = `ecom.exportManualInclude.${currentRunId || artifactState.artifact?.runId || 'draft'}`;
  const editStorageKey = `ecom.exportEdits.${currentRunId || artifactState.artifact?.runId || 'draft'}`;
  const [removed, setRemoved] = usePersistentMap(storageKey);
  const [included, setIncluded] = usePersistentMap(includeStorageKey);
  const [edits, setEdits] = usePersistentMap(editStorageKey);
  const [reviewArtifactState, setReviewArtifactState] = useState({ status: 'empty', artifact: null, error: '' });
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
      setReviewArtifactState({ status: artifactState.status, artifact: artifactState.artifact, error: artifactState.error || '' });
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
  const manualCopyCurrent = Boolean(copyTextValue) && manualCopiedText === copyTextValue;
  const canManualCopy = Boolean(currentRunId) && activeRows.length > 0 && manualIncompleteCount === 0;

  useEffect(() => {
    setDistributionCheck({ status: 'idle', result: null, error: '' });
  }, [copyTextValue]);

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
        <button type="button" className="node-secondary-button" disabled={removedRows.length === 0} onClick={() => setRemoved({})}>
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
        {rows.map((row) => {
          const url = distributionRowUrl(row);
          const keyword = rowSelectedKeyword(row);
          return (
            <article className={`export-preview-row ${row.removed ? 'is-removed' : ''}`} key={row.key}>
              <div>
                <strong>{row.title || '未命名铺货项'}</strong>
                <span>{row.removed ? '已移除' : '将导出'}</span>
                {keyword && <small className="selected-keyword-badge">选词：{keyword}</small>}
              </div>
              {Array.isArray(row.metrics) && row.metrics.length > 0 && <p>{row.metrics.join(' · ')}</p>}
              {url && <p>{url}</p>}
              <div className="distribution-edit-grid">
                <label><span>铺货标题</span><input value={row.title || ''} disabled={row.removed} onChange={(event) => updateRowEdit(row.key, 'title', event.target.value)} /></label>
                <label><span>铺货类目</span><input value={distributionRowCategory(row)} disabled={row.removed} onChange={(event) => updateRowEdit(row.key, 'category', event.target.value)} placeholder="请选择或填写类目" /></label>
              </div>
              <div className="review-row-actions">
                <button type="button" className={`node-secondary-button ${row.removed ? 'success' : 'danger'}`} onClick={() => markRemoved(row.key, !row.removed)}>
                  {row.removed ? <Check size={13} /> : <X size={13} />}
                  {row.removed ? '恢复' : '移除'}
                </button>
                {url && (
                  <a className="node-secondary-button" href={url} target="_blank" rel="noreferrer">
                    <ExternalLink size={13} /> 打开货源
                  </a>
                )}
              </div>
            </article>
          );
        })}
        {pendingBlockedRows.map((row) => {
          const url = distributionRowUrl(row);
          const keyword = rowSelectedKeyword(row);
          return (
            <article className="export-preview-row blocked" key={row.key}>
              <div>
                <strong>{row.title}</strong>
                <span>被拦截，未加入</span>
                {keyword && <small className="selected-keyword-badge">选词：{keyword}</small>}
              </div>
              {row.description && <p>拦截原因：{row.description}</p>}
              {Array.isArray(row.metrics) && row.metrics.length > 0 && <p>{row.metrics.join(' · ')}</p>}
              {url && <p>{url}</p>}
              <div className="distribution-edit-grid">
                <label><span>铺货标题</span><input value={row.title || ''} onChange={(event) => updateRowEdit(row.key, 'title', event.target.value)} /></label>
                <label><span>铺货类目</span><input value={distributionRowCategory(row)} onChange={(event) => updateRowEdit(row.key, 'category', event.target.value)} placeholder="补充类目后再加入" /></label>
              </div>
              <div className="review-row-actions">
                <button type="button" className="node-secondary-button success" onClick={() => markIncluded(row.key, true)}>
                  <Check size={13} /> 加入当前清单
                </button>
                {url && (
                  <a className="node-secondary-button" href={url} target="_blank" rel="noreferrer">
                    <ExternalLink size={13} /> 打开货源
                  </a>
                )}
              </div>
            </article>
          );
        })}
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

      {distributionJob && (
        <section className={`distribution-execution-panel ${distributionJob.status === 'failed' || distributionJob.status === 'completed_with_issues' ? 'blocked' : ''}`}>
          <div className="distribution-execution-head">
            <div>
              <strong>{distributionJob.status === 'submitting' ? '正在自动铺货' : distributionJob.status === 'checking_confirmation' ? '正在核对铺货结果' : distributionJob.status === 'paused' ? '铺货已暂停' : distributionJob.status === 'completed' && distributionJob.mode === 'manual' ? '人工铺货已确认' : distributionJob.status === 'completed' ? '铺货已完成' : distributionJob.status === 'cancelled' ? '铺货已取消' : '铺货结果'}</strong>
              <span>{distributionJob.completed || 0} / {distributionJob.total || activeRows.length} 个商品已处理</span>
            </div>
            {distributionJob.status === 'submitting' && (
              <div className="distribution-execution-actions">
                <button type="button" className="node-secondary-button" onClick={() => controlDistribution('pause')}><Clock size={13} /> 批次完成后暂停</button>
                <button type="button" className="node-secondary-button danger" onClick={() => controlDistribution('cancel')}><Square size={13} /> 取消后续批次</button>
              </div>
            )}
            {distributionJob.status === 'completed_with_issues' && (
              <div className="distribution-execution-actions">
                <button type="button" className="node-secondary-button" onClick={() => controlDistribution('recheck')}>
                  <RefreshCw size={13} /> 重新核对铺货结果
                </button>
              </div>
            )}
          </div>
          <div className="distribution-progress-track"><span style={{ width: `${Math.min(100, Math.round(((distributionJob.completed || 0) / Math.max(1, distributionJob.total || 1)) * 100))}%` }} /></div>
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
      )}

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
        <button type="button" className="node-secondary-button" disabled={removedRows.length === 0} onClick={() => setRemoved({})}>
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
        {rows.map((row) => {
          const url = distributionRowUrl(row);
          const keyword = rowSelectedKeyword(row);
          return (
            <article className={`export-row ${row.removed ? 'is-removed' : ''}`} key={row.key}>
              <div className="export-row-head">
                <div>
                  <strong>{row.title || '未命名铺货项'}</strong>
                  {row.meta && <span>{row.meta}{row.fromReview ? ' · 人工加入' : ''}</span>}
                  {keyword && <small className="selected-keyword-badge">选词：{keyword}</small>}
                </div>
                <em>{row.removed ? '已移除' : '将导出'}</em>
              </div>
              {Array.isArray(row.metrics) && row.metrics.length > 0 && (
                <div className="review-row-meta">
                  {row.metrics.map((metric) => <span key={metric}>{metric}</span>)}
                </div>
              )}
              {url && <p className="export-row-url">{url}</p>}
              <div className="distribution-edit-grid">
                <label><span>铺货标题</span><input value={row.title || ''} disabled={row.removed} onChange={(event) => updateRowEdit(row.key, 'title', event.target.value)} /></label>
                <label><span>铺货类目</span><input value={distributionRowCategory(row)} disabled={row.removed} onChange={(event) => updateRowEdit(row.key, 'category', event.target.value)} placeholder="请选择或填写类目" /></label>
              </div>
              <div className="review-row-actions">
                <button type="button" className="node-secondary-button" onClick={() => onCopyText(row.title || '')}>
                  <Copy size={13} /> 复制标题
                </button>
                <button type="button" className={`node-secondary-button ${row.removed ? 'success' : 'danger'}`} onClick={() => markRemoved(row.key, !row.removed)}>
                  {row.removed ? <Check size={13} /> : <X size={13} />}
                  {row.removed ? '恢复' : '移除'}
                </button>
                {url && (
                  <a className="node-secondary-button" href={url} target="_blank" rel="noreferrer">
                    <ExternalLink size={13} /> 打开货源
                  </a>
                )}
              </div>
            </article>
          );
        })}
        {reviewArtifactState.status === 'loading' && <div className="artifact-empty"><RefreshCw size={13} className="animate-spin" /> 正在读取拦截原因...</div>}
        {reviewArtifactState.status === 'error' && <div className="artifact-error">{reviewArtifactState.error || '拦截原因加载失败'}</div>}
        {pendingBlockedRows.length > 0 && (
          <section className="export-blocked-section">
            <div className="node-workbench-head">
              <strong>被拦截但可人工判断</strong>
              <span>{pendingBlockedRows.length} 条</span>
            </div>
            <div className="export-row-list compact">
              {pendingBlockedRows.map((row) => {
                const url = distributionRowUrl(row);
                const keyword = rowSelectedKeyword(row);
                return (
                  <article className="export-row blocked" key={row.key}>
                    <div className="export-row-head">
                      <div>
                        <strong>{row.title}</strong>
                        <span>{row.meta}</span>
                        {keyword && <small className="selected-keyword-badge">选词：{keyword}</small>}
                      </div>
                      <em>未加入</em>
                    </div>
                    {Array.isArray(row.metrics) && row.metrics.length > 0 && (
                      <div className="review-row-meta">
                        {row.metrics.map((metric) => <span key={metric}>{metric}</span>)}
                      </div>
                    )}
                    {row.description && <p className="export-row-url">拦截原因：{row.description}</p>}
                    <div className="distribution-edit-grid">
                      <label><span>铺货标题</span><input value={row.title || ''} onChange={(event) => updateRowEdit(row.key, 'title', event.target.value)} /></label>
                      <label><span>铺货类目</span><input value={distributionRowCategory(row)} onChange={(event) => updateRowEdit(row.key, 'category', event.target.value)} placeholder="补充类目后再加入" /></label>
                    </div>
                    <div className="review-row-actions">
                      <button type="button" className="node-secondary-button success" onClick={() => markIncluded(row.key, true)}>
                        <Check size={13} /> 加入当前清单
                      </button>
                      {url && (
                        <a className="node-secondary-button" href={url} target="_blank" rel="noreferrer">
                          <ExternalLink size={13} /> 打开货源
                        </a>
                      )}
                    </div>
                  </article>
                );
              })}
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
