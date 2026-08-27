/**
 * useTranslation Hook
 * FE-100
 *
 * NOTE: This hook is for CONTENT translation (multi-language translation of
 * user-generated social media posts and media captions via backend AI/translation providers).
 * It is NOT for UI localization or application internationalization (i18n).
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { translationClient, TranslateOptions } from '../services/translationClient';
import { TranslationRequest, TranslationResult } from '@socialflow/shared';

export type TranslationStatus = 'idle' | 'loading' | 'success' | 'error';

export interface UseTranslationOptions {
  /**
   * Whether to automatically translate content after debounce delay
   * @default false
   */
  autoTranslate?: boolean;
  /**
   * Debounce delay in milliseconds for auto-translate mode
   * @default 500
   */
  debounceMs?: number;
  /**
   * Default source language
   */
  defaultSourceLanguage?: string;
  /**
   * Default target languages
   */
  defaultTargetLanguages?: string[];
  /**
   * Text to track when autoTranslate is true
   */
  text?: string;
  /**
   * Target languages to track when autoTranslate is true
   */
  targetLanguages?: string[];
}

export interface UseTranslationReturn {
  /**
   * Trigger translation manually
   */
  translate: (
    textOrRequest: string | TranslationRequest,
    options?: TranslateOptions,
  ) => Promise<TranslationResult | null>;
  /**
   * Current translation result
   */
  result: TranslationResult | null;
  /**
   * Current translation lifecycle status
   */
  status: TranslationStatus;
  /**
   * Error message if status is 'error', null otherwise
   */
  error: string | null;
  /**
   * Reset result and error state back to idle, cancelling any in-flight requests
   */
  reset: () => void;
  /**
   * Cancel any current in-flight translation request
   */
  cancel: () => void;
  /**
   * Whether translation is currently in progress
   */
  loading: boolean;
  /**
   * Whether translation is currently in progress (alias for status === 'loading')
   */
  isTranslating: boolean;
  /**
   * Whether hook is in idle state
   */
  isIdle: boolean;
  /**
   * Whether translation succeeded
   */
  isSuccess: boolean;
  /**
   * Whether translation resulted in error
   */
  isError: boolean;
  /**
   * Toggle or set auto-translate mode
   */
  setAutoTranslate: (enabled: boolean) => void;
  /**
   * Whether auto-translate mode is enabled
   */
  autoTranslateEnabled: boolean;
}

export function useTranslation(options: UseTranslationOptions = {}): UseTranslationReturn {
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [status, setStatus] = useState<TranslationStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [autoTranslateEnabled, setAutoTranslate] = useState<boolean>(
    options.autoTranslate ?? false,
  );

  // In-flight request cancellation tracking
  const activeRequestIdRef = useRef<number>(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    activeRequestIdRef.current += 1;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    cancel();
    setResult(null);
    setError(null);
    setStatus('idle');
  }, [cancel]);

  const translate = useCallback(
    async (
      textOrRequest: string | TranslationRequest,
      translateOptions?: TranslateOptions,
    ): Promise<TranslationResult | null> => {
      // Increment request ID to cancel any prior in-flight request
      const currentRequestId = ++activeRequestIdRef.current;

      const text = typeof textOrRequest === 'string' ? textOrRequest : textOrRequest.text;

      if (!text || !text.trim()) {
        reset();
        return null;
      }

      setStatus('loading');
      setError(null);

      try {
        const translationResult = await translationClient.translate(
          textOrRequest,
          translateOptions,
        );

        // Discard if this request was superseded or cancelled
        if (activeRequestIdRef.current !== currentRequestId) {
          return null;
        }

        setResult(translationResult);
        setStatus('success');
        setError(null);
        return translationResult;
      } catch (err: unknown) {
        if (activeRequestIdRef.current !== currentRequestId) {
          return null;
        }

        const errorMessage = err instanceof Error ? err.message : 'Translation failed';
        setError(errorMessage);
        setStatus('error');
        return null;
      }
    },
    [reset],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancel();
    };
  }, [cancel]);

  // Debounced auto-translate effect
  useEffect(() => {
    if (!autoTranslateEnabled) return;
    if (!options.text || !options.text.trim()) {
      reset();
      return;
    }

    const targets = options.targetLanguages || options.defaultTargetLanguages || ['es'];
    if (targets.length === 0) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      translate(options.text!, {
        from: options.defaultSourceLanguage,
        to: targets,
      });
    }, options.debounceMs ?? 500);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [
    autoTranslateEnabled,
    options.text,
    options.targetLanguages,
    options.defaultTargetLanguages,
    options.defaultSourceLanguage,
    options.debounceMs,
    translate,
    reset,
  ]);

  return {
    translate,
    result,
    status,
    error,
    reset,
    cancel,
    loading: status === 'loading',
    isTranslating: status === 'loading',
    isIdle: status === 'idle',
    isSuccess: status === 'success',
    isError: status === 'error',
    setAutoTranslate,
    autoTranslateEnabled,
  };
}

export default useTranslation;
