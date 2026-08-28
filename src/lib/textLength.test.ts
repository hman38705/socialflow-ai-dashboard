import { describe, expect, it } from 'vitest';
import { Platform } from '../types';
import {
  computeTextLength,
  countGraphemes,
  getTextLengthResult,
  PLATFORM_TEXT_LIMITS,
} from './textLength';

describe('countGraphemes', () => {
  it('counts plain ascii text by code unit', () => {
    expect(countGraphemes('hello')).toBe(5);
  });

  it('counts a ZWJ family emoji sequence as a single grapheme', () => {
    // man + ZWJ + woman + ZWJ + girl + ZWJ + boy
    expect(countGraphemes('👨‍👩‍👧‍👦')).toBe(1);
  });

  it('counts an emoji with a variation selector as a single grapheme', () => {
    expect(countGraphemes('❤️')).toBe(1);
  });

  it('counts a mix of text and emoji correctly', () => {
    // "hi " (3) + family emoji (1) + " " (1) + heart (1) = 6
    expect(countGraphemes('hi 👨‍👩‍👧‍👦 ❤️')).toBe(6);
  });

  it('returns 0 for empty string', () => {
    expect(countGraphemes('')).toBe(0);
  });
});

describe('computeTextLength', () => {
  it('counts URLs at the fixed t.co length on Twitter regardless of actual length', () => {
    const shortUrl = 'https://x.co';
    const longUrl = 'https://example.com/a/very/long/path/that/is/definitely/more/than/23/chars';

    const withShort = computeTextLength(`check ${shortUrl}`, Platform.TWITTER);
    const withLong = computeTextLength(`check ${longUrl}`, Platform.TWITTER);

    // "check " is 6 chars, plus the fixed 23-char URL length = 29 in both cases.
    expect(withShort).toBe(29);
    expect(withLong).toBe(29);
  });

  it('counts URLs at their real length on platforms with no shortener', () => {
    const url = 'https://example.com/short';
    const length = computeTextLength(`see ${url}`, Platform.INSTAGRAM);
    expect(length).toBe(countGraphemes(`see ${url}`));
  });

  it('counts emoji as single graphemes when mixed with a URL', () => {
    const length = computeTextLength('🔥 https://x.co launch', Platform.TWITTER);
    // "🔥 " (2 graphemes) + 23 (url) + " launch" (7 graphemes) = 32
    expect(length).toBe(32);
  });

  it('returns 0 for empty text', () => {
    expect(computeTextLength('', Platform.TWITTER)).toBe(0);
  });
});

describe('getTextLengthResult', () => {
  it('reports remaining characters under the limit', () => {
    const result = getTextLengthResult('hello', Platform.TWITTER);
    expect(result.length).toBe(5);
    expect(result.remaining).toBe(PLATFORM_TEXT_LIMITS[Platform.TWITTER].limit - 5);
    expect(result.isOverLimit).toBe(false);
    expect(result.isWarning).toBe(false);
  });

  it('flags warning state at or above 90% of the limit', () => {
    const limit = PLATFORM_TEXT_LIMITS[Platform.TWITTER].limit;
    const text = 'a'.repeat(Math.ceil(limit * 0.9));
    const result = getTextLengthResult(text, Platform.TWITTER);
    expect(result.isWarning).toBe(true);
    expect(result.isOverLimit).toBe(false);
  });

  it('flags over-limit once the length exceeds the platform limit', () => {
    const limit = PLATFORM_TEXT_LIMITS[Platform.LINKEDIN].limit;
    const text = 'a'.repeat(limit + 1);
    const result = getTextLengthResult(text, Platform.LINKEDIN);
    expect(result.isOverLimit).toBe(true);
    expect(result.remaining).toBe(-1);
  });
});
