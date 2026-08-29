import React, { useState, useMemo, useEffect } from 'react';
import { MLModelMetrics } from '../../types/predictive';
import { predictiveService } from '../../services/PredictiveService';

export interface ScoredPostPerformance {
  id: string;
  postId?: string;
  content: string;
  platform: 'instagram' | 'tiktok' | 'facebook' | 'youtube' | 'linkedin' | 'x';
  publishedAt: number | string | Date;
  predictedReach: number;
  actualReach: number;
  reachScore: number;
  confidence: number;
  confidenceBand: {
    min: number;
    max: number;
  };
  postUrl?: string;
}

export interface PredictiveReachDashboardProps {
  posts?: ScoredPostPerformance[];
  modelMetrics?: MLModelMetrics;
  onSync?: () => Promise<void>;
  className?: string;
}

// 12 realistic benchmark records for full calibration & demo
const DEMO_SCORED_POSTS: ScoredPostPerformance[] = [
  {
    id: 'post-101',
    postId: 'p101',
    content: 'Unveiling our next-generation AI workflow tools for creators! #buildinpublic #ai',
    platform: 'x',
    publishedAt: Date.now() - 14 * 86400000,
    predictedReach: 12500,
    actualReach: 14200,
    reachScore: 82,
    confidence: 0.88,
    confidenceBand: { min: 10500, max: 15500 },
    postUrl: '/posts/post-101',
  },
  {
    id: 'post-102',
    postId: 'p102',
    content: '5 design mistakes killing your engagement rates right now (and how to fix them) 🧵',
    platform: 'linkedin',
    publishedAt: Date.now() - 13 * 86400000,
    predictedReach: 18000,
    actualReach: 24500,
    reachScore: 88,
    confidence: 0.91,
    confidenceBand: { min: 15000, max: 22000 },
    postUrl: '/posts/post-102',
  },
  {
    id: 'post-103',
    postId: 'p103',
    content: 'Behind the scenes at our team offsite in Lisbon! ☀️🌴',
    platform: 'instagram',
    publishedAt: Date.now() - 12 * 86400000,
    predictedReach: 28000,
    actualReach: 17200,
    reachScore: 74,
    confidence: 0.84,
    confidenceBand: { min: 22000, max: 34000 },
    postUrl: '/posts/post-103',
  },
  {
    id: 'post-104',
    postId: 'p104',
    content: 'How we automated 80% of our daily reporting pipeline using TypeScript.',
    platform: 'x',
    publishedAt: Date.now() - 10 * 86400000,
    predictedReach: 9500,
    actualReach: 9800,
    reachScore: 68,
    confidence: 0.86,
    confidenceBand: { min: 7800, max: 11500 },
    postUrl: '/posts/post-104',
  },
  {
    id: 'post-105',
    postId: 'p105',
    content: 'Quick 30s tutorial: Building interactive predictive reach models with React.',
    platform: 'tiktok',
    publishedAt: Date.now() - 9 * 86400000,
    predictedReach: 45000,
    actualReach: 76000,
    reachScore: 92,
    confidence: 0.89,
    confidenceBand: { min: 36000, max: 55000 },
    postUrl: '/posts/post-105',
  },
  {
    id: 'post-106',
    postId: 'p106',
    content: 'Why community feedback loops beat top-down feature roadmap planning every time.',
    platform: 'linkedin',
    publishedAt: Date.now() - 8 * 86400000,
    predictedReach: 14000,
    actualReach: 13600,
    reachScore: 76,
    confidence: 0.9,
    confidenceBand: { min: 11500, max: 17000 },
    postUrl: '/posts/post-106',
  },
  {
    id: 'post-107',
    postId: 'p107',
    content: 'New podcast episode: scaling real-time distributed systems to millions of events.',
    platform: 'youtube',
    publishedAt: Date.now() - 7 * 86400000,
    predictedReach: 32000,
    actualReach: 34500,
    reachScore: 84,
    confidence: 0.87,
    confidenceBand: { min: 26000, max: 38000 },
    postUrl: '/posts/post-107',
  },
  {
    id: 'post-108',
    postId: 'p108',
    content: 'We are hiring Senior Fullstack Engineers to join our core product team! 💼',
    platform: 'facebook',
    publishedAt: Date.now() - 5 * 86400000,
    predictedReach: 8500,
    actualReach: 5100,
    reachScore: 62,
    confidence: 0.82,
    confidenceBand: { min: 6500, max: 10800 },
    postUrl: '/posts/post-108',
  },
  {
    id: 'post-109',
    postId: 'p109',
    content: 'Weekly changelog: 14 bug fixes, dark mode polish, and 2x faster query speeds.',
    platform: 'x',
    publishedAt: Date.now() - 4 * 86400000,
    predictedReach: 11000,
    actualReach: 11900,
    reachScore: 71,
    confidence: 0.88,
    confidenceBand: { min: 9000, max: 13500 },
    postUrl: '/posts/post-109',
  },
  {
    id: 'post-110',
    postId: 'p110',
    content: 'The future of autonomous agents in everyday developer productivity.',
    platform: 'linkedin',
    publishedAt: Date.now() - 3 * 86400000,
    predictedReach: 21000,
    actualReach: 22400,
    reachScore: 85,
    confidence: 0.93,
    confidenceBand: { min: 18000, max: 25000 },
    postUrl: '/posts/post-110',
  },
  {
    id: 'post-111',
    postId: 'p111',
    content: 'How to structure multi-tier caching with Redis and Cloudflare Workers.',
    platform: 'x',
    publishedAt: Date.now() - 2 * 86400000,
    predictedReach: 16500,
    actualReach: 15900,
    reachScore: 79,
    confidence: 0.89,
    confidenceBand: { min: 13500, max: 19800 },
    postUrl: '/posts/post-111',
  },
  {
    id: 'post-112',
    postId: 'p112',
    content: 'Customer spotlight: How Acme tripled social reach with automated timing.',
    platform: 'instagram',
    publishedAt: Date.now() - 1 * 86400000,
    predictedReach: 24000,
    actualReach: 26800,
    reachScore: 81,
    confidence: 0.9,
    confidenceBand: { min: 19500, max: 28500 },
    postUrl: '/posts/post-112',
  },
];

