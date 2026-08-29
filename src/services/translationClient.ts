import {
  TranslationRequest,
  TranslationResult,
  SupportedLanguage,
  TranslationProvider,
  BatchTranslationRequest,
  BatchTranslationResult,
} from '@socialflow/shared';
import { TranslationService as ApiTranslationService } from '../api/services/TranslationService';
import { OpenAPI } from '../api/core/OpenAPI';
import { request as apiRequest } from '../api/core/request';

export interface TranslateOptions {
  from?: string;
  to: string | string[];
  preserveFormatting?: boolean;
  preserveHashtags?: boolean;
  preserveMentions?: boolean;
  preserveUrls?: boolean;
  preserveEmojis?: boolean;
}

export class TranslationRateLimitError extends Error {
  public readonly retryAfter: number;
  public readonly status: number = 429;

  constructor(retryAfter: number = 60, message?: string) {
    super(message || `Rate limit exceeded. Retry after ${retryAfter} seconds.`);
    this.name = 'TranslationRateLimitError';
    this.retryAfter = retryAfter;
  }
}

const DEFAULT_LANGUAGES: SupportedLanguage[] = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇵🇹' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', flag: '🇰🇷' },
  { code: 'zh', name: 'Chinese', nativeName: '中文', flag: '🇨🇳' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', flag: '🇳🇱' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', flag: '🇵🇱' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', flag: '🇸🇪' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk', flag: '🇩🇰' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi', flag: '🇫🇮' },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk', flag: '🇳🇴' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština', flag: '🇨🇿' },
];

export class TranslationClient {
  private readonly STORAGE_LANGUAGES_KEY = 'sf_translation_languages';
  private readonly STORAGE_HISTORY_KEY = 'socialflow_translation_history';
  private readonly MAX_HISTORY = 50;
  public readonly LENGTH_CAP = 1000;

  // In-memory memoization cache for per-language translation results
  private readonly memoCache = new Map<string, TranslationResult>();

  // Cached languages in-memory
  private inMemoryLanguages: SupportedLanguage[] | null = null;

  /**
   * List supported languages.
   * Fetched once and cached in sessionStorage.
   */
  public async listLanguages(): Promise<SupportedLanguage[]> {
    if (this.inMemoryLanguages && this.inMemoryLanguages.length > 0) {
      return this.inMemoryLanguages;
    }

    if (typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined') {
      try {
        const cached = window.sessionStorage.getItem(this.STORAGE_LANGUAGES_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as SupportedLanguage[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            this.inMemoryLanguages = parsed;
            return parsed;
          }
        }
      } catch {
        // Ignore sessionStorage read errors
      }
    }

    try {
      const response = await ApiTranslationService.getTranslationLanguages();
      const languages: SupportedLanguage[] = Array.isArray(response)
        ? response
        : response?.languages || DEFAULT_LANGUAGES;

      this.inMemoryLanguages = languages;

      if (typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined') {
        try {
          window.sessionStorage.setItem(this.STORAGE_LANGUAGES_KEY, JSON.stringify(languages));
        } catch {
          // Ignore sessionStorage write errors
        }
      }

      return languages;
    } catch {
      this.inMemoryLanguages = DEFAULT_LANGUAGES;
      return DEFAULT_LANGUAGES;
    }
  }

  /**
   * Get supported languages synchronously (returns cached or defaults).
   */
  public getSupportedLanguages(): SupportedLanguage[] {
    return this.inMemoryLanguages || DEFAULT_LANGUAGES;
  }

  /**
   * Detect source language of the given text.
   */
  public async detectLanguage(text: string): Promise<string> {
    if (!text || !text.trim()) {
      return 'en';
    }

    try {
      const result = await apiRequest<{ detectedLanguage: string }>(OpenAPI, {
        method: 'POST',
        url: '/translation/detect',
        body: { text },
        mediaType: 'application/json',
      });
      return result.detectedLanguage || 'en';
    } catch {
      return 'en';
    }
  }

