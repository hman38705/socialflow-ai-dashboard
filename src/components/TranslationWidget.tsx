import React, { useCallback, useEffect, useRef, useState } from 'react';
import { translationService } from '../services/TranslationService';
import { TranslationResult, SupportedLanguage } from '@socialflow/shared';

interface TranslationWidgetProps {
  text: string;
  onTranslationComplete?: (result: TranslationResult) => void;
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 500;

const MaterialIcon = ({ name, className }: { name: string; className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

export const TranslationWidget: React.FC<TranslationWidgetProps> = ({
  text,
  onTranslationComplete,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}) => {
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [translationResult, setTranslationResult] = useState<TranslationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showLanguageSelector, setShowLanguageSelector] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const languages = translationService.getSupportedLanguages();
  const filteredLanguages = searchQuery
    ? translationService.searchLanguages(searchQuery)
    : languages;

  const popularLanguages = ['es', 'fr', 'de', 'pt', 'ja', 'zh'];

  const runTranslation = useCallback(async () => {
    if (!text || selectedLanguages.length === 0) return;

    setLoading(true);
    try {
      const result = await translationService.translate({
        text,
        targetLanguages: selectedLanguages,
        preserveHashtags: true,
        preserveMentions: true,
        preserveUrls: true,
        preserveEmojis: true,
      });

      setTranslationResult(result);
      onTranslationComplete?.(result);
    } catch (error) {
      console.error('Translation failed:', error);
    } finally {
      setLoading(false);
    }
  }, [onTranslationComplete, selectedLanguages, text]);

  const handleTranslate = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runTranslation();
    }, debounceMs);
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const toggleLanguage = (langCode: string) => {
    setSelectedLanguages(prev =>
      prev.includes(langCode)
        ? prev.filter(l => l !== langCode)
        : [...prev, langCode]
    );
  };

  const copyTranslation = (translatedText: string) => {
    navigator.clipboard.writeText(translatedText);
  };

  return (
    <div className="bg-dark-surface rounded-xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MaterialIcon name="translate" className="text-primary-blue text-2xl" />
          <div>
            <h3 className="text-lg font-semibold text-white">Translate Post</h3>
            <p className="text-sm text-gray-subtext">Reach global audiences</p>
          </div>
        </div>
        {translationResult && (
          <span className="text-xs text-gray-subtext">
            via {translationResult.provider.toUpperCase()}
          </span>
        )}
      </div>

      {/* Quick Select Popular Languages */}
      <div>
        <p className="text-sm font-medium text-white mb-3">Popular Languages</p>
        <div className="flex flex-wrap gap-2">
          {popularLanguages.map(langCode => {
            const lang = languages.find(l => l.code === langCode);
            if (!lang) return null;
            
            return (
              <button
                key={langCode}
                onClick={() => toggleLanguage(langCode)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                  selectedLanguages.includes(langCode)
                    ? 'bg-primary-blue text-white'
                    : 'bg-dark-bg text-gray-subtext hover:bg-dark-border'
                }`}
              >
                <span>{lang.flag}</span>
                <span>{lang.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* All Languages */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-white">All Languages</p>
          <button
            onClick={() => setShowLanguageSelector(!showLanguageSelector)}
            className="text-xs text-primary-blue hover:text-blue-300"
          >
            {showLanguageSelector ? 'Hide' : 'Show All'}
          </button>
        </div>

        {showLanguageSelector && (
          <div className="space-y-3">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search languages..."
              className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-blue/50"
            />
            <div className="max-h-48 overflow-y-auto space-y-1">
              {filteredLanguages.map(lang => (
                <button
                  key={lang.code}
                  onClick={() => toggleLanguage(lang.code)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all ${
                    selectedLanguages.includes(lang.code)
                      ? 'bg-primary-blue text-white'
                      : 'bg-dark-bg text-gray-subtext hover:bg-dark-border'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{lang.flag}</span>
                    <div className="text-left">
                      <p className="font-medium">{lang.name}</p>
                      <p className="text-xs opacity-70">{lang.nativeName}</p>
                    </div>
                  </div>
                  {selectedLanguages.includes(lang.code) && (
                    <MaterialIcon name="check_circle" className="text-base" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Selected Languages Summary */}
      {selectedLanguages.length > 0 && (
        <div className="bg-dark-bg rounded-lg p-4">
          <p className="text-xs text-gray-subtext mb-2">
            Selected: {selectedLanguages.length} language{selectedLanguages.length !== 1 ? 's' : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            {selectedLanguages.map(langCode => {
              const lang = languages.find(l => l.code === langCode);
              return (
                <span
                  key={langCode}
                  className="flex items-center gap-1 bg-dark-surface px-2 py-1 rounded text-xs text-white"
                >
                  {lang?.flag} {lang?.name}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Translate Button */}
      <button
        onClick={handleTranslate}
        disabled={loading || !text || selectedLanguages.length === 0}
        className="w-full bg-primary-blue text-white px-6 py-3 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            Translating...
          </>
        ) : (
          <>
            <MaterialIcon name="translate" className="text-base" />
            Translate to {selectedLanguages.length} Language{selectedLanguages.length !== 1 ? 's' : ''}
          </>
        )}
      </button>

      {/* Translation Results */}
      {translationResult && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-white">Translations</h4>
            <span className="text-xs text-gray-subtext">
              Source: {translationResult.sourceLanguage.toUpperCase()}
            </span>
          </div>

          {translationResult.translations.map((translation, index) => (
            <div
              key={index}
              className="bg-dark-bg rounded-lg p-4 space-y-2 hover:bg-dark-border/50 transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">
                    {languages.find(l => l.code === translation.language)?.flag}
                  </span>
                  <span className="text-sm font-medium text-white">
                    {translation.languageName}
                  </span>
                  {translation.confidence && (
                    <span className="text-xs text-gray-subtext">
                      ({Math.round(translation.confidence * 100)}% confidence)
                    </span>
                  )}
                </div>
                <button
                  onClick={() => copyTranslation(translation.text)}
                  className="p-2 hover:bg-dark-surface rounded-lg transition-colors"
                  title="Copy translation"
                >
                  <MaterialIcon name="content_copy" className="text-primary-blue text-base" />
                </button>
              </div>
              <p className="text-sm text-white leading-relaxed">{translation.text}</p>
            </div>
          ))}

          {/* Preserved Elements Info */}
          {translationResult.preservedElements.length > 0 && (
            <div className="bg-primary-blue/10 rounded-lg p-3 border border-primary-blue/30">
              <div className="flex items-start gap-2">
                <MaterialIcon name="shield" className="text-primary-blue text-base mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-white">Protected Elements</p>
                  <p className="text-xs text-gray-subtext mt-1">
                    {translationResult.preservedElements.length} element(s) preserved: 
                    {' '}
                    {[...new Set(translationResult.preservedElements.map(e => e.type))].join(', ')}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