export const PredictiveReachDashboard: React.FC<PredictiveReachDashboardProps> = ({
  posts: externalPosts,
  modelMetrics: externalMetrics,
  onSync,
  className = '',
}) => {
  const [activePosts, setActivePosts] = useState<ScoredPostPerformance[]>(
    externalPosts ?? DEMO_SCORED_POSTS,
  );

  const [metrics, setMetrics] = useState<MLModelMetrics>(
    externalMetrics ?? {
      accuracy: 0.938,
      lastTrainedAt: new Date(Date.now() - 24 * 3600 * 1000),
      sampleSize: 14280,
      version: '3.1.0-prod',
    },
  );

  const [syncing, setSyncing] = useState(false);
  const [outlierFilter, setOutlierFilter] = useState<'all' | 'over' | 'under'>('all');
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');

  useEffect(() => {
    if (externalPosts !== undefined) {
      setActivePosts(externalPosts);
    }
  }, [externalPosts]);

  useEffect(() => {
    if (!externalMetrics) {
      predictiveService.getModelMetrics().then((res) => {
        if (res.metrics) setMetrics(res.metrics);
      });
    }
  }, [externalMetrics]);

  // Check if we meet the 10 post threshold
  const totalCount = activePosts.length;
  const isBelowThreshold = totalCount < 10;

  // Filter posts by platform if requested
  const filteredPosts = useMemo(() => {
    if (selectedPlatform === 'all') return activePosts;
    return activePosts.filter((p) => p.platform === selectedPlatform);
  }, [activePosts, selectedPlatform]);

  // Sort chronologically for time-series comparison
  const chronologicalPosts = useMemo(() => {
    return [...filteredPosts].sort((a, b) => {
      const timeA =
        typeof a.publishedAt === 'number' ? a.publishedAt : new Date(a.publishedAt).getTime();
      const timeB =
        typeof b.publishedAt === 'number' ? b.publishedAt : new Date(b.publishedAt).getTime();
      return timeA - timeB;
    });
  }, [filteredPosts]);

  // Compute Model Accuracy Summary Math
  const accuracySummary = useMemo(() => {
    if (totalCount === 0) {
      return {
        mae: 0,
        withinBandPct: 0,
        avgAccuracyPct: 0,
        totalEvaluated: 0,
      };
    }

    let totalAbsoluteError = 0;
    let withinBandCount = 0;
    let totalPercentageError = 0;

    activePosts.forEach((post) => {
      const error = Math.abs(post.actualReach - post.predictedReach);
      totalAbsoluteError += error;

      if (
        post.actualReach >= post.confidenceBand.min &&
        post.actualReach <= post.confidenceBand.max
      ) {
        withinBandCount += 1;
      }

      const baseline = Math.max(1, post.actualReach);
      totalPercentageError += (error / baseline) * 100;
    });

    const mae = Math.round(totalAbsoluteError / totalCount);
    const withinBandPct = Math.round((withinBandCount / totalCount) * 100);
    const meanPercentageError = totalPercentageError / totalCount;
    const avgAccuracyPct = Math.max(0, Math.min(100, Math.round(100 - meanPercentageError)));

    return {
      mae,
      withinBandPct,
      avgAccuracyPct,
      totalEvaluated: totalCount,
    };
  }, [activePosts, totalCount]);

  // Compute Outliers (posts with largest over- or under-performance delta)
  const outliers = useMemo(() => {
    const scored = activePosts.map((post) => {
      const deltaReach = post.actualReach - post.predictedReach;
      const deltaPct =
        post.predictedReach > 0 ? Math.round((deltaReach / post.predictedReach) * 100) : 0;
      const isOver = deltaReach > 0;
      const absDeltaPct = Math.abs(deltaPct);

      return {
        ...post,
        deltaReach,
        deltaPct,
        absDeltaPct,
        isOver,
      };
    });

    // Sort by absolute deviation descending
    scored.sort((a, b) => b.absDeltaPct - a.absDeltaPct);

    if (outlierFilter === 'over') {
      return scored.filter((p) => p.isOver);
    }
    if (outlierFilter === 'under') {
      return scored.filter((p) => !p.isOver);
    }
    return scored;
  }, [activePosts, outlierFilter]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      if (onSync) {
        await onSync();
      } else {
        await new Promise((res) => setTimeout(res, 800));
      }
    } finally {
      setSyncing(false);
    }
  };

  // Honest Empty State view when fewer than 10 scored posts exist
  if (isBelowThreshold) {
    return (
      <div className={`space-y-6 ${className}`}>
        <div className="bg-dark-surface/90 backdrop-blur-xl border border-dark-border rounded-2xl p-8 sm:p-12 text-center shadow-elev-2 max-w-2xl mx-auto space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-400">
            <span className="material-symbols-outlined text-3xl">insights</span>
          </div>

          <div className="space-y-2">
            <h3 className="text-xl font-bold text-white tracking-tight">
              Calibrating Predictive Reach Model
            </h3>
            <p className="text-sm text-gray-subtext max-w-md mx-auto leading-relaxed">
              We require at least{' '}
              <strong className="text-white">10 scored-and-published posts</strong> to generate
              statistically valid accuracy metrics, compute Mean Absolute Error (MAE), and rank
              reach performance outliers.
            </p>
          </div>

          {/* Progress Tracker */}
          <div className="p-4 bg-dark-bg/80 border border-dark-border rounded-xl space-y-2 max-w-md mx-auto">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-gray-subtext">Calibration Progress</span>
              <span className="text-amber-400 font-bold">{totalCount} of 10 posts</span>
            </div>
            <div className="w-full h-2.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-400 rounded-full transition-all duration-500 shadow-glow-rose"
                style={{ width: `${Math.min(100, (totalCount / 10) * 100)}%` }}
              />
            </div>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setActivePosts(DEMO_SCORED_POSTS)}
              className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-primary-blue hover:bg-blue-600 text-white text-xs font-bold transition-all shadow-glow-blue flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-base">preview</span>
              Load Benchmark Dataset (12 Posts)
            </button>
            <a
              href="/composer"
              className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-bold transition-all flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-base">add_circle</span>
              Compose New Post
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Max value for scaling charts
  const maxReachValue = Math.max(
    ...chronologicalPosts.map((p) =>
      Math.max(p.predictedReach, p.actualReach, p.confidenceBand.max),
    ),
    1000,
  );

  return (
    <div className={`space-y-8 pb-12 ${className}`}>
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary-rose/10 border border-primary-rose/30 flex items-center justify-center text-primary-rose">
            <span className="material-symbols-outlined text-2xl">analytics</span>
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">
              Predictive Reach Dashboard
            </h2>
            <p className="text-xs text-gray-subtext">
              Historical model accuracy, predicted vs. actual reach, and outlier analysis
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Platform filter */}
          <select
            value={selectedPlatform}
            onChange={(e) => setSelectedPlatform(e.target.value)}
            className="bg-dark-surface border border-dark-border rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-primary-blue font-semibold"
          >
            <option value="all">All Platforms</option>
            <option value="instagram">Instagram</option>
            <option value="tiktok">TikTok</option>
            <option value="x">X</option>
            <option value="linkedin">LinkedIn</option>
            <option value="youtube">YouTube</option>
            <option value="facebook">Facebook</option>
          </select>

          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-white transition-all flex items-center gap-1.5"
          >
            <span
              className={`material-symbols-outlined text-base ${
                syncing ? 'animate-spin text-primary-blue' : ''
              }`}
            >
              sync
            </span>
            {syncing ? 'Syncing...' : 'Sync History'}
          </button>
        </div>
      </div>

      {/* Model Accuracy Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Mean Absolute Error (MAE) */}
        <div className="bg-dark-surface/80 backdrop-blur-xl border border-dark-border rounded-2xl p-5 shadow-elev-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-subtext">
            Mean Absolute Error (MAE)
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white tracking-tight">
              ±{(accuracySummary.mae / 1000).toFixed(1)}k
            </span>
            <span className="text-xs text-gray-subtext">views</span>
          </div>
          <p className="mt-1 text-[11px] text-gray-400">
            Average absolute reach delta across {accuracySummary.totalEvaluated} posts
          </p>
        </div>

        {/* Metric 2: Confidence Band Containment */}
        <div className="bg-dark-surface/80 backdrop-blur-xl border border-dark-border rounded-2xl p-5 shadow-elev-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-subtext">
            Within Confidence Band
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-emerald-400 tracking-tight">
              {accuracySummary.withinBandPct}%
            </span>
            <span className="text-xs text-emerald-400/80 font-semibold">contained</span>
          </div>
          <p className="mt-1 text-[11px] text-gray-400">
            Posts hitting within min-max confidence window
          </p>
        </div>

        {/* Metric 3: Overall Model Accuracy */}
        <div className="bg-dark-surface/80 backdrop-blur-xl border border-dark-border rounded-2xl p-5 shadow-elev-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-subtext">
            Overall Model Fit
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-primary-teal tracking-tight">
              {accuracySummary.avgAccuracyPct}%
            </span>
            <span className="text-xs text-primary-teal/80 font-semibold">accuracy</span>
          </div>
          <p className="mt-1 text-[11px] text-gray-400">Model version: {metrics.version}</p>
        </div>

        {/* Metric 4: Total Calibrated Posts */}
        <div className="bg-dark-surface/80 backdrop-blur-xl border border-dark-border rounded-2xl p-5 shadow-elev-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-subtext">
            Calibrated Sample
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-primary-blue tracking-tight">
              {totalCount}
            </span>
            <span className="text-xs text-gray-subtext">posts</span>
          </div>
          <p className="mt-1 text-[11px] text-gray-400">
            {metrics.sampleSize.toLocaleString()} global neural training points
          </p>
        </div>
      </div>

      {/* Predicted vs Actual Reach Comparison Over Time */}
      <div className="bg-dark-surface/90 backdrop-blur-xl border border-dark-border rounded-2xl p-6 shadow-elev-2 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-dark-border/60 pb-4">
          <div>
            <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              <span className="material-symbols-outlined text-primary-blue text-xl">
                show_chart
              </span>
              Predicted vs. Actual Reach Over Time
            </h3>
            <p className="text-xs text-gray-subtext">
              Chronological alignment of predicted targets against verified actual reach
            </p>
          </div>

          {/* Chart Legend */}
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5 font-semibold">
              <span className="w-3 h-3 rounded-full bg-primary-blue shadow-glow-blue" />
              <span className="text-gray-300">Predicted Reach</span>
            </div>
            <div className="flex items-center gap-1.5 font-semibold">
              <span className="w-3 h-3 rounded-full bg-emerald-400" />
              <span className="text-gray-300">Actual Reach</span>
            </div>
            <div className="flex items-center gap-1.5 font-semibold">
              <span className="w-3 h-3 rounded-sm bg-white/15 border border-white/20" />
              <span className="text-gray-400">Confidence Band</span>
            </div>
          </div>
        </div>

        {/* Time-series bars & graph visualization */}
        <div className="space-y-4 pt-2">
          {chronologicalPosts.map((post, index) => {
            const formattedDate = new Date(post.publishedAt).toLocaleDateString([], {
              month: 'short',
              day: 'numeric',
            });
            const predPct = Math.min(100, (post.predictedReach / maxReachValue) * 100);
            const actualPct = Math.min(100, (post.actualReach / maxReachValue) * 100);
            const bandMinPct = Math.min(100, (post.confidenceBand.min / maxReachValue) * 100);
            const bandMaxPct = Math.min(100, (post.confidenceBand.max / maxReachValue) * 100);
            const bandWidthPct = Math.max(2, bandMaxPct - bandMinPct);

            const isOver = post.actualReach >= post.predictedReach;
            const deltaPct = Math.round(
              ((post.actualReach - post.predictedReach) / Math.max(1, post.predictedReach)) * 100,
            );

            return (
              <div
                key={post.id || index}
                className="p-3.5 bg-dark-bg/60 hover:bg-dark-bg border border-dark-border/70 hover:border-white/20 rounded-xl transition-all space-y-2 group"
              >
                <div className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-gray-400 font-mono text-[11px] shrink-0 font-medium">
                      {formattedDate}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-wider text-primary-blue shrink-0">
                      {post.platform}
                    </span>
                    <span className="text-white truncate font-medium text-xs">{post.content}</span>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <span className="text-gray-400 text-[11px]">Pred: </span>
                      <strong className="text-primary-blue">
                        {(post.predictedReach / 1000).toFixed(1)}k
                      </strong>
                      <span className="text-gray-500 mx-1">/</span>
                      <span className="text-gray-400 text-[11px]">Act: </span>
                      <strong className="text-emerald-400">
                        {(post.actualReach / 1000).toFixed(1)}k
                      </strong>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        isOver
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      {deltaPct >= 0 ? `+${deltaPct}%` : `${deltaPct}%`}
                    </span>
                  </div>
                </div>

                {/* Visual Bar Comparison with Confidence Interval */}
                <div className="relative h-5 w-full bg-dark-bg rounded-lg overflow-hidden border border-white/5 flex items-center">
                  {/* Shaded Confidence Band */}
                  <div
                    className="absolute h-full bg-white/10 border-x border-white/20"
                    style={{ left: `${bandMinPct}%`, width: `${bandWidthPct}%` }}
                    title={`Confidence band: ${(post.confidenceBand.min / 1000).toFixed(1)}k - ${(post.confidenceBand.max / 1000).toFixed(1)}k`}
                  />

                  {/* Predicted Reach Marker / Bar */}
                  <div
                    className="absolute h-2.5 bg-primary-blue rounded-full shadow-glow-blue transition-all"
                    style={{ width: `${predPct}%` }}
                  />

                  {/* Actual Reach Pin / Indicator */}
                  <div
                    className="absolute top-0 bottom-0 w-1.5 bg-emerald-400 rounded-sm shadow-sm transition-all z-10"
                    style={{ left: `calc(${actualPct}% - 3px)` }}
                    title={`Actual Reach: ${post.actualReach.toLocaleString()}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Outliers Ranking List */}
      <div className="bg-dark-surface/90 backdrop-blur-xl border border-dark-border rounded-2xl p-6 shadow-elev-2 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-dark-border/60 pb-4">
          <div>
            <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              <span className="material-symbols-outlined text-primary-purple text-xl">
                crisis_alert
              </span>
              Reach Outliers & High-Variance Posts
            </h3>
            <p className="text-xs text-gray-subtext">
              Posts with the most significant divergence from machine learning projections
            </p>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-1.5 bg-dark-bg/80 p-1 rounded-xl border border-dark-border">
            {(
              [
                { id: 'all', label: 'All Outliers' },
                { id: 'over', label: 'Overperformed' },
                { id: 'under', label: 'Underperformed' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setOutlierFilter(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  outlierFilter === tab.id
                    ? 'bg-primary-purple text-white shadow-sm'
                    : 'text-gray-subtext hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Outliers list */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {outliers.slice(0, 8).map((outlier) => (
            <div
              key={outlier.id}
              className="p-4 bg-dark-bg/60 hover:bg-dark-bg border border-dark-border/80 hover:border-primary-purple/40 rounded-xl transition-all flex flex-col justify-between space-y-3"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-wider text-primary-purple">
                    {outlier.platform}
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold ${
                      outlier.isOver
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    {outlier.deltaPct >= 0 ? `+${outlier.deltaPct}%` : `${outlier.deltaPct}%`} vs
                    Target
                  </span>
                </div>

                <p className="text-xs text-white font-medium line-clamp-2 leading-relaxed">
                  {outlier.content}
                </p>
              </div>

              <div className="pt-2 border-t border-dark-border/40 flex items-center justify-between">
                <div className="text-[11px]">
                  <span className="text-gray-400">Predicted: </span>
                  <span className="text-primary-blue font-bold">
                    {(outlier.predictedReach / 1000).toFixed(1)}k
                  </span>
                  <span className="text-gray-500 mx-1.5">•</span>
                  <span className="text-gray-400">Actual: </span>
                  <span className="text-emerald-400 font-bold">
                    {(outlier.actualReach / 1000).toFixed(1)}k
                  </span>
                </div>

                {/* Direct Post Link */}
                <a
                  href={outlier.postUrl || `/posts/${outlier.id}`}
                  className="text-xs font-bold text-primary-blue hover:text-blue-400 flex items-center gap-1 transition-colors"
                >
                  View Post
                  <span className="material-symbols-outlined text-sm">arrow_forward</span>
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PredictiveReachDashboard;
