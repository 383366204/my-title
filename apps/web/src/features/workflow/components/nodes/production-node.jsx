import { Handle, Position } from '@xyflow/react';
import { Download, RefreshCw, Settings2 } from 'lucide-react';

import { getWorkflowBlockerActions, getWorkflowRuntimeActions } from '../../workflow-node-actions.js';
import { getWorkflowNodeViewModel } from '../../workflow-node-view.js';
import { labelPipelineStatus } from '../../../../pipeline-labels.js';
import { SelectionStartControls } from './selection-start-controls.jsx';
import {
  WorkflowBlockerCallout,
  WorkflowNodeActionChip,
  WorkflowNodeArtifactButton,
  WorkflowNodeDiversitySummary,
  WorkflowNodeOutputSummary,
  WorkflowProgressStrip,
  WorkflowStepBadge
} from './workflow-node-parts.jsx';

const WorkflowNodeOperationStatus = ({ data }) => {
  if (!data?.operationMessage) return null;
  return (
    <div className="flex items-center gap-[5px] mt-[7px] border border-blue-500/35 rounded-md bg-blue-900/20 text-blue-200 text-[10px] font-bold leading-[1.4] px-[7px] py-[5px]" role="status" aria-live="polite">
      {data.pendingAction && <RefreshCw size={11} className="animate-spin" />}
      <span>{data.operationMessage}</span>
    </div>
  );
};

const WorkflowSheetQuickActions = ({ data, view }) => {
  if (data?.sheetConfig !== true) return null;
  const readOnly = data.workflowReadOnly === true || !['idle', 'pending'].includes(String(data.status || data.state || 'idle').toLowerCase());
  const sheetType = data.sheetType === 'review' ? 'review' : 'order';
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-[6px] mt-2" aria-label="制表操作">
      {data.reviewSourceUpload !== true && data.orderSheetOnly !== true && <div className="grid grid-cols-2 gap-[3px] border border-slate-700 rounded-md bg-slate-950 p-[3px]" role="group" aria-label="表格类型快捷选择">
        {[['order', '刷单表'], ['review', '评价表']].map(([value, label]) => (
          <button
            type="button"
            key={value}
            className={`min-w-0 border-0 rounded bg-transparent text-[10px] font-bold leading-none px-2 py-[7px] ${sheetType === value ? 'bg-blue-700 text-white' : 'text-slate-400'} ${readOnly ? 'cursor-default' : ''}`}
            aria-pressed={sheetType === value}
            disabled={readOnly}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              data.onUpdate?.('sheetType', value);
            }}
          >
            {label}
          </button>
        ))}
      </div>}
      <button
        type="button"
        className="inline-flex items-center justify-center gap-1 min-w-0 border border-slate-600 rounded bg-transparent text-slate-300 text-[10px] font-bold leading-none px-2 py-[7px] whitespace-nowrap hover:border-blue-400 hover:bg-blue-700/16 hover:text-slate-50 focus-visible:border-blue-400 focus-visible:bg-blue-700/16 focus-visible:text-slate-50"
        title={view.primaryAction.label}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          data.onAction?.('configure-sheet');
        }}
      >
        <Settings2 size={12} /> {view.primaryAction.label}
      </button>
    </div>
  );
};

