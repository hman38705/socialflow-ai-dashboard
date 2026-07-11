import { GoogleGenAI } from '@google/genai';
import {
  TranslationRequest,
  TranslationResult,
  Translation,
  PreservedElement,
  SupportedLanguage,
  TranslationProvider,
  BatchTranslationRequest,
  BatchTranslationResult,
} from '@socialflow/shared';

/**
 * TranslationService - Multi-language content translation
 * 
 * Features:
 * - Multiple provider support (DeepL, Google Translate, Gemini AI)
 * - Preserves URLs, mentions, hashtags, emojis
 * - Batch translation support
 * - Auto language detection
 * - Translation history
 */
class TranslationService {
  private genAI: GoogleGenAI | null = null;
  private model: string | null = null;
  private readonly STORAGE_KEY = 'socialflow_translation_history';
  private readonly MAX_HISTORY = 50;

  // Supported languages
  private readonly LANGUAGES: SupportedLanguage[] = [
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

  constructor() {
    this.initializeAI();
  }

  /**
   * Initialize Google Gemini AI
   */
  private initializeAI(): void {
    const apiKey = import.meta.env.VITE_API_KEY;
    
    if (apiKey && apiKey !== 'your_gemini_api_key_here') {
      try {
        this.genAI = new GoogleGenAI({ apiKey });
        this.model = 'gemini-2.5-flash';
      } catch (error) {
        console.warn('Failed to initialize Gemini AI:', error);
      }
    }
  }

  /**
   * Translate content to multiple languages
   */
  public async translate(request: TranslationRequest): Promise<TranslationResult> {
    const {
      text,
      sourceLanguage,
      targetLanguages,
      preserveFormatting = true,
      preserveHashtags = true,
      preserveMentions = true,
      preserveUrls = true,
      preserveEmojis = true,
    } = request;

    // Extract and preserve special elements
    const { processedText, preservedElements } = this.extractPreservedElements(text, {
      preserveHashtags,
      preserveMentions,
      preserveUrls,
      preserveEmojis,
    });

    // Detect source language if not provided
    const detectedSourceLang = sourceLanguage || await this.detectLanguage(text);

    // Translate to each target language
    const translations: Translation[] = [];
    
    for (const targetLang of targetLanguages) {
      if (targetLang === detectedSourceLang) {
        // Skip if target is same as source
        translations.push({
          language: targetLang,
          languageName: this.getLanguageName(targetLang),
          text: text,
          confidence: 1.0,
        });
        continue;
      }

      try {
        const translatedText = await this.translateText(
          processedText,
          detectedSourceLang,
          targetLang
        );

        // Restore preserved elements
        const finalText = this.restorePreservedElements(translatedText, preservedElements);

        translations.push({
          language: targetLang,
          languageName: this.getLanguageName(targetLang),
          text: finalText,
          confidence: 0.95,
        });
      } catch (error) {
        console.error(`Failed to translate to ${targetLang}:`, error);
        translations.push({
          language: targetLang,
          languageName: this.getLanguageName(targetLang),
          text: text, // Fallback to original
          confidence: 0,
        });
      }
    }

    const result: TranslationResult = {
      originalText: text,
      sourceLanguage: detectedSourceLang,
      translations,
      preservedElements,
      provider: this.model ? 'gemini' : 'google',
      timestamp: new Date(),
    };

    // Save to history
    this.saveToHistory(request, result);

    return result;
  }

  /**
   * Extract elements to preserve during translation
   */
  private extractPreservedElements(
    text: string,
    options: {
      preserveHashtags: boolean;
      preserveMentions: boolean;
      preserveUrls: boolean;
      preserveEmojis: boolean;
    }
  ): { processedText: string; preservedElements: PreservedElement[] } {
    let processedText = text;
    const preservedElements: PreservedElement[] = [];
    let placeholderIndex = 0;

    // Preserve URLs
    if (options.preserveUrls) {
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      processedText = processedText.replace(urlRegex, (match) => {
        const placeholder = `__URL_${placeholderIndex++}__`;
        preservedElements.push({ type: 'url', value: match, placeholder });
        return placeholder;
      });
    }

    // Preserve mentions (@username)
    if (options.preserveMentions) {
      const mentionRegex = /@(\w+)/g;
      processedText = processedText.replace(mentionRegex, (match) => {
        const placeholder = `__MENTION_${placeholderIndex++}__`;
        preservedElements.push({ type: 'mention', value: match, placeholder });
        return placeholder;
      });
    }

    // Preserve hashtags
    if (options.preserveHashtags) {
      const hashtagRegex = /#(\w+)/g;
      processedText = processedText.replace(hashtagRegex, (match) => {
        const placeholder = `__HASHTAG_${placeholderIndex++}__`;
        preservedElements.push({ type: 'hashtag', value: match, placeholder });
        return placeholder;
      });
    }

    // Preserve emojis
    if (options.preserveEmojis) {
      const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
      processedText = processedText.replace(emojiRegex, (match) => {
        const placeholder = `__EMOJI_${placeholderIndex++}__`;
        preservedElements.push({ type: 'emoji', value: match, placeholder });
        return placeholder;
      });
    }

    return { processedText, preservedElements };
  }

  /**
   * Restore preserved elements after translation
   */
  private restorePreservedElements(
    translatedText: string,
    preservedElements: PreservedElement[]
  ): string {
    let restoredText = translatedText;

    preservedElements.forEach(element => {
      restoredText = restoredText.replace(element.placeholder, element.value);
    });

    return restoredText;
  }

  /**
   * Translate text using available provider
   */
  private async translateText(
    text: string,
    sourceLang: string,
    targetLang: string
  ): Promise<string> {
    // Try Gemini AI first if available
    if (this.model) {
      try {
        return await this.translateWithGemini(text, sourceLang, targetLang);
      } catch (error) {
        console.warn('Gemini translation failed, using fallback:', error);
      }
    }

    // Fallback to mock translation (in production, use DeepL or Google Translate API)
    return this.mockTranslate(text, targetLang);
  }

  /**
   * Translate using Google Gemini AI
   */
  private async translateWithGemini(
    text: string,
    sourceLang: string,
    targetLang: string
  ): Promise<string> {
    if (!this.genAI || !this.model) {
      throw new Error('Gemini AI not initialized');
    }

    const sourceLanguageName = this.getLanguageName(sourceLang);
    const targetLanguageName = this.getLanguageName(targetLang);

    const prompt = `Translate the following text from ${sourceLanguageName} to ${targetLanguageName}.
Preserve the tone, style, and meaning. Only return the translated text, nothing else.

Text to translate: "${text}"

Translation:`;

    const result = await this.genAI.models.generateContent({
      model: this.model,
      contents: prompt,
    });
    return (result.text ?? '').trim();
  }

  /**
   * Mock translation (placeholder for DeepL/Google Translate API)
   */
  private mockTranslate(text: string, targetLang: string): string {
    // In production, replace with actual API calls
    const mockTranslations: Record<string, Record<string, string>> = {
      es: {
        'Hello world': 'Hola mundo',
        'Thank you': 'Gracias',
        'Good morning': 'Buenos días',
      },
      fr: {
        'Hello world': 'Bonjour le monde',
        'Thank you': 'Merci',
        'Good morning': 'Bonjour',
      },
      de: {
        'Hello world': 'Hallo Welt',
        'Thank you': 'Danke',
        'Good morning': 'Guten Morgen',
      },
    };

    // Simple mock - in production, call actual API
    return mockTranslations[targetLang]?.[text] || `[${targetLang.toUpperCase()}] ${text}`;
  }

  /**
   * Detect source language
   */
  private async detectLanguage(text: string): Promise<string> {
    // Simple heuristic-based detection
    // In production, use proper language detection API
    
    // Check for common patterns
    if (/[а-яА-Я]/.test(text)) return 'ru';
    if (/[ა-ჰ]/.test(text)) return 'ka';
    if (/[\u4e00-\u9fa5]/.test(text)) return 'zh';
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja';
    if (/[\uac00-\ud7af]/.test(text)) return 'ko';
    if (/[\u0600-\u06ff]/.test(text)) return 'ar';
    if (/[\u0900-\u097f]/.test(text)) return 'hi';
    
    // Default to English
    return 'en';
  }

  /**
   * Get language name from code
   */
  private getLanguageName(code: string): string {
    const language = this.LANGUAGES.find(lang => lang.code === code);
    return language?.name || code.toUpperCase();
  }

  /**
   * Get all supported languages
   */
  public getSupportedLanguages(): SupportedLanguage[] {
    return this.LANGUAGES;
  }

  /**
   * Get available translation providers
   */
  public getAvailableProviders(): TranslationProvider[] {
    const providers: TranslationProvider[] = [];

    // Gemini AI
    if (this.model) {
      providers.push({
        name: 'Google Gemini AI',
        available: true,
        languages: this.LANGUAGES.map(l => l.code),
        characterLimit: 30000,
      });
    }

    // DeepL (mock - check for API key in production)
    const deeplApiKey = import.meta.env.VITE_DEEPL_API_KEY;
    providers.push({
      name: 'DeepL',
      available: !!deeplApiKey,
      languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'zh', 'nl', 'pl'],
      characterLimit: 5000,
      rateLimit: 500000, // 500k characters/month free tier
    });

    // Google Translate (mock - check for API key in production)
    const googleApiKey = import.meta.env.VITE_GOOGLE_TRANSLATE_API_KEY;
    providers.push({
      name: 'Google Translate',
      available: !!googleApiKey,
      languages: this.LANGUAGES.map(l => l.code),
      characterLimit: 100000,
    });

    return providers;
  }

