import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PostAnalysisInput, ReachPrediction } from '../types/predictive';
import { predictiveService } from '../services/PredictiveService';

type PredictorPlatform = PostAnalysisInput['platform'];

export interface ContentVariant {
  id: string;
  name: string;
  content: string;
  platform: PredictorPlatform;
  mediaType: 'text' | 'image' | 'video' | 'carousel';
  scheduledTime?: string;
  prediction: ReachPrediction | null;
  loading: boolean;
}

const PLATFORMS: { id: PredictorPlatform; label: string }[] = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'x', label: 'X' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'facebook', label: 'Facebook' },
];

const INITIAL_SAMPLE =
  'Excited to announce our new product launch! 🚀 Check it out — link in bio #innovation #tech #startup';

export const PredictorPage: React.FC = () => {
  const navigate = useNavigate?.() ? useNavigate() : null;

  const [platform, setPlatform] = useState<PredictorPlatform>('instagram');
  const [content, setContent] = useState(INITIAL_SAMPLE);
  const [followers, setFollowers] = useState(120000);
  const [scheduledTime, setScheduledTime] = useState<string>('10:00');
  const [mediaType, setMediaType] = useState<'text' | 'image' | 'video' | 'carousel'>('image');

  // Variant comparison state (up to 3 side-by-side variants)
  const [activeTab, setActiveTab] = useState<'single' | 'variants'>('single');
  const [variants, setVariants] = useState<ContentVariant[]>([
    {
      id: 'var-1',
      name: 'Variant A (Hook + Emojis)',
      content:
        'Excited to announce our new product launch! 🚀 Check it out — link in bio #innovation #tech #startup',
      platform: 'instagram',
      mediaType: 'image',
      scheduledTime: '10:00',
      prediction: null,
      loading: false,
    },
    {
      id: 'var-2',
      name: 'Variant B (Data-Driven Question)',
      content:
        'Did you know 78% of teams struggle with manual workflow syncs? Discover how SocialFlow solves it today. #productivity #saas #growth',
      platform: 'linkedin',
      mediaType: 'carousel',
      scheduledTime: '14:00',
      prediction: null,
      loading: false,
    },
  ]);

  const [singlePrediction, setSinglePrediction] = useState<ReachPrediction | null>(null);
  const [singleLoading, setSingleLoading] = useState(false);
  const [handoffSuccess, setHandoffSuccess] = useState<string | null>(null);

  // Extract hashtags
  const hashtags = useMemo(() => {
    const matches = content.match(/#[a-zA-Z0-9_]+/g);
    return matches || [];
  }, [content]);

  // Single scratchpad live scoring
  useEffect(() => {
    let active = true;
    if (!content || content.trim().length === 0) {
      setSinglePrediction(null);
      return;
    }

    setSingleLoading(true);
    const targetDate = new Date();
    if (scheduledTime) {
      const [h, m] = scheduledTime.split(':');
      targetDate.setHours(parseInt(h, 10), parseInt(m, 10), 0, 0);
    }

    predictiveService
      .predictReach({
        content,
        platform,
        mediaType,
        hashtags,
        followerCount: followers,
        scheduledTime: targetDate,
      })
      .then((res) => {
        if (active) setSinglePrediction(res);
      })
      .catch(() => {
        if (active) {
          setSinglePrediction(
            predictiveService.heuristicPrediction({
              content,
              platform,
              mediaType,
              hashtags,
              followerCount: followers,
            }),
          );
        }
      })
      .finally(() => {
        if (active) setSingleLoading(false);
      });

    return () => {
      active = false;
    };
  }, [content, platform, mediaType, hashtags, followers, scheduledTime]);

  // Evaluate variants
  useEffect(() => {
    variants.forEach((variant, index) => {
      if (!variant.content.trim()) return;

      const varTags = variant.content.match(/#[a-zA-Z0-9_]+/g) || [];
      predictiveService
        .predictReach({
          content: variant.content,
          platform: variant.platform,
          mediaType: variant.mediaType,
          hashtags: varTags,
          followerCount: followers,
        })
        .then((res) => {
          setVariants((prev) => {
            const next = [...prev];
            if (next[index]) {
              next[index] = { ...next[index], prediction: res, loading: false };
            }
            return next;
          });
        })
        .catch(() => {
          const fallback = predictiveService.heuristicPrediction({
            content: variant.content,
            platform: variant.platform,
            mediaType: variant.mediaType,
            hashtags: varTags,
            followerCount: followers,
          });
          setVariants((prev) => {
            const next = [...prev];
            if (next[index]) {
              next[index] = { ...next[index], prediction: fallback, loading: false };
            }
            return next;
          });
        });
    });
  }, [variants.length, followers]);

  // Send to Composer handoff handler
  const handleSendToComposer = (
    variantContent?: string,
    variantPlatform?: PredictorPlatform,
    variantMedia?: 'text' | 'image' | 'video' | 'carousel',
  ) => {
    const payload = {
      content: variantContent || content,
      platform: variantPlatform || platform,
      mediaType: variantMedia || mediaType,
      scheduledTime: scheduledTime,
      followerCount: followers,
    };

    try {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('composer_draft_handoff', JSON.stringify(payload));
      }
    } catch {
      // Storage unavailable
    }

    setHandoffSuccess('Draft carried to Composer! Navigating...');
    setTimeout(() => {
      if (navigate) {
        navigate('/composer', { state: { draft: payload } });
      } else if (typeof window !== 'undefined') {
        window.location.href = '/composer';
      }
    }, 400);
  };

  const handleAddVariant = () => {
    if (variants.length >= 3) return;
    const newIndex = variants.length + 1;
    const letter = newIndex === 2 ? 'B' : 'C';
    setVariants((prev) => [
      ...prev,
      {
        id: `var-${Date.now()}`,
        name: `Variant ${letter}`,
        content: `Alternative test copy for #${letter.toLowerCase()} variant. #socialflow #test`,
        platform: 'instagram',
        mediaType: 'image',
        prediction: null,
        loading: false,
      },
    ]);
  };

  const handleRemoveVariant = (id: string) => {
    if (variants.length <= 1) return;
    setVariants((prev) => prev.filter((v) => v.id !== id));
  };

  const handleUpdateVariantContent = (index: number, newContent: string) => {
    setVariants((prev) => {
      const next = [...prev];
      if (next[index]) {
        next[index] = { ...next[index], content: newContent };
      }
      return next;
    });
  };

  // Find best scoring variant
  const topVariantId = useMemo(() => {
    let topId = '';
    let maxScore = -1;
    variants.forEach((v) => {
      if (v.prediction && v.prediction.reachScore > maxScore) {
        maxScore = v.prediction.reachScore;
        topId = v.id;
      }
    });
    return topId;
  }, [variants]);

  return (
    <div className="space-y-8 pb-20 max-w-7xl mx-auto">
      {/* Explicit Sandbox Notification Banner */}
      <div className="p-4 bg-primary-purple/10 border border-primary-purple/30 rounded-2xl flex items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary-purple/20 border border-primary-purple/40 flex items-center justify-center text-primary-purple shrink-0">
            <span className="material-symbols-outlined text-xl">science</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-primary-purple">
                Sandbox Mode
              </span>
              <span className="px-2 py-0.5 rounded-full bg-primary-purple/20 text-primary-purple text-[10px] font-extrabold">
                Zero Persistence
              </span>
            </div>
            <p className="text-xs text-gray-300 mt-0.5 leading-relaxed">
              This is an isolated predictive scratchpad. Nothing on this page persists a post or
              touches production channels.
            </p>
          </div>
        </div>

        {handoffSuccess && (
          <div className="px-3 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-xs font-bold flex items-center gap-1.5 shrink-0">
            <span className="material-symbols-outlined text-sm">check_circle</span>
            {handoffSuccess}
          </div>
        )}
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary-purple/20 border border-primary-purple/30 flex items-center justify-center">
            <span className="material-symbols-outlined text-primary-purple text-2xl">
              psychology
            </span>
          </div>
          <div>
            <h3 className="text-xl font-bold text-white tracking-tight">AI Reach Predictor</h3>
            <p className="text-sm text-gray-subtext">
              Draft a post and see its projected reach in real time.
            </p>
          </div>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-1 bg-dark-surface p-1 rounded-xl border border-dark-border">
          <button
            type="button"
            onClick={() => setActiveTab('single')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'single'
                ? 'bg-primary-purple text-white shadow-sm'
                : 'text-gray-subtext hover:text-white'
            }`}
          >
            Single Scratchpad
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('variants')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeTab === 'variants'
                ? 'bg-primary-purple text-white shadow-sm'
                : 'text-gray-subtext hover:text-white'
            }`}
          >
            <span>Compare Variants</span>
            <span className="px-1.5 py-0.2 rounded-full bg-white/20 text-[10px]">
              {variants.length}
            </span>
          </button>
        </div>
      </div>

      {/* Mode 1: Single Scratchpad */}
      {activeTab === 'single' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Editor Sandbox Form */}
          <div className="lg:col-span-7 space-y-6">
            <div className="bg-dark-surface/90 backdrop-blur-xl border border-dark-border rounded-2xl p-6 shadow-elev-2 space-y-6">
              {/* Platform Selector */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext block mb-2">
                  Platform
                </label>
                <div className="flex flex-wrap gap-2">
                  {PLATFORMS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPlatform(p.id)}
                      className={`px-3.5 py-2 rounded-xl border text-xs font-bold transition-all ${
                        platform === p.id
                          ? 'bg-primary-purple/20 border-primary-purple/40 text-primary-purple shadow-sm'
                          : 'border-dark-border text-gray-400 hover:text-white hover:border-white/20 bg-dark-bg/60'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Media Type Selection */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext block mb-2">
                  Attachment Type
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(['text', 'image', 'video', 'carousel'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setMediaType(type)}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold capitalize border flex items-center justify-center gap-1.5 transition-all ${
                        mediaType === type
                          ? 'bg-primary-purple/20 border-primary-purple/40 text-primary-purple'
                          : 'bg-dark-bg/60 border-dark-border text-gray-400 hover:text-white hover:border-white/20'
                      }`}
                    >
                      <span className="material-symbols-outlined text-base">
                        {type === 'text'
                          ? 'article'
                          : type === 'image'
                            ? 'image'
                            : type === 'video'
                              ? 'videocam'
                              : 'view_carousel'}
                      </span>
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              {/* Post Content Scratchpad */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">
                    Post Content
                  </label>
                  <span className="text-[11px] text-gray-subtext">
                    {hashtags.length} hashtags · {content.length} chars
                  </span>
                </div>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={6}
                  className="w-full resize-none rounded-2xl bg-dark-bg/80 border border-dark-border px-4 py-3.5 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-primary-purple/60 transition-all font-sans leading-relaxed"
                  placeholder="Type your post…"
                />
              </div>

              {/* Time & Audience Settings */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext block mb-1.5">
                    Target Time of Day
                  </label>
                  <input
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="w-full bg-dark-bg/80 border border-dark-border rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-primary-purple font-mono"
                    style={{ colorScheme: 'dark' }}
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext block mb-1.5">
                    Audience size · {followers.toLocaleString()}
                  </label>
                  <input
                    type="range"
                    min={1000}
                    max={1000000}
                    step={1000}
                    value={followers}
                    onChange={(e) => setFollowers(Number(e.target.value))}
                    className="w-full accent-primary-purple mt-2"
                  />
                </div>
              </div>

              {/* Send to Composer Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => handleSendToComposer()}
                  className="w-full py-3.5 px-6 rounded-xl bg-primary-purple hover:bg-purple-600 text-white font-bold text-sm tracking-wide shadow-md transition-all flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-lg">forward_to_inbox</span>
                  Send to Composer
                </button>
              </div>
            </div>
          </div>

          {/* Real-time Reach Score Widget Display */}
          <div className="lg:col-span-5 space-y-6" data-testid="reach-score-widget">
            <div className="bg-dark-surface/90 backdrop-blur-xl border border-dark-border rounded-2xl p-6 shadow-elev-2 space-y-6">
              <div className="flex items-center justify-between border-b border-dark-border/60 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-primary-purple/15 border border-primary-purple/30 flex items-center justify-center text-primary-purple">
                    <span className="material-symbols-outlined text-lg">donut_large</span>
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white tracking-tight">
                      Predicted Reach Score
                    </h4>
                    <p className="text-[10px] text-gray-subtext">Calculated via ML neural engine</p>
                  </div>
                </div>

                {singleLoading && (
                  <span className="text-primary-purple text-xs font-semibold animate-pulse flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">sync</span>
                    Scoring...
                  </span>
                )}
              </div>

              {/* Score Circular Gauge & Digits */}
              <div className="text-center py-2">
                <div className="inline-flex items-center justify-center relative">
                  <div className="w-32 h-32 rounded-full border-4 border-white/5 border-t-primary-purple border-r-primary-teal flex flex-col items-center justify-center bg-dark-bg/60">
                    <span className="text-4xl font-extrabold text-white">
                      {singlePrediction ? Math.round(singlePrediction.reachScore) : '--'}
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-subtext">
                      out of 100
                    </span>
                  </div>
                </div>

                {singlePrediction && (
                  <p className="text-xs text-gray-subtext mt-3">
                    Confidence Level:{' '}
                    <strong className="text-primary-teal">
                      {Math.round(singlePrediction.confidence * 100)}%
                    </strong>
                  </p>
                )}
              </div>

              {/* Reach Ranges */}
              {singlePrediction && (
                <div className="p-4 bg-dark-bg/60 border border-dark-border/80 rounded-xl grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-[10px] text-gray-subtext uppercase font-semibold">Min</div>
                    <div className="text-xs font-bold text-white mt-0.5">
                      {(singlePrediction.estimatedReach.min / 1000).toFixed(1)}k
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-primary-purple uppercase font-semibold">
                      Expected
                    </div>
                    <div className="text-xs font-bold text-primary-purple mt-0.5">
                      {(singlePrediction.estimatedReach.expected / 1000).toFixed(1)}k
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-subtext uppercase font-semibold">Max</div>
                    <div className="text-xs font-bold text-white mt-0.5">
                      {(singlePrediction.estimatedReach.max / 1000).toFixed(1)}k
                    </div>
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {singlePrediction?.recommendations && singlePrediction.recommendations.length > 0 && (
                <div className="space-y-2 pt-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-gray-subtext">
                    Growth Recommendations
                  </div>
                  <div className="space-y-2">
                    {singlePrediction.recommendations.map((rec, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 bg-white/5 rounded-xl text-xs text-gray-300 flex items-start gap-2"
                      >
                        <span className="text-primary-purple font-bold">💡</span>
                        <span className="leading-relaxed">{rec}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mode 2: Side-by-Side Content Variant Comparison (Up to 3 variants) */}
      {activeTab === 'variants' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-base font-bold text-white tracking-tight">
                Side-by-Side Content Variant Matrix
              </h4>
              <p className="text-xs text-gray-subtext">
                Compare hook styles, tone, and platforms to pick the highest reach variant
              </p>
            </div>

            {variants.length < 3 && (
              <button
                type="button"
                onClick={handleAddVariant}
                className="px-3.5 py-2 rounded-xl bg-primary-purple/20 hover:bg-primary-purple text-primary-purple hover:text-white border border-primary-purple/40 text-xs font-bold transition-all flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-base">add</span>
                Add Variant ({variants.length}/3)
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
            {variants.map((variant, index) => {
              const isTop =
                variant.id === topVariantId && (variant.prediction?.reachScore ?? 0) > 0;
              const score = variant.prediction?.reachScore ?? 0;

              return (
                <div
                  key={variant.id}
                  className={`bg-dark-surface/90 backdrop-blur-xl border rounded-2xl p-5 shadow-elev-2 flex flex-col justify-between space-y-4 transition-all relative ${
                    isTop
                      ? 'border-primary-purple ring-1 ring-primary-purple shadow-glow-rose'
                      : 'border-dark-border'
                  }`}
                >
                  {/* Top Performer Badge */}
                  {isTop && (
                    <div className="absolute -top-3 right-4 px-3 py-0.5 rounded-full bg-primary-purple text-white text-[10px] font-extrabold uppercase tracking-wider shadow-md flex items-center gap-1">
                      <span>🏆</span> Top Performer
                    </div>
                  )}

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h5 className="text-xs font-bold text-white uppercase tracking-wider">
                        {variant.name}
                      </h5>
                      {variants.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveVariant(variant.id)}
                          className="text-gray-500 hover:text-rose-400 text-xs transition-colors"
                          title="Remove variant"
                        >
                          <span className="material-symbols-outlined text-sm">close</span>
                        </button>
                      )}
                    </div>

                    {/* Platform selector for variant */}
                    <div className="flex items-center gap-2">
                      <select
                        value={variant.platform}
                        onChange={(e) => {
                          const newPlatform = e.target.value as PredictorPlatform;
                          setVariants((prev) => {
                            const next = [...prev];
                            if (next[index])
                              next[index] = { ...next[index], platform: newPlatform };
                            return next;
                          });
                        }}
                        className="bg-dark-bg/80 border border-dark-border rounded-lg px-2.5 py-1 text-xs text-white capitalize font-semibold focus:outline-none"
                      >
                        {PLATFORMS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>

                      <select
                        value={variant.mediaType}
                        onChange={(e) => {
                          const newMedia = e.target.value as
                            | 'text'
                            | 'image'
                            | 'video'
                            | 'carousel';
                          setVariants((prev) => {
                            const next = [...prev];
                            if (next[index]) next[index] = { ...next[index], mediaType: newMedia };
                            return next;
                          });
                        }}
                        className="bg-dark-bg/80 border border-dark-border rounded-lg px-2.5 py-1 text-xs text-white capitalize font-semibold focus:outline-none"
                      >
                        <option value="text">Text Only</option>
                        <option value="image">Image</option>
                        <option value="video">Video</option>
                        <option value="carousel">Carousel</option>
                      </select>
                    </div>

                    {/* Text Area */}
                    <textarea
                      value={variant.content}
                      onChange={(e) => handleUpdateVariantContent(index, e.target.value)}
                      rows={5}
                      className="w-full bg-dark-bg/80 border border-dark-border rounded-xl p-3 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:border-primary-purple resize-none leading-relaxed"
                      placeholder="Variant draft copy..."
                    />

                    {/* Score Bar */}
                    <div className="p-3 bg-dark-bg/60 border border-dark-border/80 rounded-xl space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-subtext font-semibold">Projected Score</span>
                        <strong className="text-white text-base">
                          {score > 0 ? Math.round(score) : '--'}
                          <span className="text-[10px] text-gray-500 font-normal">/100</span>
                        </strong>
                      </div>
                      <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            isTop ? 'bg-primary-purple' : 'bg-primary-blue'
                          }`}
                          style={{ width: `${Math.min(100, score)}%` }}
                        />
                      </div>
                      {variant.prediction && (
                        <div className="flex justify-between text-[10px] text-gray-400 pt-0.5">
                          <span>
                            Est. Reach:{' '}
                            {(variant.prediction.estimatedReach.expected / 1000).toFixed(1)}k
                          </span>
                          <span>{Math.round(variant.prediction.confidence * 100)}% conf.</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Send this variant to Composer */}
                  <button
                    type="button"
                    onClick={() =>
                      handleSendToComposer(variant.content, variant.platform, variant.mediaType)
                    }
                    className="w-full py-2.5 px-4 rounded-xl bg-white/5 hover:bg-primary-purple text-white text-xs font-bold transition-all border border-white/10 flex items-center justify-center gap-1.5 mt-2"
                  >
                    <span className="material-symbols-outlined text-base">send</span>
                    Send to Composer
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default PredictorPage;
