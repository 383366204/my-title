import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  FlaskConical,
  LayoutDashboard,
  PenLine,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Square,
  Trash2
} from 'lucide-react';

import WorkflowStudio from './WorkflowStudio.jsx';
import {
  BUSINESS_FUNNEL,
  getWorkflowAction,
  mapPipelineStageToFunnel,
  normalizeCandidateForTitle,
  buildReviewProduct
} from './workflow-ui.js';
import {
  labelPipelineStatus,
  labelPipelineStage,
  labelPipelineCount,
  labelNextAction
} from './pipeline-labels.js';
import { useSessionState } from './use-session-state.js';
import { usePipelineRun } from './use-pipeline-run.js';
import { HistoryService } from './history-service.js';
import { IndexedDbHistoryStore } from './indexeddb-history-store.js';
import './App.css';

const NAV_ITEMS = [
  { id: 'dashboard', label: '工作台', icon: LayoutDashboard },
  { id: 'mine', label: '挖词选品', icon: Search },
  { id: 'title', label: '标题生成', icon: PenLine }
];

const MINER_TABS = [
  { id: 'peer', label: '同行词根', endpoint: '/api/miner/peer', needsInput: true },
  { id: 'opp', label: '1688商机', endpoint: '/api/miner/opportunities', needsInput: false },
  { id: 'sycm-market', label: '参谋关联词', endpoint: '/api/miner/sycm-market', needsInput: true }
];

const WORKBENCH_FIELDS = [
  { key: 'mine', label: '挖词数量' },
  { key: 'verify', label: '验真数量' },
  { key: 'generate', label: '生成数量' },
  { key: 'export', label: '导出数量' },
  { key: 'productsPerKeyword', label: '每词货源' },
  { key: 'length', label: '标题长度' }
];

const WORKBENCH_MODE_LABEL = {
  daily: '每日',
  keyword: '单词'
};

const emptyTitleSafety = {
  canDistribute: false,
  degraded: false,
  reason: '未从已验真候选词导入'
};

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.ok === false) {
    throw new Error(payload.error || `请求失败: ${res.status}`);
  }
  return payload.data ?? payload;
}

function formatDateTime(value) {
  if (!value) return '暂无';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function copyText(value) {
  return navigator.clipboard.writeText(String(value || ''));
}

function getGateMeta(item = {}) {
  const status = item.gateStatus || (item.canDistribute ? 'verified' : 'candidate');
  const labels = {
    candidate: '待验真',
    verified: '已验真',
    review: '待复核',
    rejected: '已拒绝'
  };
  return {
    status,
    label: labels[status] || status,
    reason: item.gateReason || (item.canDistribute ? '可进入待确认铺货' : '需验真后才能铺货')
  };
}

function AppShell({ activeTab, setActiveTab, children }) {
  const [showDeveloperTools, setShowDeveloperTools] = useState(false);

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="brand-block">
          <div className="brand-mark">E</div>
          <div>
            <h1>电商选品工具</h1>
            <p>React unified console</p>
          </div>
        </div>
        <nav className="app-nav">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                data-testid={`nav-${item.id}`}
                className={`nav-button ${activeTab === item.id ? 'nav-button-active' : ''}`}
                onClick={() => setActiveTab(item.id)}
              >
                <Icon size={17} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-tools">
          <button className="sidebar-tool-button" type="button" onClick={() => setShowDeveloperTools((value) => !value)}>
            <Settings size={14} /> 系统
          </button>
          {showDeveloperTools && (
            <div className="sidebar-tool-menu">
              <button type="button" onClick={() => setActiveTab('experiment')}>开发调试</button>
              <a href="/legacy/">旧版备份</a>
            </div>
          )}
        </div>
      </aside>
      <main className="app-main">{children}</main>
    </div>
  );
}

function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="page-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

