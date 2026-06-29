'use strict';

// ==================== Global Utilities ====================

/** HTML escaping helper (shared across all modules) */
window.escapeHtml = function(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

/** Toast notification system (replaces alert for non-destructive feedback) */
window.showToast = function(message, type = 'success', duration = 2500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-exit');
    toast.addEventListener('animationend', () => toast.remove());
  }, duration);
};

/** Clipboard copy with toast feedback */
window.copyText = function(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('✅ 已复制到剪贴板');
  }).catch(err => {
    showToast('❌ 复制失败: ' + err.message, 'error');
  });
};

// ==================== Global State ====================

window.appState = {
  status: null,
  activeTab: 'dashboard',
  workflowStage: 'candidate'
};

const WORKFLOW_ORDER = ['candidate', 'verified', 'generated', 'pending_review', 'submitted'];
const WORKBENCH_STAGE_LABELS = {
  candidate: '候选词',
  verified: '大盘验真',
  generated: '标题货源',
  pending_review: '待确认铺货',
  submitted: '已提交'
};
const WORKBENCH_POLL_ATTEMPTS = 6;
const WORKBENCH_POLL_INTERVAL_MS = 2000;
let workbenchPollTimer = null;

window.setWorkflowStage = function(stage) {
  const nextStage = WORKFLOW_ORDER.includes(stage) ? stage : 'candidate';
  window.appState.workflowStage = nextStage;
  const activeIndex = WORKFLOW_ORDER.indexOf(nextStage);
  document.querySelectorAll('[data-workflow-step]').forEach(step => {
    const stepIndex = WORKFLOW_ORDER.indexOf(step.getAttribute('data-workflow-step'));
    step.classList.toggle('active', stepIndex === activeIndex);
    step.classList.toggle('done', stepIndex >= 0 && stepIndex < activeIndex);
  });
};

// ==================== Tab Router (3 tabs) ====================

const navItems = document.querySelectorAll('.nav-item');
const sections = document.querySelectorAll('.content-section');

