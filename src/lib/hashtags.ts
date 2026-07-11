/**
 * Extract hashtags from free-form post text.
 * Matches `#` followed by unicode letters, digits, or underscores and returns
 * the tag bodies without the leading `#`.
 */
export function parseHashtags(text: string): string[] {
  return (text.match(/#[\p{L}0-9_]+/gu) ?? []).map((h) => h.slice(1));
}
