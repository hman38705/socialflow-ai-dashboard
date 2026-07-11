import React, { useState, useEffect } from 'react';
import { predictiveService } from '../services/PredictiveService';
import { PostAnalysisInput, ReachPrediction } from '../types/predictive';

interface ReachScoreWidgetProps {
  postData: PostAnalysisInput;
  onUpdate?: (prediction: ReachPrediction) => void;
}

export const ReachScoreWidget: React.FC<ReachScoreWidgetProps> = ({ postData, onUpdate }) => {
  const [prediction, setPrediction] = useState<ReachPrediction | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Guard against out-of-order resolutions: a fast typist can trigger several
    // predictions; only the most recent effect run is allowed to commit state.
    let cancelled = false;

    if (!postData.content || postData.content.length < 3) {
      setPrediction(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    predictiveService
      .predictReach(postData)
      .then((result) => {
        if (cancelled) return;
        setPrediction(result);
        onUpdate?.(result);
      })
      .catch((error) => {
        if (!cancelled) console.error('Failed to predict reach:', error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [postData, onUpdate]);

  const getScoreColor = (score: number): string => {
    if (score >= 80) return 'text-green-400';
    if (score >= 60) return 'text-blue-400';
    if (score >= 40) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getScoreGradient = (score: number): string => {
    if (score >= 80) return 'from-green-500 to-emerald-500';
    if (score >= 60) return 'from-blue-500 to-cyan-500';
    if (score >= 40) return 'from-yellow-500 to-orange-500';
    return 'from-red-500 to-pink-500';
  };

  if (loading) {
    return (
      <div className="bg-dark-surface rounded-xl p-6">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-blue"></div>
          <span className="ml-3 text-gray-subtext">Analyzing reach potential...</span>
        </div>
      </div>
    );
  }

  if (!prediction) {
    return (
      <div className="bg-dark-surface rounded-xl p-6">
        <p className="text-gray-subtext text-center">Enter post content to see reach prediction</p>
      </div>
    );
  }

  return (
    <div className="bg-dark-surface rounded-xl p-6 space-y-6">
      {/* Reach Score */}
      <div className="text-center">
        <h3 className="text-sm font-medium text-gray-subtext mb-4">Predicted Reach Score</h3>
        <div className="relative inline-flex items-center justify-center">
          <svg className="w-32 h-32 transform -rotate-90">
            <circle
              cx="64"
              cy="64"
              r="56"
              stroke="currentColor"
              strokeWidth="8"
              fill="none"
              className="text-dark-bg"
            />
            <circle
              cx="64"
              cy="64"
              r="56"
              stroke="url(#scoreGradient)"
              strokeWidth="8"
              fill="none"
              strokeDasharray={`${(prediction.reachScore / 100) * 351.86} 351.86`}
              className="transition-all duration-1000"
            />
            <defs>
              <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" className={getScoreGradient(prediction.reachScore).split(' ')[0].replace('from-', 'stop-')} />
                <stop offset="100%" className={getScoreGradient(prediction.reachScore).split(' ')[1].replace('to-', 'stop-')} />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-4xl font-bold ${getScoreColor(prediction.reachScore)}`}>
              {Math.round(prediction.reachScore)}
            </span>
            <span className="text-xs text-gray-subtext">/ 100</span>
          </div>
        </div>
        <p className="text-sm text-gray-subtext mt-2">
          Confidence: {Math.round(prediction.confidence * 100)}%
        </p>
      </div>

      {/* Estimated Reach */}
      <div className="bg-dark-bg rounded-lg p-4">
        <h4 className="text-sm font-medium text-white mb-3">Estimated Reach</h4>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <p className="text-xs text-gray-subtext mb-1">Min</p>
            <p className="text-lg font-semibold text-white">
              {(prediction.estimatedReach.min / 1000).toFixed(1)}k
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-subtext mb-1">Expected</p>
            <p className="text-lg font-semibold text-primary-blue">
              {(prediction.estimatedReach.expected / 1000).toFixed(1)}k
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-subtext mb-1">Max</p>
            <p className="text-lg font-semibold text-white">
              {(prediction.estimatedReach.max / 1000).toFixed(1)}k
            </p>
          </div>
        </div>
      </div>

      {/* Key Factors */}
      <div>
        <h4 className="text-sm font-medium text-white mb-3">Key Factors</h4>
        <div className="space-y-2">
          {prediction.factors.slice(0, 5).map((factor, index) => (
            <div key={index} className="flex items-start gap-3 bg-dark-bg rounded-lg p-3">
              <span className={`text-lg ${
                factor.impact === 'positive' ? 'text-green-400' : 
                factor.impact === 'negative' ? 'text-red-400' : 
                'text-gray-400'
              }`}>
                {factor.impact === 'positive' ? '✓' : factor.impact === 'negative' ? '✗' : '○'}
              </span>
              <div className="flex-1">
                <p className="text-sm font-medium text-white">{factor.name}</p>
                <p className="text-xs text-gray-subtext">{factor.description}</p>
              </div>
              <span className="text-xs text-gray-subtext">
                {Math.round(factor.weight * 100)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Recommendations */}
      {prediction.recommendations.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-white mb-3">Recommendations</h4>
          <div className="space-y-2">
            {prediction.recommendations.map((rec, index) => (
              <div key={index} className="flex items-start gap-2 text-sm">
                <span className="text-primary-blue mt-0.5">💡</span>
                <p className="text-gray-subtext">{rec}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Optimal Time */}
      {prediction.optimalPostTime && (
        <div className="bg-dark-bg rounded-lg p-4">
          <h4 className="text-sm font-medium text-white mb-2">Optimal Posting Time</h4>
          <p className="text-primary-teal font-semibold">
            {prediction.optimalPostTime.toLocaleString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </p>
        </div>
      )}

      {/* Competitor Benchmark */}
      {prediction.competitorBenchmark && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-subtext">Competitor Average:</span>
          <span className="text-white font-medium">
            {(prediction.competitorBenchmark / 1000).toFixed(1)}k reach
          </span>
        </div>
      )}
    </div>
  );
};
