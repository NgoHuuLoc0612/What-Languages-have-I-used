import React from 'react'
import { useStore } from '../../store/useStore'

const ICONS: Record<string, string> = {
  success: '✓',
  error:   '✕',
  warning: '⚠',
  info:    'ℹ',
}

export default function ToastContainer() {
  const { toasts, removeToast } = useStore()

  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <div key={toast.id} className={`toast toast--${toast.type}`}>
          <span className="toast__icon">{ICONS[toast.type]}</span>
          <div className="toast__body">
            <div className="toast__title">{toast.title}</div>
            {toast.message && <div className="toast__msg">{toast.message}</div>}
          </div>
          <button className="toast__close" onClick={() => removeToast(toast.id)}>✕</button>
        </div>
      ))}
    </div>
  )
}
