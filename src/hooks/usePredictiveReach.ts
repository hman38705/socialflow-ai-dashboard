import { useState, useEffect, useCallback, useRef } from 'react';
import { predictiveService } from '../services/PredictiveService';
import { PostAnalysisInput, ReachPrediction } from '../types/predictive';

interface UsePredictiveReachOptions {
  autoAnalyze?: boolean;
  debounceMs?: number;
}

export function usePredictiveReach(
  postData: PostAnalysisInput,
  options: UsePredictiveReachOptions = {},
) {
  const { autoAnalyze = true, debounceMs = 300 } = options;

  const [prediction, setPrediction] = useState<ReachPrediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentReqId = useRef(0);

  const analyze = useCallback(async () => {
    if (!postData.content || postData.content.trim().length < 3) {
      setPrediction(null);
      setLoading(false);
      return;
    }

    const reqId = ++currentReqId.current;
    setLoading(true);
    setError(null);

    try {
      const result = await predictiveService.predictReach(postData);
      if (reqId === currentReqId.current) {
        setPrediction(result);
      }
    } catch (err) {
      if (reqId === currentReqId.current) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to analyze reach';
        setError(errorMessage);
        // Fallback heuristic if not returned
        const heuristic = predictiveService.heuristicPrediction(postData);
        setPrediction(heuristic);
      }
    } finally {
      if (reqId === currentReqId.current) {
        setLoading(false);
      }
    }
  }, [postData]);

  useEffect(() => {
    if (!autoAnalyze) return;

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
