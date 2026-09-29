/**
 * Browser clipboard copy with fallback chain.
 *
 * This is a browser-only utility with DOM side effects (creates and
 * removes a temporary textarea). It is NOT a pure function.
 *
 * Fallback order:
 *   1. document.execCommand('copy') — legacy API, works in most browsers
 *   2. navigator.clipboard.writeText() — modern async API
 *   3. Reject with Chinese error message
 *
 * The textarea is always cleaned up via finally block, even if
 * execCommand throws or returns true.
 *
 * @param {*} value Value to copy (coerced to string).
 * @returns {Promise<void>} Resolves on success, rejects on failure.
 */
export function copyText(value) {
  const text = String(value || '');
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    if (typeof document.execCommand === 'function' && document.execCommand('copy')) return Promise.resolve();
  } finally {
    textarea.remove();
  }

  if (navigator?.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return Promise.reject(new Error('当前浏览器不支持复制，请升级浏览器后重试。'));
}
