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

async function loadWorkflowBatches() {
  const container = document.getElementById('workflow-batch-content');
  if (!container) return;
  try {
    const res = await fetch('/api/workflow/batches');
    const payload = await res.json();
    if (!payload.ok) throw new Error(payload.error || '读取失败');
    renderWorkflowBatch(payload.data && payload.data.latest);
  } catch (err) {
    container.innerHTML = `<div class="workflow-danger">读取自动化批次失败：${escapeHtml(err.message)}</div>`;
  }
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

  const statusClass = batch.requiresReview ? 'badge-review' : batch.batchCount > 0 ? 'badge-verified' : 'badge-low';
  const statusLabel = batch.requiresReview ? '需复核' : batch.batchCount > 0 ? '可检查' : '无推荐';
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
    <details class="workflow-review-preview">
      <summary>查看复核报告预览</summary>
      <pre>${escapeHtml(batch.reviewPreview || '暂无报告内容')}</pre>
    </details>
  `;
}

window.loadWorkflowBatches = loadWorkflowBatches;

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

// ==================== Event Listeners ====================

window.addEventListener('hashchange', handleRouting);
window.addEventListener('load', () => {
  handleRouting();
  updateDashboardStats();
  loadWorkflowBatches();
  window.setWorkflowStage(window.appState.workflowStage);
});
