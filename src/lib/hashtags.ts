import { generateHashtags } from '../utils/hashtagGenerator';

// Matches fenced code blocks and inline code spans so their contents are excluded from
// hashtag extraction (a `#` inside a code sample isn't a hashtag).
const CODE_SPAN_RE = /```[\s\S]*?```|`[^`]*`/g;
// Matches bare URLs so a `#` used as a URL fragment (e.g. `https://x.com/y#section`) is
// never picked up as a hashtag.
const URL_RE = /\bhttps?:\/\/\S+/gi;
const HASHTAG_RE = /#([\p{L}\p{N}_]+)/gu;

/** Blanks out code spans/blocks and URLs, preserving string length so later offsets stay valid. */
const maskExcludedRegions = (text: string): string =>
  text.replace(CODE_SPAN_RE, (m) => ' '.repeat(m.length)).replace(URL_RE, (m) => ' '.repeat(m.length));

/** Normalizes a hashtag (with or without its leading `#`) to a canonical lowercase form. */
export const normalizeHashtag = (tag: string): string => tag.replace(/^#+/, '').trim().toLowerCase();

/**
 * Extracts hashtags from free-form post text, in the order they first appear.
 * - Supports unicode letters/digits (e.g. `#café`, `#日本語`).
 * - Deduplicates case-insensitively (`#Launch` and `#launch` collapse to one entry).
 * - Ignores `#` characters inside URLs and inline/fenced code spans.
 * Returned tags preserve their original casing (without the leading `#`).
 */
export const extractHashtags = (text: string): string[] => {
  const masked = maskExcludedRegions(text);
  const seen = new Set<string>();
  const results: string[] = [];

  for (const match of masked.matchAll(HASHTAG_RE)) {
    const raw = match[1];
    const key = normalizeHashtag(raw);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    results.push(raw);
  }

  return results;
};

export type HashtagSuggestionSource = (text: string, limit: number) => Promise<string[]> | string[];

// An optional external suggestion source (e.g. backed by `AiService`), wired in by the app
// once that service exists. Until then, suggestHashtags falls back to a local keyword map.
let externalSuggestionSource: HashtagSuggestionSource | null = null;

/** Registers (or clears, with `null`) the AiService-backed suggestion source. */
export const setHashtagSuggestionSource = (source: HashtagSuggestionSource | null): void => {
  externalSuggestionSource = source;
};

const suggestHashtagsOffline = (text: string, limit: number): string[] =>
  generateHashtags({ text, maxTags: limit }).hashtags;

/**
 * Suggests hashtags for the given text. Prefers the registered `AiService`-backed source
 * when one is available, and falls back to a local keyword map when it's unset or fails
 * (e.g. offline).
 */
export const suggestHashtags = async (text: string, limit = 5): Promise<string[]> => {
  if (externalSuggestionSource) {
    try {
      const suggestions = await externalSuggestionSource(text, limit);
      if (suggestions.length > 0) return suggestions.slice(0, limit);
    } catch {
      // Fall through to the offline keyword map below.
    }
  }
  return suggestHashtagsOffline(text, limit);
};
