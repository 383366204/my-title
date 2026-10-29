'use strict';

/**
 * 在上传完成提示所在面板定位搜索，避免误点首页文字搜索。
 * @param {boolean} click 是否在状态仍就绪时点击。
 * @returns {object} 页面上传状态，不依赖处理后可能清空的文件框。
 */
function readImageUploadState(click = false) {
  const visible = element => element.getBoundingClientRect().height > 0
    && getComputedStyle(element).visibility !== 'hidden';
  const input = document.querySelector('input[type="file"][aria-label="以图搜款"]');
  const markers = [...document.querySelectorAll('span,div,p')].filter(element =>
    element.children.length === 0 && visible(element) && /已上传\s*1\s*张图/.test(element.textContent));
  let button = null;
  let previewReady = false;
  for (const marker of markers) {
    let panel = marker.parentElement;
    for (let depth = 0; panel && panel !== document.body && depth < 5; depth++, panel = panel.parentElement) {
      const images = [...panel.querySelectorAll('img')].filter(visible);
      const buttons = [...panel.querySelectorAll('button,[role="button"]')].filter(element =>
        visible(element) && element.textContent.trim() === '搜索');
      if (images.length && buttons.length === 1) {
        button = buttons[0];
        previewReady = images.some(image => image.complete && image.naturalWidth > 0);
        break;
      }
    }
    if (button) break;
  }
  const buttonReady = Boolean(button && !button.disabled && button.getAttribute('aria-disabled') !== 'true');
  const state = { fileCount: input?.files?.length || 0, uploaded: markers.length > 0, previewReady, buttonReady };
  if (click && state.uploaded && previewReady && buttonReady) { button.click(); state.clicked = true; }
  return state;
}

module.exports = { readImageUploadState };
