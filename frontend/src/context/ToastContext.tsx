import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export interface ToastItem {
  id: string;
  message: string;
  tone: 'info' | 'success' | 'warning' | 'error';
}

interface ToastContextValue {
  showToast: (message: string, tone?: ToastItem['tone']) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timerId) => window.clearTimeout(timerId));
      timers.clear();
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    const timerId = timersRef.current.get(id);
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, tone: ToastItem['tone'] = 'info') => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev, { id, message, tone }]);
      const timerId = window.setTimeout(() => {
        timersRef.current.delete(id);
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3600);
      timersRef.current.set(id, timerId);
    },
    []
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0"
      >
        {toasts.map((toast) => {
          const badgeClass =
            toast.tone === 'success'
              ? 'bg-tertiary text-white'
              : toast.tone === 'error'
                ? 'bg-error text-white'
                : toast.tone === 'warning'
                  ? 'bg-secondary text-white'
                  : 'bg-primary text-white';
          const icon =
            toast.tone === 'success'
              ? 'check_circle'
              : toast.tone === 'error'
                ? 'error'
                : toast.tone === 'warning'
                  ? 'warning'
                  : 'auto_awesome';

          return (
            <div
              key={toast.id}
              className="pointer-events-auto flex items-center justify-between gap-3 rounded-2xl bg-surface-container-lowest/95 backdrop-blur-md border border-border-sand px-4 py-3 shadow-hover text-xs text-on-surface"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${badgeClass}`}
                >
                  <span className="material-symbols-outlined text-[14px]">{icon}</span>
                </span>
                <span className="font-medium leading-snug">{toast.message}</span>
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="text-outline hover:text-on-surface p-0.5 rounded transition-colors shrink-0"
                aria-label="Dismiss notification"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