  /**
   * Split long text into chunks along sentence boundaries.
   */
  public chunkText(text: string, maxChunkLength = this.LENGTH_CAP): string[] {
    if (!text || text.length <= maxChunkLength) {
      return [text];
    }

    const sentences = text.match(/[^.!?\n]+[.!?\n]+|\s*[\n]+\s*|[^.!?\n]+$/g) || [text];
    const chunks: string[] = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length <= maxChunkLength) {
        currentChunk += sentence;
      } else {
        if (currentChunk.length > 0) {
          chunks.push(currentChunk);
          currentChunk = '';
        }

        if (sentence.length > maxChunkLength) {
          // Break oversized sentence by words
          const words = sentence.split(' ');
          let wordChunk = '';
          for (const word of words) {
            if ((wordChunk + ' ' + word).trim().length <= maxChunkLength) {
              wordChunk = wordChunk ? `${wordChunk} ${word}` : word;
            } else {
              if (wordChunk) chunks.push(wordChunk);
              wordChunk = word;
            }
          }
          if (wordChunk) {
            currentChunk = wordChunk;
          }
        } else {
          currentChunk = sentence;
        }
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks.length > 0 ? chunks : [text];
  }

  /**
   * Translates content. Supports options { from, to } or TranslationRequest.
   * Handles length chunking, sentence boundary reassembly, memoization, and 429 surfacing.
   */
  public async translate(
    textOrRequest: string | TranslationRequest,
    options?: TranslateOptions,
  ): Promise<TranslationResult> {
    let text: string;
    let from: string | undefined;
    let targetLanguages: string[];
    let preserveFormatting: boolean | undefined;
    let preserveHashtags: boolean | undefined;
    let preserveMentions: boolean | undefined;
    let preserveUrls: boolean | undefined;
    let preserveEmojis: boolean | undefined;

    if (typeof textOrRequest === 'string') {
      text = textOrRequest;
      from = options?.from;
      targetLanguages = Array.isArray(options?.to)
        ? options.to
        : options?.to
          ? [options.to]
          : ['es'];
      preserveFormatting = options?.preserveFormatting;
      preserveHashtags = options?.preserveHashtags;
      preserveMentions = options?.preserveMentions;
      preserveUrls = options?.preserveUrls;
      preserveEmojis = options?.preserveEmojis;
    } else {
      text = textOrRequest.text;
      from = textOrRequest.sourceLanguage;
      targetLanguages = textOrRequest.targetLanguages;
      preserveFormatting = textOrRequest.preserveFormatting;
      preserveHashtags = textOrRequest.preserveHashtags;
      preserveMentions = textOrRequest.preserveMentions;
      preserveUrls = textOrRequest.preserveUrls;
      preserveEmojis = textOrRequest.preserveEmojis;
    }

    // Check memoization cache for all target languages
    const cacheKey = (lang: string) => `${text}::${from || 'auto'}::${lang}`;
    const missingTargets = targetLanguages.filter((lang) => !this.memoCache.has(cacheKey(lang)));

    if (missingTargets.length === 0 && targetLanguages.length > 0) {
      // All requested translations are already memoized! Reassemble result instantly.
      const cachedTranslations = targetLanguages.map(
        (lang) => this.memoCache.get(cacheKey(lang))!.translations[0],
      );
      const firstResult = this.memoCache.get(cacheKey(targetLanguages[0]))!;
      return {
        originalText: text,
        sourceLanguage: firstResult.sourceLanguage || from || 'en',
        translations: cachedTranslations,
        preservedElements: firstResult.preservedElements || [],
        provider: firstResult.provider || 'gemini',
        timestamp: new Date(),
      };
    }

    // If text exceeds length cap, chunk on sentence boundaries and translate in order
    if (text.length > this.LENGTH_CAP) {
      const chunks = this.chunkText(text, this.LENGTH_CAP);
      const chunkResults: TranslationResult[] = [];

      for (const chunk of chunks) {
        const chunkRes = await this.executeTranslateDirect({
          text: chunk,
          sourceLanguage: from,
          targetLanguages: missingTargets.length > 0 ? missingTargets : targetLanguages,
          preserveFormatting,
          preserveHashtags,
          preserveMentions,
          preserveUrls,
          preserveEmojis,
        });
        chunkResults.push(chunkRes);
      }

      // Reassemble translated chunks in order
      const combinedTranslations = (
        missingTargets.length > 0 ? missingTargets : targetLanguages
      ).map((targetLang) => {
        const combinedText = chunkResults
          .map((res) => {
            const tr = res.translations.find((t) => t.language === targetLang);
            return tr ? tr.text : '';
          })
          .join(' ');

        const langInfo = this.getLanguage(targetLang);
        return {
          language: targetLang,
          languageName: langInfo?.name || targetLang.toUpperCase(),
          text: combinedText,
          confidence:
            chunkResults[0]?.translations.find((t) => t.language === targetLang)?.confidence ??
            0.95,
        };
      });

      const finalResult: TranslationResult = {
        originalText: text,
        sourceLanguage: chunkResults[0]?.sourceLanguage || from || 'en',
        translations: combinedTranslations,
        preservedElements: chunkResults.flatMap((r) => r.preservedElements || []),
        provider: chunkResults[0]?.provider || 'gemini',
        timestamp: new Date(),
      };

      // Memoize per-language
      for (const t of finalResult.translations) {
        this.memoCache.set(cacheKey(t.language), {
          ...finalResult,
          translations: [t],
        });
      }

      this.saveToHistory({ text, sourceLanguage: from, targetLanguages }, finalResult);

      return finalResult;
    }

    // Direct single request
    const result = await this.executeTranslateDirect({
      text,
      sourceLanguage: from,
      targetLanguages: missingTargets.length > 0 ? missingTargets : targetLanguages,
      preserveFormatting,
      preserveHashtags,
      preserveMentions,
      preserveUrls,
      preserveEmojis,
    });

    // Memoize per-language
    for (const t of result.translations) {
      this.memoCache.set(cacheKey(t.language), {
        ...result,
        translations: [t],
      });
    }

    this.saveToHistory({ text, sourceLanguage: from, targetLanguages }, result);

    return result;
  }

