import {
  deduplicateHashtags,
  mergeMultiLanguageHashtags,
  generateHashtagSuggestions,
  HashtagGenerationResult,
} from '../hashtagGeneratorService';

const makeResult = (hashtags: string[]): HashtagGenerationResult => ({
  platform: 'generic',
  source: 'heuristic',
  hashtags,
  analysis: { keywords: [], trendMatches: [], textLength: 0, aiUsed: false },
});

describe('deduplicateHashtags', () => {
  it('removes exact duplicates', () => {
    expect(deduplicateHashtags(['#Marketing', '#Marketing', '#Growth'])).toEqual([
      '#Marketing',
      '#Growth',
    ]);
  });

  it('removes case-insensitive duplicates, keeping first occurrence casing', () => {
    expect(deduplicateHashtags(['#Marketing', '#marketing', '#MARKETING'])).toEqual(['#Marketing']);
  });

  it('returns empty array for empty input', () => {
    expect(deduplicateHashtags([])).toEqual([]);
  });

  it('preserves order of first occurrences', () => {
    expect(deduplicateHashtags(['#B', '#A', '#b', '#C'])).toEqual(['#B', '#A', '#C']);
  });
});

describe('mergeMultiLanguageHashtags', () => {
  it('merges and deduplicates overlapping hashtags across two languages', () => {
    const en = makeResult(['#ContentCreator', '#Marketing', '#Growth']);
    const es = makeResult(['#marketing', '#Crecimiento', '#ContentCreator']);

    const result = mergeMultiLanguageHashtags([en, es]);

    expect(result).toEqual(['#ContentCreator', '#Marketing', '#Growth', '#Crecimiento']);
  });

  it('respects maxTags limit', () => {
    const en = makeResult(['#A', '#B', '#C']);
    const es = makeResult(['#D', '#E', '#F']);

    expect(mergeMultiLanguageHashtags([en, es], 4)).toHaveLength(4);
  });

  it('returns empty array when given no results', () => {
    expect(mergeMultiLanguageHashtags([])).toEqual([]);
  });

  it('handles a single language result without duplicating', () => {
    const en = makeResult(['#Growth', '#growth']);
    expect(mergeMultiLanguageHashtags([en])).toEqual(['#Growth']);
  });
});

