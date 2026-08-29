import React, { useState, useEffect, useRef, useMemo } from 'react';
import { translationService, DEFAULT_LANGUAGES } from '../../services/TranslationService';
import type { SupportedLanguage, TranslationResult } from '@socialflow/shared';

export interface TranslationWidgetProps {
  /** Text content to translate */
  text: string;
  /** Optional user ID for per-user language preference */
  userId?: string;
  /** Source language code (default "auto" or "en") */
  sourceLanguage?: string;
  /** Optional pre-selected target language code */
  defaultTargetLanguage?: string;
  /** Debounce delay in ms before triggering translation API call */
  debounceMs?: number;
  /** Whether the widget starts expanded */
  defaultExpanded?: boolean;
  /** Compact inline variant styling */
  compact?: boolean;
  /** Callback when translation completes */
  onTranslated?: (translatedText: string, targetLanguage: string) => void;
  /** Callback when widget is collapsed / original restored */
  onCollapse?: () => void;
  /** Callback when widget is expanded */
  onExpand?: () => void;
  /** Additional CSS class names */
  className?: string;
}

const MaterialIcon = ({ name, className }: { name: string; className?: string }) => (
  <span
    className={`material-symbols-outlined select-none inline-flex items-center justify-center ${className || ''}`}
    aria-hidden="true"
  >
    {name}
  </span>
);

