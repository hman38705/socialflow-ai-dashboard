import React, { createContext, useContext, useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export type ToastKind = 'success' | 'error' | 'info' | 'loading';

interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  /** Show a toast; returns its id so it can be dismissed/updated later. */
  toast: (message: string, kind?: ToastKind) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const KIND_META: Record<ToastKind, { icon: string; ring: string; text: string }> = {
  success: { icon: 'check_circle', ring: 'border-green-500/30 shadow-[0_0_25px_rgba(34,197,94,0.15)]', text: 'text-green-400' },
  error: { icon: 'error', ring: 'border-red-500/30 shadow-[0_0_25px_rgba(239,68,68,0.15)]', text: 'text-red-400' },
  info: { icon: 'info', ring: 'border-primary-blue/30 shadow-[0_0_25px_rgba(79,131,255,0.18)]', text: 'text-primary-blue' },
  loading: { icon: 'progress_activity', ring: 'border-white/15', text: 'text-gray-subtext' },
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev, { id, kind, message }]);
      // Loading toasts persist until explicitly dismissed/replaced.
      if (kind !== 'loading') {
        setTimeout(() => dismiss(id), 3800);
      }
      return id;
    },
    [dismiss]
  );

  const value = useMemo<ToastContextValue>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none"
        role="status"
        aria-live="polite"
      >
        <AnimatePresence>
          {toasts.map((t) => {
            const meta = KIND_META[t.kind];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, x: 40, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                className={`pointer-events-auto flex items-center gap-3 min-w-[280px] max-w-sm px-5 py-4 rounded-2xl glass border ${meta.ring}`}
              >
                <span
                  className={`material-symbols-outlined text-xl ${meta.text} ${
                    t.kind === 'loading' ? 'animate-spin' : ''
                  }`}
                >
                  {meta.icon}
                </span>
                <p className="text-sm font-medium text-white/90 leading-snug flex-1">{t.message}</p>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  aria-label="Dismiss"
                  className="shrink-0 flex items-center justify-center w-6 h-6 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
};
