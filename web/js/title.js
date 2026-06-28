'use strict';

// ==================== DOM Elements ====================
const formTitleGen = document.getElementById('form-title-gen');
const btnGenTitle = document.getElementById('btn-gen-title');
const titleAnalysisPanel = document.getElementById('title-analysis-panel');
const titleResultsCard = document.getElementById('title-results-card');
const productsResultContainer = document.getElementById('products-result-container');
const titleSourceIndicator = document.getElementById('title-source-indicator');
const titleSourceText = document.getElementById('title-source-text');
const titleSourceClose = document.getElementById('title-source-close');
const btnCopyAllTitles = document.getElementById('btn-copy-all-titles');
const titleGenMeta = document.getElementById('title-gen-meta');
const titleGenTimer = document.getElementById('title-gen-timer');
const titleKeywordInput = document.getElementById('title-keyword');

let allGeneratedTitles = [];
let currentTitleSafety = {
  canDistribute: false,
  sourceGateStatus: 'manual',
  degraded: false,
  reason: '未从已验真候选词导入'
};

// ==================== Source Indicator ====================

/**
 * Show source indicator when keyword was imported from mining results
 */
function checkAndShowSourceIndicator() {
  if (window._titleSourceKeyword && titleSourceIndicator && titleSourceText) {
    const candidate = window._titleSourceCandidate || {};
    if (titleKeywordInput && normalizeTitleKeyword(titleKeywordInput.value) !== normalizeTitleKeyword(window._titleSourceKeyword)) {
      titleSourceIndicator.style.display = 'none';
      return;
    }
    const statusText = candidate.canDistribute ? '已验真' : '待验真';
    titleSourceText.textContent = `📍 来源：从挖词候选「${window._titleSourceKeyword}」导入 · ${statusText}`;
    titleSourceIndicator.style.display = 'flex';
  }
}

if (titleKeywordInput) {
  titleKeywordInput.addEventListener('input', () => {
    if (!window._titleSourceKeyword) return;
    if (normalizeTitleKeyword(titleKeywordInput.value) !== normalizeTitleKeyword(window._titleSourceKeyword)) {
      window._titleSourceCandidate = null;
      if (titleSourceIndicator) titleSourceIndicator.style.display = 'none';
      currentTitleSafety = buildTitleSafety(null, titleKeywordInput.value);
      if (typeof window.setWorkflowStage === 'function') window.setWorkflowStage('candidate');
    } else {
      checkAndShowSourceIndicator();
    }
  });
}

// Listen for hash change to detect arrival on title page
window.addEventListener('hashchange', () => {
  if (window.location.hash === '#title') {
    checkAndShowSourceIndicator();
  }
});

// Clear source indicator
if (titleSourceClose) {
  titleSourceClose.addEventListener('click', () => {
    titleSourceIndicator.style.display = 'none';
    window._titleSourceKeyword = null;
    window._titleSourceCandidate = null;
  });
}

// ==================== Form Submit ====================

formTitleGen.addEventListener('submit', async (e) => {
  e.preventDefault();

  // Start timer
  const startTime = Date.now();

  // Set UI state
  btnGenTitle.disabled = true;
  btnGenTitle.textContent = '⏳ 正在检索货源并智能选品中 (约60-120秒)...';
  titleAnalysisPanel.innerHTML = '<p class="empty-state-text-sm">正在启动大模型及1688/淘宝网络数据检索...<br>请稍候，我们正在分析竞品并为您优化标题结构。</p>';
  titleResultsCard.style.display = 'none';
  productsResultContainer.innerHTML = '';
  allGeneratedTitles = [];
  currentTitleSafety = buildTitleSafety(null, document.getElementById('title-keyword').value);
  if (titleGenMeta) titleGenMeta.style.display = 'none';

  const keyword = document.getElementById('title-keyword').value;
  const maxLength = document.getElementById('title-max-length').value;
  const useImageSearch = document.getElementById('title-use-image').checked;
  const peerTitlesRaw = document.getElementById('title-peer-titles').value;
  const peerTitles = peerTitlesRaw.split('\n').map(t => t.trim()).filter(Boolean);

  try {
    const res = await fetch('/api/title/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyword,
        maxLength,
        useImageSearch,
        peerTitles: peerTitles.length > 0 ? peerTitles : null
      })
    });

    const payload = await res.json();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    btnGenTitle.disabled = false;
    btnGenTitle.textContent = '✨ 开始选品并生成标题';

    if (payload.ok) {
      currentTitleSafety = buildTitleSafety(payload.data, keyword);
      if (window.historyService && window._titleSourceCandidate) {
        window.historyService.markGenerated(window._titleSourceCandidate, {
          keyword,
          productCount: Array.isArray(payload.data.products) ? payload.data.products.length : 0,
          canDistribute: currentTitleSafety.canDistribute,
          degraded: !!currentTitleSafety.degraded
        }).catch(err => console.warn('记录标题生成历史失败:', err.message));
      }
      renderTitleAnalysis(payload.data);
      renderProductResults(payload.data.products);
      titleResultsCard.style.display = 'block';
      if (typeof window.setWorkflowStage === 'function') {
        window.setWorkflowStage('generated');
      }

      // Show elapsed time
      if (titleGenMeta && titleGenTimer) {
        titleGenTimer.textContent = `⏱️ 耗时 ${elapsed} 秒`;
        titleGenMeta.style.display = 'block';
      }

      showToast(`✨ 标题生成完成，耗时 ${elapsed} 秒`);
    } else {
      titleAnalysisPanel.innerHTML = `<div class="analysis-item error"><span class="analysis-label">❌ 任务失败</span><p>${escapeHtml(payload.error)}</p></div>`;
      showToast('标题生成失败: ' + payload.error, 'error');
    }
  } catch (err) {
    btnGenTitle.disabled = false;
    btnGenTitle.textContent = '✨ 开始选品并生成标题';
    titleAnalysisPanel.innerHTML = `<div class="analysis-item error"><span class="analysis-label">❌ 网络异常</span><p>${escapeHtml(err.message)}</p></div>`;
    showToast('网络异常: ' + err.message, 'error');
  }
});

