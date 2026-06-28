'use strict';

// ==================== DOM Elements ====================
const formMineConfig = document.getElementById('form-mine-config');
const btnStartMine = document.getElementById('btn-start-mine');
const btnStopMine = document.getElementById('btn-stop-mine');
const logConsole = document.getElementById('log-console');
const mineResultsCard = document.getElementById('mine-results-card');
const resultsCount = document.getElementById('results-count');
const mineResultsTbody = document.getElementById('mine-results-tbody');
const btnCopyAllKws = document.getElementById('btn-copy-all-kws');
const btnBatchGenTitle = document.getElementById('btn-batch-gen-title');
const selectAllKws = document.getElementById('select-all-kws');
const progressTracker = document.getElementById('mine-progress-tracker');

let currentMinedKeywords = [];
let currentMinedCandidates = [];
let activeEventSource = null;

// ==================== Progress Tracker ====================

/**
 * Reset all progress steps to default state
 */
function resetProgress() {
  if (!progressTracker) return;
  for (let i = 1; i <= 5; i++) {
    const step = document.getElementById(`p-step-${i}`);
    if (step) {
      step.classList.remove('active', 'done');
    }
  }
  // Reset all lines
  progressTracker.querySelectorAll('.progress-step-line').forEach(line => {
    line.classList.remove('done');
  });
}

/**
 * Activate a progress step (1-5), mark previous as done
 * @param {number} stepNum - Step number to activate (1-5)
 */
function activateProgressStep(stepNum) {
  if (!progressTracker) return;
  const lines = progressTracker.querySelectorAll('.progress-step-line');

  for (let i = 1; i <= 5; i++) {
    const step = document.getElementById(`p-step-${i}`);
    if (!step) continue;

    if (i < stepNum) {
      step.classList.remove('active');
      step.classList.add('done');
    } else if (i === stepNum) {
      step.classList.add('active');
      step.classList.remove('done');
    } else {
      step.classList.remove('active', 'done');
    }
  }

  // Mark lines before current step as done
  lines.forEach((line, idx) => {
    if (idx < stepNum - 1) {
      line.classList.add('done');
    } else {
      line.classList.remove('done');
    }
  });
}

/**
 * Parse SSE log message and update progress tracker
 * @param {string} message - Log message from backend
 */
function updateProgressFromLog(message) {
  if (!message) return;

  if (message.includes('读取种子') || message.includes('加载种子池') || (message.includes('开始挖掘') && !message.includes('生意参谋'))) {
    activateProgressStep(1);
  } else if (message.includes('AI 扩词') || message.includes('本地扩词') || message.includes('裂变') || message.includes('候选词生成') || message.includes('生意参谋关联词挖掘')) {
    activateProgressStep(2);
  } else if (message.includes('预检') || message.includes('sycm_verify') || message.includes('热度过滤') || message.includes('在线热度')) {
    activateProgressStep(3);
  } else if (message.includes('多样化采样') || message.includes('去重') || message.includes('采样') || message.includes('筛选')) {
    activateProgressStep(4);
  }
}

// ==================== Empty Seed Pool Check ====================

/**
 * Check if seed pool has any active seeds before mining
 * @returns {boolean} true if seeds exist
 */
function hasSeedPoolEntries() {
  const tbody = document.getElementById('mine-seeds-tbody');
  return tbody && tbody.children.length > 0 && !tbody.querySelector('.empty-state-inline');
}

// ==================== Form Submit Handler ====================

function resetMiningUI() {
  btnStartMine.style.display = 'block';
  btnStartMine.disabled = false;
  btnStartMine.textContent = '🚀 开始挖掘词流';
  if (btnStopMine) btnStopMine.style.display = 'none';
  activeEventSource = null;
}

