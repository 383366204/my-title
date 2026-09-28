/**
 * Lightweight toast notification service.
 *
 * Hooks call showToast() to emit notifications without blocking.
 * The ToastContainer component renders them as auto-dismissing overlays.
 *
 * This replaces alert() calls in hooks, which block the main thread
 * and cannot be tested or styled.
 */

const TOAST_EVENT = 'workflow:toast';

/**
 * @typedef {'info'|'warn'|'error'|'success'} ToastLevel
 */

/**
 * Show a non-blocking toast notification.
 * @param {string} message Display text.
 * @param {ToastLevel} [level='info'] Severity level.
 * @param {number} [duration=4000] Auto-dismiss time in ms; 0 = manual dismiss.
 */
export function showToast(message, level = 'info', duration = 4000) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, {
    detail: { message, level, duration, id: Date.now() + Math.random() }
  }));
}

/**
 * Subscribe to toast events. Returns an unsubscribe function.
 * @param {(toast: {message: string, level: ToastLevel, duration: number, id: number}) => void} callback
 * @returns {() => void}
 */
export function onToast(callback) {
  const handler = (event) => callback(event.detail);
  window.addEventListener(TOAST_EVENT, handler);
  return () => window.removeEventListener(TOAST_EVENT, handler);
}
