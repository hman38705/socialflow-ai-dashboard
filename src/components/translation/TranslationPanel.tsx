import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { translationClient } from '../../services/translationClient';
import { SupportedLanguage } from '@socialflow/shared';

export interface TranslationPanelProps {
  initialText?: string;
  defaultSourceLanguage?: string;
  defaultTargetLanguage?: string;
  onReplaceInComposer?: (translatedText: string) => void;
  onClose?: () => void;
  className?: string;
}

const RTL_LANGUAGES = new Set([
  'ar',
  'he',
  'fa',
  'ur',
  'yi',
  'ps',
  'sd',
  'ug',
  'ckb',
  'arc',
  'syr',
]);

function isRtlLanguage(langCode: string): boolean {
  if (!langCode || langCode === 'auto') return false;
  const baseCode = langCode.toLowerCase().split('-')[0];
  return RTL_LANGUAGES.has(baseCode);
}

const MaterialIcon: React.FC<{ name: string; className?: string }> = ({ name, className = '' }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

interface LanguageComboboxProps {
  label: string;
  selectedCode: string;
  languages: SupportedLanguage[];
  onSelect: (code: string) => void;
  includeAutoDetect?: boolean;
  detectedLangName?: string;
  disabled?: boolean;
}

const LanguageCombobox: React.FC<LanguageComboboxProps> = ({
  label,
  selectedCode,
  languages,
  onSelect,
  includeAutoDetect = false,
  detectedLangName,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredLanguages = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return languages;
    return languages.filter(
      (lang) =>
        lang.name.toLowerCase().includes(query) ||
        lang.nativeName.toLowerCase().includes(query) ||
        lang.code.toLowerCase().includes(query),
    );
  }, [languages, searchQuery]);

  const selectedLang =
    selectedCode === 'auto' ? null : languages.find((l) => l.code === selectedCode);

  const selectedDisplayName =
    selectedCode === 'auto'
      ? detectedLangName
        ? `Auto-detect (${detectedLangName})`
        : 'Auto-detect'
      : selectedLang
        ? `${selectedLang.flag} ${selectedLang.name}`
        : selectedCode;

  return (
    <div className="relative flex-1" ref={dropdownRef}>
      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">
        {label}
      </label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between px-3 py-2 bg-dark-bg/80 border border-dark-border rounded-xl text-sm text-white hover:border-white/20 focus:outline-none focus:ring-1 focus:ring-primary-blue transition-all disabled:opacity-50"
      >
        <span className="truncate">{selectedDisplayName}</span>
        <MaterialIcon
          name={isOpen ? 'expand_less' : 'expand_more'}
          className="text-gray-400 text-sm ml-1"
        />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full min-w-[200px] max-h-60 bg-dark-surface border border-dark-border rounded-xl shadow-xl overflow-hidden flex flex-col">
          <div className="p-2 border-b border-dark-border">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search language..."
              autoFocus
              className="w-full px-2.5 py-1.5 bg-dark-bg border border-dark-border rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary-blue"
            />
          </div>

          <div className="overflow-y-auto flex-1 p-1 space-y-0.5">
            {includeAutoDetect && (
              <button
                type="button"
                onClick={() => {
                  onSelect('auto');
                  setIsOpen(false);
                  setSearchQuery('');
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs text-left transition-colors ${
                  selectedCode === 'auto'
                    ? 'bg-primary-blue text-white'
                    : 'text-gray-300 hover:bg-white/5'
                }`}
              >
                <span>✨ Auto-detect</span>
                {detectedLangName && (
                  <span className="text-[10px] opacity-75">({detectedLangName})</span>
                )}
              </button>
            )}

            {filteredLanguages.map((lang) => (
              <button
                key={lang.code}
                type="button"
                onClick={() => {
                  onSelect(lang.code);
                  setIsOpen(false);
                  setSearchQuery('');
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs text-left transition-colors ${
                  selectedCode === lang.code
                    ? 'bg-primary-blue text-white'
                    : 'text-gray-300 hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <span>{lang.flag}</span>
                  <span className="truncate">{lang.name}</span>
                </div>
                <span className="text-[10px] text-gray-400">{lang.nativeName}</span>
              </button>
            ))}

            {filteredLanguages.length === 0 && (
              <p className="p-3 text-center text-xs text-gray-500">No languages found</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const TranslationPanel: React.FC<TranslationPanelProps> = ({
  initialText = '',
  defaultSourceLanguage = 'auto',
  defaultTargetLanguage = 'es',
  onReplaceInComposer,
  onClose,
  className = '',
}) => {
  const [inputText, setInputText] = useState(initialText);
  const [sourceLang, setSourceLang] = useState(defaultSourceLanguage);
  const [targetLang, setTargetLang] = useState(defaultTargetLanguage);
  const [languages, setLanguages] = useState<SupportedLanguage[]>([]);
  const [detectedLangCode, setDetectedLangCode] = useState<string>('en');
  const [copied, setCopied] = useState(false);

  const { translate, result, error, reset, loading } = useTranslation();

  // Fetch languages on mount
  useEffect(() => {
    translationClient.listLanguages().then((langs) => {
      setLanguages(langs);
    });
  }, []);

  // Update input text if initialText changes
  useEffect(() => {
    if (initialText) {
      setInputText(initialText);
    }
  }, [initialText]);

  // Source language detection when auto-detect is enabled
  useEffect(() => {
    if (sourceLang === 'auto' && inputText.trim().length >= 3) {
      const timer = setTimeout(() => {
        translationClient.detectLanguage(inputText).then((code) => {
          setDetectedLangCode(code);
        });
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [inputText, sourceLang]);

  // Detected language display name
  const detectedLangName = useMemo(() => {
    const found = languages.find((l) => l.code === detectedLangCode);
    return found ? found.name : detectedLangCode.toUpperCase();
  }, [languages, detectedLangCode]);

  // Active source language code
  const effectiveSourceCode = sourceLang === 'auto' ? detectedLangCode : sourceLang;
  const isSourceRtl = isRtlLanguage(effectiveSourceCode);
  const isTargetRtl = isRtlLanguage(targetLang);

  // Result text
  const translatedText = useMemo(() => {
    if (!result) return '';
    const match = result.translations.find((t) => t.language === targetLang);
    return match ? match.text : result.translations[0]?.text || '';
  }, [result, targetLang]);

  // Cost and character estimation
  const costEstimate = useMemo(() => {
    if (!inputText) return { characters: 0, estimatedCost: 0, currency: 'USD' };
    return translationClient.estimateCost(inputText, [targetLang], 'deepl');
  }, [inputText, targetLang]);

  // Trigger translation
  const handleTranslate = async () => {
    if (!inputText.trim()) return;
    await translate(inputText, {
      from: sourceLang === 'auto' ? undefined : sourceLang,
      to: [targetLang],
      preserveFormatting: true,
      preserveHashtags: true,
      preserveMentions: true,
      preserveUrls: true,
      preserveEmojis: true,
    });
  };

  // Swap languages and text
  const handleSwap = () => {
    const newSource = targetLang;
    const newTarget = effectiveSourceCode || 'en';

    setSourceLang(newSource);
    setTargetLang(newTarget);

    if (translatedText) {
      const oldInput = inputText;
      setInputText(translatedText);
      reset();
      // If we had input text previously, auto-translate or allow immediate re-translation
      if (oldInput) {
        translate(translatedText, {
          from: newSource,
          to: [newTarget],
          preserveFormatting: true,
          preserveHashtags: true,
          preserveMentions: true,
          preserveUrls: true,
          preserveEmojis: true,
        });
      }
    }
  };

  // Copy result to clipboard
  const handleCopy = async () => {
    if (!translatedText) return;
    try {
      await navigator.clipboard.writeText(translatedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard write failure
    }
  };

  // Replace in composer callback
  const handleReplaceInComposer = () => {
    if (translatedText && onReplaceInComposer) {
      onReplaceInComposer(translatedText);
    }
  };

  return (
    <div
      className={`bg-dark-surface border border-dark-border rounded-2xl p-6 shadow-2xl space-y-6 ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-dark-border pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-blue/20 border border-primary-blue/30 flex items-center justify-center">
            <MaterialIcon name="translate" className="text-primary-blue text-xl" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">Content Translation</h2>
            <p className="text-xs text-gray-400">
              Translate social posts with hashtag & URL preservation
            </p>
          </div>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
          >
            <MaterialIcon name="close" className="text-lg" />
          </button>
        )}
      </div>

      {/* Language Selection Header with Comboboxes & Swap */}
      <div className="flex items-center gap-3 bg-dark-bg/60 p-4 rounded-xl border border-dark-border">
        <LanguageCombobox
          label="Source Language"
          selectedCode={sourceLang}
          languages={languages}
          onSelect={setSourceLang}
          includeAutoDetect={true}
          detectedLangName={detectedLangName}
        />

        <div className="pt-4 flex items-center justify-center">
          <button
            type="button"
            onClick={handleSwap}
            title="Swap source and target languages"
            aria-label="Swap languages"
            className="p-2.5 bg-dark-surface border border-dark-border rounded-xl text-gray-300 hover:text-white hover:border-primary-blue hover:bg-primary-blue/10 transition-all cursor-pointer"
          >
            <MaterialIcon name="swap_horiz" className="text-lg" />
          </button>
        </div>

        <LanguageCombobox
          label="Target Language"
          selectedCode={targetLang}
          languages={languages}
          onSelect={setTargetLang}
          includeAutoDetect={false}
        />
      </div>

      {/* Main Panes Grid: Source (Input) and Target (Result) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Source Pane */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-300">Original</span>
            <span className="text-[11px] text-gray-400">{inputText.length} chars</span>
          </div>

          <div className="relative">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Enter your post caption or content..."
              lang={effectiveSourceCode}
              dir={isSourceRtl ? 'rtl' : 'ltr'}
              rows={8}
              className={`w-full p-4 bg-dark-bg border border-dark-border rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-primary-blue resize-none transition-all ${
                isSourceRtl ? 'text-right' : 'text-left'
              }`}
            />
          </div>

          {/* Character count & Cost/Credits preview */}
          <div className="flex items-center justify-between text-[11px] text-gray-400 px-1">
            <span>
              {costEstimate.characters > 0
                ? `${costEstimate.characters} chars to translate`
                : 'No input'}
            </span>
            <span className="font-mono text-gray-300">
              Est. cost: ${costEstimate.estimatedCost.toFixed(4)} {costEstimate.currency}
            </span>
          </div>
        </div>

        {/* Target Pane */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-300">Translation</span>
            {translatedText && (
              <span className="text-[11px] text-gray-400">{translatedText.length} chars</span>
            )}
          </div>

          <div
            lang={targetLang}
            dir={isTargetRtl ? 'rtl' : 'ltr'}
            className={`w-full h-48 p-4 bg-dark-bg/40 border border-dark-border rounded-xl text-sm overflow-y-auto flex flex-col justify-between ${
              isTargetRtl ? 'text-right' : 'text-left'
            }`}
          >
            {loading ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-2">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-blue"></div>
                <span className="text-xs text-gray-400">Translating...</span>
              </div>
            ) : error ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-1 text-red-400">
                <MaterialIcon name="error_outline" className="text-xl" />
                <span className="text-xs font-medium">{error}</span>
              </div>
            ) : translatedText ? (
              <p className="text-white whitespace-pre-wrap leading-relaxed">{translatedText}</p>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-500">
                <MaterialIcon name="translate" className="text-3xl mb-1 opacity-50" />
                <p className="text-xs">Translation output will appear here</p>
              </div>
            )}
          </div>

          {/* Action buttons on result pane */}
          {translatedText && (
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-dark-bg hover:bg-dark-border border border-dark-border rounded-lg text-xs text-gray-200 hover:text-white transition-all"
              >
                <MaterialIcon name={copied ? 'check' : 'content_copy'} className="text-sm" />
                <span>{copied ? 'Copied!' : 'Copy'}</span>
              </button>

              {onReplaceInComposer && (
                <button
                  type="button"
                  onClick={handleReplaceInComposer}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-blue/20 hover:bg-primary-blue/30 border border-primary-blue/40 text-primary-blue rounded-lg text-xs font-medium transition-all"
                >
                  <MaterialIcon name="edit_note" className="text-sm" />
                  <span>Replace in Composer</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer Controls */}
      <div className="flex items-center justify-between pt-4 border-t border-dark-border">
        <button
          type="button"
          onClick={() => {
            setInputText('');
            reset();
          }}
          disabled={!inputText && !translatedText}
          className="px-4 py-2 text-xs text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Clear All
        </button>

        <div className="flex items-center gap-3">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-dark-border text-xs font-semibold text-gray-300 hover:text-white hover:border-white/20 transition-all"
            >
              Cancel
            </button>
          )}

          <button
            type="button"
            onClick={handleTranslate}
            disabled={loading || !inputText.trim()}
            className="flex items-center gap-2 px-6 py-2.5 bg-primary-blue hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-all shadow-glow-blue"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></div>
                <span>Translating...</span>
              </>
            ) : (
              <>
                <MaterialIcon name="translate" className="text-sm" />
                <span>Translate</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TranslationPanel;
