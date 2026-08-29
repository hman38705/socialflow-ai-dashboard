import React from 'react';

// === Types

export type SpinnerSize = 'sm' | 'md' | 'lg';

interface SpinnerProps {
  size?: SpinnerSize;
  /** Accessible label announced by screen readers. */
  label?: string;
  className?: string;
}

// === Constants

const SIZE_CLASS: Record<SpinnerSize, string> = {
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-10 h-10',
};

// === Components

export const Spinner: React.FC<SpinnerProps> = ({
  size = 'md',
  label = 'Loading',
  className = '',
}) => {
  return (
    <span role="status" aria-label={label} className={`inline-flex ${className}`.trim()}>
      <svg
        className={`animate-spin ${SIZE_CLASS[size]}`}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
    </span>
  );
};

export const LoadingScreen: React.FC<{ label?: string }> = ({ label = 'Loading' }) => {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-dark-bg text-primary-blue">
      <Spinner size="lg" label={label} />
    </div>
  );
};

export default Spinner;
