import { useState, useEffect, useCallback } from 'react';
import { onToast } from '../toast.js';

const LEVEL_STYLES = {
  info:    { bg: '#1e293b', border: '#334155', text: '#e2e8f0' },
  warn:    { bg: '#422006', border: '#92400e', text: '#fef3c7' },
  error:   { bg: '#450a0a', border: '#991b1b', text: '#fecaca' },
  success: { bg: '#052e16', border: '#166534', text: '#bbf7d0' }
};

export function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    return onToast((toast) => {
      setToasts((prev) => [...prev.slice(-4), toast]); // max 5 visible
      if (toast.duration > 0) {
        setTimeout(() => dismiss(toast.id), toast.duration);
      }
    });
  }, [dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="通知"
      aria-live="polite"
      style={{
        position: 'fixed', bottom: 48, right: 16, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none'
      }}
    >
      {toasts.map((toast) => {
        const style = LEVEL_STYLES[toast.level] || LEVEL_STYLES.info;
        return (
          <div
            key={toast.id}
            role="alert"
            style={{
              pointerEvents: 'auto',
              padding: '10px 36px 10px 16px', borderRadius: 6, maxWidth: 400,
              backgroundColor: style.bg, border: `1px solid ${style.border}`,
              color: style.text, fontSize: 13, lineHeight: 1.4,
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              animation: 'toast-in 0.2s ease-out',
              position: 'relative'
            }}
          >
            {toast.message}
            <button
              type="button"
              aria-label="关闭通知"
              onClick={() => dismiss(toast.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dismiss(toast.id); } }}
              style={{
                position: 'absolute', top: 6, right: 8,
                background: 'none', border: 'none', cursor: 'pointer',
                color: style.text, fontSize: 16, lineHeight: 1,
                padding: '2px 4px', opacity: 0.7
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
