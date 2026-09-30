import { useState } from 'react';
import { Database, Plus, RefreshCw, Trash2 } from 'lucide-react';

import { MINER_TABS } from '../../workflow-data.js';

const seedStatusLabel = {
  active: '活跃',
  observing: '观察',
  explore: '探索',
  cooling: '冷却',
  paused: '暂停',
  disabled: '停用'
};

const roleLabel = {
  discovery_root: '扩词词根',
  direct_candidate: '直接候选',
  context_only: '场景参考',
  unrecognized: '待识别'
};

/**
 * 种子池健康度、增删状态与词根发现工作台组件
 * @param {object} props
 * @param {Array} [props.seedRows=[]] - 种子词列表
 * @param {object} props.seedDraft - 种子词草稿
 * @param {boolean} props.seedLoading - 种子词加载状态
 * @param {string} props.seedMessage - 种子词提示消息
 * @param {Function} props.onSeedDraftChange - 草稿变更回调
 * @param {Function} props.onLoadSeeds - 刷新种子池回调
 * @param {Function} props.onAddSeed - 添加种子词回调
 * @param {Function} props.onToggleSeed - 切换种子词暂停/恢复回调
 * @param {Function} props.onDeleteSeed - 删除种子词回调
 * @param {Function} props.onSetSeedStatus - 设置种子词状态回调
 * @param {string} props.minerTab - 词根挖掘当前选中的 Tab
 * @param {string} props.minerInput - 词根挖掘输入框值
 * @param {Array} [props.minerResults=[]] - 词根挖掘提取结果
 * @param {boolean} props.minerBusy - 词根挖掘计算中状态
 * @param {Function} props.onMinerTabChange - 切换词根挖掘 Tab 回调
 * @param {Function} props.onMinerInputChange - 词根挖掘输入框变更回调
 * @param {Function} props.onRunMiner - 运行词根挖掘回调
 * @returns {import('react').JSX.Element} 种子池与词根发现工作台视图
 */
