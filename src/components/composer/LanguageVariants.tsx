import React, { useState, useEffect, useRef, useMemo } from 'react';
import { translationService, DEFAULT_LANGUAGES } from '../../services/TranslationService';
import type { SupportedLanguage } from '@socialflow/shared';

export type VariantStatus = 'translated' | 'edited' | 'stale';

export interface PostVariant {
  language: string;
  languageName: string;
  text: string;
  status: VariantStatus;
  lastTranslatedText?: string;
  lastTranslatedAt?: Date | string;
  confidence?: number;
}

export interface LanguageVariantsProps {
  /** The primary / source post text */
  sourceText: string;
  /** Primary / source language code (defaults to "en") */
  sourceLanguage?: string;
  /** Platform identifier for platform-specific character limits (FE-062) */
  platform?: string;
  /** Controlled variants list */
  variants?: PostVariant[];
  /** Callback fired whenever variants list or variant text is updated */
  onChange?: (variants: PostVariant[]) => void;
  /** Additional container styling */
  className?: string;
}

/** Platform character limits based on FE-062 specifications */
export const PLATFORM_LIMITS: Record<string, number> = {
  twitter: 280,
  x: 280,
  threads: 500,
  instagram: 2200,
  tiktok: 2200,
  linkedin: 3000,
  youtube: 5000,
  facebook: 63206,
  generic: 280,
};

const MaterialIcon = ({ name, className }: { name: string; className?: string }) => (
  <span
    className={`material-symbols-outlined select-none inline-flex items-center justify-center ${className || ''}`}
    aria-hidden="true"
  >
    {name}
  </span>
);

