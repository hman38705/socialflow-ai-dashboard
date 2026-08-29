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
  options: UsePredictiveReachOptions = {},
) {
  const { autoAnalyze = true, enabled = true, debounceMs = 300 } = options;
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const [prediction, setPrediction] = useState<ReachPrediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentReqId = useRef(0);

  const analyze = useCallback(async () => {
    if (!enabled || !postData.content || postData.content.trim().length < 3) {
      setPrediction(null);
      setLoading(false);
      return;
    }

    const reqId = ++currentReqId.current;
    setLoading(true);
    setError(null);

    try {
      const result = await predictiveService.predictReach(postData);
      if (mounted.current && reqId === currentReqId.current) {
        setPrediction(result);
      }
    } catch (err) {
      if (mounted.current && reqId === currentReqId.current) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to analyze reach';
        setError(errorMessage);
        // Fallback heuristic if not returned
        const heuristic = predictiveService.heuristicPrediction(postData);
        setPrediction(heuristic);
      }
    } finally {
      if (mounted.current && reqId === currentReqId.current) {
        setLoading(false);
      }
    }
  }, [postData, enabled]);

  useEffect(() => {
    if (!autoAnalyze || !enabled) return;

    const timer = setTimeout(() => {
      analyze();
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [
    postData.content,
    postData.platform,
    postData.scheduledTime,
    postData.mediaType,
    postData.followerCount,
    autoAnalyze,
    enabled,
    debounceMs,
    analyze,
  ]);

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