// ==================== Render Analysis Panel ====================

function renderTitleAnalysis(data) {
  let html = '';
  const safety = buildTitleSafety(data, document.getElementById('title-keyword').value);

  // 1. Degraded Banner
  if (safety.degraded) {
    html += `
      <div class="workflow-danger">
        <strong>降级警示</strong><br>
        接口已触发兜底逻辑 (${escapeHtml(String(safety.degraded))})。本次结果只可参考，不能进入铺货清单。
      </div>
    `;
  }

  if (!safety.canDistribute && !safety.degraded) {
    html += `
      <div class="workflow-warning">
        <strong>待验真结果</strong><br>
        ${escapeHtml(safety.reason)}。可以生成标题做研究，但不能进入待确认铺货。
      </div>
    `;
  }

  // 2. Keyword details
  html += `
    <div class="analysis-item">
      <span class="analysis-label">蓝海词 / 原始词</span>
      <span class="analysis-value">${escapeHtml(data.blueOceanWord)}</span>
    </div>
    <div class="analysis-item">
      <span class="analysis-label">GLM 提取核心词</span>
      <span class="analysis-value" style="color: var(--accent-purple); font-weight: 700;">${escapeHtml(data.coreWord)}</span>
    </div>
    <div class="analysis-item">
      <span class="analysis-label">修饰词</span>
      <span class="analysis-value" style="font-size: 13px;">${(data.modifiers || []).map(m => escapeHtml(m.word)).join(', ') || '无'}</span>
    </div>
  `;

  // 3. Crawler stats
  if (data.stats) {
    html += `
      <div class="analysis-item">
        <span class="analysis-label">货源抓取统计</span>
        <span class="analysis-value" style="font-size: 13px; font-family: monospace;">
          1688货源数: ${data.stats.alibaba1688Total || 0} | 淘宝同行: ${data.peerTitles ? data.peerTitles.length : 0}
        </span>
      </div>
    `;
  }

  // 4. Overall advice
  if (data.overallAdvice) {
    html += `
      <div class="analysis-item" style="border-top: 1px solid var(--card-border); padding-top: 12px; margin-top: 12px;">
        <span class="analysis-label">GLM 选品评估与定价建议</span>
        <p style="font-size: 12px; color: var(--text-secondary); line-height: 1.5; margin-top: 4px;">${escapeHtml(data.overallAdvice)}</p>
      </div>
    `;
  }

  titleAnalysisPanel.innerHTML = html;
}

// ==================== Render Product Cards ====================