export const TranslationWidget: React.FC<TranslationWidgetProps> = ({
  text,
  userId,
  sourceLanguage,
  defaultTargetLanguage,
  debounceMs = 0,
  defaultExpanded = false,
  compact = true,
  onTranslated,
  onCollapse,
  onExpand,
  className = '',
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(() => {
    const remembered =
      defaultTargetLanguage || translationService.getLastUsedLanguage(userId) || 'es';
    return [remembered];
  });
  const [showLanguageSelector, setShowLanguageSelector] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [translationResult, setTranslationResult] = useState<TranslationResult | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  // All and popular languages
  const languages: SupportedLanguage[] = useMemo(() => {
    try {
      return translationService.getSupportedLanguages() || DEFAULT_LANGUAGES;
    } catch {
      return DEFAULT_LANGUAGES;
    }
  }, []);

  const popularLanguageCodes = useMemo(() => ['es', 'fr', 'de', 'pt', 'ja', 'zh', 'ar'], []);

  const filteredLanguages = useMemo(() => {
    if (!searchQuery.trim()) return languages;
    return languages.filter(
      (l) =>
        l.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        l.nativeName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        l.code.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [languages, searchQuery]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  const toggleLanguage = (code: string) => {
    setSelectedLanguages((prev) => {
      const exists = prev.includes(code);
      let updated: string[];
      if (exists) {
        updated = prev.filter((c) => c !== code);
      } else {
        updated = [...prev, code];
      }
      if (!exists && updated.length > 0) {
        translationService.setLastUsedLanguage(code, userId);
      }
      return updated;
    });
  };

  const selectSingleLanguage = (code: string) => {
    setSelectedLanguages([code]);
    translationService.setLastUsedLanguage(code, userId);
    setShowLanguageSelector(false);
  };

  const executeTranslation = async (targetLangs: string[]) => {
    if (!text || targetLangs.length === 0) return;

    setLoading(true);
    setError(null);

    try {
      const result = await translationService.translate({
        text,
        sourceLanguage,
        targetLanguages: targetLangs,
        preserveFormatting: true,
        preserveHashtags: true,
        preserveMentions: true,
        preserveUrls: true,
        preserveEmojis: true,
      });

      if (isMountedRef.current) {
        setTranslationResult(result);
        setLoading(false);
        if (result.translations.length > 0 && onTranslated) {
          onTranslated(result.translations[0].text, result.translations[0].language);
        }
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : 'Translation failed');
        setLoading(false);
      }
    }
  };

  const handleTranslate = () => {
    if (!text || selectedLanguages.length === 0) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (debounceMs > 0) {
      debounceTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          executeTranslation(selectedLanguages);
        }
      }, debounceMs);
    } else {
      executeTranslation(selectedLanguages);
    }
  };

  const handleToggleExpand = () => {
    if (isExpanded) {
      setIsExpanded(false);
      setTranslationResult(null);
      setError(null);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      onCollapse?.();
    } else {
      setIsExpanded(true);
      onExpand?.();
    }
  };

  const copyTranslation = async (str: string, index: number) => {
    try {
      await navigator.clipboard.writeText(str);
      setCopiedIndex(index);
      setTimeout(() => {
        if (isMountedRef.current) setCopiedIndex(null);
      }, 2000);
    } catch (e) {
      console.warn('Failed to copy:', e);
    }
  };

  const currentTargetLang = languages.find((l) => l.code === selectedLanguages[0]) || languages[0];

  // Collapsed inline view
  if (!isExpanded) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 ${className}`}
        data-testid="translation-widget-compact"
      >
        <button
          type="button"
          onClick={handleToggleExpand}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-primary-blue hover:text-white hover:bg-primary-blue/20 border border-primary-blue/30 transition-all focus:outline-none focus:ring-1 focus:ring-primary-blue"
          title="Translate post"
          aria-label="Translate"
        >
          <MaterialIcon name="translate" className="text-sm" />
          <span>Translate</span>
          {currentTargetLang && (
            <span className="text-[10px] text-gray-400 opacity-80">
              ({currentTargetLang.flag} {currentTargetLang.code.toUpperCase()})
            </span>
          )}
        </button>
      </div>
    );
  }

  // Expanded in-place view
  return (
    <div
      className={`bg-dark-surface/95 border border-dark-border rounded-xl p-4 space-y-3 shadow-lg transition-all ${className}`}
      data-testid="translation-widget-expanded"
    >
      {/* Header with expand/collapse */}
      <div className="flex items-center justify-between gap-2 border-b border-dark-border/60 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary-blue/20 flex items-center justify-center text-primary-blue">
            <MaterialIcon name="translate" className="text-base" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-white tracking-wide uppercase">
              Inline Translation
            </h4>
            <p className="text-[11px] text-gray-subtext">
              Expands in-place to view or copy translations
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {translationResult && (
            <span className="text-[10px] text-gray-400 bg-dark-bg px-2 py-0.5 rounded border border-dark-border">
              via {translationResult.provider.toUpperCase()}
            </span>
          )}
          <button
            type="button"
            onClick={handleToggleExpand}
            className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Restore original text"
            aria-label="Collapse translation"
          >
            <MaterialIcon name="close" className="text-base" />
          </button>
        </div>
      </div>

      {/* Target Language Selection Pills */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[11px] font-semibold text-gray-300">Target Language:</label>
          <button
            type="button"
            onClick={() => setShowLanguageSelector(!showLanguageSelector)}
            className="text-[11px] text-primary-blue hover:text-blue-300 underline font-medium"
          >
            {showLanguageSelector ? 'Hide All' : 'More Languages...'}
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {popularLanguageCodes.map((langCode) => {
            const lang = languages.find((l) => l.code === langCode);
            if (!lang) return null;
            const isSelected = selectedLanguages.includes(langCode);

            return (
              <button
                key={langCode}
                type="button"
                onClick={() => selectSingleLanguage(langCode)}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all ${
                  isSelected
                    ? 'bg-primary-blue text-white shadow-sm font-semibold'
                    : 'bg-dark-bg text-gray-300 hover:bg-dark-border hover:text-white border border-dark-border'
                }`}
              >
                <span>{lang.flag}</span>
                <span>{lang.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Full Language Search Dropdown */}
      {showLanguageSelector && (
        <div className="space-y-2 bg-dark-bg rounded-lg p-2.5 border border-dark-border">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search languages..."
            className="w-full bg-dark-surface border border-dark-border rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-primary-blue"
          />
          <div className="max-h-36 overflow-y-auto space-y-1">
            {filteredLanguages.map((lang) => {
              const isSelected = selectedLanguages.includes(lang.code);
              return (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => selectSingleLanguage(lang.code)}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                    isSelected
                      ? 'bg-primary-blue text-white font-medium'
                      : 'text-gray-300 hover:bg-dark-surface'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span>{lang.flag}</span>
                    <span>{lang.name}</span>
                    <span className="text-[10px] opacity-60">({lang.nativeName})</span>
                  </div>
                  {isSelected && <MaterialIcon name="check" className="text-sm" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Translate Action Button */}
      <button
        type="button"
        onClick={handleTranslate}
        disabled={loading || !text || selectedLanguages.length === 0}
        className="w-full bg-primary-blue text-white py-2 px-4 rounded-xl text-xs font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-1.5"
      >
        {loading ? (
          <>
            <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />
            <span>Translating...</span>
          </>
        ) : (
          <>
            <MaterialIcon name="translate" className="text-sm" />
            <span>
              Translate to {selectedLanguages.length} Language
              {selectedLanguages.length !== 1 ? 's' : ''}
            </span>
          </>
        )}
      </button>

      {/* Error state */}
      {error && (
        <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
          <MaterialIcon name="error" className="text-sm" />
          <span>{error}</span>
        </div>
      )}

      {/* Results view */}
      {translationResult && (
        <div className="space-y-2 pt-1 border-t border-dark-border/60">
          <div className="flex items-center justify-between text-[11px] text-gray-subtext">
            <span>Translations ({translationResult.translations.length})</span>
            <span>Source: {translationResult.sourceLanguage.toUpperCase()}</span>
          </div>

          {translationResult.translations.map((t, idx) => {
            const lang = languages.find((l) => l.code === t.language);
            return (
              <div
                key={idx}
                className="bg-dark-bg/80 border border-dark-border/70 rounded-lg p-3 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-white">
                    <span>{lang?.flag}</span>
                    <span>{t.languageName || lang?.name}</span>
                    {t.confidence && (
                      <span className="text-[10px] text-gray-400">
                        ({Math.round(t.confidence * 100)}% match)
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => copyTranslation(t.text, idx)}
                    className="p-1 rounded text-primary-blue hover:text-white hover:bg-primary-blue/20 transition-colors"
                    title="Copy translation"
                  >
                    <MaterialIcon
                      name={copiedIndex === idx ? 'check' : 'content_copy'}
                      className="text-xs"
                    />
                  </button>
                </div>
                <p className="text-xs text-white leading-relaxed whitespace-pre-wrap">{t.text}</p>
              </div>
            );
          })}

          {/* Preserved elements tag info */}
          {translationResult.preservedElements &&
            translationResult.preservedElements.length > 0 && (
              <div className="text-[10px] text-primary-teal bg-primary-teal/10 rounded px-2 py-1 border border-primary-teal/20 flex items-center gap-1">
                <MaterialIcon name="verified" className="text-xs" />
                <span>
                  {translationResult.preservedElements.length} protected item(s) preserved
                  (URLs/hashtags/emojis)
                </span>
              </div>
            )}
        </div>
      )}
    </div>
  );
};

export default TranslationWidget;
