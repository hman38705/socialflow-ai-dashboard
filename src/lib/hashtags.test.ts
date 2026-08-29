import fc from 'fast-check';
import { extractHashtags, normalizeHashtag, suggestHashtags, setHashtagSuggestionSource } from './hashtags';

describe('normalizeHashtag', () => {
  test('strips a leading # and lowercases', () => {
    expect(normalizeHashtag('#Launch')).toBe('launch');
    expect(normalizeHashtag('Launch')).toBe('launch');
  });

  test('trims surrounding whitespace', () => {
    expect(normalizeHashtag('  #Launch  ')).toBe('launch');
  });
});

describe('extractHashtags', () => {
  test('extracts simple ascii hashtags', () => {
    expect(extractHashtags('Big news #launch today #Growth')).toEqual(['launch', 'Growth']);
  });

  test('supports unicode letters', () => {
    expect(extractHashtags('Bonjour #café et #日本語')).toEqual(['café', '日本語']);
  });

  test('deduplicates case-insensitively, keeping the first casing seen', () => {
    expect(extractHashtags('#Launch #launch #LAUNCH')).toEqual(['Launch']);
  });

  test('ignores # characters inside URLs', () => {
    expect(extractHashtags('See https://example.com/docs#section for #details')).toEqual(['details']);
  });

  test('ignores # characters inside inline code spans', () => {
    expect(extractHashtags('Use `#not-a-tag` in code, but #realtag works')).toEqual(['realtag']);
  });

  test('ignores # characters inside fenced code blocks', () => {
    const text = 'before #real\n```\nconst x = 1; // #notatag\n```\nafter #also';
    expect(extractHashtags(text)).toEqual(['real', 'also']);
  });

  test('returns an empty array when there are no hashtags', () => {
    expect(extractHashtags('no tags here')).toEqual([]);
  });
});

describe('extractHashtags (property tests)', () => {
  test('never returns duplicate tags (case-insensitively)', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const tags = extractHashtags(text);
        const normalized = tags.map(normalizeHashtag);
        expect(new Set(normalized).size).toBe(normalized.length);
      })
    );
  });

  test('never includes fragments extracted from a URL', () => {
    fc.assert(
      fc.property(
        fc.webUrl().filter((url) => url.length > 0),
        fc.string({ minLength: 1, maxLength: 12 }).filter((s) => /^[\p{L}\p{N}_]+$/u.test(s)),
        (url, tag) => {
          const text = `${url}#${tag} #real${tag}`;
          const tags = extractHashtags(text);
          // The URL's own fragment must never surface as an extracted hashtag...
          expect(tags).not.toContain(tag);
          // ...while a hashtag appearing outside the URL is still picked up.
          expect(tags).toContain(`real${tag}`);
        }
      )
    );
  });

  test('every extracted tag actually appeared after a # in the source text', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /^[\p{L}\p{N}_]+$/u.test(s))), (words) => {
        const text = words.map((w) => `#${w}`).join(' ');
        const tags = extractHashtags(text);
        tags.forEach((tag) => {
          expect(text).toContain(`#${tag}`);
        });
      })
    );
  });
});

describe('suggestHashtags', () => {
  test('falls back to the local keyword map when no external source is registered', async () => {
    setHashtagSuggestionSource(null);
    const suggestions = await suggestHashtags('Launching our new creator content strategy', 3);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(3);
    suggestions.forEach((tag) => expect(tag.startsWith('#')).toBe(true));
  });

  test('prefers the registered external (AiService) source when it succeeds', async () => {
    setHashtagSuggestionSource(async () => ['#FromAi']);
    const suggestions = await suggestHashtags('anything', 5);
    expect(suggestions).toEqual(['#FromAi']);
    setHashtagSuggestionSource(null);
  });

  test('falls back to the local keyword map when the external source throws', async () => {
    setHashtagSuggestionSource(() => {
      throw new Error('offline');
    });
    const suggestions = await suggestHashtags('growth and audience strategy', 3);
    expect(suggestions.length).toBeGreaterThan(0);
    setHashtagSuggestionSource(null);
  });
});
