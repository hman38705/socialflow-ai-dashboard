import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from '../../types';
import { getTextLengthResult, PLATFORM_TEXT_LIMITS } from '../../lib/textLength';

export interface CharacterCounterProps {
  /** The composer text for this platform, as typed so far. */
  text: string;
  platform: Platform;
  /**
   * Called whenever the over-limit state changes for this platform, so the
   * composer can block submit for that platform only (not the whole post).
   */
  onOverLimitChange?: (isOverLimit: boolean) => void;
  /** Debounce delay (ms) before the polite screen-reader announcement updates. */
  announceDelayMs?: number;
  className?: string;
}

const RADIUS = 9;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

type CounterState = 'normal' | 'warning' | 'over';

/**
 * Per-platform character counter: a small ring indicator plus a numeric
 * remaining-count, driven by `getTextLengthResult` so counting matches each
 * platform's own rules (fixed-length URLs, grapheme-cluster emoji).
 */
export function CharacterCounter({
  text,
  platform,
  onOverLimitChange,
  announceDelayMs = 600,
  className,
}: CharacterCounterProps) {
  const result = useMemo(() => getTextLengthResult(text, platform), [text, platform]);
  const [announcement, setAnnouncement] = useState('');
  const lastOverLimitRef = useRef<boolean | null>(null);

  // Notify the composer immediately (not throttled) so submit can be
  // blocked/unblocked for this platform as soon as the limit is crossed.
  useEffect(() => {
    if (lastOverLimitRef.current !== result.isOverLimit) {
      lastOverLimitRef.current = result.isOverLimit;
      onOverLimitChange?.(result.isOverLimit);
    }
  }, [result.isOverLimit, onOverLimitChange]);

  // Throttle the screen-reader announcement so it doesn't fire on every
  // keystroke — only after typing settles for `announceDelayMs`.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const message = result.isOverLimit
        ? `${Math.abs(result.remaining)} characters over the ${result.limit} character limit`
        : `${result.remaining} characters remaining`;
      setAnnouncement(message);
    }, announceDelayMs);

    return () => window.clearTimeout(timer);
  }, [result.remaining, result.isOverLimit, result.limit, announceDelayMs]);

  const state: CounterState = result.isOverLimit ? 'over' : result.isWarning ? 'warning' : 'normal';

  const ringColor = state === 'over' ? '#fb7185' : state === 'warning' ? '#fbbf24' : '#4f83ff';
  const textColor =
    state === 'over'
      ? 'text-trend-down'
      : state === 'warning'
        ? 'text-amber-400'
        : 'text-gray-subtext';

  const progress = Math.min(Math.max(result.ratio, 0), 1);
  const dashOffset = CIRCUMFERENCE * (1 - progress);

  return (
    <div
      className={`inline-flex items-center gap-2 ${className ?? ''}`}
      data-state={state}
      data-platform={platform}
      title={`${PLATFORM_TEXT_LIMITS[platform].limit} character limit on ${platform}`}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" className="shrink-0" aria-hidden="true">
        <circle
          cx="12"
          cy="12"
          r={RADIUS}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="2"
        />
        <circle
          cx="12"
          cy="12"
          r={RADIUS}
          fill="none"
          stroke={ringColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          transform="rotate(-90 12 12)"
          style={{ transition: 'stroke-dashoffset 150ms ease, stroke 150ms ease' }}
        />
      </svg>
      <span className={`font-mono text-sm tabular-nums ${textColor}`}>{result.remaining}</span>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}

export default CharacterCounter;
