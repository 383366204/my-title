import { useState } from 'react';
import { Copy, Database, ExternalLink, Plus, RefreshCw, Trash2 } from 'lucide-react';

import { artifactItems, candidateKeyword, MINER_TABS } from '../workflow-data.js';
import { ArtifactPanel } from './artifact-panel.jsx';

const SOURCE_LABELS = { news: '新闻', dictionary: '字典', calendar: '日历', trend: '趋势' };
const REJECTION_LABELS = {
  sensitive_or_negative_news: '涉及敏感或负面事件，不用于商品化',
  brand_or_ip_risk: '存在品牌或知识产权风险',
  empty_root: '没有生成商品词根',
  root_length_out_of_range: '词根长度不符合要求',
  banned_word: '命中违禁词',
  abstract_root: '仍是抽象概念，不是具体商品',
  not_concrete_product: '无法确认是可采购的具体商品',
  root_cooldown: '该词根仍在冷却期',
  family_cooldown: '同商品族仍在冷却期',
  root_score_below_threshold: '商品化与新鲜度综合分不足',
  daily_quota_or_diversity: '受每日配额或商品族多样性限制未入选'
};

const sourceLabel = (value) => SOURCE_LABELS[value] || value || '未知来源';
const rejectionLabel = (value) => REJECTION_LABELS[value] || value || '';