formMineConfig.addEventListener('submit', (e) => {
  e.preventDefault();

  // Check seed pool first
  const seedPoolCount = document.getElementById('seed-pool-count');
  const count = seedPoolCount ? parseInt(seedPoolCount.textContent, 10) : 0;
  if (count === 0) {
    showToast('⚠️ 种子池为空，请先在上方添加种子词', 'error');
    const seedInput = document.getElementById('seed-keyword-input');
    if (seedInput) seedInput.focus();
    return;
  }

  // Toggle button visibility
  btnStartMine.style.display = 'none';
  if (btnStopMine) btnStopMine.style.display = 'block';

  // Reset & show progress
  logConsole.innerHTML = '<div class="log-line system">🚀 正在启动关键词挖掘管道...</div>';
  if (progressTracker) {
    progressTracker.style.display = 'flex';
    resetProgress();
  }

  // Reset results
  currentMinedKeywords = [];
  currentMinedCandidates = [];
  if (btnBatchGenTitle) btnBatchGenTitle.style.display = 'none';

  // Parse parameters
  const formData = new FormData(formMineConfig);
  const queryCount = formData.get('count');
  const source = formData.get('source');
  const minSearchPopularity = formData.get('minSearchPopularity');
  const sycmPrecheck = formData.get('sycmPrecheck') ? 'true' : 'false';
  const autoSeedHighTier = formData.get('autoSeedHighTier') ? 'true' : 'false';

  const queryParams = new URLSearchParams({
    count: queryCount,
    source,
    minSearchPopularity,
    sycmPrecheck,
    autoSeedHighTier
  });

  // Open SSE stream
  activeEventSource = new EventSource(`/api/mine/run?${queryParams.toString()}`);

  activeEventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'log') {
        appendLogLine(data.message, 'info');
        updateProgressFromLog(data.message);
      } else if (data.type === 'error') {
        appendLogLine(data.message, 'error');
      } else if (data.type === 'result') {
        activeEventSource.close();
        resetMiningUI();
        appendLogLine('🎉 挖掘管道已全部执行成功！', 'system');
        activateProgressStep(5);
        renderMinedCandidates(data.data);
        if (typeof updateDashboardStats === 'function') updateDashboardStats();
      }
    } catch (err) {
      appendLogLine('日志流解析异常: ' + err.message, 'error');
    }
  };

  activeEventSource.onerror = () => {
    if (activeEventSource) {
      appendLogLine('❌ 网络连接意外中断或服务器返回错误。', 'error');
      activeEventSource.close();
      resetMiningUI();
    }
  };
});

if (btnStopMine) {
  btnStopMine.addEventListener('click', () => {
    if (activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }
    appendLogLine('🛑 挖掘任务已被用户手动终止。', 'error');
    resetMiningUI();
  });
}

// ==================== Log Console ====================

function appendLogLine(message, type) {
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.textContent = message;
  logConsole.appendChild(line);
  logConsole.scrollTop = logConsole.scrollHeight;
}

// ==================== Render Mined Candidates ====================

