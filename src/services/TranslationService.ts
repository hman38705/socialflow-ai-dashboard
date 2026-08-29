import { TranslationService as ApiTranslationService } from '../api/services/TranslationService';
import type { TranslationRequest, TranslationResult, SupportedLanguage } from '@socialflow/shared';

export const DEFAULT_LANGUAGES: SupportedLanguage[] = [
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇵🇹' },
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

const LAST_LANG_KEY_PREFIX = 'socialflow_last_target_language';
const HISTORY_STORAGE_KEY = 'socialflow_translation_history';
const MAX_HISTORY = 50;

export class FrontendTranslationService {
  private languages: SupportedLanguage[] = DEFAULT_LANGUAGES;

  public getSupportedLanguages(): SupportedLanguage[] {
    return this.languages;
  }

  public searchLanguages(query: string): SupportedLanguage[] {
    if (!query) return this.languages;
    const lowerQuery = query.toLowerCase();
    return this.languages.filter(
      (lang) =>
        lang.name.toLowerCase().includes(lowerQuery) ||
        lang.nativeName.toLowerCase().includes(lowerQuery) ||
        lang.code.toLowerCase().includes(lowerQuery),
    );
  }

  public getLanguage(code: string): SupportedLanguage | undefined {
    return this.languages.find((lang) => lang.code.toLowerCase() === code.toLowerCase());
  }

  public getLastUsedLanguage(userId?: string): string {
    try {
      const key = userId ? `${LAST_LANG_KEY_PREFIX}_${userId}` : LAST_LANG_KEY_PREFIX;
      return localStorage.getItem(key) || 'es';
    } catch {
      return 'es';
    }
  }

  public setLastUsedLanguage(langCode: string, userId?: string): void {
    try {
      const key = userId ? `${LAST_LANG_KEY_PREFIX}_${userId}` : LAST_LANG_KEY_PREFIX;
      localStorage.setItem(key, langCode);
      if (userId) {
        localStorage.setItem(LAST_LANG_KEY_PREFIX, langCode);
      }
    } catch (e) {
      console.warn('Failed to persist last used language:', e);
    }
  }

  public async translate(request: TranslationRequest): Promise<TranslationResult> {
    const rawResult = await ApiTranslationService.postTranslationTranslate({
      requestBody: {
        text: request.text,
        sourceLanguage: request.sourceLanguage,
        targetLanguages: request.targetLanguages,
        preserveFormatting: request.preserveFormatting ?? true,
        preserveHashtags: request.preserveHashtags ?? true,
        preserveMentions: request.preserveMentions ?? true,
        preserveUrls: request.preserveUrls ?? true,
        preserveEmojis: request.preserveEmojis ?? true,
      },
    });

    const result: TranslationResult = {
      originalText: rawResult?.originalText || request.text,
      sourceLanguage: rawResult?.sourceLanguage || request.sourceLanguage || 'en',
      translations: rawResult?.translations || [],
      preservedElements: rawResult?.preservedElements || [],
      provider: rawResult?.provider || 'deepl',
      timestamp: rawResult?.timestamp ? new Date(rawResult.timestamp) : new Date(),
    };

    if (request.targetLanguages.length > 0) {
      this.setLastUsedLanguage(request.targetLanguages[0]);
    }

    this.saveToHistory(request, result);
    return result;
  }

  public getHistory(): TranslationResult[] {
    try {
      const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (!stored) return [];
      const history = JSON.parse(stored);
      return history.map((item: any) => ({
        ...item,
        timestamp: new Date(item.timestamp),
      }));
    } catch {
      return [];
    }
  }

  private saveToHistory(request: TranslationRequest, result: TranslationResult): void {
    try {
      const history = this.getHistory();
      history.unshift(result);
      const trimmed = history.slice(0, MAX_HISTORY);
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) {
      console.warn('Failed to save translation history:', e);
    }
  }

  public clearHistory(): void {
    try {
      localStorage.removeItem(HISTORY_STORAGE_KEY);
    } catch (e) {
      console.warn('Failed to clear translation history:', e);
    }
  }
}

export const translationService = new FrontendTranslationService();
