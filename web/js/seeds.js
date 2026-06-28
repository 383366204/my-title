'use strict';

// ==================== Seed Pool Management ====================
// Operates on the seed table embedded in the Mining page (#mine-seeds-tbody)

const mineSeedsTbody = document.getElementById('mine-seeds-tbody');
const formAddSeed = document.getElementById('form-add-seed');
const seedsEmptyState = document.getElementById('seeds-empty-state');
const seedPoolCount = document.getElementById('seed-pool-count');

/**
 * Load and render seeds from API into the mining page's seed pool table.
 */
async function loadMineSeedsTable() {
  try {
    const res = await fetch('/api/seeds');
    const payload = await res.json();
    if (payload.ok) {
      renderSeedsCompact(payload.data);
    } else {
      console.error('加载种子失败:', payload.error);
    }
  } catch (err) {
    console.error('加载种子请求异常:', err);
  }
}

/**
 * Render seeds in compact 4-column layout: 种子词 | 分数 | 状态 | 操作
 * @param {Array} seeds - Array of seed objects
 */
function renderSeedsCompact(seeds) {
  mineSeedsTbody.innerHTML = '';

  if (seedPoolCount) seedPoolCount.textContent = seeds.length;

  if (seeds.length === 0) {
    if (seedsEmptyState) seedsEmptyState.style.display = 'block';
    return;
  }

  if (seedsEmptyState) seedsEmptyState.style.display = 'none';

  seeds.forEach(seed => {
    const tr = document.createElement('tr');
    const isPaused = seed.status === 'paused';
    const statusBadge = isPaused
      ? '<span class="badge badge-paused">暂停</span>'
      : '<span class="badge badge-active">活跃</span>';

    tr.innerHTML = `
      <td><strong>${escapeHtml(seed.keyword)}</strong></td>
      <td style="font-family: var(--font-display); font-weight: 500;">${seed.priorityScore || seed.priority}</td>
      <td>${statusBadge}</td>
      <td class="action-cell"></td>
    `;

    const actionCell = tr.querySelector('.action-cell');

    // Toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn btn-secondary btn-sm';
    toggleBtn.style.marginRight = '4px';
    toggleBtn.textContent = isPaused ? '▶️' : '⏸️';
    toggleBtn.title = isPaused ? '恢复' : '暂停';
    toggleBtn.addEventListener('click', () => toggleSeed(seed.keyword));

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger btn-sm';
    deleteBtn.textContent = '🗑️';
    deleteBtn.title = '删除';
    deleteBtn.addEventListener('click', () => deleteSeed(seed.keyword));

    actionCell.appendChild(toggleBtn);
    actionCell.appendChild(deleteBtn);

    mineSeedsTbody.appendChild(tr);
  });
}

/**
 * Toggle seed active/paused status
 * @param {string} keyword
 */
async function toggleSeed(keyword) {
  try {
    const res = await fetch(`/api/seeds/${encodeURIComponent(keyword)}/toggle`, {
      method: 'POST'
    });
    const payload = await res.json();
    if (payload.ok) {
      loadMineSeedsTable();
      if (typeof updateDashboardStats === 'function') updateDashboardStats();
    } else {
      showToast('操作失败: ' + payload.error, 'error');
    }
  } catch (err) {
    showToast('请求异常: ' + err.message, 'error');
  }
}

/**
 * Delete a seed from the pool
 * @param {string} keyword
 */
async function deleteSeed(keyword) {
  if (!confirm(`确定要删除种子词「${keyword}」吗？`)) return;
  try {
    const res = await fetch(`/api/seeds/${encodeURIComponent(keyword)}`, {
      method: 'DELETE'
    });
    const payload = await res.json();
    if (payload.ok) {
      showToast(`🗑️ 已删除种子词「${keyword}」`);
      loadMineSeedsTable();
      if (typeof updateDashboardStats === 'function') updateDashboardStats();
    } else {
      showToast('删除失败: ' + payload.error, 'error');
    }
  } catch (err) {
    showToast('请求异常: ' + err.message, 'error');
  }
}

// Add new seed form submit handler
formAddSeed.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(formAddSeed);
  const body = {
    keyword: formData.get('keyword'),
    category: formData.get('category'),
    priority: formData.get('priority'),
    type: formData.get('type')
  };

  try {
    const res = await fetch('/api/seeds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const payload = await res.json();
    if (payload.ok) {
      formAddSeed.reset();
      // Restore default priority value after reset
      formAddSeed.querySelector('[name="priority"]').value = '5';
      showToast(`🌱 已添加种子词「${body.keyword}」`);
      loadMineSeedsTable();
      if (typeof updateDashboardStats === 'function') updateDashboardStats();
    } else {
      showToast('添加失败: ' + payload.error, 'error');
    }
  } catch (err) {
    showToast('请求异常: ' + err.message, 'error');
  }
});

// Export globally for tab router
window.loadMineSeedsTable = loadMineSeedsTable;