function renderMinedCandidates(result) {
  const candidates = result.candidates || [];
  currentMinedKeywords = candidates.map(c => c.keyword);
  currentMinedCandidates = candidates;

  resultsCount.textContent = candidates.length;
  mineResultsTbody.innerHTML = '';

  if (candidates.length === 0) {
    mineResultsTbody.innerHTML = `<tr><td colspan="7" class="empty-state-cell">本次挖掘没有满足过滤要求的关键词。</td></tr>`;
    return;
  }

  candidates.forEach(item => {
    const tr = document.createElement('tr');
    const duplicatePromise = window.historyService
      ? window.historyService.findDuplicate(item).catch(() => null)
      : null;

    // Tier Badge
    let tierBadgeClass = 'badge-low';
    if (item.tier === 'high') tierBadgeClass = 'badge-high';
    else if (item.tier === 'mid') tierBadgeClass = 'badge-mid';
    const tierBadge = `<span class="badge ${tierBadgeClass}">${item.tier}</span>`;

    // Score
    const formattedScore = item.localScore != null ? item.localScore : '-';

    // Source Label
    let srcText = '💻 本地';
    if (item.source === 'ai') srcText = '🤖 AI';
    else if (item.source === 'sycm_hot') srcText = '📈 参谋热词';
    else if (item.source === 'sycm_blue') srcText = '🌊 参谋蓝海';
    else if (item.source === 'hybrid') srcText = '🔀 混合模式';

    const gate = workflowGateMeta(item);

    // SYCM Metrics Subtext
    let subtext = '';
    if (item.sycmData) {
      const pop = item.sycmData.searchPopularity || 0;
      const ratio = item.sycmData.demandSupplyRatio != null ? item.sycmData.demandSupplyRatio : '-';
      subtext = `<div class="sub-details" style="font-size: 11px; color: rgba(255, 255, 255, 0.45); margin-top: 2px;">🔥 人气: ${pop} | ⚖️ 供需: ${ratio}</div>`;
    }

    tr.innerHTML = `
      <td class="td-checkbox"><input type="checkbox" class="kw-checkbox" data-keyword="${escapeHtml(item.keyword)}"></td>
      <td>
        <div class="keyword-cell-main">
          <strong>${escapeHtml(item.keyword)}</strong>
        </div>
        ${subtext}
      </td>
      <td style="font-family: var(--font-display); font-weight: 500;">${formattedScore}</td>
      <td>${tierBadge}</td>
      <td>
        <span class="badge ${gate.className}">${gate.label}</span>
        <div class="gate-reason">${escapeHtml(gate.reason)}</div>
      </td>
      <td style="font-size: 12px;">${srcText}</td>
      <td class="action-cell"></td>
    `;

    const actionCell = tr.querySelector('.action-cell');

    // Copy Button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-secondary btn-sm';
    copyBtn.style.marginRight = '4px';
    copyBtn.textContent = '📋';
    copyBtn.title = '复制关键词';
    copyBtn.addEventListener('click', () => copyText(item.keyword));

    // Go to Title Gen Button
    const genBtn = document.createElement('button');
    genBtn.className = 'btn btn-primary btn-sm';
    genBtn.textContent = '✍️ 生成';
    genBtn.title = '跳转到标题生成';
    genBtn.addEventListener('click', () => sendToTitleGen(item));

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'btn btn-secondary btn-sm';
    rejectBtn.textContent = '排除';
    rejectBtn.title = '将该词加入近期拒绝冷却';
    rejectBtn.addEventListener('click', async () => {
      if (!window.historyService) return;
      await window.historyService.markRejected(item, '用户在挖词表手动排除');
      tr.classList.add('row-muted');
      showToast(`已排除「${item.keyword}」`);
    });

    actionCell.appendChild(copyBtn);
    actionCell.appendChild(genBtn);
    actionCell.appendChild(rejectBtn);

    mineResultsTbody.appendChild(tr);
    if (duplicatePromise) {
      duplicatePromise.then(dup => renderDuplicateBadge(tr, dup));
    }
  });

  // Show batch action button
  if (btnBatchGenTitle && candidates.length > 0) {
    btnBatchGenTitle.style.display = 'inline-flex';
  }

  // Update checkbox states
  updateBatchButtonState();

  if (window.historyService) {
    window.historyService.recordCandidates(candidates).catch(err => {
      console.warn('记录候选词历史失败:', err.message);
    });
  }
}

function renderDuplicateBadge(tr, duplicate) {
  if (!duplicate || !duplicate.duplicate) return;
  const keywordCell = tr.querySelector('.keyword-cell-main');
  if (!keywordCell) return;
  const badge = document.createElement('span');
  badge.className = 'duplicate-badge';
  const labels = {
    recent_rejected_signature: '近期拒绝',
    recent_distributed_signature: '近期铺货',
    recent_generated_signature: '近期生成',
    recent_signature: '近期出现'
  };
  badge.textContent = labels[duplicate.reason] || '历史命中';
  keywordCell.appendChild(badge);
}

function workflowGateMeta(item) {
  const status = item.gateStatus || (item.canDistribute ? 'verified' : 'candidate');
  const labels = {
    candidate: '待验真',
    verified: '已验真',
    review: '待复核',
    rejected: '已拒绝'
  };
  const classes = {
    candidate: 'badge-candidate',
    verified: 'badge-verified',
    review: 'badge-review',
    rejected: 'badge-rejected'
  };
  return {
    label: labels[status] || status,
    className: classes[status] || 'badge-low',
    reason: item.gateReason || (item.canDistribute ? '可进入待确认铺货' : '需验真后才能铺货')
  };
}

// ==================== Batch Selection ====================

/** Select/deselect all checkboxes */
if (selectAllKws) {
  selectAllKws.addEventListener('change', () => {
    const checked = selectAllKws.checked;
    document.querySelectorAll('.kw-checkbox').forEach(cb => {
      cb.checked = checked;
    });
    updateBatchButtonState();
  });
}

/** Listen for individual checkbox changes (event delegation) */
if (mineResultsTbody) {
  mineResultsTbody.addEventListener('change', (e) => {
    if (e.target.classList.contains('kw-checkbox')) {
      updateBatchButtonState();
    }
  });
}