export const SeedPoolWorkbench = ({
  seedRows = [],
  seedDraft = { keyword: '', category: '' },
  seedLoading = false,
  seedMessage = '',
  onSeedDraftChange,
  onLoadSeeds,
  onAddSeed,
  onToggleSeed,
  onDeleteSeed,
  onSetSeedStatus,
  minerTab,
  minerInput = '',
  minerResults = [],
  minerBusy = false,
  onMinerTabChange,
  onMinerInputChange,
  onRunMiner
}) => {
  const activeTab = MINER_TABS.find((item) => item.id === minerTab) || MINER_TABS[0];
  const [seedFilter, setSeedFilter] = useState('active');
  const [selectedSeedKeyword, setSelectedSeedKeyword] = useState('');
  const normalizedSeeds = (seedRows || []).map((seed) => ({ ...seed, status: seed.status || 'active' }));

  const statusCounts = normalizedSeeds.reduce((counts, seed) => {
    counts[seed.status] = (counts[seed.status] || 0) + 1;
    return counts;
  }, {});
  const visibleSeeds = seedFilter === 'all'
    ? normalizedSeeds
    : normalizedSeeds.filter((seed) => seed.status === seedFilter);
  const selectedSeed = normalizedSeeds.find((seed) => seed.keyword === selectedSeedKeyword) || visibleSeeds[0] || null;
  const familyCounts = normalizedSeeds.reduce((counts, seed) => {
    if (seed.familyKey) counts[seed.familyKey] = (counts[seed.familyKey] || 0) + 1;
    return counts;
  }, {});
  const lowQualityCount = normalizedSeeds.filter((seed) => Number(seed.qualityScore || 0) < 50).length;
  const repeatedFamilyCount = Object.values(familyCounts).filter((count) => count > 1).length;

  const statCellClass = 'grid gap-0.5 min-w-0 p-[7px] border border-[#263449] rounded-md bg-slate-900/60 text-[var(--text-muted)] text-[9px] text-center';
  const statStrongClass = 'text-[var(--text-body)] text-xs';
  const inputClass = 'w-full min-w-0 border border-[var(--border-default)] rounded-lg bg-[#020617] text-[var(--text-body)] text-xs leading-[1.4] px-[9px] py-2 outline-none focus:border-blue-500';

  return (
    <>
      <section className="grid gap-[10px] p-3 border border-slate-800/90 rounded-lg bg-[rgba(2,6,23,0.42)]">
        <div className="flex items-center justify-between gap-[10px]">
          <strong className="min-w-0 text-[var(--text-body)] text-xs">种子池</strong>
          <span className="shrink-0 text-[var(--text-muted)] text-[10px]">{seedLoading ? '加载中' : `活跃 ${statusCounts.active || 0} · 观察 ${statusCounts.observing || 0}`}</span>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          <span className={statCellClass}><strong className={statStrongClass}>{normalizedSeeds.length}</strong> 总种子</span>
          <span className={statCellClass}><strong className={statStrongClass}>{normalizedSeeds.filter((seed) => ['discovery_root', 'direct_candidate'].includes(seed.role)).length}</strong> 可执行</span>
          <span className={`${statCellClass} ${repeatedFamilyCount ? 'border-amber-500/50 !text-amber-400' : ''}`}><strong className={statStrongClass}>{repeatedFamilyCount}</strong> 重复商品族</span>
          <span className={`${statCellClass} ${lowQualityCount ? 'border-amber-500/50 !text-amber-400' : ''}`}><strong className={statStrongClass}>{lowQualityCount}</strong> 低质量</span>
        </div>
        <form className="grid grid-cols-[minmax(0,1fr)_minmax(72px,0.7fr)_34px] gap-2" onSubmit={(event) => { event.preventDefault(); onAddSeed(); }}>
          <input className={inputClass} value={seedDraft.keyword} onChange={(event) => onSeedDraftChange({ ...seedDraft, keyword: event.target.value })} placeholder="新增种子词" />
          <input className={inputClass} value={seedDraft.category} onChange={(event) => onSeedDraftChange({ ...seedDraft, category: event.target.value })} placeholder="类目" />
          <button type="submit" className="node-icon-button" title="添加种子词"><Plus size={14} /></button>
        </form>
        {seedMessage && <div className="rounded-lg border border-blue-500/30 bg-blue-900/10 text-blue-200 text-[11px] leading-normal p-2">{seedMessage}</div>}
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="种子池状态筛选">
          {[['active', '活跃'], ['observing', '观察'], ['explore', '探索'], ['cooling', '冷却'], ['paused', '暂停'], ['all', '全部']].map(([status, label]) => (
            <button type="button" key={status} className={`border border-[var(--border-default)] rounded-md bg-[var(--bg-panel)] text-[var(--text-muted)] text-[10px] font-bold px-[7px] py-[5px] ${seedFilter === status ? 'border-blue-500/80 bg-blue-900/30 text-blue-100' : ''}`} onClick={() => setSeedFilter(status)}>
              {label} {status === 'all' ? normalizedSeeds.length : (statusCounts[status] || 0)}
            </button>
          ))}
        </div>
        <div className="grid gap-[7px] max-h-[250px] overflow-auto">
          {visibleSeeds.slice(0, 12).map((seed) => (
            <div className={`node-seed-compact-row ${selectedSeed?.keyword === seed.keyword ? 'is-selected' : ''}`} key={seed.keyword}>
              <button type="button" onClick={() => setSelectedSeedKeyword(seed.keyword)}>
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <strong>{seed.keyword}</strong>
                  <span className={`node-seed-quality ${Number(seed.qualityScore || 0) < 50 ? 'low' : ''}`}>{seed.qualityScore ?? '--'} 分</span>
                </div>
                <span>
                  商品族 {seed.familyKey || '待识别'} · {seedStatusLabel[seed.status] || '活跃'} · {roleLabel[seed.role] || '待识别'}
                  {familyCounts[seed.familyKey] > 1 ? ` · 同族 ${familyCounts[seed.familyKey]} 个` : ''}
                </span>
              </button>
              <button type="button" className="node-icon-button danger" title="删除种子词" onClick={() => onDeleteSeed(seed.keyword)}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {visibleSeeds.length === 0 && <div className="artifact-empty">当前状态下没有种子词。</div>}
        </div>
        {selectedSeed && (
          <div className="grid gap-[10px] p-2.5 border border-blue-500/30 rounded-lg bg-blue-900/10">
            <div className="grid gap-1">
              <strong className="text-blue-100 text-xs">{selectedSeed.keyword}</strong>
              <span className="text-[var(--text-muted)] text-[10px] leading-[1.45]">{selectedSeed.category || '未分类'} · 商品族 {selectedSeed.familyKey || '待识别'} · {roleLabel[selectedSeed.role] || '待识别'} · 来源 {selectedSeed.source || '未记录'}</span>
              <small className="text-[var(--text-muted)] text-[10px] leading-[1.45]">{selectedSeed.classificationReason || selectedSeed.statusReason || '暂无识别说明'}</small>
              {selectedSeed.recommendedStatus && selectedSeed.recommendedStatus !== selectedSeed.status && (
                <small className="!text-amber-400 text-[10px] leading-[1.45]">建议状态：{seedStatusLabel[selectedSeed.recommendedStatus] || selectedSeed.recommendedStatus}</small>
              )}
            </div>
            <div className="grid grid-cols-3 gap-1.5" aria-label="种子效果漏斗">
              <span className={statCellClass}><strong className={statStrongClass}>{selectedSeed.stats?.runs || 0}</strong>运行</span>
              <span className={statCellClass}><strong className={statStrongClass}>{selectedSeed.stats?.candidates || 0}</strong>候选</span>
              <span className={statCellClass}><strong className={statStrongClass}>{selectedSeed.stats?.verified || 0}</strong>验真</span>
              <span className={statCellClass}><strong className={statStrongClass}>{selectedSeed.stats?.generationEligible || 0}</strong>可生成</span>
              <span className={statCellClass}><strong className={statStrongClass}>{selectedSeed.stats?.selectedProducts || 0}</strong>选品</span>
              <span className={statCellClass}><strong className={statStrongClass}>{selectedSeed.stats?.generatedTitles || 0}</strong>标题</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {selectedSeed.status !== 'active' && <button type="button" className="node-secondary-button success" onClick={() => onSetSeedStatus(selectedSeed.keyword, 'active')}>晋升活跃</button>}
              {selectedSeed.status !== 'observing' && <button type="button" className="node-secondary-button" onClick={() => onSetSeedStatus(selectedSeed.keyword, 'observing')}>转为观察</button>}
              {selectedSeed.status !== 'explore' && <button type="button" className="node-secondary-button" onClick={() => onSetSeedStatus(selectedSeed.keyword, 'explore')}>仅作探索</button>}
              {selectedSeed.status !== 'cooling' && <button type="button" className="node-secondary-button" onClick={() => onSetSeedStatus(selectedSeed.keyword, 'cooling')}>进入冷却</button>}
              <button type="button" className="node-secondary-button" onClick={() => onToggleSeed(selectedSeed.keyword)}>{selectedSeed.status === 'paused' ? '恢复' : '暂停'}</button>
            </div>
          </div>
        )}
        <button type="button" className="node-secondary-button" onClick={onLoadSeeds} disabled={seedLoading}>
          <RefreshCw size={13} className={seedLoading ? 'animate-spin' : ''} /> 刷新种子池
        </button>
      </section>

      <section className="grid gap-[10px] p-3 border border-slate-800/90 rounded-lg bg-[rgba(2,6,23,0.42)]">
        <div className="flex items-center justify-between gap-[10px]">
          <strong className="min-w-0 text-[var(--text-body)] text-xs">词根发现</strong>
          <span className="shrink-0 text-[var(--text-muted)] text-[10px]">{minerResults.length} 个结果</span>
        </div>
        <div className="node-segmented">
          {MINER_TABS.map((tab) => (
            <button type="button" key={tab.id} className={minerTab === tab.id ? 'active' : ''} onClick={() => onMinerTabChange(tab.id)}>
              {tab.label}
            </button>
          ))}
        </div>
        {activeTab.needsInput && (
          <input className={inputClass} value={minerInput} onChange={(event) => onMinerInputChange(event.target.value)} placeholder="输入关键词或商品链接" />
        )}
        <button type="button" className="node-primary-button" onClick={onRunMiner} disabled={minerBusy || (activeTab.needsInput && !minerInput.trim())}>
          {minerBusy ? <RefreshCw size={14} className="animate-spin" /> : <Database size={14} />}
          提取词根
        </button>
        <div className="node-chip-list">
          {(minerResults || []).slice(0, 16).map((item) => (
            <button type="button" key={`${item.word}-${item.searchPopularity || item.count || ''}`} onClick={() => onSeedDraftChange({ ...seedDraft, keyword: item.word })}>
              <span>{item.word}</span>
              <small>{item.searchPopularity ? `人气 ${item.searchPopularity}` : `词频 ${item.count || 1}`}</small>
            </button>
          ))}
          {(minerResults || []).length === 0 && <div className="artifact-empty">词根发现结果会显示在这里，可点选后加入种子池。</div>}
        </div>
      </section>
    </>
  );
};
