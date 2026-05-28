import { GoogleGenAI } from '@google/genai';

type SupportedPlatform =
  | 'instagram'
  | 'tiktok'
  | 'linkedin'
  | 'x'
  | 'youtube'
  | 'facebook'
  | 'generic';

interface TrendSignal {
  tag: string;
  weight: number;
  keywords: string[];
}

interface GenerationOptions {
  text: string;
  platform?: string;
  maxTags?: number;
  useAi?: boolean;
}

export interface HashtagGenerationResult {
  platform: SupportedPlatform;
  source: 'ai' | 'heuristic';
  hashtags: string[];
  analysis: {
    keywords: string[];
    trendMatches: string[];
    textLength: number;
    aiUsed: boolean;
    fallbackReason?: string;
  };
}

const apiKey = process.env.GEMINI_API_KEY ?? '';
const aiClient = apiKey ? new GoogleGenAI({ apiKey }) : null;

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'our',
  'that',
  'the',
  'this',
  'to',
  'we',
  'with',
  'you',
  'your',
]);

const TREND_CATALOG: Record<SupportedPlatform, TrendSignal[]> = {
  instagram: [
    { tag: 'ContentCreator', weight: 1.3, keywords: ['creator', 'content', 'brand', 'campaign'] },
    { tag: 'SocialMediaTips', weight: 1.15, keywords: ['social', 'tips', 'growth', 'marketing'] },
    { tag: 'ReelsStrategy', weight: 1.2, keywords: ['video', 'reel', 'short', 'story'] },
    { tag: 'BrandStory', weight: 1.05, keywords: ['story', 'brand', 'launch', 'community'] },
  ],
  tiktok: [
    { tag: 'TikTokGrowth', weight: 1.25, keywords: ['viral', 'growth', 'trend', 'audience'] },
    { tag: 'ForYouStrategy', weight: 1.2, keywords: ['discover', 'reach', 'viral', 'trend'] },
    { tag: 'ShortFormVideo', weight: 1.15, keywords: ['video', 'clip', 'hook', 'short'] },
    {
      tag: 'CreatorEconomy',
      weight: 1.05,
      keywords: ['creator', 'content', 'monetize', 'audience'],
    },
  ],
  linkedin: [
    { tag: 'B2BMarketing', weight: 1.2, keywords: ['b2b', 'brand', 'marketing', 'pipeline'] },
    {
      tag: 'ThoughtLeadership',
      weight: 1.25,
      keywords: ['insight', 'leadership', 'strategy', 'industry'],
    },
    { tag: 'GrowthStrategy', weight: 1.1, keywords: ['growth', 'strategy', 'revenue', 'scale'] },
    { tag: 'PersonalBrand', weight: 1.05, keywords: ['brand', 'founder', 'career', 'leadership'] },
  ],
  x: [
    { tag: 'MarketingTwitter', weight: 1.2, keywords: ['marketing', 'thread', 'growth', 'social'] },
    { tag: 'BuildInPublic', weight: 1.15, keywords: ['launch', 'build', 'product', 'community'] },
    {
      tag: 'CreatorStrategy',
      weight: 1.1,
      keywords: ['creator', 'audience', 'engagement', 'content'],
    },
    { tag: 'TrendWatch', weight: 1.05, keywords: ['trend', 'news', 'timely', 'conversation'] },
  ],
  youtube: [
    { tag: 'YouTubeGrowth', weight: 1.2, keywords: ['channel', 'video', 'audience', 'growth'] },
    { tag: 'VideoMarketing', weight: 1.15, keywords: ['video', 'marketing', 'reach', 'content'] },
    {
      tag: 'CreatorTools',
      weight: 1.05,
      keywords: ['creator', 'editing', 'workflow', 'production'],
    },
    { tag: 'AudienceRetention', weight: 1.1, keywords: ['hook', 'watch', 'audience', 'retention'] },
  ],
  facebook: [
    {
      tag: 'CommunityGrowth',
      weight: 1.15,
      keywords: ['community', 'audience', 'group', 'engagement'],
    },
    { tag: 'SocialCampaign', weight: 1.1, keywords: ['campaign', 'social', 'reach', 'brand'] },
    {
      tag: 'DigitalMarketing',
      weight: 1.05,
      keywords: ['digital', 'marketing', 'strategy', 'content'],
    },
    {
      tag: 'AudienceEngagement',
      weight: 1.1,
      keywords: ['engagement', 'comments', 'reach', 'social'],
    },
  ],
  generic: [
    { tag: 'SocialMedia', weight: 1.1, keywords: ['social', 'content', 'marketing', 'brand'] },
    {
      tag: 'ContentStrategy',
      weight: 1.1,
      keywords: ['content', 'strategy', 'audience', 'growth'],
    },
    {
      tag: 'AudienceGrowth',
      weight: 1.05,
      keywords: ['audience', 'reach', 'growth', 'engagement'],
    },
    {
      tag: 'DigitalMarketing',
      weight: 1.05,
      keywords: ['digital', 'marketing', 'campaign', 'brand'],
    },
  ],
};

const normalizePlatform = (platform?: string): SupportedPlatform => {
  const normalized = (platform ?? 'generic').trim().toLowerCase();

  if (normalized === 'twitter') {
    return 'x';
  }

  if (normalized in TREND_CATALOG) {
    return normalized as SupportedPlatform;
  }

  return 'generic';
};