  /**
   * Batch translate multiple texts
   */
  public async batchTranslate(request: BatchTranslationRequest): Promise<BatchTranslationResult> {
    const startTime = Date.now();
    const translations: TranslationResult[] = [];
    let totalCharacters = 0;

    for (const text of request.texts) {
      totalCharacters += text.length;
      
      const result = await this.translate({
        text,
        sourceLanguage: request.sourceLanguage,
        targetLanguages: request.targetLanguages,
        preserveFormatting: request.preserveFormatting,
      });

      translations.push(result);
    }

    const duration = Date.now() - startTime;

    return {
      translations,
      totalCharacters,
      provider: this.model ? 'gemini' : 'google',
      duration,
    };
  }

  /**
   * Translate with DeepL API
   */
  public async translateWithDeepL(
    text: string,
    sourceLang: string,
    targetLang: string
  ): Promise<string> {
    const apiKey = import.meta.env.VITE_DEEPL_API_KEY;
    
    if (!apiKey) {
      throw new Error('DeepL API key not configured');
    }

    try {
      const response = await fetch('https://api-free.deepl.com/v2/translate', {
        method: 'POST',
        headers: {
          'Authorization': `DeepL-Auth-Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: [text],
          source_lang: sourceLang.toUpperCase(),
          target_lang: targetLang.toUpperCase(),
          preserve_formatting: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`DeepL API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.translations[0].text;
    } catch (error) {
      console.error('DeepL translation error:', error);
      throw error;
    }
  }

  /**
   * Translate with Google Translate API
   */
  public async translateWithGoogle(
    text: string,
    sourceLang: string,
    targetLang: string
  ): Promise<string> {
    const apiKey = import.meta.env.VITE_GOOGLE_TRANSLATE_API_KEY;
    
    if (!apiKey) {
      throw new Error('Google Translate API key not configured');
    }

    try {
      const response = await fetch(
        `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            q: text,
            source: sourceLang,
            target: targetLang,
            format: 'text',
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Google Translate API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data.translations[0].translatedText;
    } catch (error) {
      console.error('Google Translate error:', error);
      throw error;
    }
  }

  /**
   * Get translation history
   */
  public getHistory(): TranslationResult[] {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (!stored) return [];
      
      const history = JSON.parse(stored);
      return history.map((item: any) => ({
        ...item,
        timestamp: new Date(item.timestamp),
      }));
    } catch (error) {
      console.error('Failed to load translation history:', error);
      return [];
    }
  }

  /**
   * Save translation to history
   */
  private saveToHistory(request: TranslationRequest, result: TranslationResult): void {
    try {
      const history = this.getHistory();
      history.unshift(result);
      
      // Keep only last MAX_HISTORY items
      const trimmedHistory = history.slice(0, this.MAX_HISTORY);
      
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(trimmedHistory));
    } catch (error) {
      console.error('Failed to save translation history:', error);
    }
  }

  /**
   * Clear translation history
   */
  public clearHistory(): void {
    localStorage.removeItem(this.STORAGE_KEY);
  }

  /**
   * Get popular language pairs
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
   * Estimate translation cost (for paid APIs)
   */
  public estimateCost(
    text: string,
    targetLanguages: string[],
    provider: 'deepl' | 'google'
  ): { characters: number; estimatedCost: number; currency: string } {
    const characters = text.length * targetLanguages.length;
    
    // Pricing estimates (as of 2024)
    const pricing = {
      deepl: 20 / 1000000, // $20 per 1M characters
      google: 20 / 1000000, // $20 per 1M characters
    };

    const costPerChar = pricing[provider];
    const estimatedCost = characters * costPerChar;

    return {
      characters,
      estimatedCost: Math.max(0.01, estimatedCost), // Minimum $0.01
      currency: 'USD',
    };
  }

  /**
   * Validate translation quality
   */
  public async validateTranslation(
    original: string,
    translated: string,
    targetLang: string
  ): Promise<{ valid: boolean; issues: string[] }> {
    const issues: string[] = [];

    // Check length difference (shouldn't be too drastic)
    const lengthRatio = translated.length / original.length;
    if (lengthRatio < 0.5 || lengthRatio > 2.0) {
      issues.push('Translation length significantly different from original');
    }

    // Check if preserved elements are intact
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
   * Get language by code
   */
  public getLanguage(code: string): SupportedLanguage | undefined {
    return this.LANGUAGES.find(lang => lang.code === code);
  }

  /**
   * Search languages
   */
  public searchLanguages(query: string): SupportedLanguage[] {
    const lowerQuery = query.toLowerCase();
    return this.LANGUAGES.filter(lang =>
      lang.name.toLowerCase().includes(lowerQuery) ||
      lang.nativeName.toLowerCase().includes(lowerQuery) ||
      lang.code.toLowerCase().includes(lowerQuery)
    );
  }
}

export const translationService = new TranslationService();