function MetricCard({ label, value, tone = 'neutral' }) {
  return (
    <div className={`metric-card metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DashboardView({ status, runs, loading, onRefresh, onStartWorkbench, onNavigate, reviewProducts, onClearReviewProduct }) {
  const latest = runs[0] || null;

  return (
    <div className="page-scroll">
      <PageHeader
        title="每日选品工作台"
        subtitle="从这里启动自动化、查看当前流程、处理下一步动作。"
        actions={(
          <button className="icon-button" type="button" onClick={onRefresh} title="刷新状态">
            <RefreshCw size={16} />
          </button>
        )}
      />

      <section className="metric-grid">
        <MetricCard label="种子词" value={status?.files?.seedsCount ?? '-'} tone="blue" />
        <MetricCard label="历史候选" value={status?.files?.seenCount ?? '-'} />
        <MetricCard label="拒绝冷却" value={status?.files?.rejectedCount ?? '-'} />
        <MetricCard label="验真缓存" value={status?.files?.cacheCount ?? '-'} />
      </section>

      <section className="workbench-band">
        <WorkbenchLauncher onStart={onStartWorkbench} />
        <div className="latest-run-panel">
          <div className="section-title-row">
            <h3>当前流程</h3>
            {loading && <span className="tiny-muted">刷新中...</span>}
          </div>
          {!latest ? (
            <div className="empty-panel">还没有 daily pipeline 运行记录。</div>
          ) : (
            <FlowStatusPanel run={latest} onNavigate={onNavigate} />
          )}
        </div>
      </section>

      <section className="table-panel review-queue-panel">
        <div className="section-title-row">
          <h3>待确认铺货</h3>
          <span className="tiny-muted">{reviewProducts.length} 个</span>
        </div>
        {reviewProducts.length === 0 ? (
          <div className="empty-panel">从标题生成页点击“加入复核”后，商品会出现在这里。</div>
        ) : (
          <div className="review-queue-list">
            {reviewProducts.map((item) => (
              <div className="review-queue-item" key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.keyword} · {item.price || '暂无价'}</span>
                </div>
                <button className="secondary-button" type="button" onClick={() => copyText(item.title)}>复制标题</button>
                {item.productUrl && <a className="secondary-button" href={item.productUrl} target="_blank" rel="noreferrer">打开货源</a>}
                <button className="icon-button danger" type="button" onClick={() => onClearReviewProduct(item.id)}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="table-panel">
        <div className="section-title-row">
          <h3>流程批次</h3>
          <span className="tiny-muted">{runs.length} 条</span>
        </div>
        <div className="compact-run-list">
          {runs.map((run) => (
            <div className="compact-run-row" key={run.runId}>
              <span className={`status-dot status-dot-${run.status || 'idle'}`} />
              <div>
                <strong>{run.runId}</strong>
                <p>{labelPipelineStage(run.stage)} · {formatDateTime(run.updatedAt || run.startedAt)}</p>
              </div>
              <span>{run.requiresUserAction ? '需处理' : labelPipelineStatus(run.status)}</span>
            </div>
          ))}
          {runs.length === 0 && <div className="empty-panel">暂无流程批次。</div>}
        </div>
      </section>
    </div>
  );
}

function FlowStatusPanel({ run, onNavigate }) {
  const activeStage = mapPipelineStageToFunnel(run.stage);
  const activeIndex = Math.max(0, BUSINESS_FUNNEL.findIndex((stage) => stage.id === activeStage));
  const action = getWorkflowAction(run);
  const statusText = run.status || 'unknown';
  const nextActionText = labelNextAction(run);

  return (
    <div className="run-summary">
      <div className="run-summary-top">
        <span className={`status-pill status-${statusText}`}>{labelPipelineStatus(statusText)}</span>
        <span>{formatDateTime(run.updatedAt || run.startedAt)}</span>
      </div>
      <strong>{run.runId}</strong>
      <div className="workflow-funnel-react">
        {BUSINESS_FUNNEL.map((stage, index) => {
          const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : '';
          return (
            <div className={`workflow-funnel-step ${state}`} key={stage.id}>
              <span>{index + 1}</span>
              <b>{stage.label}</b>
            </div>
          );
        })}
      </div>
      <div className={`next-action-card ${action.tone === 'warn' ? 'next-action-warn' : ''}`}>
        <div>
          <span>{action.tone === 'warn' ? '需要处理' : '下一步'}</span>
          <p>{nextActionText}</p>
        </div>
        {action.tone === 'warn' ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
      </div>
      <div className="count-strip">
        {Object.entries(run.counts || {}).slice(0, 5).map(([key, value]) => (
          <span key={key}>{labelPipelineCount(key)}: <b>{value}</b></span>
        ))}
      </div>
      <div className="flow-action-row">
        <button className="secondary-button" type="button" onClick={() => onNavigate(action.targetTab)}>
          <Play size={15} /> {action.label}
        </button>
        <button className="secondary-button muted" type="button" onClick={() => onNavigate('mine')}>
          <Search size={15} /> 挖词
        </button>
        <button className="secondary-button muted" type="button" onClick={() => onNavigate('title')}>
          <PenLine size={15} /> 标题
        </button>
        <button className="secondary-button muted" type="button" onClick={() => onNavigate('experiment')}>
          <FlaskConical size={15} /> 开发调试
        </button>
      </div>
    </div>
  );
}

function RecoveryHint({ message, onGoTitle }) {
  return (
    <div className="recovery-hint">
      <AlertTriangle size={18} />
      <div>
        <strong>自动抓取受阻</strong>
        <p>{message || '如果淘宝/1688触发限流，可以先手工粘贴同行标题继续生成。'}</p>
      </div>
      <button className="secondary-button" type="button" onClick={onGoTitle}>去手工生成</button>
    </div>
  );
}

function WorkbenchLauncher({ onStart }) {
  const [form, setForm] = useState({
    mode: 'daily',
    keyword: '',
    mine: 50,
    verify: 20,
    generate: 5,
    export: 20,
    productsPerKeyword: 3,
    length: 60
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const result = await onStart(form);
      setMessage(`已启动${WORKBENCH_MODE_LABEL[result.mode] || result.mode}工作流，流程 ${result.runId || '已创建'}`);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="launcher-panel" onSubmit={submit}>
      <div className="section-title-row">
        <h3>启动自动化</h3>
        <span className="tiny-muted">受保护后台运行</span>
      </div>
      <div className="segmented">
        <button type="button" className={form.mode === 'daily' ? 'active' : ''} onClick={() => update('mode', 'daily')}>每日</button>
        <button type="button" className={form.mode === 'keyword' ? 'active' : ''} onClick={() => update('mode', 'keyword')}>单词</button>
      </div>
      {form.mode === 'keyword' && (
        <label className="field">
          <span>关键词</span>
          <input value={form.keyword} onChange={(e) => update('keyword', e.target.value)} placeholder="例如：纯银项链" />
        </label>
      )}
      <div className="mini-form-grid">
        {WORKBENCH_FIELDS.map((field) => (
          <label className="field" key={field.key}>
            <span>{field.label}</span>
            <input type="number" min="1" value={form[field.key]} onChange={(e) => update(field.key, e.target.value)} />
          </label>
        ))}
      </div>
      <button className="primary-button" type="submit" disabled={busy}>
        {busy ? <RefreshCw size={16} className="spin" /> : <Play size={16} />}
        启动流程
      </button>
      {message && <div className="form-message">{message}</div>}
    </form>
  );
}

function MiningView({ onSendToTitle, historyService, pipeline }) {
  const [seeds, setSeeds] = useState([]);
  const [seedForm, setSeedForm] = useState({ keyword: '', category: '', priority: 5, type: 'manual' });
  const [config, setConfig] = useState({ count: 50, source: 'hybrid', minSearchPopularity: 50, sycmPrecheck: true, autoSeedHighTier: false });
  const [logs, setLogs] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [running, setRunning] = useState(false);
  const [minerTab, setMinerTab] = useState('peer');
  const [minerInput, setMinerInput] = useState('');
  const [minerResults, setMinerResults] = useState([]);
  const [minerBusy, setMinerBusy] = useState(false);
  const [pipelineBusy, setPipelineBusy] = useState('');
  const [pipelineMessage, setPipelineMessage] = useState('');
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [seedSearch, setSeedSearch] = useState('');
  const eventSourceRef = useRef(null);

  const filteredSeeds = useMemo(() => {
    const query = seedSearch.trim().toLowerCase();
    if (!query) return seeds;
    return seeds.filter((seed) => {
      return [
        seed.keyword,
        seed.category,
        seed.status,
        seed.type
      ].some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [seeds, seedSearch]);

  const loadSeeds = async () => {
    const data = await fetchJson('/api/seeds');
    setSeeds(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    loadSeeds().catch((err) => setLogs((current) => current.concat({ type: 'error', message: err.message })));
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, []);

  const addSeed = async (keyword = seedForm.keyword) => {
    const cleanKeyword = String(keyword || '').trim();
    if (!cleanKeyword) return;
    await fetchJson('/api/seeds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...seedForm, keyword: cleanKeyword })
    });
    setSeedForm((current) => ({ ...current, keyword: '' }));
    await loadSeeds();
  };

  const toggleSeed = async (keyword) => {
    await fetchJson(`/api/seeds/${encodeURIComponent(keyword)}/toggle`, { method: 'POST' });
    await loadSeeds();
  };

  const deleteSeed = async (keyword) => {
    await fetchJson(`/api/seeds/${encodeURIComponent(keyword)}`, { method: 'DELETE' });
    await loadSeeds();
  };

  const startMining = () => {
    if (running) return;
    setRunning(true);
    setRecoveryMessage('');
    setLogs([{ type: 'system', message: '正在启动关键词挖掘管道...' }]);
    setCandidates([]);
    const params = new URLSearchParams({
      count: config.count,
      source: config.source,
      minSearchPopularity: config.minSearchPopularity,
      sycmPrecheck: config.sycmPrecheck ? 'true' : 'false',
      autoSeedHighTier: config.autoSeedHighTier ? 'true' : 'false'
    });
    const source = new EventSource(`/api/mine/run?${params.toString()}`);
    eventSourceRef.current = source;

    source.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'result') {
        const nextCandidates = data.data?.candidates || [];
        setCandidates(nextCandidates);
        historyService?.recordCandidates(nextCandidates).catch(() => {});
        setLogs((current) => current.concat({ type: 'system', message: '挖掘管道执行完成。' }));
        source.close();
        eventSourceRef.current = null;
        setRunning(false);
      } else {
        setLogs((current) => current.concat({ type: data.type || 'log', message: data.message || '' }));
      }
    };

    source.onerror = () => {
      const message = '挖词日志流中断或平台限流，请稍后重试，或手工输入关键词进入标题生成。';
      setRecoveryMessage(message);
      setLogs((current) => current.concat({ type: 'error', message }));
      source.close();
      eventSourceRef.current = null;
      setRunning(false);
    };
  };

  const stopMining = () => {
    if (eventSourceRef.current) eventSourceRef.current.close();
    eventSourceRef.current = null;
    setRunning(false);
    setLogs((current) => current.concat({ type: 'error', message: '挖掘任务已手动停止。' }));
  };

  const runRootMiner = async () => {
    const tab = MINER_TABS.find((item) => item.id === minerTab);
    if (!tab) return;
    if (tab.needsInput && !minerInput.trim()) return;
    setMinerBusy(true);
    setRecoveryMessage('');
    setMinerResults([]);
    try {
      const data = await fetchJson(tab.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tab.needsInput ? { keyword: minerInput.trim() } : {})
      });
      setMinerResults(Array.isArray(data) ? data : []);
    } catch (err) {
      setRecoveryMessage(`挖掘异常：${err.message}。可以手工输入关键词进入标题生成。`);
    } finally {
      setMinerBusy(false);
    }
  };

  const runPipelineMine = async () => {
    setPipelineBusy('mine');
    setPipelineMessage('');
    try {
      const result = await pipeline.runStep('mine', config);
      setPipelineMessage(`流程挖词完成，当前候选词 ${result.currentRun?.counts?.candidates ?? '-'} 个。`);
    } catch (err) {
      setPipelineMessage(err.message);
    } finally {
      setPipelineBusy('');
    }
  };

  const appendCurrentCandidates = async (items = candidates) => {
    const rows = Array.isArray(items) ? items : [];
    if (rows.length === 0) return;
    setPipelineBusy('append');
    setPipelineMessage('');
    try {
      const result = await pipeline.appendCandidates(rows);
      setPipelineMessage(`已加入当前流程 ${result.result?.added || 0} 个，跳过重复 ${result.result?.skipped || 0} 个。`);
    } catch (err) {
      setPipelineMessage(err.message);
    } finally {
      setPipelineBusy('');
    }
  };

  const appendMinerResult = async (item) => {
    await appendCurrentCandidates([{
      keyword: item.word,
      source: minerTab,
      localScore: item.searchPopularity ? Math.min(95, Math.max(55, Math.round(item.searchPopularity / 10))) : 65,
      reason: item.searchPopularity ? `词根发现人气 ${item.searchPopularity}` : `词根发现词频 ${item.count || 1}`,
      nextAction: 'sycm_verify'
    }]);
  };

  return (
    <div className="page-scroll">
      <PageHeader
        title="挖词选品"
        subtitle="种子池、词根挖掘、SSE 挖词结果在同一页完成，结果可直接送入标题生成。"
        actions={(
          <button className="icon-button" type="button" onClick={() => loadSeeds()} title="刷新种子池">
            <RefreshCw size={16} />
          </button>
        )}
      />
      {recoveryMessage && (
        <RecoveryHint
          message={recoveryMessage}
          onGoTitle={() => onSendToTitle({ keyword: minerInput || seedForm.keyword })}
        />
      )}
      <section className="pipeline-context-band">
        <div>
          <span>当前流程</span>
          <strong>{pipeline.currentRun?.runId || '暂无流程'}</strong>
          <p>
            {pipeline.currentRun
              ? `候选词 ${pipeline.currentRun.counts?.candidates || 0} 个 · ${labelPipelineStatus(pipeline.currentRun.status)}`
              : '先在工作台启动流程，或继续使用临时挖词探索。'}
          </p>
        </div>
        <div className="context-actions">
          <button className="secondary-button" type="button" onClick={pipeline.refreshRun} disabled={pipeline.loading}>
            <RefreshCw size={15} /> 刷新
          </button>
          <button className="primary-button" type="button" onClick={runPipelineMine} disabled={!pipeline.currentRun || Boolean(pipelineBusy)}>
            {pipelineBusy === 'mine' ? <RefreshCw size={15} className="spin" /> : <Play size={15} />}
            运行当前流程挖词阶段
          </button>
        </div>
      </section>
      {pipelineMessage && <div className="form-message">{pipelineMessage}</div>}

      <section className="split-layout">
        <div className="table-panel">
          <div className="section-title-row">
            <h3>种子池</h3>
            <span className="tiny-muted">
              {seedSearch.trim() ? `${filteredSeeds.length} / ${seeds.length} 个` : `${seeds.length} 个`}
            </span>
          </div>
          <form className="inline-form" onSubmit={(event) => { event.preventDefault(); addSeed(); }}>
            <input value={seedForm.keyword} onChange={(e) => setSeedForm({ ...seedForm, keyword: e.target.value })} placeholder="新增种子词" />
            <input value={seedForm.category} onChange={(e) => setSeedForm({ ...seedForm, category: e.target.value })} placeholder="类目" />
            <input type="number" min="1" max="10" value={seedForm.priority} onChange={(e) => setSeedForm({ ...seedForm, priority: e.target.value })} />
            <button type="submit" className="icon-button" title="添加"><Plus size={16} /></button>
          </form>
          <label className="seed-search">
            <Search size={14} />
            <input value={seedSearch} onChange={(e) => setSeedSearch(e.target.value)} placeholder="搜索种子词、类目或状态" />
          </label>
          <div className="seed-list">
            {filteredSeeds.map((seed) => (
              <div className="seed-row" key={seed.keyword}>
                <div>
                  <strong>{seed.keyword}</strong>
                  <span>{seed.category || '未分类'} · 分数 {seed.priorityScore || seed.priority || '-'}</span>
                </div>
                <span className={`status-pill status-${seed.status || 'active'}`}>{seed.status === 'paused' ? '暂停' : '活跃'}</span>
                <button className="icon-button" type="button" onClick={() => toggleSeed(seed.keyword)} title={seed.status === 'paused' ? '恢复' : '暂停'}>
                  {seed.status === 'paused' ? <Play size={15} /> : <Square size={15} />}
                </button>
                <button className="icon-button danger" type="button" onClick={() => deleteSeed(seed.keyword)} title="删除">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            {seeds.length === 0 && <div className="empty-panel">种子池为空，先添加几个核心品类词。</div>}
            {seeds.length > 0 && filteredSeeds.length === 0 && <div className="empty-panel">没有匹配的种子词。</div>}
          </div>
        </div>

        <div className="table-panel">
          <div className="section-title-row">
            <h3>词根发现</h3>
            <span className="tiny-muted">同行 / 商机 / 参谋</span>
          </div>
          <div className="segmented">
            {MINER_TABS.map((tab) => (
              <button type="button" key={tab.id} className={minerTab === tab.id ? 'active' : ''} onClick={() => setMinerTab(tab.id)}>{tab.label}</button>
            ))}
          </div>
          {MINER_TABS.find((tab) => tab.id === minerTab)?.needsInput && (
            <input className="wide-input" value={minerInput} onChange={(e) => setMinerInput(e.target.value)} placeholder="输入关键词或商品链接" />
          )}
          <button className="primary-button" type="button" onClick={runRootMiner} disabled={minerBusy}>
            {minerBusy ? <RefreshCw size={16} className="spin" /> : <Database size={16} />}
            提取并验真
          </button>
          <div className="chip-area">
            {minerResults.map((item) => (
              <button className="keyword-chip" type="button" key={`${item.word}-${item.searchPopularity || item.count || ''}`} onClick={() => addSeed(item.word)}>
                <span>{item.word}</span>
                <small>{item.searchPopularity ? `人气 ${item.searchPopularity}` : `词频 ${item.count || 1}`}</small>
                <Plus size={13} />
              </button>
            ))}
            {minerResults.length === 0 && <div className="empty-panel">提取出的词根会出现在这里，可一键导入种子池。</div>}
          </div>
          {minerResults.length > 0 && (
            <div className="flow-action-row">
              <button className="secondary-button" type="button" onClick={() => appendCurrentCandidates(minerResults.map((item) => ({
                keyword: item.word,
                source: minerTab,
                localScore: item.searchPopularity ? Math.min(95, Math.max(55, Math.round(item.searchPopularity / 10))) : 65,
                reason: item.searchPopularity ? `词根发现人气 ${item.searchPopularity}` : `词根发现词频 ${item.count || 1}`,
                nextAction: 'sycm_verify'
              })))} disabled={!pipeline.currentRun || Boolean(pipelineBusy)}>
                <Plus size={15} /> 全部加入当前流程
              </button>
              <button className="secondary-button muted" type="button" onClick={() => appendMinerResult(minerResults[0])} disabled={!pipeline.currentRun || Boolean(pipelineBusy)}>
                <Send size={15} /> 首词加入流程
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="table-panel">
        <div className="section-title-row">
          <h3>自动挖词流</h3>
          <span className="tiny-muted">候选词会做去重、验真和质量分层</span>
        </div>
        <div className="config-row">
          <label className="field"><span>数量</span><input type="number" value={config.count} onChange={(e) => setConfig({ ...config, count: e.target.value })} /></label>
          <label className="field"><span>来源</span><select value={config.source} onChange={(e) => setConfig({ ...config, source: e.target.value })}><option value="hybrid">混合</option><option value="local">本地规则</option><option value="ai">智能扩展</option></select></label>
          <label className="field"><span>最低人气</span><input type="number" value={config.minSearchPopularity} onChange={(e) => setConfig({ ...config, minSearchPopularity: e.target.value })} /></label>
          <label className="toggle-field"><input type="checkbox" checked={config.sycmPrecheck} onChange={(e) => setConfig({ ...config, sycmPrecheck: e.target.checked })} /> 生意参谋预检</label>
          <label className="toggle-field"><input type="checkbox" checked={config.autoSeedHighTier} onChange={(e) => setConfig({ ...config, autoSeedHighTier: e.target.checked })} /> 高分自动入池</label>
          <button className="primary-button" type="button" onClick={running ? stopMining : startMining}>
            {running ? <Square size={16} /> : <Play size={16} />}
            {running ? '停止临时挖词' : '临时挖词'}
          </button>
          <button className="secondary-button" type="button" onClick={() => appendCurrentCandidates()} disabled={!pipeline.currentRun || candidates.length === 0 || Boolean(pipelineBusy)}>
            <Plus size={15} /> 加入当前流程
          </button>
        </div>
        <div className="form-message">临时挖词用于探索；要推进选品流水线，请使用“运行当前流程挖词阶段”或把候选词加入当前流程。</div>
        <div className="console-panel">
          {logs.map((line, index) => <div key={index} className={`log-line log-${line.type}`}>{line.message}</div>)}
          {logs.length === 0 && <div className="log-line">日志会在运行后实时显示。</div>}
        </div>
        <CandidateTable candidates={candidates} onSendToTitle={onSendToTitle} />
      </section>
    </div>
  );
}

function CandidateTable({ candidates, onSendToTitle }) {
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>关键词</th>
            <th>分数</th>
            <th>分层</th>
            <th>验真</th>
            <th>来源</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((item) => {
            const gate = getGateMeta(item);
            return (
              <tr key={`${item.keyword}-${item.source || ''}`}>
                <td>
                  <strong>{item.keyword}</strong>
                  {item.sycmData && <small>人气 {item.sycmData.searchPopularity || 0} · 供需 {item.sycmData.demandSupplyRatio ?? '-'}</small>}
                </td>
                <td>{item.localScore ?? '-'}</td>
                <td><span className={`tier tier-${item.tier || 'low'}`}>{item.tier || '-'}</span></td>
                <td><span className={`gate gate-${gate.status}`}>{gate.label}</span><small>{gate.reason}</small></td>
                <td>{item.source || '-'}</td>
                <td className="row-actions">
                  <button className="icon-button" type="button" title="复制" onClick={() => copyText(item.keyword)}><Copy size={15} /></button>
                  <button className="secondary-button" type="button" onClick={() => onSendToTitle(item)}><Send size={15} /> 生成</button>
                </td>
              </tr>
            );
          })}
          {candidates.length === 0 && (
            <tr><td colSpan="6" className="empty-cell">还没有挖词结果。</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function TitleView({ sourceCandidate, onAddReviewProduct, historyService, pipeline }) {
  const [form, setForm] = useState({ keyword: '', maxLength: 60, useImageSearch: false, peerTitles: '' });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (sourceCandidate?.keyword) {
      setForm((current) => ({ ...current, keyword: sourceCandidate.keyword }));
    }
  }, [sourceCandidate]);

  const safety = useMemo(() => {
    if (!result) return sourceCandidate?.canDistribute ? {
      canDistribute: true,
      degraded: false,
      reason: sourceCandidate.gateReason || '生意参谋验真通过'
    } : emptyTitleSafety;
    const degraded = result.degraded || result.stats?.degraded || result.stats?.trace?.degraded;
    if (degraded) return { canDistribute: false, degraded, reason: '标题生成已降级' };
    if (sourceCandidate?.canDistribute && sourceCandidate.keyword === form.keyword.trim()) {
      return { canDistribute: true, degraded: false, reason: sourceCandidate.gateReason || '生意参谋验真通过' };
    }
    return { canDistribute: false, degraded: false, reason: '该词未通过生意参谋验真或已手动修改' };
  }, [form.keyword, result, sourceCandidate]);

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const peerTitles = form.peerTitles.split('\n').map((item) => item.trim()).filter(Boolean);
      const data = await fetchJson('/api/title/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: form.keyword,
          maxLength: form.maxLength,
          useImageSearch: form.useImageSearch,
          peerTitles: peerTitles.length > 0 ? peerTitles : null
        })
      });
      setResult(data);
    } catch (err) {
      setError(`${err.message}。可以粘贴同行标题后重试，减少平台抓取依赖。`);
    } finally {
      setLoading(false);
    }
  };

  const products = result?.products || [];
  const titles = products.map((item) => item['铺货标题']).filter(Boolean);
  const verifiedKeywords = pipeline.currentRun?.previews?.verifiedKeywords || [];

  return (
    <div className="page-scroll">
      <PageHeader
        title="标题生成"
        subtitle="从挖词页导入的已验真词会保留铺货安全状态，手动输入则默认只能做研究参考。"
        actions={titles.length > 0 && (
          <button className="secondary-button" type="button" onClick={() => copyText(titles.join('\n'))}>
            <Copy size={15} /> 复制全部标题
          </button>
        )}
      />

      <section className="title-layout">
        <form className="title-form table-panel" onSubmit={submit}>
          <div className="section-title-row">
            <h3>当前流程已验真词</h3>
            <span className="tiny-muted">{verifiedKeywords.length} 个</span>
          </div>
          <div className="verified-keyword-strip">
            {verifiedKeywords.map((item) => (
              <button
                type="button"
                className="keyword-chip"
                key={item.keyword}
                onClick={() => setForm((current) => ({ ...current, keyword: item.keyword }))}
              >
                <span>{item.keyword}</span>
                <small>{item.sycmScore?.score ? `分数 ${item.sycmScore.score}` : '已验真'}</small>
              </button>
            ))}
            {verifiedKeywords.length === 0 && <div className="empty-panel">当前流程还没有已验真关键词，可以先去挖词页运行验真。</div>}
          </div>
          {sourceCandidate?.keyword && (
            <div className="source-context-panel">
              <div>
                <span>来源候选词</span>
                <strong>{sourceCandidate.keyword}</strong>
              </div>
              <div>
                <span>质量分</span>
                <strong>{sourceCandidate.score ?? '-'}</strong>
              </div>
              <div>
                <span>搜索人气</span>
                <strong>{sourceCandidate.market?.searchPopularity ?? '-'}</strong>
              </div>
              <div>
                <span>供需比</span>
                <strong>{sourceCandidate.market?.demandSupplyRatio ?? '-'}</strong>
              </div>
            </div>
          )}
          <label className="field">
            <span>关键词</span>
            <input value={form.keyword} onChange={(e) => setForm({ ...form, keyword: e.target.value })} placeholder="例如：纯银项链女高级感" />
          </label>
          <label className="field">
            <span>标题最大长度</span>
            <input type="number" min="10" max="100" value={form.maxLength} onChange={(e) => setForm({ ...form, maxLength: e.target.value })} />
          </label>
          <label className="toggle-field"><input type="checkbox" checked={form.useImageSearch} onChange={(e) => setForm({ ...form, useImageSearch: e.target.checked })} /> 使用图搜辅助</label>
          <label className="field">
            <span>同行标题</span>
            <textarea rows="7" value={form.peerTitles} onChange={(e) => setForm({ ...form, peerTitles: e.target.value })} placeholder="可粘贴淘宝同行标题，一行一个" />
          </label>
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? <RefreshCw size={16} className="spin" /> : <PenLine size={16} />}
            {loading ? '生成中' : '开始选品并生成标题'}
          </button>
        </form>

        <div className="analysis-panel table-panel">
          <div className="section-title-row">
            <h3>分析结果</h3>
            <span className={`gate gate-${safety.canDistribute ? 'verified' : 'candidate'}`}>{safety.canDistribute ? '可进入复核' : '仅研究'}</span>
          </div>
          {error && <div className="alert-box alert-error"><AlertTriangle size={16} /> {error}</div>}
          {safety.degraded && <div className="alert-box alert-error"><AlertTriangle size={16} /> {safety.reason}</div>}
          {!safety.canDistribute && !safety.degraded && <div className="alert-box alert-warn"><Clock size={16} /> {safety.reason}</div>}
          {result ? (
            <div className="analysis-grid">
              <MetricCard label="蓝海词" value={result.blueOceanWord || '-'} tone="blue" />
              <MetricCard label="核心词" value={result.coreWord || '-'} />
              <MetricCard label="货源数" value={result.stats?.alibaba1688Total ?? products.length} />
              <MetricCard label="同行标题" value={result.peerTitles?.length ?? 0} />
              {result.overallAdvice && <p className="advice-text">{result.overallAdvice}</p>}
            </div>
          ) : (
            <div className="empty-panel">生成后的核心词、货源统计和选品建议会显示在这里。</div>
          )}
        </div>
      </section>

      <section className="product-grid">
        {products.map((product, index) => (
          <ProductCard
            key={`${product['产品链接'] || index}`}
            product={product}
            safety={safety}
            sourceCandidate={sourceCandidate}
            onAddReview={onAddReviewProduct}
          />
        ))}
        {products.length === 0 && <div className="empty-panel full-span">还没有生成的货源卡片。</div>}
      </section>
    </div>
  );
}

function ProductCard({ product, safety, sourceCandidate, onAddReview }) {
  return (
    <article className="product-card">
      <div className="product-image">
        {product['主图链接'] ? <img src={product['主图链接']} alt={product['链接原标题'] || 'product'} /> : <div className="image-placeholder">No Image</div>}
        <span>{product['商品原价'] ? `¥${product['商品原价']}` : '暂无价'}</span>
      </div>
      <div className="product-content">
        <a href={product['产品链接']} target="_blank" rel="noreferrer">{product['链接原标题'] || '查看 1688 货源'}</a>
        <div className="seo-title">{product['铺货标题'] || '未生成标题'}</div>
        <div className="product-meta">
          <span>销量 {product['30天销量'] || 0}</span>
          <span>好评 {Math.round((product['好评率'] || 0) * 100)}%</span>
          <span>复购 {Math.round((product['复购率'] || 0) * 100)}%</span>
        </div>
        <p>{product['选品理由'] || '符合核心词搜索需求'}</p>
        <p>{product['定价建议'] || '参考同类产品定价'}</p>
      </div>
      <footer className="product-footer">
        <span>质量分 {product['标题质量分'] || 0}</span>
        <button className="secondary-button" type="button" onClick={() => copyText(product['铺货标题'])}><Copy size={15} /> 复制</button>
        <button
          className="secondary-button"
          type="button"
          disabled={!safety.canDistribute}
          onClick={() => onAddReview(buildReviewProduct({ keyword: sourceCandidate?.keyword, product, candidate: sourceCandidate }))}
        >
          <CheckCircle2 size={15} /> 加入复核
        </button>
      </footer>
    </article>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [status, setStatus] = useState(null);
  const pipeline = usePipelineRun({ limit: 12 });
  const [sourceCandidate, setSourceCandidate] = useSessionState('ecom.sourceCandidate', null);
  const [reviewProducts, setReviewProducts] = useSessionState('ecom.reviewProducts', []);
  const historyService = useMemo(() => {
    if (typeof window === 'undefined' || !window.indexedDB) return null;
    return new HistoryService(new IndexedDbHistoryStore());
  }, []);

  const refreshOverview = async () => {
    const [statusData] = await Promise.all([
      fetchJson('/api/status'),
      pipeline.refreshRun()
    ]);
    setStatus(statusData);
  };

  useEffect(() => {
    refreshOverview().catch(() => {});
  }, []);

  const sendToTitle = (candidate) => {
    setSourceCandidate(normalizeCandidateForTitle(candidate));
    setActiveTab('title');
  };

  const startWorkbench = async (form) => {
    const data = await pipeline.startRun(form);
    setTimeout(() => pipeline.refreshRun().catch(() => {}), 1200);
    return data;
  };

  if (activeTab === 'experiment') {
    return (
      <AppShell activeTab={activeTab} setActiveTab={setActiveTab}>
        <div className="studio-host">
          <WorkflowStudio key={activeTab} initialMode="experiment" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell activeTab={activeTab} setActiveTab={setActiveTab}>
      {activeTab === 'dashboard' && (
        <DashboardView
          status={status}
          runs={pipeline.runs}
          loading={pipeline.loading}
          onRefresh={() => refreshOverview().catch(() => {})}
          onStartWorkbench={startWorkbench}
          onNavigate={setActiveTab}
          reviewProducts={reviewProducts}
          onClearReviewProduct={(id) => setReviewProducts((current) => current.filter((item) => item.id !== id))}
        />
      )}
      {activeTab === 'mine' && <MiningView onSendToTitle={sendToTitle} historyService={historyService} pipeline={pipeline} />}
      {activeTab === 'title' && (
        <TitleView
          sourceCandidate={sourceCandidate}
          pipeline={pipeline}
          historyService={historyService}
          onAddReviewProduct={(product) => {
            setReviewProducts((current) => [
              product,
              ...current.filter((item) => item.id !== product.id)
            ]);
            if (sourceCandidate) {
              historyService?.markPendingReview(sourceCandidate.raw || sourceCandidate, product).catch(() => {});
            }
          }}
        />
      )}
    </AppShell>
  );
}
