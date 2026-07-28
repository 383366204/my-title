import { lazy, Suspense } from 'react';
import { ChevronLeft, Settings } from 'lucide-react';

import {
  getWorkflowNodeDetailRows,
  getWorkflowNodePanelKind,
  getWorkflowNodeViewModel,
  isWorkflowInputNodeType
} from '../../../workflow-ui.js';
import { ArtifactPanel } from './artifact-panel.jsx';

const DistributionExportPanel = lazy(() => import('./distribution-export-panel.jsx').then((module) => ({
  default: module.DistributionExportPanel
})));
const NodeOperationPanel = lazy(() => import('./node-operation-panel.jsx').then((module) => ({
  default: module.NodeOperationPanel
})));

const DAILY_START_FIELDS = [
  { key: 'mine', label: '挖掘候选词', min: 1, max: 200 },
  { key: 'rootLimit', label: '每日词根数', min: 1, max: 20 },
  { key: 'rootCooldownDays', label: '词根冷却天数', min: 0, max: 60 },
  { key: 'verify', label: '生意参谋校验', min: 1, max: 200 },
  { key: 'verifyReserve', label: '备用词补验数量', min: 0, max: 30 },
  { key: 'select', label: '货源选品', min: 1, max: 100 },
  { key: 'generate', label: '标题生成', min: 1, max: 100 },
  { key: 'export', label: '导出清单数量', min: 1, max: 100 },
  { key: 'productsPerKeyword', label: '每词货源数', min: 1, max: 50 },
  { key: 'length', label: '标题长度', min: 30, max: 80 },
  { key: 'pages', label: '采集页数', min: 1, max: 5 }
];

const DAILY_START_OPTIONS = [
  { key: 'source', label: '挖词来源', options: [{ value: 'sycm_hot', label: '生意参谋热搜关联词' }, { value: 'sycm_blue', label: '生意参谋蓝海关联词' }, { value: 'local', label: '本地规则扩展' }, { value: 'hybrid', label: '本地规则 + AI' }] },
  { key: 'rootMode', label: '词根模式', options: [{ value: 'auto', label: '自动提取短词根' }, { value: 'seed', label: '直接使用种子词' }] },
  { key: 'autoAllowReviewKeywords', label: '严格词为空时', options: [{ value: 'true', label: '继续少量可复核词' }, { value: 'false', label: '停在验真等待处理' }] }
];

const isInputNodeType = isWorkflowInputNodeType;