function updateBatchButtonState() {
  const checked = document.querySelectorAll('.kw-checkbox:checked');
  if (btnBatchGenTitle) {
    const count = checked.length;
    if (count > 0) {
      btnBatchGenTitle.textContent = `✍️ 批量生成 (${count})`;
      btnBatchGenTitle.style.display = 'inline-flex';
    } else {
      btnBatchGenTitle.style.display = currentMinedKeywords.length > 0 ? 'inline-flex' : 'none';
      btnBatchGenTitle.textContent = '✍️ 批量生成标题';
    }
  }
}

/** Batch generate: send first selected keyword to title gen */
if (btnBatchGenTitle) {
  btnBatchGenTitle.addEventListener('click', () => {
    const checked = document.querySelectorAll('.kw-checkbox:checked');
    if (checked.length === 0) {
      showToast('⚠️ 请先勾选要生成标题的关键词', 'error');
      return;
    }
    // Send first selected keyword to title gen
    const keyword = checked[0].getAttribute('data-keyword');
    const candidate = currentMinedCandidates.find(item => item.keyword === keyword) || { keyword };
    sendToTitleGen(candidate);
    showToast(`📍 已导入「${keyword}」到标题生成，共勾选 ${checked.length} 个词`);
  });
}

// ==================== Navigation ====================

function sendToTitleGen(candidateOrKeyword) {
  const candidate = typeof candidateOrKeyword === 'string'
    ? { keyword: candidateOrKeyword }
    : (candidateOrKeyword || {});
  const keyword = candidate.keyword || '';
  const titleKwInput = document.getElementById('title-keyword');
  if (titleKwInput) {
    titleKwInput.value = keyword;
  }
  // Set source indicator
  window._titleSourceKeyword = keyword;
  window._titleSourceCandidate = candidate;
  window.location.hash = 'title';
  if (typeof window.setWorkflowStage === 'function') {
    window.setWorkflowStage(candidate.canDistribute ? 'verified' : 'candidate');
  }
}

// ==================== Copy All Keywords ====================

if (btnCopyAllKws) {
  btnCopyAllKws.addEventListener('click', () => {
    if (currentMinedKeywords.length === 0) {
      showToast('⚠️ 还没有挖掘结果', 'error');
      return;
    }
    const rawList = currentMinedKeywords.join('\n');
    copyText(rawList);
  });
}

// ==================== Core Root Miner Widget ====================

const btnTabPeer = document.getElementById('btn-tab-peer');
const btnTabOpp = document.getElementById('btn-tab-opp');
const btnTabSycmMarket = document.getElementById('btn-tab-sycm-market');
const minerPeerInput = document.getElementById('miner-peer-input');
const minerInputLabel = document.getElementById('miner-input-label');
const btnRunMiner = document.getElementById('btn-run-miner');
const minerResultsArea = document.getElementById('miner-results-area');
const minerChipsContainer = document.getElementById('miner-chips-container');

let activeMinerTab = 'peer'; // 'peer' | 'opp' | 'sycm-market'

function switchMinerTab(tab) {
  activeMinerTab = tab;

  // Update active button state
  btnTabPeer.classList.toggle('active', tab === 'peer');
  btnTabOpp.classList.toggle('active', tab === 'opp');
  btnTabSycmMarket.classList.toggle('active', tab === 'sycm-market');

  // Update form inputs and labels
  if (tab === 'peer') {
    minerInputLabel.style.display = 'block';
    minerInputLabel.textContent = '输入同行关键词或淘宝商品链接：';
    minerPeerInput.style.display = 'block';
    minerPeerInput.placeholder = '例如：防晒女款 或 粘贴淘宝商品地址';
    btnRunMiner.textContent = '🚀 提取并验真词根';
  } else if (tab === 'opp') {
    minerInputLabel.style.display = 'block';
    minerInputLabel.textContent = '自动分析全网 1688 最新爆款商机，提取热门品类词：';
    minerPeerInput.style.display = 'none';
    btnRunMiner.textContent = '🚀 分析爆款商机';
  } else if (tab === 'sycm-market') {
    minerInputLabel.style.display = 'block';
    minerInputLabel.textContent = '输入行业大类目词或大品类词（查询参参关联词）：';
    minerPeerInput.style.display = 'block';
    minerPeerInput.placeholder = '例如：项链 或 服饰配件';
    btnRunMiner.textContent = '🚀 抓取关联热词';
  }
}

