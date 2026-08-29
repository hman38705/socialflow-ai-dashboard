import React from 'react';

// === Types

export type BadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

interface BadgeProps {
  variant?: BadgeVariant;
  /** Show a leading status dot. */
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}

// === Constants

const VARIANT_CLASS: Record<BadgeVariant, { pill: string; dot: string }> = {
  neutral: { pill: 'bg-white/5 text-gray-subtext border-dark-border', dot: 'bg-gray-subtext' },
  info: {
    pill: 'bg-primary-blue/10 text-primary-blue border-primary-blue/25',
    dot: 'bg-primary-blue',
  },
  success: { pill: 'bg-trend-up/10 text-trend-up border-trend-up/25', dot: 'bg-trend-up' },
  warning: { pill: 'bg-amber-400/10 text-amber-400 border-amber-400/25', dot: 'bg-amber-400' },
  danger: {
    pill: 'bg-primary-rose/10 text-primary-rose border-primary-rose/25',
    dot: 'bg-primary-rose',
  },
};

// === Component

export const Badge: React.FC<BadgeProps> = ({
  variant = 'neutral',
  dot = false,
  className = '',
  children,
}) => {
  const styles = VARIANT_CLASS[variant];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${styles.pill} ${className}`.trim()}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} aria-hidden="true" />}
      {children}
    </span>
  );
};

export default Badge;
