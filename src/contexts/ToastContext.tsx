import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';

// === Types

export type ToastKind = 'success' | 'error' | 'warning' | 'info' | 'loading';

interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  /** Number of times this message was raised while still visible (see dedupe). */
  count: number;
}

export interface ToastContextValue {
  /** Show a toast of an explicit kind; returns its id for use with `dismiss(id)`. */
  toast: (message: string, kind?: ToastKind) => string;
  success: (message: string) => string;
  error: (message: string) => string;
  warning: (message: string) => string;
  info: (message: string) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

// === Constants

/** Auto-dismiss delay for every kind except `loading`. */
const AUTO_DISMISS_MS = 3800;
/** An identical message raised again within this window bumps a count instead of stacking. */
const DEDUPE_WINDOW_MS = 2000;

const KIND_META: Record<ToastKind, { Icon: typeof Info; ring: string; text: string }> = {
  success: { Icon: CheckCircle2, ring: 'border-trend-up/30', text: 'text-trend-up' },
  error: { Icon: XCircle, ring: 'border-primary-rose/30', text: 'text-primary-rose' },
  warning: { Icon: AlertTriangle, ring: 'border-amber-400/30', text: 'text-amber-400' },
  info: { Icon: Info, ring: 'border-primary-blue/30', text: 'text-primary-blue' },
  loading: { Icon: Loader2, ring: 'border-dark-border', text: 'text-gray-subtext' },
};

const ToastContext = createContext<ToastContextValue | null>(null);

// === Provider

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // `list` is the synchronous source of truth; `toasts` state just mirrors it for
  // render. `toast()` may be called several times in one tick (before React
  // re-renders), so dedupe has to read the ref, not the state snapshot.
  const list = useRef<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const seq = useRef<number>(0);
  // Last time (ms) a given message was raised, for the dedupe window.
  const lastRaisedAt = useRef<Map<string, number>>(new Map());

  const commit = useCallback((next: Toast[]) => {
    list.current = next;
    setToasts(next);
  }, []);

  const clearTimer = useCallback((id: string) => {
    const handle = timers.current.get(id);
    if (handle !== undefined) {
      clearTimeout(handle);
      timers.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      clearTimer(id);
      commit(list.current.filter((t) => t.id !== id));
    },
    [clearTimer, commit],
  );

  const dismissAll = useCallback(() => {
    timers.current.forEach((handle) => clearTimeout(handle));
    timers.current.clear();
    commit([]);
  }, [commit]);

  const scheduleAutoDismiss = useCallback(
    (id: string) => {
      clearTimer(id);
      const handle = setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
      timers.current.set(id, handle);
    },
    [clearTimer, dismiss],
  );

  const toast = useCallback(
    (message: string, kind: ToastKind = 'info'): string => {
      const now = Date.now();
      const previousAt = lastRaisedAt.current.get(message);
      lastRaisedAt.current.set(message, now);

      // Dedupe: same message still on screen and raised within the window -> bump count.
      const withinWindow = previousAt !== undefined && now - previousAt < DEDUPE_WINDOW_MS;
      const existing = withinWindow ? list.current.find((t) => t.message === message) : undefined;

      if (existing) {
        commit(
          list.current.map((t) => (t.id === existing.id ? { ...t, count: t.count + 1, kind } : t)),
        );
        if (kind !== 'loading') scheduleAutoDismiss(existing.id);
        return existing.id;
      }

      seq.current += 1;
      const id = `toast-${now}-${seq.current}`;
      commit([...list.current, { id, kind, message, count: 1 }]);

      if (kind !== 'loading') scheduleAutoDismiss(id);
      return id;
    },
    [commit, scheduleAutoDismiss],
  );

  const success = useCallback((message: string) => toast(message, 'success'), [toast]);
  const error = useCallback((message: string) => toast(message, 'error'), [toast]);
  const warning = useCallback((message: string) => toast(message, 'warning'), [toast]);
  const info = useCallback((message: string) => toast(message, 'info'), [toast]);

  // Clear every pending timer when the provider unmounts so no timer fires
  // setState on an unmounted tree.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((handle) => clearTimeout(handle));
      pending.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ toast, success, error, warning, info, dismiss, dismissAll }),
    [toast, success, error, warning, info, dismiss, dismissAll],
  );

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
            const { Icon } = meta;
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, x: 40, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                className={`pointer-events-auto flex items-center gap-3 min-w-[280px] max-w-sm px-5 py-4 rounded-2xl bg-dark-elev border ${meta.ring}`}
              >
                <Icon
                  className={`shrink-0 w-5 h-5 ${meta.text} ${
                    t.kind === 'loading' ? 'animate-spin' : ''
                  }`}
                  aria-hidden="true"
                />
                <p className="text-sm font-medium text-white/90 leading-snug flex-1">
                  {t.message}
                  {t.count > 1 && (
                    <span className="ml-2 text-xs text-gray-subtext">&times;{t.count}</span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  aria-label="Dismiss"
                  className="shrink-0 flex items-center justify-center w-6 h-6 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};

// === Hook

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
};