const toWords = (text: string): string[] => {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
};

const toHashtag = (value: string): string => {
  const compact = value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');

  return compact ? `#${compact}` : '';
};

const getKeywordScores = (words: string[]): Map<string, number> => {
  const scores = new Map<string, number>();

  words.forEach((word, index) => {
    const positionalBoost = index < 8 ? 0.35 : 0;
    scores.set(word, (scores.get(word) ?? 0) + 1 + positionalBoost);
  });

  for (let index = 0; index < words.length - 1; index += 1) {
    const phrase = `${words[index]} ${words[index + 1]}`;
    scores.set(phrase, (scores.get(phrase) ?? 0) + 1.4);
  }

  return scores;
};

const buildHeuristicHashtags = (
  text: string,
  platform: SupportedPlatform,
  maxTags: number,
): HashtagGenerationResult => {
  const words = toWords(text);
  const keywordScores = getKeywordScores(words);
  const trendSignals = TREND_CATALOG[platform];

  const ranked = Array.from(keywordScores.entries()).map(([term, score]) => {
    const trendBoost = trendSignals.reduce((total, signal) => {
      const matches = signal.keywords.some(
        (keyword) => term.includes(keyword) || keyword.includes(term),
      );
      return matches ? total + signal.weight : total;
    }, 0);

    return {
      term,
      score: score + trendBoost,
    };
  });

  const textHashtags = ranked
    .sort((left, right) => right.score - left.score)
    .map((entry) => toHashtag(entry.term))
    .filter(Boolean);

  const matchedTrendSignals = trendSignals.filter((signal) =>
    signal.keywords.some((keyword) => words.includes(keyword)),
  );

  const trendHashtags = matchedTrendSignals.map((signal) => `#${signal.tag}`);
  const platformTag = platform === 'generic' ? [] : [toHashtag(platform)];

  const hashtags = Array.from(new Set([...trendHashtags, ...textHashtags, ...platformTag])).slice(
    0,
    maxTags,
  );

  return {
    platform,
    source: 'heuristic',
    hashtags,
    analysis: {
      keywords: Array.from(new Set(words)).slice(0, 12),
      trendMatches: matchedTrendSignals.map((signal) => signal.tag),
      textLength: text.length,
      aiUsed: false,
    },
  };
};

const extractAiHashtags = (text: string): string[] => {
  const matches = text.match(/#?[A-Za-z][A-Za-z0-9_]+/g) ?? [];
  return Array.from(
    new Set(matches.map((value) => (value.startsWith('#') ? value : `#${value}`)).slice(0, 20)),
  );
};

const generateAiHashtags = async (
  text: string,
  platform: SupportedPlatform,
  maxTags: number,
  heuristic: HashtagGenerationResult,
): Promise<string[]> => {
  if (!aiClient) {
    throw new Error('GEMINI_API_KEY is not configured for AI hashtag generation.');
  }

  const trendHints =
    heuristic.analysis.trendMatches.length > 0
      ? heuristic.analysis.trendMatches.join(', ')
      : 'none';
  const fallbackHints = heuristic.hashtags.join(', ');

  const response = await aiClient.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      'You generate high-performing social media hashtags.',
      `Platform: ${platform}`,
      `Input text: ${text}`,
      `Relevant trend hints: ${trendHints}`,
      `Fallback hashtag seeds: ${fallbackHints}`,
      `Return only a comma-separated list of up to ${maxTags} hashtags. No commentary.`,
    ].join('\n'),
  });

  return extractAiHashtags(response.text ?? '').slice(0, maxTags);
};

/**
 * Deduplicates hashtags case-insensitively, preserving the first occurrence's casing.
 */
export const deduplicateHashtags = (hashtags: string[]): string[] => {
  const seen = new Set<string>();
  return hashtags.filter((tag) => {
    const key = tag.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Merges hashtag results from multiple language/platform runs and deduplicates them.
 */
export const mergeMultiLanguageHashtags = (
  results: HashtagGenerationResult[],
  maxTags = 20,
): string[] => {
  const merged = results.flatMap((r) => r.hashtags);
  return deduplicateHashtags(merged).slice(0, maxTags);
};

export const generateHashtagSuggestions = async (
  options: GenerationOptions,
): Promise<HashtagGenerationResult> => {
  const platform = normalizePlatform(options.platform);
  const maxTags = Math.min(Math.max(options.maxTags ?? 10, 1), 20);
  const heuristic = buildHeuristicHashtags(options.text, platform, maxTags);

  if (!options.useAi) {
    return heuristic;
  }

  try {
    const aiHashtags = await generateAiHashtags(options.text, platform, maxTags, heuristic);
    if (aiHashtags.length === 0) {
      return {
        ...heuristic,
        analysis: {
          ...heuristic.analysis,
          fallbackReason: 'AI returned no hashtags.',
        },
      };
    }

    return {
      ...heuristic,
      source: 'ai',
      hashtags: Array.from(new Set([...aiHashtags, ...heuristic.hashtags])).slice(0, maxTags),
      analysis: {
        ...heuristic.analysis,
        aiUsed: true,
      },
    };
  } catch (error) {
    return {
      ...heuristic,
      analysis: {
        ...heuristic.analysis,
        fallbackReason: error instanceof Error ? error.message : String(error),
      },
    };
  }
};