const WorkflowCollectionQuickActions = ({ data, view }) => {
  if (data?.orderSheetConfig !== true) return null;
  const isHistoricalConfig = data.workflowReadOnly === true;
  const readOnly = !isHistoricalConfig && !['idle', 'pending'].includes(String(data.status || data.state || 'idle').toLowerCase());
  const inputMode = ['rank', 'manual', 'hybrid'].includes(data.inputMode) ? data.inputMode : 'rank';
  const usesRank = inputMode !== 'manual';
  const manualCount = Array.isArray(data.manualItems) ? data.manualItems.length : 0;
  return (
    <div className="grid grid-cols-[minmax(92px,1fr)_54px] gap-[6px] mt-2 [&>label]:grid [&>label]:gap-[3px] [&>label]:min-w-0 [&_span]:text-slate-500 [&_span]:text-[9px] [&_span]:font-bold [&_select]:w-full [&_select]:min-w-0 [&_select]:h-7 [&_select]:border [&_select]:border-slate-700 [&_select]:rounded-[5px] [&_select]:bg-slate-950 [&_select]:text-slate-300 [&_select]:text-[10px] [&_select]:px-1.5 [&_select]:py-1 [&_input]:w-full [&_input]:min-w-0 [&_input]:h-7 [&_input]:border [&_input]:border-slate-700 [&_input]:rounded-[5px] [&_input]:bg-slate-950 [&_input]:text-slate-300 [&_input]:text-[10px] [&_input]:px-1.5 [&_input]:py-1" aria-label="采集条件">
      <label className="col-span-full">
        <span>来源</span>
        <select
          aria-label="刷单表商品来源"
          value={inputMode === 'manual' ? 'manual' : 'rank'}
          disabled={readOnly}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => data.onUpdate?.('inputMode', event.target.value)}
        >
          <option value="rank">商品排行</option>
          <option value="manual">指定商品</option>
        </select>
      </label>
      {usesRank && <label>
        <span>日期</span>
        <select
          aria-label="采集日期范围"
          value={data.dateMode || 'latest_day'}
          disabled={readOnly}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => data.onUpdate?.('dateMode', event.target.value)}
        >
          <option value="latest_day">最近单日</option>
          <option value="last_7_days">最近 7 天</option>
          <option value="last_30_days">最近 30 天</option>
          <option value="custom">自定义</option>
        </select>
      </label>}
      {usesRank && <label>
        <span>页数</span>
        <input
          aria-label="采集页数"
          type="number"
          min="1"
          max="5"
          value={data.pages ?? 1}
          disabled={readOnly}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => data.onUpdate?.('pages', Math.min(5, Math.max(1, Number.parseInt(event.target.value, 10) || 1)))}
        />
      </label>}
      {!usesRank && <div className="grid gap-[3px] min-w-0 [&>span]:text-slate-500 [&>span]:text-[9px] [&>span]:font-bold [&>strong]:min-h-7 [&>strong]:flex [&>strong]:items-center [&>strong]:border [&>strong]:border-slate-700 [&>strong]:rounded-[5px] [&>strong]:bg-slate-950 [&>strong]:text-slate-300 [&>strong]:text-[10px] [&>strong]:px-1.5 [&>strong]:py-1"><span>商品</span><strong>{manualCount} 个</strong></div>}
      {inputMode === 'hybrid' && <div className="grid gap-[3px] min-w-0 [&>span]:text-slate-500 [&>span]:text-[9px] [&>span]:font-bold [&>strong]:min-h-7 [&>strong]:flex [&>strong]:items-center [&>strong]:border [&>strong]:border-slate-700 [&>strong]:rounded-[5px] [&>strong]:bg-slate-950 [&>strong]:text-slate-300 [&>strong]:text-[10px] [&>strong]:px-1.5 [&>strong]:py-1"><span>追加</span><strong>{manualCount} 个</strong></div>}
      <button
        type="button"
        className="col-span-full inline-flex items-center justify-center gap-1 min-w-0 border border-slate-600 rounded bg-transparent text-slate-300 text-[10px] font-bold leading-none px-2 py-[7px] whitespace-nowrap hover:border-blue-400 hover:bg-blue-700/16 hover:text-slate-50 focus-visible:border-blue-400 focus-visible:bg-blue-700/16 focus-visible:text-slate-50"
        title={view.primaryAction.label}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          data.onAction?.('manual-input');
        }}
      >
        <Settings2 size={12} /> {usesRank && inputMode !== 'hybrid' ? view.primaryAction.label : '输入商品'}
      </button>
    </div>
  );
};