  /**
   * Executes API call and surfaces 429 rate limit errors with retry-after header.
   */
  private async executeTranslateDirect(request: {
    text: string;
    sourceLanguage?: string;
    targetLanguages: string[];
    preserveFormatting?: boolean;
    preserveHashtags?: boolean;
    preserveMentions?: boolean;
    preserveUrls?: boolean;
    preserveEmojis?: boolean;
  }): Promise<TranslationResult> {
    try {
      const response = await ApiTranslationService.postTranslationTranslate({
        requestBody: {
          text: request.text,
          sourceLanguage: request.sourceLanguage,
          targetLanguages: request.targetLanguages,
          preserveFormatting: request.preserveFormatting,
          preserveHashtags: request.preserveHashtags,
          preserveMentions: request.preserveMentions,
          preserveUrls: request.preserveUrls,
          preserveEmojis: request.preserveEmojis,
        },
      });

      return {
        ...response,
        timestamp: new Date(response.timestamp || Date.now()),
      };
    } catch (err: unknown) {
      const errorObj = err as {
        status?: number;
        statusCode?: number;
        response?: {
          status?: number;
          headers?: Record<string, string>;
          data?: { retryAfter?: number };
        };
        body?: { retryAfter?: number; error?: string };
        headers?: Record<string, string>;
      };

      const status = errorObj?.status || errorObj?.statusCode || errorObj?.response?.status;
      if (status === 429) {
        const retryAfterHeader =
          errorObj?.headers?.['retry-after'] || errorObj?.response?.headers?.['retry-after'];
        const retryAfter =
          (retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined) ||
          errorObj?.body?.retryAfter ||
          errorObj?.response?.data?.retryAfter ||
          60;

        throw new TranslationRateLimitError(
          retryAfter,
          `Rate limit exceeded. Please retry after ${retryAfter} seconds.`,
        );
      }

      throw err;
    }
  }

  /**
   * Clear the memoization cache.
   */
  public clearCache(): void {
    this.memoCache.clear();
  }

  /**
   * Get language by code.
   */
  public getLanguage(code: string): SupportedLanguage | undefined {
    return this.getSupportedLanguages().find((lang) => lang.code === code);
  }

  /**
   * Search languages by query string.
   */
  public searchLanguages(query: string): SupportedLanguage[] {
    const lowerQuery = query.toLowerCase();
    return this.getSupportedLanguages().filter(
      (lang) =>
        lang.name.toLowerCase().includes(lowerQuery) ||
        lang.nativeName.toLowerCase().includes(lowerQuery) ||
        lang.code.toLowerCase().includes(lowerQuery),
    );
  }

