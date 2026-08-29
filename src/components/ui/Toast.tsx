import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'info' | 'loading';

export interface ToastData {
  id: string;
  kind: ToastKind;
  message: string;
}

export interface ToastViewportProps {
  /** Toasts to display, newest last (stacked bottom-up). */
  toasts: ToastData[];
  /** Called with a toast's id when its dismiss button is clicked. */
  onDismiss: (id: string) => void;
}

interface KindMeta {
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  /** Icon + message accent color. */
  text: string;
  /** Border/glow accent for the card. */
  ring: string;
  /** True when the icon should spin (loading). */
  spinning?: boolean;
}

const KIND_META: Record<ToastKind, KindMeta> = {
  success: {
    Icon: CheckCircle2,
    text: 'text-trend-up',
    ring: 'border-trend-up/30 shadow-[0_0_25px_rgba(52,211,153,0.15)]',
  },
  error: {
    Icon: XCircle,
    text: 'text-trend-down',
    ring: 'border-trend-down/30 shadow-[0_0_25px_rgba(251,113,133,0.15)]',
  },
  info: {
    Icon: Info,
    text: 'text-primary-blue',
    ring: 'border-primary-blue/30 shadow-[0_0_25px_rgba(79,131,255,0.18)]',
  },
  loading: {
    Icon: Loader2,
    text: 'text-gray-subtext',
    ring: 'border-white/15',
    spinning: true,
  },
};

/**
 * Presentational toast viewport — renders the fixed bottom-right stack of
 * toast cards with enter/exit animation and a live region. Deliberately
 * stateless: the caller owns the toast list and dismiss handling (see the
 * ToastContext state half), so this component can be reused and tested in
 * isolation.
 */
export function ToastViewport({ toasts, onDismiss }: ToastViewportProps): React.JSX.Element {
  return (
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
              data-kind={t.kind}
              className={`pointer-events-auto flex items-center gap-3 min-w-[280px] max-w-sm px-5 py-4 rounded-2xl bg-dark-surface/80 backdrop-blur-xl border ${meta.ring}`}
            >
              <Icon
                size={20}
                aria-hidden="true"
                className={`shrink-0 ${meta.text} ${meta.spinning ? 'animate-spin' : ''}`}
              />
              <p className="flex-1 text-sm font-medium leading-snug text-white/90">{t.message}</p>
              <button
                type="button"
                onClick={() => onDismiss(t.id)}
                aria-label="Dismiss"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export default ToastViewport;