describe('generateHashtagSuggestions – heuristic (no AI)', () => {
  it('returns non-empty hashtags prefixed with # for a normal prompt', async () => {
    const result = await generateHashtagSuggestions({
      text: 'Boost your brand with social media marketing strategy',
      useAi: false,
    });

    expect(result.hashtags.length).toBeGreaterThan(0);
    result.hashtags.forEach((tag) => expect(tag).toMatch(/^#/));
  });

  it('returns empty hashtags for empty prompt without calling AI', async () => {
    const result = await generateHashtagSuggestions({ text: '', useAi: false });
    expect(result.hashtags).toEqual([]);
    expect(result.analysis.aiUsed).toBe(false);
  });

  it('uses heuristic source when useAi is false', async () => {
    const result = await generateHashtagSuggestions({
      text: 'content marketing growth strategy',
      useAi: false,
    });
    expect(result.source).toBe('heuristic');
    expect(result.analysis.aiUsed).toBe(false);
  });

  it('normalizes platform alias: twitter → x', async () => {
    const result = await generateHashtagSuggestions({
      text: 'trending topics viral reach',
      platform: 'twitter',
      useAi: false,
    });
    expect(result.platform).toBe('x');
  });

  it('defaults to generic platform for unknown platform value', async () => {
    const result = await generateHashtagSuggestions({
      text: 'some content here',
      platform: 'unknown-platform',
      useAi: false,
    });
    expect(result.platform).toBe('generic');
  });

  it('respects maxTags limit', async () => {
    const result = await generateHashtagSuggestions({
      text: 'marketing brand growth strategy content creator viral audience engagement reach',
      maxTags: 3,
      useAi: false,
    });
    expect(result.hashtags.length).toBeLessThanOrEqual(3);
  });
});

describe('generateHashtagSuggestions – trending detection', () => {
  it('includes trend-matched hashtags when keywords match trend catalog', async () => {
    // 'creator', 'content', 'brand', 'campaign' → ContentCreator trend for instagram
    const result = await generateHashtagSuggestions({
      text: 'creator content brand campaign launch',
      platform: 'instagram',
      useAi: false,
    });

    const hasTrend = result.analysis.trendMatches.length > 0;
    expect(hasTrend).toBe(true);
  });

  it('trendMatches is empty when no keywords overlap with trend catalog', async () => {
    const result = await generateHashtagSuggestions({
      text: 'xyz abc def ghi jkl mno',
      platform: 'instagram',
      useAi: false,
    });
    expect(result.analysis.trendMatches).toEqual([]);
  });

  it('includes platform-specific trend hashtags in results', async () => {
    const result = await generateHashtagSuggestions({
      text: 'viral growth trend audience tiktok',
      platform: 'tiktok',
      useAi: false,
    });
    const hasTikTokTrend = result.hashtags.some(
      (t) => t === '#TikTokGrowth' || t === '#ForYouStrategy',
    );
    expect(hasTikTokTrend).toBe(true);
  });
});

describe('generateHashtagSuggestions – AI path', () => {
  afterEach(() => jest.resetModules());

  it('falls back to heuristic with fallbackReason when GEMINI_API_KEY is not set', async () => {
    const savedKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    // Re-import so the module re-evaluates apiKey at module load time
    jest.resetModules();
    const { generateHashtagSuggestions: gen } = require('../hashtagGeneratorService');

    const result = await gen({ text: 'marketing growth strategy', useAi: true });

    expect(result.source).toBe('heuristic');
    expect(result.analysis.aiUsed).toBe(false);
    expect(result.analysis.fallbackReason).toBeDefined();

    process.env.GEMINI_API_KEY = savedKey;
  });

  it('uses AI source and merges AI hashtags when AI provider succeeds', async () => {
    process.env.GEMINI_API_KEY = 'test-api-key';

    jest.resetModules();
    jest.doMock('@google/genai', () => ({
      GoogleGenAI: jest.fn().mockImplementation(() => ({
        models: {
          generateContent: jest.fn().mockResolvedValue({
            text: '#AIMarketing, #GrowthHack, #ContentStrategy',
          }),
        },
      })),
    }));

    const { generateHashtagSuggestions: gen } = require('../hashtagGeneratorService');

    const result = await gen({
      text: 'marketing growth content strategy brand',
      useAi: true,
    });

    expect(result.source).toBe('ai');
    expect(result.analysis.aiUsed).toBe(true);
    expect(result.hashtags.some((t: string) => t.startsWith('#'))).toBe(true);

    delete process.env.GEMINI_API_KEY;
  });

  it('falls back to heuristic with fallbackReason when AI provider call throws', async () => {
    process.env.GEMINI_API_KEY = 'test-api-key';

    jest.resetModules();
    jest.doMock('@google/genai', () => ({
      GoogleGenAI: jest.fn().mockImplementation(() => ({
        models: {
          generateContent: jest.fn().mockRejectedValue(new Error('AI service unavailable')),
        },
      })),
    }));

    const { generateHashtagSuggestions: gen } = require('../hashtagGeneratorService');

    const result = await gen({ text: 'marketing brand launch', useAi: true });

    expect(result.source).toBe('heuristic');
    expect(result.analysis.fallbackReason).toContain('AI service unavailable');

    delete process.env.GEMINI_API_KEY;
  });

  it('falls back to heuristic when AI returns empty result', async () => {
    process.env.GEMINI_API_KEY = 'test-api-key';

    jest.resetModules();
    jest.doMock('@google/genai', () => ({
      GoogleGenAI: jest.fn().mockImplementation(() => ({
        models: {
          generateContent: jest.fn().mockResolvedValue({ text: '' }),
        },
      })),
    }));

    const { generateHashtagSuggestions: gen } = require('../hashtagGeneratorService');

    const result = await gen({ text: 'marketing brand launch', useAi: true });

    expect(result.analysis.aiUsed).toBe(false);
    expect(result.analysis.fallbackReason).toBeDefined();

    delete process.env.GEMINI_API_KEY;
  });
});