  /**
   * Get available translation providers from backend.
   */
  public async getAvailableProviders(): Promise<TranslationProvider[]> {
    try {
      const result = await apiRequest<{ providers: TranslationProvider[] }>(OpenAPI, {
        method: 'GET',
        url: '/translation/providers',
      });
      return result.providers || [];
    } catch {
      return [];
    }
  }

  /**
   * Batch translate multiple texts.
   */
  public async batchTranslate(request: BatchTranslationRequest): Promise<BatchTranslationResult> {
    const startTime = Date.now();
    const result = await apiRequest<{
      translations: TranslationResult[];
      totalTexts: number;
      duration: number;
    }>(OpenAPI, {
      method: 'POST',
      url: '/translation/batch',
      body: {
        texts: request.texts,
        sourceLanguage: request.sourceLanguage,
        targetLanguages: request.targetLanguages,
      },
      mediaType: 'application/json',
    });

    const totalCharacters = request.texts.reduce((sum, t) => sum + t.length, 0);
    const duration = Date.now() - startTime;

    return {
      translations: result.translations.map((t) => ({ ...t, timestamp: new Date(t.timestamp) })),
      totalCharacters,
      provider: 'backend',
      duration,
    };
  }

  /**
   * Estimate translation cost.
   */
  public estimateCost(
    text: string,
    targetLanguages: string[],
    provider: 'deepl' | 'google' = 'deepl',
  ): { characters: number; estimatedCost: number; currency: string } {
    const characters = text.length * targetLanguages.length;
    const pricing = {
      deepl: 20 / 1000000,
      google: 20 / 1000000,
    };
    const costPerChar = pricing[provider] || 0.00002;
    const estimatedCost = characters * costPerChar;

    return {
      characters,
      estimatedCost: Math.max(0.01, estimatedCost),
      currency: 'USD',
    };
  }

  /**
   * Validate translation quality.
   */
  public async validateTranslation(
    original: string,
    translated: string,
    _targetLang?: string,
  ): Promise<{ valid: boolean; issues: string[] }> {
    const issues: string[] = [];

    const lengthRatio = translated.length / Math.max(1, original.length);
    if (lengthRatio < 0.5 || lengthRatio > 2.0) {
      issues.push('Translation length significantly different from original');
    }

    const originalUrls = original.match(/https?:\/\/[^\s]+/g) || [];
    const translatedUrls = translated.match(/https?:\/\/[^\s]+/g) || [];
    if (originalUrls.length !== translatedUrls.length) {
      issues.push('URLs may not be preserved correctly');
    }

    const originalHashtags = original.match(/#\w+/g) || [];
    const translatedHashtags = translated.match(/#\w+/g) || [];
    if (originalHashtags.length !== translatedHashtags.length) {
      issues.push('Hashtags may not be preserved correctly');
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Get popular language pairs.
   */
  public getPopularLanguagePairs(): Array<{ from: string; to: string[]; label: string }> {
    return [
      { from: 'en', to: ['es', 'fr', 'de', 'pt'], label: 'English to European' },
      { from: 'en', to: ['ja', 'ko', 'zh'], label: 'English to Asian' },
      { from: 'en', to: ['ar', 'hi'], label: 'English to Middle East/India' },
      { from: 'es', to: ['en', 'pt', 'fr'], label: 'Spanish to Major Languages' },
      { from: 'zh', to: ['en', 'ja', 'ko'], label: 'Chinese to English/Asian' },
    ];
  }

  /**
   * Get translation history from local storage.
   */
  public getHistory(): TranslationResult[] {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return [];
      const stored = window.localStorage.getItem(this.STORAGE_HISTORY_KEY);
      if (!stored) return [];

      const history = JSON.parse(stored) as TranslationResult[];
      return history.map((item) => ({
        ...item,
        timestamp: new Date(item.timestamp),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Save translation to history.
   */
  private saveToHistory(_request: TranslationRequest, result: TranslationResult): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const history = this.getHistory();
      history.unshift(result);
      const trimmed = history.slice(0, this.MAX_HISTORY);
      window.localStorage.setItem(this.STORAGE_HISTORY_KEY, JSON.stringify(trimmed));
    } catch {
      // Ignore localStorage errors
    }
  }

  /**
   * Clear translation history.
   */
  public clearHistory(): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(this.STORAGE_HISTORY_KEY);
    }
  }
}

export const translationClient = new TranslationClient();
export default translationClient;
