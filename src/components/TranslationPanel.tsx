import React, { useState, useCallback, useRef } from 'react';
import { translationService } from '../services/TranslationService';
import { useTranslation } from '../hooks/useTranslation';
import { SupportedLanguage } from '@socialflow/shared';

const MaterialIcon = ({ name, className }: { name: string; className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

export const TranslationPanel: React.FC = () => {
  const [inputText, setInputText] = useState('');
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(['es', 'fr']);
  const { result, loading, translate } = useTranslation();
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const languages = translationService.getSupportedLanguages();
  const providers = translationService.getAvailableProviders();

  /**
   * Debounced translate function - waits 400ms after user stops typing
   */
  const debouncedTranslate = useCallback(
    (text: string, langs: string[]) => {
      // Clear existing timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Set new timer
      debounceTimerRef.current = setTimeout(async () => {
        if (!text || langs.length === 0) return;

        await translate({
          text,
          targetLanguages: langs,
          preserveHashtags: true,
          preserveMentions: true,
          preserveUrls: true,
          preserveEmojis: true,
        });
      }, 400);
    },
    [translate]
  );

  const handleTranslate = async () => {
    if (!inputText || selectedLanguages.length === 0) return;

    // Clear debounce timer and translate immediately
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    await translate({
      text: inputText,
      targetLanguages: selectedLanguages,
      preserveHashtags: true,
      preserveMentions: true,
      preserveUrls: true,
      preserveEmojis: true,
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setInputText(newText);
    
    // Trigger debounced translation on text change
    debouncedTranslate(newText, selectedLanguages);
  };

  const toggleLanguage = (langCode: string) => {
    setSelectedLanguages(prev =>
      prev.includes(langCode)
        ? prev.filter(l => l !== langCode)
        : [...prev, langCode]
    );
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const exportTranslations = () => {
    if (!result) return;

    const exportData = {
      original: result.originalText,
      sourceLanguage: result.sourceLanguage,
      translations: result.translations.map(t => ({
        language: t.language,
        text: t.text,
      })),
      timestamp: result.timestamp,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `translations-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="bg-dark-surface rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <MaterialIcon name="language" className="text-primary-blue text-3xl" />
          <div>
            <h2 className="text-2xl font-bold text-white">Multi-Language Translation</h2>
            <p className="text-sm text-gray-subtext">Translate your content to reach global audiences</p>
          </div>
        </div>

        {/* Provider Status */}
        <div className="flex gap-3 mt-4">
          {providers.map(provider => (
            <div
              key={provider.name}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
                provider.available
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-gray-500/20 text-gray-400'
              }`}
            >
              <MaterialIcon 
                name={provider.available ? 'check_circle' : 'cancel'} 
                className="text-sm" 
              />
              {provider.name}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Section */}
        <div className="bg-dark-surface rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-semibold text-white">Original Content</h3>
          
          <textarea
            value={inputText}
            onChange={handleInputChange}
            placeholder="Enter your post content here... 

You can include:
• URLs: https://example.com
• Mentions: @username
• Hashtags: #trending
• Emojis: 🚀 ✨

These will be preserved in translations!"
            className="w-full h-64 bg-dark-bg border border-dark-border rounded-lg p-4 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-blue/50 resize-none"
          />

          <div className="flex items-center justify-between text-xs text-gray-subtext">
            <span>{inputText.length} characters</span>
            <span>
              {inputText.match(/#\w+/g)?.length || 0} hashtags • 
              {' '}{inputText.match(/@\w+/g)?.length || 0} mentions
            </span>
          </div>

          {/* Language Selection */}
          <div>
            <p className="text-sm font-medium text-white mb-3">Target Languages ({selectedLanguages.length})</p>
            <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
              {languages.map(lang => (
                <button
                  key={lang.code}
                  onClick={() => toggleLanguage(lang.code)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                    selectedLanguages.includes(lang.code)
                      ? 'bg-primary-blue text-white'
                      : 'bg-dark-bg text-gray-subtext hover:bg-dark-border'
                  }`}
                >
                  <span>{lang.flag}</span>
                  <span className="text-xs">{lang.name}</span>
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleTranslate}
            disabled={loading || !inputText || selectedLanguages.length === 0}
            className="w-full bg-primary-blue text-white px-6 py-3 rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Translating...
              </>
            ) : (
              <>
                <MaterialIcon name="translate" className="text-base" />
                Translate Now
              </>
            )}
          </button>
        </div>

        {/* Results Section */}
        <div className="bg-dark-surface rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Translations</h3>
            {result && (
              <button
                onClick={exportTranslations}
                className="flex items-center gap-2 px-3 py-2 bg-dark-bg rounded-lg text-xs text-white hover:bg-dark-border transition-colors"
              >
                <MaterialIcon name="download" className="text-sm" />
                Export
              </button>
            )}
          </div>

          {!result ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <MaterialIcon name="translate" className="text-gray-600 text-6xl mb-4" />
              <p className="text-gray-subtext">Translations will appear here</p>
              <p className="text-xs text-gray-600 mt-2">
                Select languages and click translate
              </p>
            </div>
          ) : (
            <div className="space-y-4 max-h-[600px] overflow-y-auto">
              {result.translations.map((translation, index) => {
                const lang = languages.find(l => l.code === translation.language);
                
                return (
                  <div
                    key={index}
                    className="bg-dark-bg rounded-lg p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{lang?.flag}</span>
                        <div>
                          <p className="text-sm font-medium text-white">{translation.languageName}</p>
                          <p className="text-xs text-gray-subtext">{lang?.nativeName}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {translation.confidence && (
                          <span className="text-xs text-gray-subtext">
                            {Math.round(translation.confidence * 100)}%
                          </span>
                        )}
                        <button
                          onClick={() => copyToClipboard(translation.text)}
                          className="p-2 hover:bg-dark-surface rounded-lg transition-colors"
                          title="Copy"
                        >
                          <MaterialIcon name="content_copy" className="text-primary-blue text-base" />
                        </button>
                      </div>
                    </div>
                    
                    <div className="bg-dark-surface rounded-lg p-3">
                      <p className="text-sm text-white leading-relaxed whitespace-pre-wrap">
                        {translation.text}
                      </p>
                    </div>
                  </div>
                );
              })}

              {/* Preserved Elements Summary */}
              {result.preservedElements.length > 0 && (
                <div className="bg-primary-blue/10 rounded-lg p-4 border border-primary-blue/30">
                  <div className="flex items-start gap-2">
                    <MaterialIcon name="verified" className="text-primary-blue text-base mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-white mb-2">
                        Protected {result.preservedElements.length} element(s)
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {result.preservedElements.map((element, idx) => (
                          <span
                            key={idx}
                            className="text-xs bg-dark-bg px-2 py-1 rounded text-gray-subtext"
                          >
                            {element.type}: {element.value}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