export const LanguageVariants: React.FC<LanguageVariantsProps> = ({
  sourceText,
  sourceLanguage = 'en',
  platform = 'twitter',
  variants: controlledVariants,
  onChange,
  className = '',
}) => {
  const [internalVariants, setInternalVariants] = useState<PostVariant[]>([]);
  const variants = controlledVariants !== undefined ? controlledVariants : internalVariants;

  const [activeTab, setActiveTab] = useState<string>('source'); // "source" or language code
  const [showAddDropdown, setShowAddDropdown] = useState(false);
  const [addSearchQuery, setAddSearchQuery] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatingLang, setTranslatingLang] = useState<string | null>(null);
  const [copiedLang, setCopiedLang] = useState<string | null>(null);

  const prevSourceTextRef = useRef(sourceText);
  const isMountedRef = useRef(true);

  const allLanguages: SupportedLanguage[] = useMemo(() => {
    try {
      return translationService.getSupportedLanguages() || DEFAULT_LANGUAGES;
    } catch {
      return DEFAULT_LANGUAGES;
    }
  }, []);

  const characterLimit = PLATFORM_LIMITS[platform.toLowerCase()] || PLATFORM_LIMITS.generic;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const updateVariants = (newVariants: PostVariant[]) => {
    if (controlledVariants === undefined) {
      setInternalVariants(newVariants);
    }
    onChange?.(newVariants);
  };

  // Staleness propagation: when sourceText changes, mark all variants stale
  useEffect(() => {
    if (prevSourceTextRef.current !== sourceText) {
      prevSourceTextRef.current = sourceText;
      if (variants.length > 0) {
        const markedStale = variants.map((v) => ({
          ...v,
          status: 'stale' as VariantStatus,
        }));
        updateVariants(markedStale);
      }
    }
  }, [sourceText]);

  // Languages available to add (exclude current variants and source language)
  const availableLanguages = useMemo(() => {
    const activeCodes = new Set([
      sourceLanguage.toLowerCase(),
      ...variants.map((v) => v.language.toLowerCase()),
    ]);
    return allLanguages.filter((l) => !activeCodes.has(l.code.toLowerCase()));
  }, [allLanguages, sourceLanguage, variants]);

  const filteredAvailableLanguages = useMemo(() => {
    if (!addSearchQuery.trim()) return availableLanguages;
    const q = addSearchQuery.toLowerCase();
    return availableLanguages.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.nativeName.toLowerCase().includes(q) ||
        l.code.toLowerCase().includes(q),
    );
  }, [availableLanguages, addSearchQuery]);

  // Translate a single target language variant
  const translateSingleVariant = async (langCode: string) => {
    const langObj = allLanguages.find((l) => l.code.toLowerCase() === langCode.toLowerCase());
    const langName = langObj?.name || langCode.toUpperCase();

    if (!sourceText.trim()) {
      const newVariant: PostVariant = {
        language: langCode,
        languageName: langName,
        text: '',
        status: 'translated',
        lastTranslatedText: '',
        lastTranslatedAt: new Date(),
      };
      const existingIdx = variants.findIndex(
        (v) => v.language.toLowerCase() === langCode.toLowerCase(),
      );
      if (existingIdx >= 0) {
        const updated = [...variants];
        updated[existingIdx] = newVariant;
        updateVariants(updated);
      } else {
        updateVariants([...variants, newVariant]);
      }
      return;
    }

    setIsTranslating(true);
    setTranslatingLang(langCode);

    try {
      const result = await translationService.translate({
        text: sourceText,
        sourceLanguage,
        targetLanguages: [langCode],
        preserveFormatting: true,
        preserveHashtags: true,
        preserveMentions: true,
        preserveUrls: true,
        preserveEmojis: true,
      });

      const translatedItem =
        result.translations.find((t) => t.language.toLowerCase() === langCode.toLowerCase()) ||
        result.translations[0];

      const translatedText = translatedItem ? translatedItem.text : sourceText;

      const newVariant: PostVariant = {
        language: langCode,
        languageName: langName,
        text: translatedText,
        status: 'translated',
        lastTranslatedText: translatedText,
        lastTranslatedAt: new Date(),
        confidence: translatedItem?.confidence,
      };

      const existingIdx = variants.findIndex(
        (v) => v.language.toLowerCase() === langCode.toLowerCase(),
      );
      let updated: PostVariant[];
      if (existingIdx >= 0) {
        updated = [...variants];
        updated[existingIdx] = newVariant;
      } else {
        updated = [...variants, newVariant];
      }
      updateVariants(updated);
      setActiveTab(langCode);
    } catch (e) {
      console.error('Failed to translate variant:', e);
    } finally {
      if (isMountedRef.current) {
        setIsTranslating(false);
        setTranslatingLang(null);
      }
    }
  };

  // Re-translate all stale variants with a single click
  const handleRetranslateStale = async () => {
    const staleVariants = variants.filter((v) => v.status === 'stale');
    if (staleVariants.length === 0 || !sourceText.trim()) return;

    setIsTranslating(true);
    setTranslatingLang('all');

    try {
      const targetLangs = staleVariants.map((v) => v.language);
      const result = await translationService.translate({
        text: sourceText,
        sourceLanguage,
        targetLanguages: targetLangs,
        preserveFormatting: true,
        preserveHashtags: true,
        preserveMentions: true,
        preserveUrls: true,
        preserveEmojis: true,
      });

      const updated = variants.map((v) => {
        if (v.status !== 'stale') return v;
        const res = result.translations.find(
          (t) => t.language.toLowerCase() === v.language.toLowerCase(),
        );
        if (res) {
          return {
            ...v,
            text: res.text,
            lastTranslatedText: res.text,
            status: 'translated' as VariantStatus,
            lastTranslatedAt: new Date(),
            confidence: res.confidence,
          };
        }
        return v;
      });

      updateVariants(updated);
    } catch (e) {
      console.error('Failed to retranslate stale variants:', e);
    } finally {
      if (isMountedRef.current) {
        setIsTranslating(false);
        setTranslatingLang(null);
      }
    }
  };

  // Add a new language variant
  const handleAddLanguage = (langCode: string) => {
    setShowAddDropdown(false);
    setAddSearchQuery('');
    translateSingleVariant(langCode);
  };

  // Remove a variant
  const handleRemoveVariant = (langCode: string) => {
    const updated = variants.filter((v) => v.language.toLowerCase() !== langCode.toLowerCase());
    updateVariants(updated);
    if (activeTab.toLowerCase() === langCode.toLowerCase()) {
      setActiveTab('source');
    }
  };

  // Handle editing text in active variant
  const handleVariantTextChange = (langCode: string, newText: string) => {
    const updated = variants.map((v) => {
      if (v.language.toLowerCase() === langCode.toLowerCase()) {
        const isModifiedFromTranslation =
          v.lastTranslatedText !== undefined && v.lastTranslatedText !== newText;
        return {
          ...v,
          text: newText,
          status: isModifiedFromTranslation ? ('edited' as VariantStatus) : v.status,
        };
      }
      return v;
    });
    updateVariants(updated);
  };

  // Restore original translated text
  const handleRestoreTranslated = (langCode: string) => {
    const updated = variants.map((v) => {
      if (v.language.toLowerCase() === langCode.toLowerCase() && v.lastTranslatedText) {
        return {
          ...v,
          text: v.lastTranslatedText,
          status: 'translated' as VariantStatus,
        };
      }
      return v;
    });
    updateVariants(updated);
  };

  const copyToClipboard = async (text: string, langKey: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedLang(langKey);
      setTimeout(() => {
        if (isMountedRef.current) setCopiedLang(null);
      }, 2000);
    } catch (e) {
      console.warn('Failed to copy:', e);
    }
  };

  const staleCount = variants.filter((v) => v.status === 'stale').length;
  const activeVariant = variants.find((v) => v.language.toLowerCase() === activeTab.toLowerCase());

  // Status badge styling helper
  const getStatusBadge = (status: VariantStatus) => {
    switch (status) {
      case 'translated':
        return (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded">
            <MaterialIcon name="check" className="text-[11px]" />
            Translated
          </span>
        );
      case 'edited':
        return (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/30 rounded">
            <MaterialIcon name="edit" className="text-[11px]" />
            Edited
          </span>
        );
      case 'stale':
        return (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded animate-pulse">
            <MaterialIcon name="warning" className="text-[11px]" />
            Stale
          </span>
        );
    }
  };

  return (
    <div
      className={`bg-dark-surface border border-dark-border rounded-xl p-4 space-y-4 ${className}`}
      data-testid="language-variants-container"
    >
      {/* Header with platform info and Re-translate Stale Action */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-dark-border/70 pb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary-blue/20 flex items-center justify-center text-primary-blue">
            <MaterialIcon name="language" className="text-lg" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white tracking-wide">Multi-Language Variants</h3>
            <p className="text-xs text-gray-subtext">
              Platform limit:{' '}
              <span className="font-semibold text-white">{characterLimit} chars</span> ({platform})
            </p>
          </div>
        </div>

        {staleCount > 0 && (
          <button
            type="button"
            onClick={handleRetranslateStale}
            disabled={isTranslating || !sourceText.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-xl text-xs font-semibold hover:bg-amber-500/30 disabled:opacity-50 transition-all shadow-sm"
          >
            {isTranslating && translatingLang === 'all' ? (
              <>
                <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-amber-300 border-t-transparent" />
                <span>Re-translating...</span>
              </>
            ) : (
              <>
                <MaterialIcon name="sync" className="text-sm" />
                <span>
                  Re-translate {staleCount} Stale Variant{staleCount !== 1 ? 's' : ''}
                </span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Variant Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Source Language Tab */}
        <button
          type="button"
          onClick={() => setActiveTab('source')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-all ${
            activeTab === 'source'
              ? 'bg-primary-blue text-white border-primary-blue shadow'
              : 'bg-dark-bg text-gray-300 border-dark-border hover:border-gray-600 hover:text-white'
          }`}
        >
          <MaterialIcon name="source" className="text-sm" />
          <span>Original ({sourceLanguage.toUpperCase()})</span>
          <span className="text-[10px] opacity-75">({sourceText.length})</span>
        </button>

        {/* Target Language Tabs */}
        {variants.map((v) => {
          const langObj = allLanguages.find(
            (l) => l.code.toLowerCase() === v.language.toLowerCase(),
          );
          const isSelected = activeTab.toLowerCase() === v.language.toLowerCase();

          return (
            <div
              key={v.language}
              onClick={() => setActiveTab(v.language)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border cursor-pointer transition-all ${
                isSelected
                  ? 'bg-primary-blue text-white border-primary-blue shadow'
                  : 'bg-dark-bg text-gray-300 border-dark-border hover:border-gray-600 hover:text-white'
              }`}
            >
              <span>{langObj?.flag || '🌐'}</span>
              <span>{v.languageName || v.language.toUpperCase()}</span>
              {getStatusBadge(v.status)}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveVariant(v.language);
                }}
                className="text-gray-400 hover:text-red-400 p-0.5 rounded transition-colors"
                title="Remove variant"
                aria-label={`Remove ${v.languageName} variant`}
              >
                <MaterialIcon name="close" className="text-xs" />
              </button>
            </div>
          );
        })}

        {/* Add Language Button & Dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowAddDropdown(!showAddDropdown)}
            disabled={availableLanguages.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-dark-bg text-gray-300 border border-dashed border-dark-border hover:border-primary-blue hover:text-primary-blue disabled:opacity-40 transition-all"
          >
            <MaterialIcon name="add" className="text-sm" />
            <span>Add Language</span>
          </button>

          {showAddDropdown && (
            <div className="absolute left-0 mt-2 w-64 bg-dark-bg border border-dark-border rounded-xl shadow-2xl z-30 p-2 space-y-2">
              <input
                type="text"
                value={addSearchQuery}
                onChange={(e) => setAddSearchQuery(e.target.value)}
                placeholder="Search languages..."
                className="w-full bg-dark-surface border border-dark-border rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-primary-blue"
                autoFocus
              />
              <div className="max-h-48 overflow-y-auto space-y-1">
                {filteredAvailableLanguages.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => handleAddLanguage(l.code)}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-gray-300 hover:bg-primary-blue hover:text-white transition-colors text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span>{l.flag}</span>
                      <span className="font-medium">{l.name}</span>
                      <span className="text-[10px] opacity-60">({l.nativeName})</span>
                    </div>
                  </button>
                ))}
                {filteredAvailableLanguages.length === 0 && (
                  <p className="text-center text-xs text-gray-subtext py-2">No languages found</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Editor Content Area */}
      {activeTab === 'source' ? (
        <div className="bg-dark-bg/60 border border-dark-border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-300">Original Source Content</span>
            <div className="flex items-center gap-2">
              <span
                className={`text-xs font-mono ${
                  sourceText.length > characterLimit ? 'text-red-400 font-bold' : 'text-gray-400'
                }`}
              >
                {sourceText.length} / {characterLimit} chars
              </span>
              <button
                type="button"
                onClick={() => copyToClipboard(sourceText, 'source')}
                className="p-1 rounded text-primary-blue hover:text-white hover:bg-primary-blue/20 transition-colors"
                title="Copy source text"
              >
                <MaterialIcon
                  name={copiedLang === 'source' ? 'check' : 'content_copy'}
                  className="text-xs"
                />
              </button>
            </div>
          </div>
          <div className="p-3 bg-dark-surface rounded-lg text-xs text-white whitespace-pre-wrap min-h-[80px]">
            {sourceText || (
              <span className="text-gray-500 italic">No source text provided in composer.</span>
            )}
          </div>
          {sourceText.length > characterLimit && (
            <div className="text-xs text-red-400 flex items-center gap-1.5">
              <MaterialIcon name="error" className="text-sm" />
              <span>
                Exceeds {platform} character limit by {sourceText.length - characterLimit}{' '}
                characters.
              </span>
            </div>
          )}
        </div>
      ) : activeVariant ? (
        <div
          className="bg-dark-bg/60 border border-dark-border rounded-xl p-4 space-y-3"
          data-testid="variant-editor"
        >
          {/* Variant Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-white">
                {activeVariant.languageName} ({activeVariant.language.toUpperCase()}) Variant
              </span>
              {getStatusBadge(activeVariant.status)}
            </div>

            <div className="flex items-center gap-2">
              {activeVariant.status === 'stale' && (
                <button
                  type="button"
                  onClick={() => translateSingleVariant(activeVariant.language)}
                  disabled={isTranslating || !sourceText.trim()}
                  className="flex items-center gap-1 px-2.5 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-lg text-xs hover:bg-amber-500/30 transition-colors"
                >
                  <MaterialIcon name="sync" className="text-xs" />
                  <span>Re-translate</span>
                </button>
              )}

              {activeVariant.status === 'edited' && activeVariant.lastTranslatedText && (
                <button
                  type="button"
                  onClick={() => handleRestoreTranslated(activeVariant.language)}
                  className="flex items-center gap-1 px-2.5 py-1 bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded-lg text-xs hover:bg-purple-500/30 transition-colors"
                  title="Restore original translated version"
                >
                  <MaterialIcon name="history" className="text-xs" />
                  <span>Restore Translated</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => copyToClipboard(activeVariant.text, activeVariant.language)}
                className="p-1 rounded text-primary-blue hover:text-white hover:bg-primary-blue/20 transition-colors"
                title="Copy variant text"
              >
                <MaterialIcon
                  name={copiedLang === activeVariant.language ? 'check' : 'content_copy'}
                  className="text-xs"
                />
              </button>
            </div>
          </div>

          {/* Editable Textarea */}
          <textarea
            value={activeVariant.text}
            onChange={(e) => handleVariantTextChange(activeVariant.language, e.target.value)}
            placeholder={`Write or refine ${activeVariant.languageName} translation...`}
            rows={4}
            className="w-full bg-dark-surface border border-dark-border rounded-xl p-3 text-xs text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-blue/50 resize-none transition-all"
          />

          {/* Independent Character Count & Limit Check */}
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              {activeVariant.text.length > characterLimit ? (
                <span className="text-red-400 font-semibold flex items-center gap-1">
                  <MaterialIcon name="error" className="text-xs" />
                  {activeVariant.text.length - characterLimit} chars over {platform} limit
                </span>
              ) : (
                <span className="text-gray-400">
                  {characterLimit - activeVariant.text.length} chars remaining
                </span>
              )}
            </div>
            <span
              className={`font-mono text-xs ${
                activeVariant.text.length > characterLimit
                  ? 'text-red-400 font-bold'
                  : 'text-gray-400'
              }`}
            >
              {activeVariant.text.length} / {characterLimit}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default LanguageVariants;
