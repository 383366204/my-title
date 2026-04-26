(function () {
  'use strict';

  const els = {
    status: document.getElementById('status'),
    statusIcon: document.getElementById('status-icon'),
    statusText: document.getElementById('status-text'),
    extractBtn: document.getElementById('extract-btn'),
    preview: document.getElementById('preview'),
    previewToggle: document.getElementById('preview-toggle'),
    previewSummary: document.getElementById('preview-summary'),
    previewCode: document.getElementById('preview-code'),
    feedbackSuccess: document.getElementById('feedback-success'),
    feedbackSuccessText: document.getElementById('feedback-success-text'),
    feedbackError: document.getElementById('feedback-error'),
    feedbackErrorText: document.getElementById('feedback-error-text'),
    feedbackErrorHint: document.getElementById('feedback-error-hint'),
    feedbackWarning: document.getElementById('feedback-warning'),
    feedbackWarningText: document.getElementById('feedback-warning-text'),
    feedbackWarningHint: document.getElementById('feedback-warning-hint'),
  };

  let currentTabId = null;
  let isSycmPage = false;
  let contentScriptReady = false;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    els.extractBtn.addEventListener('click', handleExtract);
    els.previewToggle.addEventListener('click', togglePreview);
    detectPage();
  }

  function detectPage() {
    setStatus('loading', '⏳', '正在检测页面...');
    els.extractBtn.disabled = true;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) {
        setStatus('error', '✗', '无法获取当前标签页');
        return;
      }

      const tab = tabs[0];
      currentTabId = tab.id;
      const url = tab.url || '';

      isSycmPage = /sycm\.1688\.com|sycm\.taobao\.com/.test(url);

      if (!isSycmPage) {
        setStatus('warning', '⚠', '请在生意参谋页面使用此插件');
        showWarning(
          '当前页面不是生意参谋',
          '请切换到 sycm.1688.com 或 sycm.taobao.com 后再试'
        );
        return;
      }

      setStatus('ok', '✓', '检测到生意参谋页面');
      pingContentScript();
    });
  }

  function pingContentScript() {
    if (!currentTabId) return;

    sendMessage({ action: 'ping' })
      .then((res) => {
        if (res && res.status === 'ok') {
          contentScriptReady = true;
          els.extractBtn.disabled = false;

          if (res.hasData) {
            setStatus('ok', '✓', '检测到生意参谋页面 · 数据已就绪');
          } else {
            setStatus('warning', '⚠', '检测到生意参谋页面 · 暂无数据，请先搜索');
            showWarning(
              '暂无可用数据',
              '请在生意参谋中执行搜索操作，等待数据加载完成后再提取'
            );
          }
        } else {
          contentScriptReady = false;
          els.extractBtn.disabled = true;
          setStatus('warning', '⚠', '页面脚本未就绪，请刷新页面');
          showWarning('内容脚本未响应', '请刷新生意参谋页面后重试');
        }
      })
      .catch(() => {
        contentScriptReady = false;
        els.extractBtn.disabled = true;
        setStatus('warning', '⚠', '无法与页面通信，请刷新后重试');
        showWarning('无法与页面脚本通信', '请刷新生意参谋页面后重试');
      });
  }

  async function handleExtract() {
    if (!currentTabId || !contentScriptReady) {
      showError('插件未就绪', '请刷新页面或切换到生意参谋页面后重试');
      return;
    }

    hideAllFeedback();
    els.extractBtn.disabled = true;
    const originalText = els.extractBtn.querySelector('.btn-text').textContent;
    els.extractBtn.querySelector('.btn-text').textContent = '提取中...';

    try {
      const result = await sendMessage({ action: 'extract' });

      if (result.error) {
        handleExtractError(result);
        return;
      }

      if (!result.success || !result.data) {
        showError('提取失败', '未获取到有效数据，请刷新页面后重试');
        return;
      }

      await navigator.clipboard.writeText(result.data);

      showPreview(result.data, result.rowCount);
      showSuccess(`已复制 ${result.rowCount} 行数据到剪贴板`);
      setStatus('ok', '✓', `数据已提取 · ${result.rowCount} 行`);
    } catch (err) {
      console.error('[SYCM-POPUP] 提取或复制失败:', err);
      showError('复制到剪贴板失败', '请手动复制或检查浏览器权限设置');
    } finally {
      els.extractBtn.disabled = !contentScriptReady;
      els.extractBtn.querySelector('.btn-text').textContent = originalText;
    }
  }

  function handleExtractError(result) {
    const errorMap = {
      not_sycm_page: {
        text: '当前页面不是生意参谋',
        hint: '请切换到 sycm.1688.com 或 sycm.taobao.com 后再试',
      },
      no_data_available: {
        text: result.message || '暂无可用数据',
        hint: result.hint || '请在生意参谋中执行搜索操作，等待数据加载完成后再提取',
      },
      data_expired: {
        text: result.message || '数据已过期',
        hint: result.hint || '请在生意参谋中重新执行搜索操作',
      },
      no_valid_data: {
        text: result.message || '数据格式化后没有有效内容',
        hint: result.hint || '请检查 API 响应结构是否符合预期',
      },
    };

    const info = errorMap[result.error] || {
      text: result.message || '提取失败',
      hint: result.hint || '请刷新页面后重试',
    };

    if (result.error === 'no_data_available' || result.error === 'data_expired') {
      showWarning(info.text, info.hint);
    } else {
      showError(info.text, info.hint);
    }
  }

  function showPreview(tsv, rowCount) {
    const lines = tsv.split('\n');
    const previewLines = lines.slice(0, Math.min(4, lines.length));
    const hasMore = lines.length > 4;

    els.previewSummary.textContent = `已提取 ${rowCount} 行数据`;
    els.previewCode.textContent = previewLines.join('\n') + (hasMore ? '\n...' : '');
    els.preview.style.display = 'block';
    els.previewToggle.setAttribute('aria-expanded', 'false');
  }

  function togglePreview() {
    const expanded = els.previewToggle.getAttribute('aria-expanded') === 'true';
    els.previewToggle.setAttribute('aria-expanded', String(!expanded));
  }

  function setStatus(type, icon, text) {
    els.status.className = 'status';
    if (type === 'ok') els.status.classList.add('status--ok');
    if (type === 'warning') els.status.classList.add('status--warning');
    if (type === 'error') els.status.classList.add('status--error');

    els.statusIcon.textContent = icon;
    els.statusText.textContent = text;
  }

  function showSuccess(text) {
    hideAllFeedback();
    els.feedbackSuccessText.textContent = text;
    els.feedbackSuccess.style.display = 'flex';
  }

  function showError(text, hint) {
    hideAllFeedback();
    els.feedbackErrorText.textContent = text;
    els.feedbackErrorHint.textContent = hint;
    els.feedbackError.style.display = 'flex';
  }

  function showWarning(text, hint) {
    hideAllFeedback();
    els.feedbackWarningText.textContent = text;
    els.feedbackWarningHint.textContent = hint;
    els.feedbackWarning.style.display = 'flex';
  }

  function hideAllFeedback() {
    els.feedbackSuccess.style.display = 'none';
    els.feedbackError.style.display = 'none';
    els.feedbackWarning.style.display = 'none';
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(currentTabId, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }
})();