export const KeywordMiningOperationPanel = ({
  artifactState,
  dynamicMode = false,
  seedRows,
  seedDraft,
  seedLoading,
  seedMessage,
  onSeedDraftChange,
  onLoadSeeds,
  onAddSeed,
  onToggleSeed,
  onDeleteSeed,
  onSetSeedStatus,
  minerTab,
  minerInput,
  minerResults,
  minerBusy,
  onMinerTabChange,
  onMinerInputChange,
  onRunMiner,
  onCopyCandidate,
  onRetryMine,
  canRetryMine
}) => {
  const candidates = artifactItems(artifactState);
  const activeTab = MINER_TABS.find((item) => item.id === minerTab) || MINER_TABS[0];
  const [seedFilter, setSeedFilter] = useState('active');
  const [selectedSeedKeyword, setSelectedSeedKeyword] = useState('');
  const [dynamicTab, setDynamicTab] = useState('inspirations');
  const inspirationRows = Array.isArray(artifactState.artifact?.inspirationRows) ? artifactState.artifact.inspirationRows : [];
  const rootRows = Array.isArray(artifactState.artifact?.rootRows) ? artifactState.artifact.rootRows : [];
  const discoveryStats = artifactState.artifact?.discovery?.stats || {};
  const seedStatusLabel = {
    active: '活跃',
    observing: '观察',
    explore: '探索',
    cooling: '冷却',
    paused: '暂停',
    disabled: '停用'
  };
  const normalizedSeeds = seedRows.map((seed) => ({ ...seed, status: seed.status || 'active' }));
  const roleLabel = {
    discovery_root: '扩词词根',
    direct_candidate: '直接候选',
    context_only: '场景参考',
    unrecognized: '待识别'
  };
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

  return (
    <div className="node-embedded-workbench">
      {dynamicMode && (
        <section className="node-workbench-section">
          <div className="node-workbench-head">
            <strong>今日灵感发现</strong>
            <span>{discoveryStats.selectedRootCount || rootRows.filter((row) => row.status === 'selected').length} 个词根入选</span>
          </div>
          <div className="node-inspiration-summary">
            <span><strong>{discoveryStats.inspirationCount || inspirationRows.length}</strong> 条灵感</span>
            <span><strong>{discoveryStats.safeInspirationCount || inspirationRows.filter((row) => row.status === 'safe').length}</strong> 安全可用</span>
            <span><strong>{discoveryStats.productizedCount || rootRows.length}</strong> 个商品词根</span>
            <span className={Number(discoveryStats.inspirationRejected || 0) > 0 ? 'warning' : ''}><strong>{discoveryStats.inspirationRejected || inspirationRows.filter((row) => row.status === 'rejected').length}</strong> 条拦截</span>
          </div>
          <div className="node-segmented" role="tablist" aria-label="灵感选词链路">
            <button type="button" className={dynamicTab === 'inspirations' ? 'active' : ''} onClick={() => setDynamicTab('inspirations')}>灵感来源</button>
            <button type="button" className={dynamicTab === 'roots' ? 'active' : ''} onClick={() => setDynamicTab('roots')}>词根与拦截</button>
          </div>
          {dynamicTab === 'inspirations' ? (
            <div className="node-inspiration-list">
              {inspirationRows.slice(0, 20).map((item, index) => (
                <div className={`node-inspiration-row ${item.status === 'rejected' ? 'is-rejected' : ''}`} key={item.id || `${item.inspirationWord}-${index}`}>
                  <div>
                    <strong>{item.inspirationWord || item.sourceTitle || '未命名灵感'}</strong>
                    <span>{item.sourceTitle || item.rawSourceText || '未记录来源'} · {sourceLabel(item.sourceType)}</span>
                    {item.rejectReason && <small>拦截原因：{rejectionLabel(item.rejectReason)}</small>}
                  </div>
                  {item.sourceUrl && (
                    <a href={item.sourceUrl} target="_blank" rel="noreferrer" title="打开灵感来源">
                      <ExternalLink size={13} />
                    </a>
                  )}
                </div>
              ))}
              {inspirationRows.length === 0 && <div className="artifact-empty">运行后会展示新闻、字典、日历和趋势灵感。</div>}
            </div>
          ) : (
            <div className="node-inspiration-list">
              {rootRows.slice(0, 30).map((item, index) => (
                <div className={`node-inspiration-row ${!['selected', 'eligible'].includes(item.status) ? 'is-rejected' : ''}`} key={`${item.rootKeyword}-${item.inspirationId}-${index}`}>
                  <div>
                    <strong>{item.rootKeyword || '未命名词根'} <em>{item.status === 'selected' ? '已入选' : item.status === 'eligible' ? '可选' : '未采用'}</em></strong>
                    <span>{item.inspiration?.inspirationWord ? `灵感 ${item.inspiration.inspirationWord} → ` : ''}{item.coreProduct || item.familyKey || '待识别商品'}{item.rootScore?.total ? ` · ${Math.round(item.rootScore.total)} 分` : ''}</span>
                    <small>{item.rejectReason ? `未采用原因：${rejectionLabel(item.rejectReason)}` : (item.relationReason || '已通过商品化校验')}</small>
                  </div>
                </div>
              ))}
              {rootRows.length === 0 && <div className="artifact-empty">运行后会展示商品词根及每条未采用原因。</div>}
            </div>
          )}
        </section>
      )}

      {!dynamicMode && (<>
      <section className="node-workbench-section">
        <div className="node-workbench-head">
          <strong>种子池</strong>
          <span>{seedLoading ? '加载中' : `活跃 ${statusCounts.active || 0} · 观察 ${statusCounts.observing || 0}`}</span>
        </div>
        <div className="node-seed-health-summary">
          <span><strong>{normalizedSeeds.length}</strong> 总种子</span>
          <span><strong>{normalizedSeeds.filter((seed) => ['discovery_root', 'direct_candidate'].includes(seed.role)).length}</strong> 可执行</span>
          <span className={repeatedFamilyCount ? 'warning' : ''}><strong>{repeatedFamilyCount}</strong> 重复商品族</span>
          <span className={lowQualityCount ? 'warning' : ''}><strong>{lowQualityCount}</strong> 低质量</span>
        </div>
        <form className="node-inline-form" onSubmit={(event) => { event.preventDefault(); onAddSeed(); }}>
          <input value={seedDraft.keyword} onChange={(event) => onSeedDraftChange({ ...seedDraft, keyword: event.target.value })} placeholder="新增种子词" />
          <input value={seedDraft.category} onChange={(event) => onSeedDraftChange({ ...seedDraft, category: event.target.value })} placeholder="类目" />
          <button type="submit" className="node-icon-button" title="添加种子词"><Plus size={14} /></button>
        </form>
        {seedMessage && <div className="node-workbench-message">{seedMessage}</div>}
        <div className="node-seed-status-tabs" role="tablist" aria-label="种子池状态筛选">
          {[['active', '活跃'], ['observing', '观察'], ['explore', '探索'], ['cooling', '冷却'], ['paused', '暂停'], ['all', '全部']].map(([status, label]) => (
            <button type="button" key={status} className={seedFilter === status ? 'active' : ''} onClick={() => setSeedFilter(status)}>
              {label} {status === 'all' ? normalizedSeeds.length : (statusCounts[status] || 0)}
            </button>
          ))}
        </div>
        <div className="node-seed-compact-list">
          {visibleSeeds.slice(0, 12).map((seed) => (
            <div className={`node-seed-compact-row ${selectedSeed?.keyword === seed.keyword ? 'is-selected' : ''}`} key={seed.keyword}>
              <button type="button" onClick={() => setSelectedSeedKeyword(seed.keyword)}>
                <div className="node-seed-row-title">
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
          <div className="node-seed-detail">
            <div>
              <strong>{selectedSeed.keyword}</strong>
              <span>{selectedSeed.category || '未分类'} · 商品族 {selectedSeed.familyKey || '待识别'} · {roleLabel[selectedSeed.role] || '待识别'} · 来源 {selectedSeed.source || '未记录'}</span>
              <small>{selectedSeed.classificationReason || selectedSeed.statusReason || '暂无识别说明'}</small>
              {selectedSeed.recommendedStatus && selectedSeed.recommendedStatus !== selectedSeed.status && (
                <small className="node-seed-recommendation">建议状态：{seedStatusLabel[selectedSeed.recommendedStatus] || selectedSeed.recommendedStatus}</small>
              )}
            </div>
            <div className="node-seed-funnel" aria-label="种子效果漏斗">
              <span><strong>{selectedSeed.stats?.runs || 0}</strong>运行</span>
              <span><strong>{selectedSeed.stats?.candidates || 0}</strong>候选</span>
              <span><strong>{selectedSeed.stats?.verified || 0}</strong>验真</span>
              <span><strong>{selectedSeed.stats?.generationEligible || 0}</strong>可生成</span>
              <span><strong>{selectedSeed.stats?.selectedProducts || 0}</strong>选品</span>
              <span><strong>{selectedSeed.stats?.generatedTitles || 0}</strong>标题</span>
            </div>
            <div className="node-seed-detail-actions">
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

      <section className="node-workbench-section">
        <div className="node-workbench-head">
          <strong>词根发现</strong>
          <span>{minerResults.length} 个结果</span>
        </div>
        <div className="node-segmented">
          {MINER_TABS.map((tab) => (
            <button type="button" key={tab.id} className={minerTab === tab.id ? 'active' : ''} onClick={() => onMinerTabChange(tab.id)}>
              {tab.label}
            </button>
          ))}
        </div>
        {activeTab.needsInput && (
          <input className="node-wide-input" value={minerInput} onChange={(event) => onMinerInputChange(event.target.value)} placeholder="输入关键词或商品链接" />
        )}
        <button type="button" className="node-primary-button" onClick={onRunMiner} disabled={minerBusy || (activeTab.needsInput && !minerInput.trim())}>
          {minerBusy ? <RefreshCw size={14} className="animate-spin" /> : <Database size={14} />}
          提取词根
        </button>
        <div className="node-chip-list">
          {minerResults.slice(0, 16).map((item) => (
            <button type="button" key={`${item.word}-${item.searchPopularity || item.count || ''}`} onClick={() => onSeedDraftChange({ ...seedDraft, keyword: item.word })}>
              <span>{item.word}</span>
              <small>{item.searchPopularity ? `人气 ${item.searchPopularity}` : `词频 ${item.count || 1}`}</small>
            </button>
          ))}
          {minerResults.length === 0 && <div className="artifact-empty">词根发现结果会显示在这里，可点选后加入种子池。</div>}
        </div>
      </section>
      </>)}

      <section className="node-workbench-section">
        <div className="node-workbench-head">
          <strong>候选词产物</strong>
          <span>{candidates.length} 个</span>
        </div>
        <div className="node-candidate-list">
          {candidates.slice(0, 8).map((item, index) => (
            <div className="node-candidate-row" key={`${candidateKeyword(item)}-${index}`}>
              <div>
                <strong>{candidateKeyword(item) || '未命名候选词'}</strong>
                <span>{item.inspiration?.inspirationWord ? `灵感 ${item.inspiration.inspirationWord} → ${item.rootKeyword || item.coreProduct || '商品词根'} · ` : ''}{item.relationReason || item.reason || item.source || item.nextAction || '等待生意参谋校验'}</span>
              </div>
              <button type="button" className="node-icon-button" title="复制关键词" onClick={() => onCopyCandidate(candidateKeyword(item))}>
                <Copy size={13} />
              </button>
            </div>
          ))}
          {candidates.length === 0 && <ArtifactPanel state={artifactState} />}
        </div>
        <button type="button" className="node-secondary-button" onClick={onRetryMine} disabled={!canRetryMine}>
          <RefreshCw size={13} /> 重新执行灵感选词
        </button>
      </section>
    </div>
  );
};
