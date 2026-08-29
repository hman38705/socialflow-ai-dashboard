import React from 'react';
import { useReducedMotion } from 'framer-motion';

// === Types

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

interface SkeletonTextProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Number of lines to render. The last line is rendered at 60% width. */
  lines?: number;
  className?: string;
}

// === Helpers

/**
 * `animate-pulse-slow` unless the user asked for reduced motion, in which case
 * the placeholder is static. Consumers announce the loading state on the
 * surrounding container, so every skeleton node is `aria-hidden`.
 */
function useSkeletonAnimationClass(): string {
  const prefersReducedMotion = useReducedMotion();
  return prefersReducedMotion ? '' : 'animate-pulse-slow';
}

const BASE = 'rounded-md bg-dark-border';

// === Components

export const Skeleton: React.FC<SkeletonProps> = ({ className = '', ...rest }) => {
  const animation = useSkeletonAnimationClass();
  return (
    <div aria-hidden="true" className={`${BASE} ${animation} ${className}`.trim()} {...rest} />
  );
};

export const SkeletonText: React.FC<SkeletonTextProps> = ({
  lines = 3,
  className = '',
  ...rest
}) => {
  const animation = useSkeletonAnimationClass();
  const count = Math.max(1, lines);
  return (
    <div aria-hidden="true" className={`flex flex-col gap-2 ${className}`.trim()} {...rest}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          data-testid="skeleton-line"
          className={`${BASE} ${animation} h-4 ${i === count - 1 ? 'w-3/5' : 'w-full'}`}
        />
      ))}
    </div>
  );
};

export const SkeletonCard: React.FC<SkeletonProps> = ({ className = '', ...rest }) => {
  const animation = useSkeletonAnimationClass();
  return (
    <div
      aria-hidden="true"
      className={`rounded-2xl bg-dark-elev border border-dark-border p-5 flex flex-col gap-4 ${className}`.trim()}
      {...rest}
    >
      <div className={`${BASE} ${animation} h-32 w-full`} />
      <div className={`${BASE} ${animation} h-4 w-3/4`} />
      <div className={`${BASE} ${animation} h-4 w-1/2`} />
    </div>
  );
};

export default Skeleton;
