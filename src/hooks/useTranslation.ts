import { useState, useCallback, useRef } from 'react';
import { translationService } from '../services/TranslationService';
import type { TranslationRequest, TranslationResult } from '@socialflow/shared';

export function useTranslation() {
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightPromiseRef = useRef<Promise<TranslationResult | null> | null>(null);

  const translate = useCallback(async (request: TranslationRequest) => {
    if (!request.text || !request.targetLanguages || request.targetLanguages.length === 0) {
      return null;
    }

    setLoading(true);
    setError(null);

    const promise = (async () => {
      try {
        const translationResult = await translationService.translate(request);
        setResult(translationResult);
        return translationResult;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Translation failed';
        setError(errorMessage);
        console.error('Translation error:', err);
        return null;
      } finally {
        setLoading(false);
        inFlightPromiseRef.current = null;
      }
    })();

    inFlightPromiseRef.current = promise;
    return promise;
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setLoading(false);
  }, []);

  return {
    result,
    loading,
    error,
    translate,
    reset,
  };
}
