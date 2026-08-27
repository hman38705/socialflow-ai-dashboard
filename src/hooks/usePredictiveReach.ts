import { useState, useEffect, useCallback, useRef } from 'react';
import { predictiveService } from '../services/PredictiveService';
import { PostAnalysisInput, ReachPrediction } from '../types/predictive';

interface UsePredictiveReachOptions {
  autoAnalyze?: boolean;
  enabled?: boolean;
  debounceMs?: number;
}

export function usePredictiveReach(
  postData: PostAnalysisInput,
  options: UsePredictiveReachOptions = {}
) {
  const { autoAnalyze = true, enabled = true, debounceMs = 600 } = options;
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  
  const [prediction, setPrediction] = useState<ReachPrediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(async () => {
    if (!enabled || !postData.content || postData.content.length < 3) {
      setPrediction(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await predictiveService.predictReach(postData);
      if (mounted.current) setPrediction(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to analyze reach';
      if (mounted.current) setError(errorMessage);
      console.error('Reach prediction error:', err);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [postData, enabled]);

  useEffect(() => {
    if (!autoAnalyze || !enabled) return;

    const timer = setTimeout(() => {
      analyze();
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [postData.content, postData.platform, postData.scheduledTime, autoAnalyze, enabled, debounceMs, analyze]);

  const refresh = useCallback(() => {
    analyze();
  }, [analyze]);

  return {
    prediction,
    loading,
    error,
    analyze: refresh,
  };
}