if (btnTabPeer) btnTabPeer.addEventListener('click', () => switchMinerTab('peer'));
if (btnTabOpp) btnTabOpp.addEventListener('click', () => switchMinerTab('opp'));
if (btnTabSycmMarket) btnTabSycmMarket.addEventListener('click', () => switchMinerTab('sycm-market'));

if (btnRunMiner) {
  btnRunMiner.addEventListener('click', async () => {
    const keyword = minerPeerInput ? minerPeerInput.value.trim() : '';
    if (activeMinerTab !== 'opp' && !keyword) {
      showToast('⚠️ 请先输入关键词', 'error');
      return;
    }

    btnRunMiner.disabled = true;
    const originalText = btnRunMiner.textContent;
    btnRunMiner.textContent = '⏳ 正在挖掘验证中...';

    if (minerResultsArea) minerResultsArea.style.display = 'none';
    if (minerChipsContainer) minerChipsContainer.innerHTML = '';

    try {
      let url = '/api/miner/peer';
      let body = { keyword };
      if (activeMinerTab === 'opp') {
        url = '/api/miner/opportunities';
        body = {};
      } else if (activeMinerTab === 'sycm-market') {
        url = '/api/miner/sycm-market';
        body = { keyword };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const payload = await res.json();

      if (!payload.ok) {
        throw new Error(payload.error || '请求失败');
      }

      const list = payload.data || [];
      if (payload.warning) {
        showToast(payload.warning, 'info', 5000);
      }
      if (list.length === 0) {
        showToast('📭 未挖掘到符合热度要求的词根', 'info');
      } else {
        renderMinerChips(list);
      }
    } catch (err) {
      showToast(`挖掘异常: ${err.message}`, 'error');
    } finally {
      btnRunMiner.disabled = false;
      btnRunMiner.textContent = originalText;
    }
  });
}

function renderMinerChips(list) {
  if (!minerChipsContainer || !minerResultsArea) return;
  minerChipsContainer.innerHTML = '';

  list.forEach(item => {
    const chip = document.createElement('div');
    chip.className = 'chip-item';
    chip.style.cssText = `
      display: inline-flex;
      align-items: center;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 20px;
      padding: 4px 10px 4px 12px;
      font-size: 12px;
      color: var(--text-primary);
      gap: 6px;
    `;

    let info = '';
    if (item.searchPopularity) {
      info = ` (人气: ${item.searchPopularity})`;
    } else if (item.count) {
      info = ` (词频: ${item.count})`;
    }

    chip.innerHTML = `
      <span><strong>${escapeHtml(item.word)}</strong>${info}</span>
      <button class="btn-chip-add" style="
        background: none;
        border: none;
        color: var(--accent-blue);
        cursor: pointer;
        padding: 0;
        font-size: 13px;
        line-height: 1;
        outline: none;
        display: flex;
        align-items: center;
        justify-content: center;
      " title="导入种子池">➕</button>
    `;

    const addBtn = chip.querySelector('.btn-chip-add');
    addBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      addBtn.disabled = true;
      const success = await addSeedDirectly(item.word);
      if (success) {
        chip.style.opacity = '0.5';
        addBtn.textContent = '✓';
        addBtn.style.color = '#10b981';
      } else {
        addBtn.disabled = false;
      }
    });

    minerChipsContainer.appendChild(chip);
  });

  minerResultsArea.style.display = 'block';
}

async function addSeedDirectly(keyword) {
  try {
    const res = await fetch('/api/seeds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyword: keyword,
        category: '',
        priority: 5,
        type: 'expand'
      })
    });
    const payload = await res.json();
    if (payload.ok) {
      showToast(`🌱 已成功导入种子池：「${keyword}」`);
      if (typeof window.loadMineSeedsTable === 'function') {
        window.loadMineSeedsTable();
      }
      if (typeof updateDashboardStats === 'function') {
        updateDashboardStats();
      }
      return true;
    } else {
      showToast(`导入失败: ${payload.error}`, 'error');
      return false;
    }
  } catch (err) {
    showToast(`请求异常: ${err.message}`, 'error');
    return false;
  }
}