function handleRouting() {
  const hash = window.location.hash.slice(1) || 'dashboard';
  const validTabs = ['dashboard', 'mine', 'title'];
  const tab = validTabs.includes(hash) ? hash : 'dashboard';

  let targetSection = document.getElementById(`sec-${tab}`);
  if (!targetSection) {
    targetSection = document.getElementById('sec-dashboard');
    window.location.hash = 'dashboard';
    return;
  }

  // Update navigation items
  navItems.forEach(item => {
    if (item.getAttribute('href') === `#${tab}`) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Update sections
  sections.forEach(sec => {
    if (sec.id === `sec-${tab}`) {
      sec.classList.add('active');
    } else {
      sec.classList.remove('active');
    }
  });

  window.appState.activeTab = tab;

  // Tab-specific activations
  if (tab === 'dashboard') {
    window.setWorkflowStage('candidate');
    updateDashboardStats();
    loadWorkbenchRuns();
    loadWorkflowBatches();
  } else if (tab === 'mine' && typeof window.loadMineSeedsTable === 'function') {
    window.setWorkflowStage('candidate');
    window.loadMineSeedsTable();
  } else if (tab === 'title') {
    const sourceCandidate = window._titleSourceCandidate || null;
    if (sourceCandidate && sourceCandidate.canDistribute) {
      window.setWorkflowStage('verified');
    } else if (sourceCandidate) {
      window.setWorkflowStage('candidate');
    } else {
      window.setWorkflowStage(window.appState.workflowStage === 'generated' ? 'generated' : 'candidate');
    }
  }
}

// ==================== Dashboard Stats ====================

async function updateDashboardStats() {
  try {
    const res = await fetch('/api/status');
    const payload = await res.json();
    if (payload.ok) {
      const data = payload.data;
      window.appState.status = data;

      // Update indicator dots
      const glmDot = document.getElementById('env-glm');
      const aliDot = document.getElementById('env-ali');
      if (glmDot) glmDot.className = `indicator-dot ${data.env.hasGlmKey ? 'active' : 'inactive'}`;
      if (aliDot) aliDot.className = `indicator-dot ${data.env.hasAliKey ? 'active' : 'inactive'}`;

      // Update stat counters safely
      const setStatSafe = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };
      setStatSafe('stat-seeds', data.files.seedsCount);
      setStatSafe('stat-seen', data.files.seenCount);
      setStatSafe('stat-rejected', data.files.rejectedCount);
      setStatSafe('stat-cache', data.files.cacheCount);
    }
  } catch (err) {
    console.error('获取系统状态失败:', err);
  }
}

window.updateDashboardStats = updateDashboardStats;

function mapWorkbenchStageToFunnel(stage) {
  const normalized = String(stage || '').toLowerCase();
  if (normalized === 'seed' || normalized === 'mined') return 'candidate';
  if (normalized === 'verified') return 'verified';
  if (normalized === 'generated') return 'generated';
  if (normalized === 'review' || normalized === 'ready') return 'pending_review';
  if (normalized === 'submitted') return 'submitted';
  return 'candidate';
}

function formatWorkbenchCount(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function renderWorkbenchCounts(counts = {}, batchCount = 0) {
  const items = [
    ['候选', counts.candidates],
    ['验真', counts.verifiedKeywords],
    ['生成', counts.generatedProducts],
    ['待复核', counts.reviewCandidates],
    ['可提交', counts.readyToDistribute || batchCount]
  ];
  return items.map(([label, value]) => `
    <span>${escapeHtml(label)} <strong>${formatWorkbenchCount(value)}</strong></span>
  `).join('');
}

function renderWorkbenchFiles(run) {
  const files = [];
  if (run.batchFile) files.push(['批次文件', run.batchFile]);
  if (run.reviewFile) files.push(['复核报告', run.reviewFile]);
  if (run.files) {
    ['candidates', 'verifiedKeywords', 'generatedProducts'].forEach(key => {
      if (run.files[key]) files.push([key, run.files[key]]);
    });
  }
  if (files.length === 0) return '';
  return `
    <div class="workbench-files">
      ${files.map(([label, file]) => `<div>${escapeHtml(label)}：<code>${escapeHtml(file)}</code></div>`).join('')}
    </div>
  `;
}

function renderWorkbenchActionWarning(run) {
  if (!run.requiresUserAction && !run.userMessage && !(run.blockers || []).length && !run.nextCommand) return '';
  const blockers = Array.isArray(run.blockers) ? run.blockers : [];
  return `
    <div class="workbench-action-warning">
      ${run.userMessage ? `<div><strong>需要处理：</strong>${escapeHtml(run.userMessage)}</div>` : ''}
      ${blockers.length ? `<div><strong>阻塞项：</strong>${blockers.map(escapeHtml).join('、')}</div>` : ''}
      ${run.nextCommand ? `<div><strong>下一步：</strong><code>${escapeHtml(run.nextCommand)}</code></div>` : ''}
    </div>
  `;
}

function renderWorkbenchReviewPreview(run) {
  const reviewPreview = run.reviewPreview || (run.previews && run.previews.distributionReview) || '';
  const generated = run.previews && Array.isArray(run.previews.generatedProducts) ? run.previews.generatedProducts.slice(0, 3) : [];
  if (!reviewPreview && generated.length === 0) return '';
  return `
    <div class="workbench-review-grid">
      ${generated.length ? `
        <div>
          <h5>商品预览</h5>
          ${generated.map(item => `
            <div class="workbench-review-item">
              <strong>${escapeHtml(item.keyword || item.blueOceanWord || item.title || '商品')}</strong>
              <span>${escapeHtml(item.productTitle || item['链接原标题'] || item.title || '')}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${reviewPreview ? `
        <details class="workflow-review-preview workbench-review-preview">
          <summary>查看复核报告预览</summary>
          <pre>${escapeHtml(reviewPreview)}</pre>
        </details>
      ` : ''}
    </div>
  `;
}

function renderWorkbenchLatestRun(run) {
  const container = document.getElementById('workbench-run-summary');
  if (!container) return;
  if (!run) {
    container.innerHTML = `
      <div class="workflow-empty">
        <strong>暂无每日流程记录</strong>
        <span>启动 daily 或 keyword 模式后，这里会显示运行状态和下一步。</span>
      </div>
    `;
    return;
  }

  const funnelStage = mapWorkbenchStageToFunnel(run.stage);
  const statusClass = run.requiresUserAction ? 'badge-review' : run.status === 'workflow_complete' ? 'badge-verified' : 'badge-candidate';
  if (typeof window.setWorkflowStage === 'function') window.setWorkflowStage(funnelStage);

  container.innerHTML = `
    <div class="workbench-latest-summary">
      <div class="workbench-run-heading">
        <span class="badge ${statusClass}">${escapeHtml(run.status || 'unknown')}</span>
        <strong>${escapeHtml(run.runId || '-')}</strong>
      </div>
      <div class="workbench-stage-strip" aria-label="当前流程阶段">
        ${WORKFLOW_ORDER.map(stage => `
          <span class="${stage === funnelStage ? 'active' : ''}">${escapeHtml(WORKBENCH_STAGE_LABELS[stage])}</span>
        `).join('')}
      </div>
      <div class="workflow-batch-meta">
        阶段 ${escapeHtml(run.stage || '-')} · 更新 ${escapeHtml(run.updatedAt || run.startedAt || '-')}
      </div>
      <div class="workflow-batch-counts workbench-counts">
        ${renderWorkbenchCounts(run.counts || {}, run.batchCount)}
      </div>
      ${renderWorkbenchActionWarning(run)}
      ${renderWorkbenchFiles(run)}
      ${renderWorkbenchReviewPreview(run)}
    </div>
  `;
}

function renderWorkbenchRunList(runs) {
  const container = document.getElementById('workbench-run-list');
  if (!container) return;
  if (!Array.isArray(runs) || runs.length === 0) {
    container.innerHTML = '<div class="workflow-empty"><strong>暂无最近运行</strong><span>运行记录会按更新时间倒序显示。</span></div>';
    return;
  }
  container.innerHTML = `
    <div class="workbench-run-list">
      ${runs.map(run => {
        const stage = mapWorkbenchStageToFunnel(run.stage);
        const label = WORKBENCH_STAGE_LABELS[stage] || stage;
        return `
          <div class="workbench-run-list-item">
            <div>
              <strong>${escapeHtml(run.runId || '-')}</strong>
              <span>${escapeHtml(run.status || 'unknown')} · ${escapeHtml(run.updatedAt || run.startedAt || '-')}</span>
            </div>
            <span class="badge ${run.requiresUserAction ? 'badge-review' : 'badge-low'}">${escapeHtml(label)}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

async function loadWorkbenchRuns() {
  const summary = document.getElementById('workbench-run-summary');
  const list = document.getElementById('workbench-run-list');
  try {
    const res = await fetch('/api/workbench/runs?limit=10');
    const payload = await res.json();
    if (!payload.ok) throw new Error(payload.error || '读取失败');
    const data = payload.data || {};
    const runs = Array.isArray(data.runs) ? data.runs : [];
    const latest = data.latest || runs[0] || null;
    renderWorkbenchLatestRun(latest);
    renderWorkbenchRunList(runs);
  } catch (err) {
    const message = escapeHtml(err.message);
    if (summary) summary.innerHTML = `<div class="workflow-danger">读取每日流程失败：${message}</div>`;
    if (list) list.innerHTML = `<div class="workflow-danger">读取最近运行失败：${message}</div>`;
  }
}

async function loadWorkflowBatches() {
  const container = document.getElementById('workflow-batch-content');
  if (!container) return;
  try {
    const res = await fetch('/api/workflow/batches?limit=10');
    const payload = await res.json();
    if (!payload.ok) throw new Error(payload.error || '读取失败');
    const data = payload.data || {};
    const runs = Array.isArray(data.runs) ? data.runs : [];
    renderWorkflowBatch(findLatestDistributionBatch(data.latest, runs));
  } catch (err) {
    container.innerHTML = `<div class="workflow-danger">读取自动化批次失败：${escapeHtml(err.message)}</div>`;
  }
}

function isDistributionBatchState(batch) {
  if (!batch) return false;
  const status = String(batch.status || '');
  const counts = batch.counts || {};
  const distributionStatuses = ['needs_review', 'ready_to_distribute', 'export_empty', 'awaiting_user_confirmation'];
  return distributionStatuses.includes(status) ||
    Boolean(batch.requiresReview || batch.mustReview) ||
    Number(batch.batchCount || 0) > 0 ||
    Number(counts.readyToDistribute || 0) > 0 ||
    Number(counts.reviewCandidates || 0) > 0;
}

function findLatestDistributionBatch(latest, runs) {
  if (isDistributionBatchState(latest)) return latest;
  return runs.find(isDistributionBatchState) || null;
}

function renderWorkflowBatch(batch) {
  const container = document.getElementById('workflow-batch-content');
  if (!container) return;
  if (!batch) {
    container.innerHTML = `
      <div class="workflow-empty">
        <strong>暂无待复核批次</strong>
        <span>每日 flow 跑完后，这里会显示 distribution-review.md 和 distribution-batch.txt 的摘要。</span>
      </div>
    `;
    return;
  }

  const requiresReview = Boolean(
    batch.requiresReview ||
    batch.mustReview ||
    batch.status === 'needs_review' ||
    Number((batch.counts || {}).reviewCandidates || 0) > 0
  );
  const statusClass = requiresReview ? 'badge-review' : batch.batchCount > 0 ? 'badge-verified' : 'badge-low';
  const statusLabel = requiresReview ? '需处理' : batch.batchCount > 0 ? '可检查' : '无推荐';
  const counts = batch.counts || {};
  if (batch.batchCount > 0 && typeof window.setWorkflowStage === 'function') {
    window.setWorkflowStage('pending_review');
  }

  container.innerHTML = `
    <div class="workflow-batch-summary">
      <div>
        <div class="workflow-batch-title">
          <span class="badge ${statusClass}">${statusLabel}</span>
          <strong>${escapeHtml(batch.runId)}</strong>
        </div>
        <div class="workflow-batch-meta">
          状态 ${escapeHtml(batch.status)} · 更新 ${escapeHtml(batch.updatedAt || '-')}
        </div>
      </div>
      <div class="workflow-batch-counts">
        <span>推荐提交 <strong>${batch.batchCount || counts.readyToDistribute || 0}</strong></span>
        <span>人工复核 <strong>${counts.reviewCandidates || 0}</strong></span>
        <span>硬拒绝 <strong>${counts.rejectedBeforeDistribution || 0}</strong></span>
      </div>
    </div>
    <div class="workflow-batch-files">
      <div>批次文件：<code>${escapeHtml(batch.batchFile || '-')}</code></div>
      <div>复核报告：<code>${escapeHtml(batch.reviewFile || '-')}</code></div>
    </div>
    ${renderWorkbenchActionWarning(batch)}
    <details class="workflow-review-preview">
      <summary>查看复核报告预览</summary>
      <pre>${escapeHtml(batch.reviewPreview || (batch.previews && batch.previews.distributionReview) || '暂无报告内容')}</pre>
    </details>
  `;
}

window.loadWorkflowBatches = loadWorkflowBatches;
window.loadWorkbenchRuns = loadWorkbenchRuns;

function readPositiveNumber(id) {
  const el = document.getElementById(id);
  if (!el) return undefined;
  const num = Number(el.value);
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

function setWorkbenchKeywordVisibility() {
  const mode = document.getElementById('workbench-mode')?.value || 'daily';
  const field = document.getElementById('workbench-keyword-field');
  const input = document.getElementById('workbench-keyword');
  if (field) field.classList.toggle('is-hidden', mode !== 'keyword');
  if (input) input.required = mode === 'keyword';
}

function stopWorkbenchPolling() {
  if (workbenchPollTimer) {
    clearTimeout(workbenchPollTimer);
    workbenchPollTimer = null;
  }
}

function startWorkbenchPolling(attempts = WORKBENCH_POLL_ATTEMPTS) {
  stopWorkbenchPolling();
  let remaining = attempts;
  const poll = async () => {
    await loadWorkbenchRuns();
    await loadWorkflowBatches();
    remaining -= 1;
    if (remaining > 0) {
      workbenchPollTimer = setTimeout(poll, WORKBENCH_POLL_INTERVAL_MS);
    } else {
      workbenchPollTimer = null;
    }
  };
  workbenchPollTimer = setTimeout(poll, WORKBENCH_POLL_INTERVAL_MS);
}

function renderWorkbenchStartingState(mode, data) {
  const container = document.getElementById('workbench-run-summary');
  if (!container) return;
  const pid = data && data.pid ? data.pid : '';
  container.innerHTML = `
    <div class="workbench-starting-state">
      <div class="workbench-run-heading">
        <span class="badge badge-active">starting</span>
        <strong>${escapeHtml(mode)} 流程已提交</strong>
      </div>
      <div class="workflow-batch-meta">
        后台流程正在启动${pid ? ` · pid ${escapeHtml(pid)}` : ''}。系统会在接下来几秒自动刷新最新运行。
      </div>
    </div>
  `;
}

async function startWorkbenchRun(evt) {
  evt.preventDefault();
  const btn = document.getElementById('btn-start-workbench-run');
  const mode = document.getElementById('workbench-mode')?.value === 'keyword' ? 'keyword' : 'daily';
  const keyword = (document.getElementById('workbench-keyword')?.value || '').trim();
  if (mode === 'keyword' && !keyword) {
    showToast('keyword 模式需要填写关键词', 'error');
    document.getElementById('workbench-keyword')?.focus();
    return;
  }

  const payload = {
    mode,
    keyword,
    mine: readPositiveNumber('workbench-mine'),
    verify: readPositiveNumber('workbench-verify'),
    generate: readPositiveNumber('workbench-generate'),
    export: readPositiveNumber('workbench-export'),
    productsPerKeyword: readPositiveNumber('workbench-products-per-keyword'),
    length: readPositiveNumber('workbench-length'),
    port: readPositiveNumber('workbench-port'),
    pages: readPositiveNumber('workbench-pages')
  };

  if (btn) {
    btn.disabled = true;
    btn.textContent = '启动中...';
  }
  try {
    const res = await fetch('/api/workbench/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      if (res.status === 409) {
        showToast(data.error || '已有流程正在运行', 'error', 4000);
        await loadWorkbenchRuns();
        await loadWorkflowBatches();
        return;
      }
      throw new Error(data.error || '启动失败');
    }
    stopWorkbenchPolling();
    renderWorkbenchStartingState(mode, data.data || {});
    showToast('每日流程已启动，稍后刷新状态');
    startWorkbenchPolling();
  } catch (err) {
    showToast('启动流程失败: ' + err.message, 'error', 4000);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '启动每日流程';
    }
  }
}

// ==================== Quick Start Buttons ====================

document.getElementById('btn-goto-mine')?.addEventListener('click', () => {
  window.location.hash = 'mine';
  setTimeout(() => {
    const seedInput = document.getElementById('seed-keyword-input');
    if (seedInput) seedInput.focus();
  }, 100);
});

document.getElementById('btn-goto-title')?.addEventListener('click', () => {
  window.location.hash = 'title';
  setTimeout(() => {
    const kwInput = document.getElementById('title-keyword');
    if (kwInput) kwInput.focus();
  }, 100);
});

// ==================== Cache Cleanup (No inline onclick) ====================

document.querySelectorAll('[data-clean-type]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const type = btn.getAttribute('data-clean-type');
    if (!confirm(`确认清空 ${type} 对应的本地数据文件吗？该操作不可逆！`)) {
      return;
    }
    try {
      const res = await fetch('/api/config/clean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
      });
      const data = await res.json();
      if (data.ok) {
        showToast('🧹 ' + (data.message || '清理成功'));
        updateDashboardStats();
      } else {
        showToast('清除失败: ' + data.error, 'error');
      }
    } catch (err) {
      showToast('清除异常: ' + err.message, 'error');
    }
  });
});

document.getElementById('btn-refresh-batches')?.addEventListener('click', () => {
  loadWorkflowBatches();
});

document.getElementById('workbench-mode')?.addEventListener('change', setWorkbenchKeywordVisibility);
document.getElementById('form-workbench-run')?.addEventListener('submit', startWorkbenchRun);
setWorkbenchKeywordVisibility();

// ==================== Event Listeners ====================

window.addEventListener('hashchange', handleRouting);
window.addEventListener('load', () => {
  handleRouting();
  updateDashboardStats();
  loadWorkbenchRuns();
  loadWorkflowBatches();
  window.setWorkflowStage(window.appState.workflowStage);
});
