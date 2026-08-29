import React from 'react';
import type { LucideIcon } from 'lucide-react';

// === Types

export type EmptyStateVariant = 'empty' | 'error' | 'no-results';

interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  variant?: EmptyStateVariant;
}

// === Constants

const VARIANT_ICON: Record<EmptyStateVariant, string> = {
  empty: 'text-gray-subtext',
  error: 'text-primary-rose',
  'no-results': 'text-gray-subtext',
};

// === Component

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  action,
  variant = 'empty',
}) => {
  const isError = variant === 'error';
  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={`flex flex-col items-center justify-center gap-3 rounded-2xl border px-6 py-12 text-center ${
        isError ? 'border-primary-rose/25 bg-primary-rose/5' : 'border-dark-border bg-white/[0.02]'
      }`}
    >
      <Icon className={`h-10 w-10 ${VARIANT_ICON[variant]}`} aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-white/90">{title}</p>
        {description && <p className="text-xs text-gray-subtext max-w-sm">{description}</p>}
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className={`mt-1 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
            isError
              ? 'bg-primary-rose/15 text-primary-rose hover:bg-primary-rose/25'
              : 'bg-primary-blue/15 text-primary-blue hover:bg-primary-blue/25'
          }`}
        >
          {action.label}
        </button>
      )}
    </div>
  );
};

export default EmptyState;