const WorkflowReviewQuickActions = ({ data }) => {
  if (data?.reviewConfig !== true) return null;
  const readOnly = data.workflowReadOnly === true || !['idle', 'pending'].includes(String(data.status || data.state || 'idle').toLowerCase());
  return (
    <div className="grid grid-cols-[minmax(92px,1fr)_54px] !grid-cols-[minmax(0,1fr)_64px_46px] gap-[6px] mt-2 [&>label]:grid [&>label]:gap-[3px] [&>label]:min-w-0 [&_span]:text-slate-500 [&_span]:text-[9px] [&_span]:font-bold [&_select]:w-full [&_select]:min-w-0 [&_select]:h-7 [&_select]:border [&_select]:border-slate-700 [&_select]:rounded-[5px] [&_select]:bg-slate-950 [&_select]:text-slate-300 [&_select]:text-[10px] [&_select]:px-1.5 [&_select]:py-1 [&_input]:w-full [&_input]:min-w-0 [&_input]:h-7 [&_input]:border [&_input]:border-slate-700 [&_input]:rounded-[5px] [&_input]:bg-slate-950 [&_input]:text-slate-300 [&_input]:text-[10px] [&_input]:px-1.5 [&_input]:py-1" aria-label="评价生成设置">
      <label>
        <span>语气</span>
        <select
          aria-label="评价语气"
          value={data.reviewTone || '自然真实'}
          disabled={readOnly}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => data.onUpdate?.('reviewTone', event.target.value)}
        >
          <option value="自然真实">自然真实</option>
          <option value="简洁克制">简洁克制</option>
          <option value="生活化">生活化</option>
        </select>
      </label>
      <label>
        <span>字数</span>
        <input
          aria-label="评价字数"
          type="number"
          min="15"
          max="100"
          value={data.reviewLength ?? 35}
          disabled={readOnly}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => data.onUpdate?.('reviewLength', Math.min(100, Math.max(15, Number.parseInt(event.target.value, 10) || 35)))}
        />
      </label>
      <label className="!flex !flex-row !items-center !justify-center !gap-[5px] [&>input]:h-3.5 [&>input]:min-h-0 [&>input]:w-3.5">
        <input
          type="checkbox"
          checked={data.useAI !== false}
          disabled={readOnly}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => data.onUpdate?.('useAI', event.target.checked)}
        />
        <span>AI</span>
      </label>
    </div>
  );
};

const WorkflowCompletionDownload = ({ nodeId, data }) => {
  const status = String(data?.status || data?.state || '').toLowerCase();
  const workflowRunId = data?.workflowRunId || data?.output?.runId;
  const artifactNodeId = data?.competitorDownload === true ? 'competitorReport' : 'generateSheet';
  if (nodeId !== 'end' || status !== 'completed' || (data?.orderSheetDownload !== true && data?.competitorDownload !== true) || !workflowRunId) {
    return null;
  }
  const downloadUrl = `/api/workflows/runs/${encodeURIComponent(workflowRunId)}/artifacts/${artifactNodeId}/raw`;
  return (
    <a
      className="inline-flex items-center gap-[5px] mt-2.5 bg-emerald-600 border border-emerald-500 rounded-md text-white text-[10px] font-extrabold px-[9px] py-1.5 no-underline transition-all duration-[160ms] hover:bg-emerald-700 hover:border-emerald-400 hover:-translate-y-px focus-visible:bg-emerald-700 focus-visible:border-emerald-400 focus-visible:-translate-y-px focus-visible:outline-none cursor-pointer"
      href={downloadUrl}
      download
      title={data?.competitorDownload === true ? '下载同行分析报告' : '下载本次生成的 Excel 表格'}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <Download size={13} /> {data?.competitorDownload === true ? '下载分析报告' : '下载 Excel'}
    </a>
  );
};

const WorkflowNodeSecondaryActions = ({ nodeId, data }) => {
  const runtimeActions = getWorkflowRuntimeActions({
    runStatus: data?.workflowRunStatus,
    nodeId,
    state: data
  });
  const distributionActions = nodeId === 'export' && data?.distributionJob?.status === 'submitting'
    ? [{
        action: 'pause-distribution',
        label: data.distributionJob.requestedAction === 'pause' ? '暂停请求中' : '暂停铺货',
        description: data.distributionJob.requestedAction === 'pause'
          ? '当前批次完成后会停止后续铺货。'
          : '当前批次完成后停止，未提交的商品会保留在清单中。',
        disabled: data.distributionJob.requestedAction === 'pause'
      }]
    : [];
  const manualActions = nodeId === 'export' && data?.workflowRunId
    && ['needs_review', 'waiting_confirmation', 'waiting_manual', 'blocked', 'failed', 'paused'].includes(data.status)
    && !['checking', 'checking_confirmation', 'submitting', 'paused', 'completed'].includes(data.distributionJob?.status)
    ? [{ action: 'manual-complete-distribution', label: '手动完成', description: '打开清单，人工确认后将流程标记为完成，不会再次提交商品。' }] : [];
  const actions = [...distributionActions, ...manualActions, ...runtimeActions, ...getWorkflowBlockerActions(nodeId, data)]
    .filter((action, index, list) => list.findIndex((item) => item.action === action.action) === index)
    .filter((action) => action.action !== getWorkflowNodeViewModel(nodeId, data).primaryAction.action)
    .slice(0, 3);
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-[5px] mt-1.5">
      {actions.map((action) => (
        <button
          type="button"
          key={action.action}
          className="border border-slate-500/55 rounded-md bg-slate-900/72 text-slate-300 text-[10px] font-bold px-[7px] py-1 cursor-pointer hover:border-blue-400/80 hover:bg-blue-900/34 hover:text-blue-100 focus-visible:border-blue-400/80 focus-visible:bg-blue-900/34 focus-visible:text-blue-100 focus-visible:outline-none disabled:cursor-wait disabled:opacity-[0.58]"
          title={action.description || action.label}
          disabled={action.disabled || Boolean(data.pendingAction)}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            data.onAction?.(action.action);
          }}
        >
          {data.pendingAction === action.action ? `${action.label}中…` : action.label}
        </button>
      ))}
    </div>
  );
};

