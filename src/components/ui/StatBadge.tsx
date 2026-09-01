import React from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';

// === Types

interface StatBadgeProps {
  /** Signed percentage change. `0` renders neutral with no arrow. */
  delta: number;
  /** Decimal places for the displayed percentage (default 1). */
  precision?: number;
  className?: string;
}

// === Helpers

type Direction = 'up' | 'down' | 'flat';

function direction(delta: number): Direction {
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}

function formatPercent(value: number, precision: number): string {
  return `${value.toFixed(precision).replace(/\.0+$/, '')}%`;
}

function screenReaderText(dir: Direction, magnitude: string): string {
  if (dir === 'flat') return 'no change';
  return `${dir === 'up' ? 'up' : 'down'} ${magnitude.replace('%', ' percent')}`;
}

const DIR_CLASS: Record<Direction, string> = {
  up: 'text-trend-up',
  down: 'text-trend-down',
  flat: 'text-gray-subtext',
};

// === Component

export const StatBadge: React.FC<StatBadgeProps> = ({ delta, precision = 1, className = '' }) => {
  const dir = direction(delta);
  const magnitude = formatPercent(Math.abs(delta), precision);
  const shown = dir === 'down' ? `-${magnitude}` : dir === 'up' ? `+${magnitude}` : magnitude;

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums ${DIR_CLASS[dir]} ${className}`.trim()}
    >
      {dir === 'up' && <ArrowUp className="h-3 w-3" aria-hidden="true" />}
      {dir === 'down' && <ArrowDown className="h-3 w-3" aria-hidden="true" />}
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{screenReaderText(dir, magnitude)}</span>
    </span>
  );
};

export default StatBadge;
