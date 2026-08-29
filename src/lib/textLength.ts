import { Platform } from '../types';

/**
 * Per-platform text length rules, kept in a single place so every consumer
 * (composer, character counter, validation) agrees on the same numbers.
 */
export interface PlatformTextLimit {
  platform: Platform;
  /** Maximum length allowed for this platform, in grapheme clusters. */
  limit: number;
  /**
   * Fixed length every URL is counted as, regardless of its actual length
   * (e.g. Twitter/X wraps every link in a t.co shortener of this length).
   * When omitted, URLs count at their real grapheme length.
   */
  urlLength?: number;
  /** Ratio (0-1) of the limit at which the counter should switch to a "warning" state. */
  warningThreshold: number;
}

export const PLATFORM_TEXT_LIMITS: Record<Platform, PlatformTextLimit> = {
  [Platform.TWITTER]: {
    platform: Platform.TWITTER,
    limit: 280,
    urlLength: 23,
    warningThreshold: 0.9,
  },
  [Platform.INSTAGRAM]: {
    platform: Platform.INSTAGRAM,
    limit: 2200,
    warningThreshold: 0.9,
  },
  [Platform.LINKEDIN]: {
    platform: Platform.LINKEDIN,
    limit: 3000,
    warningThreshold: 0.9,
  },
  [Platform.FACEBOOK]: {
    platform: Platform.FACEBOOK,
    limit: 63206,
    warningThreshold: 0.9,
  },
};

const URL_PATTERN = /\bhttps?:\/\/\S+/gi;

const ZERO_WIDTH_JOINER = '‍';
const VARIATION_SELECTOR_16 = '️';

/**
 * Splits text into extended-grapheme-like clusters without relying on
 * `Intl.Segmenter`. Used only as a fallback for runtimes where the
 * `Intl.Segmenter` API isn't available. Groups code points joined by a
 * zero-width joiner (ZWJ) or followed by a variation selector into a single
 * cluster so multi-codepoint emoji (e.g. family/ZWJ sequences) still count
 * as one character.
 */
function splitGraphemesFallback(text: string): string[] {
  const codePoints = Array.from(text);
  const clusters: string[] = [];
  let current = '';

  for (const char of codePoints) {
    if (char === ZERO_WIDTH_JOINER) {
      current += char;
      continue;
    }
    if (current.endsWith(ZERO_WIDTH_JOINER) || char === VARIATION_SELECTOR_16) {
      current += char;
      continue;
    }
    if (current) {
      clusters.push(current);
    }
    current = char;
  }
  if (current) {
    clusters.push(current);
  }

  return clusters;
}

interface GraphemeSegmenter {
  segment(input: string): Iterable<{ segment: string }>;
}

// `Intl.Segmenter` isn't part of every TS lib target yet, so it's accessed
// through an untyped handle and feature-detected at runtime rather than
// requiring a newer `lib` setting project-wide.
function getSegmenter(): GraphemeSegmenter | undefined {
  const IntlWithSegmenter = Intl as unknown as {
    Segmenter?: new (locale?: string, options?: { granularity?: string }) => GraphemeSegmenter;
  };

  if (typeof IntlWithSegmenter.Segmenter !== 'function') {
    return undefined;
  }

  return new IntlWithSegmenter.Segmenter(undefined, { granularity: 'grapheme' });
}

/** Counts grapheme clusters (user-perceived characters) in `text`. */
export function countGraphemes(text: string): number {
  if (!text) {
    return 0;
  }

  const segmenter = getSegmenter();
  if (segmenter) {
    let count = 0;
    for (const _segment of segmenter.segment(text)) {
      count += 1;
    }
    return count;
  }

  return splitGraphemesFallback(text).length;
}

/**
 * Computes the length of `text` under the counting rules of `platform`:
 * every URL is counted as the platform's fixed URL length (when the
 * platform shortens links), everything else is counted in grapheme
 * clusters so emoji and ZWJ sequences count as a single character.
 */
export function computeTextLength(text: string, platform: Platform): number {
  if (!text) {
    return 0;
  }

  const config = PLATFORM_TEXT_LIMITS[platform];
  if (!config.urlLength) {
    return countGraphemes(text);
  }

  let length = 0;
  let lastIndex = 0;
  const pattern = new RegExp(URL_PATTERN);
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    length += countGraphemes(text.slice(lastIndex, match.index));
    length += config.urlLength;
    lastIndex = match.index + match[0].length;
  }
  length += countGraphemes(text.slice(lastIndex));

  return length;
}

export interface TextLengthResult {
  platform: Platform;
  length: number;
  limit: number;
  remaining: number;
  ratio: number;
  isWarning: boolean;
  isOverLimit: boolean;
}

/** Computes the full counter state (length, remaining, thresholds) for a platform. */
export function getTextLengthResult(text: string, platform: Platform): TextLengthResult {
  const config = PLATFORM_TEXT_LIMITS[platform];
  const length = computeTextLength(text, platform);
  const ratio = config.limit > 0 ? length / config.limit : 0;

  return {
    platform,
    length,
    limit: config.limit,
    remaining: config.limit - length,
    ratio,
    isWarning: ratio >= config.warningThreshold && length <= config.limit,
    isOverLimit: length > config.limit,
  };
}
