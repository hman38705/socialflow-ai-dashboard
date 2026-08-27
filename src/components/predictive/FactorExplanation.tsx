import React, { useState, useEffect, useMemo } from 'react';
import { ReachFactor, MLModelMetrics } from '../../types/predictive';

export interface FactorExplanationProps {
  factors?: ReachFactor[];
  modelMetrics?: MLModelMetrics;
  storageKey?: string;
  className?: string;
}

interface FactorDisplayItem {
  id: string;
  rawName: string;
  label: string;
  explanation: string;
  signedWeight: number; // -1.0 to +1.0
  percentageStr: string;
  isPositive: boolean;
}

// Plain-language factor mapping dictionary
const FACTOR_METADATA: Record<
  string,
  { label: string; defaultPositiveExp: string; defaultNegativeExp: string }
> = {
  content_length: {
    label: 'Post Length & Conciseness',
    defaultPositiveExp:
      'Copy is within the optimal 18–25 word window, maximizing full-read completion.',
    defaultNegativeExp:
      'Post length exceeds optimal reading attention or is too brief to hook the audience.',
  },
  hashtag_relevance: {
    label: 'Hashtag Discovery',
    defaultPositiveExp:
      '3–5 strategic hashtags provide ideal topic categorization across discovery feeds.',
    defaultNegativeExp:
      'Too few hashtags or overloaded tags reduce discoverability across search and feeds.',
  },
  media_richness: {
    label: 'Visual Media Format',
    defaultPositiveExp: 'Rich media (image/video/carousel) boosts organic impression rate by 2–3x.',
    defaultNegativeExp:
      'Text-only updates typically receive lower ranking in modern social visual algorithms.',
  },
  platform_distribution: {
    label: 'Platform Algorithm Fit',
    defaultPositiveExp:
      'Formatting, aspect ratio, and tone closely match current network preferences.',
    defaultNegativeExp:
      'Content style or dimensions diverge from platform-native engagement patterns.',
  },
  call_to_action: {
    label: 'Call-to-Action Strength',
    defaultPositiveExp: 'Clear, actionable instruction prompts comments, saves, clicks, or shares.',
    defaultNegativeExp: 'Missing direct reader call-to-action reduces viral discussion momentum.',
  },
  peak_hour_alignment: {
    label: 'Peak Timing Alignment',
    defaultPositiveExp:
      'Scheduled during your audience peak activity window for strong initial velocity.',
    defaultNegativeExp:
      'Scheduled during low-traffic off-hours, slowing initial engagement accumulation.',
  },
  readability_score: {
    label: 'Readability & Formatting',
    defaultPositiveExp:
      'Clean line breaks, bullet points, and high contrast make content effortlessly scannable.',
    defaultNegativeExp: 'Dense wall of text without spacing increases reader drop-off rate.',
  },
  sentiment_polarity: {
    label: 'Emotional Resonance & Tone',
    defaultPositiveExp:
      'Compelling, high-energy tone captures interest and encourages organic re-sharing.',
    defaultNegativeExp:
      'Neutral or flat emotional delivery may struggle to stand out in fast-scrolling feeds.',
  },
};

const DEFAULT_FACTORS: ReachFactor[] = [
  {
    name: 'content_length',
    impact: 'positive',
    weight: 0.28,
    description: '22 words — within sweet spot',
  },
  {
    name: 'hashtag_relevance',
    impact: 'positive',
    weight: 0.22,
    description: '3 relevant topic hashtags',
  },
  {
    name: 'media_richness',
    impact: 'positive',
    weight: 0.35,
    description: 'Image asset attached',
  },
  {
    name: 'call_to_action',
    impact: 'negative',
    weight: -0.15,
    description: 'No explicit CTA prompt detected',
  },
  {
    name: 'peak_hour_alignment',
    impact: 'positive',
    weight: 0.18,
    description: 'Aligned with peak morning window',
  },
];