function renderProductResults(products) {
  productsResultContainer.innerHTML = '';
  allGeneratedTitles = [];

  if (!products || products.length === 0) {
    productsResultContainer.innerHTML = '<p class="empty-state-text-sm" style="grid-column: span 3;">没有匹配到的1688货源商品。</p>';
    return;
  }

  products.forEach(p => {
    // Collect titles for batch copy
    if (p['铺货标题']) allGeneratedTitles.push(p['铺货标题']);

    const card = document.createElement('div');
    card.className = 'product-card';

    const priceText = p['商品原价'] ? `¥${p['商品原价']}` : '暂无价';

    card.innerHTML = `
      <div class="product-img-wrapper">
        <img src="${escapeHtml(p['主图链接'] || '')}" class="product-img" onerror="this.src='https://placehold.co/280x280?text=No+Image'">
        <span class="product-price-badge">${priceText}</span>
      </div>
      <div class="product-body">
        <a href="${escapeHtml(p['产品链接'])}" target="_blank" class="product-orig-title" title="点击查看1688原网页">
          🔗 ${escapeHtml(p['链接原标题'] || '查看原件详情')}
        </a>
        <div class="product-seo-title-wrapper">
          <span class="product-seo-title-label">淘宝 SEO 推荐标题</span>
          <p class="product-seo-title">${escapeHtml(p['铺货标题'])}</p>
        </div>
        <div class="product-meta-row">
          <span>销量: ${p['30天销量'] || 0}</span>
          <span>好评: ${Math.round((p['好评率'] || 0) * 100)}%</span>
          <span>复购: ${Math.round((p['复购率'] || 0) * 100)}%</span>
        </div>
        <div class="product-advice-box">
          <div class="product-advice-item">
            <span class="product-advice-label">💡 选品理由:</span>
            <span>${escapeHtml(p['选品理由'] || '符合核心词搜索需求')}</span>
          </div>
          <div class="product-advice-item">
            <span class="product-advice-label">💰 定价建议:</span>
            <span>${escapeHtml(p['定价建议'] || '参考同类产品')}</span>
          </div>
          <div class="product-advice-item">
            <span class="product-advice-label">⚠️ 风险提示:</span>
            <span>${escapeHtml(p['风险提示'] || '无重大材质合规风险')}</span>
          </div>
        </div>
      </div>
      <div class="product-card-footer">
        <span class="product-quality-score">质量分: ${p['标题质量分'] || 0}</span>
        <div class="action-wrapper"></div>
      </div>
    `;

    // Programmatic buttons
    const actionWrapper = card.querySelector('.action-wrapper');

    // Copy title button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-primary btn-sm';
    copyBtn.style.marginRight = '4px';
    copyBtn.textContent = '📋 复制标题';
    copyBtn.addEventListener('click', () => copyText(p['铺货标题']));
    actionWrapper.appendChild(copyBtn);

    const reviewBtn = document.createElement('button');
    reviewBtn.className = currentTitleSafety.canDistribute ? 'btn btn-secondary btn-sm' : 'btn btn-secondary btn-sm';
    reviewBtn.textContent = currentTitleSafety.canDistribute ? '加入待确认' : '待验真';
    reviewBtn.title = currentTitleSafety.canDistribute ? '加入待确认铺货清单' : currentTitleSafety.reason;
    reviewBtn.disabled = !currentTitleSafety.canDistribute;
    reviewBtn.addEventListener('click', () => {
      if (typeof window.setWorkflowStage === 'function') window.setWorkflowStage('pending_review');
      if (window.historyService && window._titleSourceCandidate) {
        window.historyService.markPendingReview(window._titleSourceCandidate, {
          keyword: window._titleSourceCandidate.keyword,
          productUrl: p['产品链接'] || '',
          title: p['铺货标题'] || ''
        }).catch(err => console.warn('记录待确认动作失败:', err.message));
      }
      showToast('已加入待确认铺货清单');
    });
    actionWrapper.appendChild(reviewBtn);

    // Open 1688 link button
    if (p['产品链接']) {
      const linkBtn = document.createElement('button');
      linkBtn.className = 'btn btn-secondary btn-sm';
      linkBtn.textContent = '🔗 打开';
      linkBtn.title = '在新窗口打开1688产品页';
      linkBtn.addEventListener('click', () => window.open(p['产品链接'], '_blank'));
      actionWrapper.appendChild(linkBtn);
    }

    productsResultContainer.appendChild(card);
  });
}

function getDegradedStatus(data) {
  if (!data) return false;
  return data.degraded
    || (data.stats && data.stats.degraded)
    || (data.stats && data.stats.trace && data.stats.trace.degraded)
    || false;
}

function normalizeTitleKeyword(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

function buildTitleSafety(data, keyword = '') {
  const source = window._titleSourceCandidate || {};
  const currentKeyword = normalizeTitleKeyword(keyword || (titleKeywordInput ? titleKeywordInput.value : ''));
  const sourceKeyword = normalizeTitleKeyword(source.keyword || window._titleSourceKeyword || '');
  const degraded = getDegradedStatus(data);
  if (degraded) {
    return {
      canDistribute: false,
      sourceGateStatus: source.gateStatus || 'unknown',
      degraded,
      reason: '标题生成已降级'
    };
  }
  if (source.canDistribute && sourceKeyword && sourceKeyword === currentKeyword) {
    return {
      canDistribute: true,
      sourceGateStatus: source.gateStatus || 'verified',
      degraded: false,
      reason: source.gateReason || '生意参谋验真通过'
    };
  }
  return {
    canDistribute: false,
    sourceGateStatus: source.gateStatus || 'manual',
    degraded: false,
    reason: sourceKeyword && sourceKeyword !== currentKeyword
      ? '输入词已被手动修改，原验真状态失效'
      : (source.gateReason || '该词未通过生意参谋验真')
  };
}

// ==================== Copy All Titles ====================

if (btnCopyAllTitles) {
  btnCopyAllTitles.addEventListener('click', () => {
    if (allGeneratedTitles.length === 0) {
      showToast('⚠️ 还没有生成的标题', 'error');
      return;
    }
    copyText(allGeneratedTitles.join('\n'));
  });
}