export function WorkflowRightSidebar({
  activeTemplateMode,
  activeTemplateView,
  artifactPreviewOpen,
  artifactState,
  collapsed,
  copyText,
  currentRunId,
  isViewingRun,
  onOpenManualInput,
  onToggle,
  operationProps,
  selectedNode,
  setArtifactPreviewOpen,
  updateDistributionNodeJob,
  updateNodeData
}) {
  const distributionPreview = getWorkflowNodePanelKind(selectedNode?.id) === 'distribution-export';
  return (
<div className={`w-[420px] max-w-[44vw] border-l border-slate-800 bg-slate-900/40 flex flex-col h-full shrink-0 workflow-right-sidebar ${collapsed ? 'is-collapsed' : ''}`}>
        <button
          type="button"
          className="workflow-sidebar-toggle"
          title={collapsed ? '展开节点详情' : '收起节点详情'}
          aria-label={collapsed ? '展开节点详情' : '收起节点详情'}
          onClick={onToggle}
        >
          <ChevronLeft size={15} className={collapsed ? '' : 'rotate-180'} />
        </button>
        <div className="p-4 border-b border-slate-800 bg-slate-900 flex items-center gap-2">
          <Settings className="text-slate-400" size={18} />
          <h2 className="font-bold text-sm tracking-wider text-slate-200">
            节点详情
          </h2>
        </div>

        {selectedNode ? (
          <div className="p-5 flex-1 overflow-y-auto space-y-6">
            <div className="workflow-detail-card">
              <div className="workflow-detail-card-head">
                <span>{selectedNode.data?.label || selectedNode.id}</span>
                <b>{getWorkflowNodeViewModel(selectedNode.id, selectedNode.data).statusLabel}</b>
              </div>
              <div className="workflow-detail-rows">
                <div className="workflow-detail-row">
                  <span>节点</span>
                  <strong>{selectedNode.id} ({selectedNode.data?.originalType || selectedNode.type})</strong>
                </div>
                {getWorkflowNodeDetailRows(selectedNode).map((row) => (
                  <div className="workflow-detail-row" key={row.label}>
                    <span>{row.label}</span>
                    {row.label === '产物位置' ? (
                      <button type="button" className="workflow-detail-link" onClick={() => setArtifactPreviewOpen(true)}>
                        {row.value}
                      </button>
                    ) : (
                      <strong>{row.value}</strong>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <Suspense fallback={<div className="artifact-empty">正在加载节点操作...</div>}>
              <NodeOperationPanel {...operationProps} />
            </Suspense>

            {artifactPreviewOpen && (
              <div className="workflow-modal-backdrop" role="presentation" onClick={() => setArtifactPreviewOpen(false)}>
                <section className={`workflow-modal artifact-preview-modal ${distributionPreview ? 'is-distribution-preview' : ''}`} role="dialog" aria-modal="true" aria-label={distributionPreview ? '导出清单预览' : '节点产物预览'} onClick={(event) => event.stopPropagation()}>
                  <div className="workflow-modal-head">
                    <div>
                      <strong>{distributionPreview ? '导出清单预览' : `${selectedNode.data?.label || selectedNode.id}产物`}</strong>
                      <span>{distributionPreview ? '核对标题和类目，可复制铺货内容进行人工铺货，也可直接启动自动铺货。' : '已转换成可读视图；原始文件位置仍保留在上方节点详情中。'}</span>
                    </div>
                    <button type="button" className="workflow-modal-close" onClick={() => setArtifactPreviewOpen(false)}>×</button>
                  </div>
                  <div className="artifact-preview-modal-body">
                    {getWorkflowNodePanelKind(selectedNode?.id) === 'distribution-export' ? (
                      <Suspense fallback={<div className="artifact-empty">正在加载铺货清单...</div>}>
                        <DistributionExportPanel
                          artifactState={artifactState}
                          onCopyText={copyText}
                          currentRunId={currentRunId}
                          sourceNodeId={selectedNode?.id}
                          onDistributionJobChange={updateDistributionNodeJob}
                          directPreview
                        />
                      </Suspense>
                    ) : (
                      <ArtifactPanel state={artifactState} />
                    )}
                  </div>
                </section>
              </div>
            )}

            {isViewingRun && (
              <div className="p-3 rounded border border-slate-800 bg-slate-950/50 text-[11px] leading-relaxed text-slate-400">
                当前正在查看历史运行。节点状态、产物和恢复动作可以查看，参数编辑请先从左侧选择流程模板。
              </div>
            )}

            {!isViewingRun && selectedNode.id === 'start' && activeTemplateMode === 'keyword' && (
              <div className="space-y-4">
                <div className="rounded border border-slate-800 bg-slate-950/50 p-3 text-[11px] leading-relaxed text-slate-400">
                  {activeTemplateView.modeHint}
                </div>
                <div className="border-t border-slate-800/80 pt-4">
                  <label className="text-xs font-bold text-slate-300 block mb-2">搜索核心关键词</label>
                  <input
                    type="text"
                    value={selectedNode.data.keyword || ''}
                    onChange={(e) => updateNodeData(selectedNode.id, 'keyword', e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-slate-700 bg-slate-950 focus:border-blue-500 focus:outline-none text-slate-100 text-sm transition-all"
                    placeholder="例如: 纯银项链女高级感"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">此词会作为精确关键词流水线的启动参数。</p>
                </div>
              </div>
            )}

            {!isViewingRun && selectedNode.id === 'start' && activeTemplateMode === 'manual' && (
              <div className="space-y-4">
                <div className="rounded border border-slate-800 bg-slate-950/50 p-3 text-[11px] leading-relaxed text-slate-400">
                  {activeTemplateView.modeHint}
                </div>
                <div className="border-t border-slate-800/80 pt-4">
                  <div className="manual-input-summary">
                    <strong>{selectedNode.data.items?.length || 0} 个商品已准备</strong>
                    <span>{selectedNode.data.defaultKeyword ? `默认关键词：${selectedNode.data.defaultKeyword}` : '每个商品需要绑定关键词'}</span>
                  </div>
                  <button type="button" className="node-primary-button" onClick={onOpenManualInput}>
                    录入关键词和1688链接
                  </button>
                  <p className="text-[10px] text-slate-500 mt-2">启动后直接获取商品资料，不再经过人工筛词或默认货源搜索。</p>
                </div>
              </div>
            )}

            {!isViewingRun && selectedNode.id === 'start' && activeTemplateMode === 'daily' && (
              <div className="space-y-4 border-t border-slate-800/80 pt-4">
                <div className="text-xs font-bold text-slate-300">每日流水线参数</div>
                <div className="rounded border border-slate-800 bg-slate-950/50 p-3 text-[11px] leading-relaxed text-slate-400">
                  {activeTemplateView.modeHint}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {DAILY_START_OPTIONS.map((field) => (
                    <label key={field.key} className="space-y-1 col-span-2">
                      <span className="text-[10px] font-bold text-slate-400 block">{field.label}</span>
                      <select
                        value={selectedNode.data[field.key] ?? field.options[0].value}
                        onChange={(e) => updateNodeData(selectedNode.id, field.key, e.target.value)}
                        className="w-full p-2.5 rounded-lg border border-slate-700 bg-slate-950 focus:border-blue-500 focus:outline-none text-slate-100 text-sm transition-all"
                      >
                        {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                  ))}
                  {DAILY_START_FIELDS.map((field) => (
                    <label key={field.key} className="space-y-1">
                      <span className="text-[10px] font-bold text-slate-400 block">{field.label}</span>
                      <input
                        type="number"
                        value={selectedNode.data[field.key] ?? ''}
                        onChange={(e) => updateNodeData(selectedNode.id, field.key, parseInt(e.target.value, 10) || field.min)}
                        className="w-full p-2.5 rounded-lg border border-slate-700 bg-slate-950 focus:border-blue-500 focus:outline-none text-slate-100 text-sm transition-all"
                        min={field.min}
                        max={field.max}
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* 输入节点独有参数 */}
            {!isViewingRun && isInputNodeType(selectedNode.type) && (
              <div className="space-y-4">
                <div className="border-t border-slate-800/80 pt-4">
                  <label className="text-xs font-bold text-slate-300 block mb-2">搜索核心关键词</label>
                  <input
                    type="text"
                    value={selectedNode.data.keyword || ''}
                    onChange={(e) => updateNodeData(selectedNode.id, 'keyword', e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-slate-700 bg-slate-950 focus:border-blue-500 focus:outline-none text-slate-100 text-sm transition-all"
                    placeholder="例如: 纯银项链女高级感"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">此词作为整个标题分析与1688货源搜索的核心关键词。</p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-300 block">标题最大长度 (字符)</label>
                  <input
                    type="number"
                    value={selectedNode.data.maxLength || 60}
                    onChange={(e) => updateNodeData(selectedNode.id, 'maxLength', parseInt(e.target.value) || 60)}
                    className="w-full p-2.5 rounded-lg border border-slate-700 bg-slate-950 focus:border-blue-500 focus:outline-none text-slate-100 text-sm transition-all"
                    min="10"
                    max="100"
                  />
                  <p className="text-[10px] text-slate-500">最终在淘系发布时限制的最大标题字数。</p>
                </div>
              </div>
            )}

            {/* 关键词挖掘节点参数 */}
            {!isViewingRun && selectedNode.type === 'keyword-mining' && (
              <div className="space-y-4 border-t border-slate-800/80 pt-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-300 block">最大挖掘候选词数量</label>
                  <input
                    type="number"
                    value={selectedNode.data.count || 5}
                    onChange={(e) => updateNodeData(selectedNode.id, 'count', parseInt(e.target.value) || 5)}
                    className="w-full p-2.5 rounded-lg border border-slate-700 bg-slate-950 focus:border-blue-500 focus:outline-none text-slate-100 text-sm transition-all"
                    min="1"
                    max="20"
                  />
                  <p className="text-[10px] text-slate-500">自动从同行或1688热榜抓取的最优词根个数。</p>
                </div>
              </div>
            )}

            {/* 标题生成器节点参数 */}
            {!isViewingRun && selectedNode.type === 'title-generator' && (
              <div className="space-y-4 border-t border-slate-800/80 pt-4 text-xs text-slate-400 leading-relaxed">
                <div>此节点将接收上一节点的关键词与货源结果，合并淘宝与 1688 竞品数据，通过当前配置的模型服务（如 MiniMax）生成符合 SEO 规则的标题。</div>
                <div className="p-3 bg-slate-950/40 rounded border border-emerald-950/40 text-emerald-400/90 text-[11px]">
                  <b>运行提示：</b>该步骤包含商品数据处理和模型批量生成，耗时会随商品数量与模型响应速度变化。失败时可在节点上查看真实原因并重跑。
                </div>
              </div>
            )}

            {/* 重置标签 */}
            {!isViewingRun && (
            <div className="border-t border-slate-800/80 pt-4">
              <label className="text-xs font-bold text-slate-300 block mb-2">画布节点标签</label>
              <input
                type="text"
                value={selectedNode.data.label || ''}
                onChange={(e) => updateNodeData(selectedNode.id, 'label', e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-700 bg-slate-950 focus:border-blue-500 focus:outline-none text-slate-100 text-xs transition-all"
              />
            </div>
            )}
          </div>
        ) : (
          <div className="p-5 flex-grow flex flex-col justify-center items-center text-slate-500 text-xs italic text-center">
            <Settings size={28} className="text-slate-700 mb-2 animate-pulse" />
            在画布中选中一个节点后，这里会显示状态、产物和恢复动作。
          </div>
        )}
      </div>
  );
}