const DEFAULT_METRICS: MLModelMetrics = {
  accuracy: 0.942,
  lastTrainedAt: new Date(Date.now() - 28 * 3600 * 1000), // 28 hours ago
  sampleSize: 14850,
  version: '3.2.0-neural',
};

export const FactorExplanation: React.FC<FactorExplanationProps> = ({
  factors = DEFAULT_FACTORS,
  modelMetrics = DEFAULT_METRICS,
  storageKey = 'socialflow_factor_explanation_expanded',
  className = '',
}) => {
  // Collapsed by default; expansion state persists in localStorage
  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem(storageKey);
        if (saved !== null) {
          return JSON.parse(saved);
        }
      }
    } catch {
      // Storage unavailable
    }
    return false; // Collapsed by default
  });

  const toggleExpanded = () => {
    setIsExpanded((prev) => {
      const next = !prev;
      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem(storageKey, JSON.stringify(next));
        }
      } catch {
        // Storage unavailable
      }
      return next;
    });
  };

  // Transform factors into signed diverging items with plain language
  const displayFactors = useMemo<FactorDisplayItem[]>(() => {
    return factors.map((factor, index) => {
      const rawName = factor.name.toLowerCase();
      const meta = FACTOR_METADATA[rawName] || {
        label: factor.name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        defaultPositiveExp:
          factor.description || 'Positive contributing factor to reach potential.',
        defaultNegativeExp: factor.description || 'Factor currently constraining maximum reach.',
      };

      // Determine signed weight (-1 to +1)
      let signedWeight = factor.weight;
      if (factor.impact === 'negative' && signedWeight > 0) {
        signedWeight = -signedWeight;
      } else if (factor.impact === 'positive' && signedWeight < 0) {
        signedWeight = Math.abs(signedWeight);
      }

      // Clamp between -1.0 and +1.0
      signedWeight = Math.max(-1.0, Math.min(1.0, signedWeight));
      const isPositive = signedWeight >= 0;
      const pct = Math.round(Math.abs(signedWeight) * 100);
      const percentageStr = isPositive ? `+${pct}%` : `-${pct}%`;

      const explanation = factor.description
        ? factor.description
        : isPositive
          ? meta.defaultPositiveExp
          : meta.defaultNegativeExp;

      return {
        id: `factor-${index}-${rawName}`,
        rawName,
        label: meta.label,
        explanation,
        signedWeight,
        percentageStr,
        isPositive,
      };
    });
  }, [factors]);

  // Compute training recency text
  const trainingRecencyText = useMemo(() => {
    if (!modelMetrics?.lastTrainedAt) return '24 hours ago';
    const lastDate =
      typeof modelMetrics.lastTrainedAt === 'string'
        ? new Date(modelMetrics.lastTrainedAt)
        : modelMetrics.lastTrainedAt;
    const diffHours = Math.max(1, Math.round((Date.now() - lastDate.getTime()) / (3600 * 1000)));

    if (diffHours < 24) return `${diffHours} hours ago`;
    const days = Math.round(diffHours / 24);
    return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  }, [modelMetrics?.lastTrainedAt]);

  return (
    <div className={`w-full ${className}`}>
      <div className="bg-dark-surface/90 backdrop-blur-xl border border-dark-border rounded-2xl shadow-elev-2 overflow-hidden transition-all">
        {/* Accordion Disclosure Header (Collapsed by Default) */}
        <button
          type="button"
          onClick={toggleExpanded}
          aria-expanded={isExpanded}
          className="w-full p-5 flex items-center justify-between text-left hover:bg-white/[0.02] transition-colors focus:outline-none"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-primary-teal/10 border border-primary-teal/30 flex items-center justify-center text-primary-teal">
              <span className="material-symbols-outlined text-lg">tune</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-white tracking-tight">
                  Reach Factor Contribution Breakdown
                </h4>
                <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] font-bold text-primary-teal">
                  {displayFactors.length} Factors
                </span>
              </div>
              <p className="text-xs text-gray-subtext">
                Signed impact weights & plain-language explanations
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-400 hidden sm:inline">
              {isExpanded ? 'Hide Breakdown' : 'View Breakdown'}
            </span>
            <span
              className={`material-symbols-outlined text-gray-400 transition-transform duration-300 ${
                isExpanded ? 'rotate-180 text-white' : ''
              }`}
            >
              expand_more
            </span>
          </div>
        </button>

        {/* Collapsible Panel Content */}
        {isExpanded && (
          <div className="p-6 pt-2 border-t border-dark-border/60 space-y-6 animate-fade-in">
            {/* Diverging Bar Chart Axis Header */}
            <div className="space-y-1 pt-2">
              <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-gray-subtext">
                <span className="text-rose-400 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  Negative Drag (-100%)
                </span>
                <span className="text-gray-400 font-mono">0 Center Axis</span>
                <span className="text-emerald-400 flex items-center gap-1">
                  Positive Boost (+100%)
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                </span>
              </div>
            </div>

            {/* Contributing Factors Diverging Chart List */}
            <div className="space-y-4">
              {displayFactors.map((factor) => {
                const absWeight = Math.abs(factor.signedWeight);
                const barWidthPct = Math.min(100, Math.round(absWeight * 100));

                return (
                  <div
                    key={factor.id}
                    className="p-4 bg-dark-bg/60 border border-dark-border/70 rounded-xl space-y-2.5 hover:border-white/20 transition-all"
                  >
                    {/* Top Row: Plain-Language Label and Signed Delta Badge */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            factor.isPositive
                              ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]'
                              : 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.5)]'
                          }`}
                        />
                        <span className="text-xs font-bold text-white tracking-tight">
                          {factor.label}
                        </span>
                      </div>

                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold font-mono tracking-wide ${
                          factor.isPositive
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                        }`}
                      >
                        {factor.percentageStr}
                      </span>
                    </div>

                    {/* Plain-Language Explanation */}
                    <p className="text-xs text-gray-300 leading-relaxed pl-4">
                      {factor.explanation}
                    </p>

                    {/* Diverging Horizontal Bar (Centered at 0) */}
                    <div className="relative h-3 w-full bg-dark-bg rounded-full overflow-hidden border border-white/5 flex items-center">
                      {/* Center 0-Axis Divider */}
                      <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-white/30 z-10" />

                      {/* Negative Bar (Extends to the left from 50%) */}
                      {!factor.isPositive && (
                        <div
                          className="absolute right-1/2 h-full bg-rose-500 rounded-l-full transition-all duration-500 shadow-[0_0_10px_rgba(244,63,94,0.4)]"
                          style={{ width: `${barWidthPct / 2}%` }}
                        />
                      )}

                      {/* Positive Bar (Extends to the right from 50%) */}
                      {factor.isPositive && (
                        <div
                          className="absolute left-1/2 h-full bg-emerald-400 rounded-r-full transition-all duration-500 shadow-[0_0_10px_rgba(52,211,153,0.4)]"
                          style={{ width: `${barWidthPct / 2}%` }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Explicit Model Estimate & Recency Disclaimer Copy */}
            <div className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary-teal">
                <span className="material-symbols-outlined text-base">info</span>
                Model Estimate Notice
              </div>
              <p className="text-xs text-gray-300 leading-relaxed">
                Reach scores and factor weights are statistical predictive estimates derived from
                historical social performance models and are not guaranteed outcomes.
              </p>
              <div className="pt-2 border-t border-white/10 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-400 font-medium">
                <span>
                  Model Version: <strong className="text-white">{modelMetrics.version}</strong>
                </span>
                <span>•</span>
                <span>
                  Last Trained: <strong className="text-white">{trainingRecencyText}</strong>
                </span>
                <span>•</span>
                <span>
                  Calibration Base:{' '}
                  <strong className="text-white">
                    {modelMetrics.sampleSize.toLocaleString()} posts
                  </strong>
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FactorExplanation;