/**
 * Component to render a production workflow canvas node.
 * @param {object} props Component props.
 * @param {string} props.id Node ID.
 * @param {object} props.data React Flow node data object.
 * @returns {import('react').JSX.Element} React component element.
 */
export const ProductionNode = ({ id, data }) => {
  const status = data.status || data.state || 'idle';
  const view = getWorkflowNodeViewModel(id, data);
  const tone = view.tone;
  const label = data.label || data.name || data.title || id;
  const filterCounts = data.keywordFilterCounts || data.output?.filterCounts;

  return (
    <div
      role="button"
      tabIndex={0}
      className={`production-node production-node-${tone}`}
      onPointerDown={(event) => {
        event.stopPropagation();
        data.onSelect?.();
      }}
      onClick={data.onSelect}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          data.onSelect?.();
        }
      }}
    >
      <Handle type="target" position={Position.Left} id="in" />
      <div className="flex items-center justify-between gap-2 text-slate-500 font-mono text-[10px] uppercase [&>span]:truncate [&>b]:truncate [&>b]:max-w-[86px] [&>b]:text-slate-400 [&>b]:whitespace-nowrap">
        <span>{data.stage || data.kind || data.action || data.type || 'workflow'}</span>
        <WorkflowStepBadge data={data} />
        <b>{labelPipelineStatus(status)}</b>
      </div>
      <div className="mt-2 text-slate-50 text-sm font-extrabold leading-[1.3] whitespace-nowrap truncate">{label}</div>
      {data.description && <div className="mt-[5px] text-slate-400 text-[11px] leading-[1.4] line-clamp-2">{data.description}</div>}
      {view.configSummary && !data.selectionMode && <div className="mt-[7px] border-l-2 border-sky-400/72 text-sky-200 text-[10px] font-bold leading-[1.45] break-all pl-[7px] py-0.5">{view.configSummary}</div>}
      {id === 'start' && data.selectionMode && <SelectionStartControls data={data} />}

      <WorkflowProgressStrip view={view} />
      <WorkflowNodeOutputSummary view={view} />
      <WorkflowNodeDiversitySummary nodeId={id} data={data} />
      <WorkflowBlockerCallout view={view} />
      <WorkflowNodeOperationStatus data={data} />
      {id === 'start' && <WorkflowCollectionQuickActions data={data} view={view} />}
      {id === 'generateReviews' && <WorkflowReviewQuickActions data={data} />}
      {id === 'generateSheet' && <WorkflowSheetQuickActions data={data} view={view} />}
      {!['artifact', 'inspect'].includes(view.primaryAction.action)
        && !(id === 'generateSheet' && data.sheetConfig === true)
        && !(id === 'start' && data.orderSheetConfig === true)
        && !(id === 'start' && data.selectionMode)
        && <WorkflowNodeActionChip view={view} onAction={data.onAction} />}
      <WorkflowNodeSecondaryActions nodeId={id} data={data} />
      {id === 'keywordReview' && data.keywordFilterAvailable && <button type="button"
        className="node-secondary-button nodrag" onPointerDown={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); data.onAction?.('keyword-filter'); }}>
        <Settings2 size={13} /> 筛选条件
      </button>}
      {id === 'keywordReview' && data.keywordFilterAvailable && filterCounts && <div className="workflow-node-output-summary">
        符合 {filterCounts.passed} · 待确认 {filterCounts.review} · 不符合 {filterCounts.failed}
      </div>}
      <WorkflowNodeArtifactButton data={data} />
      <WorkflowCompletionDownload nodeId={id} data={data} />
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
};
