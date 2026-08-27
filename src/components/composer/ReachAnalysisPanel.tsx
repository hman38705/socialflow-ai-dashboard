import React, { useState, useEffect, useMemo, useRef } from 'react';
import { PostAnalysisInput, ReachPrediction } from '../../types/predictive';
import { predictiveService } from '../../services/PredictiveService';

export interface ComposerDraft {
  content: string;
  platform: 'instagram' | 'tiktok' | 'facebook' | 'youtube' | 'linkedin' | 'x';
  mediaType?: 'text' | 'image' | 'video' | 'carousel';
  scheduledTime?: Date | null;
  hashtags?: string[];
  followerCount?: number;
  mediaUrl?: string;
}

export interface SuggestionItem {
  id: 'add_media' | 'shorten' | 'better_time' | 'add_hashtags';
  title: string;
  description: string;
  pointDelta: number;
  icon: string;
  apply: () => void;
}

export interface ReachAnalysisPanelProps {
  draft?: ComposerDraft;
  onUpdateDraft?: (updates: Partial<ComposerDraft>) => void;
  onPublish?: () => Promise<void> | void;
  isPublishing?: boolean;
  className?: string;
}

const DEFAULT_PLATFORMS: Array<ComposerDraft['platform']> = [
  'instagram',
  'tiktok',
  'x',
  'linkedin',
  'youtube',
  'facebook',
];

export const ReachAnalysisPanel: React.FC<ReachAnalysisPanelProps> = ({
  draft: externalDraft,
  onUpdateDraft: externalUpdateDraft,
  onPublish,
  isPublishing = false,
  className = '',
}) => {
  // Internal draft state when used standalone
  const [internalDraft, setInternalDraft] = useState<ComposerDraft>({
    content: 'Excited to announce our new product feature launch! 🚀 #product #update #growth',
    platform: 'instagram',
    mediaType: 'image',
    scheduledTime: null,
    hashtags: ['#product', '#update', '#growth'],
    followerCount: 25000,
  });

  const draft = externalDraft ?? internalDraft;
  const isStandalone = !externalDraft;

  const updateDraft = (updates: Partial<ComposerDraft>) => {
    if (externalUpdateDraft) {
      externalUpdateDraft(updates);
    } else {
      setInternalDraft((prev) => ({ ...prev, ...updates }));
    }
  };

  const [prediction, setPrediction] = useState<ReachPrediction | null>(null);
  const [scoringLoading, setScoringLoading] = useState(false);
  const [scoreHistory, setScoreHistory] = useState<{
    before: number;
    after: number;
    delta: number;
  } | null>(null);
  const [appliedSuggestionId, setAppliedSuggestionId] = useState<string | null>(null);
  const [publishSuccessMessage, setPublishSuccessMessage] = useState<string | null>(null);
  const [internalPublishing, setInternalPublishing] = useState(false);

  const prevScoreRef = useRef<number | null>(null);

  // Extract hashtags from content
  const contentHashtags = useMemo(() => {
    const matches = draft.content.match(/#[a-zA-Z0-9_]+/g);
    return matches || [];
  }, [draft.content]);

  // Synchronize post analysis input
  const postAnalysisInput: PostAnalysisInput = useMemo(
    () => ({
      content: draft.content,
      platform: draft.platform,
      mediaType: draft.mediaType || 'text',
      scheduledTime: draft.scheduledTime || undefined,
      hashtags: contentHashtags.length > 0 ? contentHashtags : draft.hashtags,
      followerCount: draft.followerCount ?? 25000,
    }),
    [
      draft.content,
      draft.platform,
      draft.mediaType,
      draft.scheduledTime,
      contentHashtags,
      draft.hashtags,
      draft.followerCount,
    ],
  );

  // Live scoring effect
  useEffect(() => {
    let active = true;

    if (!draft.content || draft.content.trim().length === 0) {
      setPrediction(null);
      setScoringLoading(false);
      return;
    }

    setScoringLoading(true);

    // Score calculation with fail-safe heuristic so publish is never blocked
    predictiveService
      .predictReach(postAnalysisInput)
      .then((result) => {
        if (!active) return;
        if (prevScoreRef.current !== null && prevScoreRef.current !== result.reachScore) {
          const delta = result.reachScore - prevScoreRef.current;
          setScoreHistory({
            before: prevScoreRef.current,
            after: result.reachScore,
            delta,
          });
        }
        prevScoreRef.current = result.reachScore;
        setPrediction(result);
      })
      .catch(() => {
        if (!active) return;
        // Invisible fallback heuristic
        const fallback = predictiveService.heuristicPrediction(postAnalysisInput);
        setPrediction(fallback);
      })
      .finally(() => {
        if (active) setScoringLoading(false);
      });

    return () => {
      active = false;
    };
  }, [postAnalysisInput, draft.content]);

  // Compute actionable suggestions with projected point deltas
  const suggestions = useMemo<SuggestionItem[]>(() => {
    const list: SuggestionItem[] = [];
    const currentScore = prediction?.reachScore ?? 65;

    // 1. Add Media
    if (!draft.mediaType || draft.mediaType === 'text') {
      list.push({
        id: 'add_media',
        title: 'Add visual media',
        description:
          'Posts with rich images or short videos generate significantly higher visibility.',
        pointDelta: 14,
        icon: 'image',
        apply: () => {
          setAppliedSuggestionId('add_media');
          prevScoreRef.current = currentScore;
          updateDraft({ mediaType: 'image' });
        },
      });
    }

    // 2. Shorten content if too long / verbose
    const wordCount = draft.content.trim().split(/\s+/).filter(Boolean).length;
    if (draft.content.length > 220 || wordCount > 35) {
      list.push({
        id: 'shorten',
        title: 'Shorten to peak engagement length',
        description: 'Hook your audience concisely with punchier copy (around 20–25 words).',
        pointDelta: 8,
        icon: 'content_cut',
        apply: () => {
          setAppliedSuggestionId('shorten');
          prevScoreRef.current = currentScore;
          const words = draft.content.trim().split(/\s+/).filter(Boolean);
          const shortened =
            words.slice(0, 22).join(' ') +
            (contentHashtags.length ? `\n\n${contentHashtags.join(' ')}` : '');
          updateDraft({ content: shortened });
        },
      });
    }

    // 3. Better Time
    const currentHour = draft.scheduledTime ? new Date(draft.scheduledTime).getHours() : -1;
    const isOptimalTime = currentHour === 10 || currentHour === 14 || currentHour === 18;
    if (!draft.scheduledTime || !isOptimalTime) {
      const optimal = prediction?.optimalPostTime || new Date(Date.now() + 86400000);
      list.push({
        id: 'better_time',
        title: 'Schedule at peak audience window',
        description: 'Publish during peak attention window (10:00 AM) for maximum early momentum.',
        pointDelta: 12,
        icon: 'schedule',
        apply: () => {
          setAppliedSuggestionId('better_time');
          prevScoreRef.current = currentScore;
          const target = new Date();
          target.setDate(target.getDate() + 1);
          target.setHours(10, 0, 0, 0);
          updateDraft({ scheduledTime: target });
        },
      });
    }

    // 4. Add Hashtags
    if (contentHashtags.length < 3) {
      list.push({
        id: 'add_hashtags',
        title: 'Add 3+ strategic hashtags',
        description: 'Include targeted hashtags to enhance topic categorization and explore reach.',
        pointDelta: 10,
        icon: 'tag',
        apply: () => {
          setAppliedSuggestionId('add_hashtags');
          prevScoreRef.current = currentScore;
          const recommendedTags = ['#SocialFlow', '#Growth', '#Trending'];
          const existingTags = new Set(contentHashtags);
          const newTags = recommendedTags.filter((t) => !existingTags.has(t));
          const updatedContent = `${draft.content.trim()} ${newTags.join(' ')}`.trim();
          updateDraft({
            content: updatedContent,
            hashtags: [...contentHashtags, ...newTags],
          });
        },
      });
    }

    return list;
  }, [
    draft.mediaType,
    draft.content,
    draft.scheduledTime,
    contentHashtags,
    prediction,
    updateDraft,
  ]);

  // Non-blocking publish handler
  const handlePublish = async () => {
    try {
      setInternalPublishing(true);
      setPublishSuccessMessage(null);
      if (onPublish) {
        await onPublish();
      } else {
        // Simulated publish success
        await new Promise((res) => setTimeout(res, 600));
        setPublishSuccessMessage('Post scheduled and published successfully!');
      }
    } catch {
      // Handled gracefully
    } finally {
      setInternalPublishing(false);
    }
  };

  const currentScore = prediction?.reachScore ?? 0;
  const scoreBadgeColor =
    currentScore >= 75
      ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
      : currentScore >= 50
        ? 'text-primary-blue bg-primary-blue/10 border-primary-blue/30'
        : 'text-amber-400 bg-amber-500/10 border-amber-500/30';

  const publishingState = isPublishing || internalPublishing;

  return (
    <div className={`w-full ${className}`}>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Main Composer Area (rendered if standalone) */}
        {isStandalone && (
          <div className="lg:col-span-7 space-y-6">
            <div className="bg-dark-surface/80 backdrop-blur-xl border border-dark-border rounded-2xl p-6 shadow-elev-2 space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary-blue text-xl">
                    edit_note
                  </span>
                  Post Composer
                </h3>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-subtext uppercase tracking-wider font-semibold">
                    Target Platform:
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-primary-blue/10 border border-primary-blue/30 text-primary-blue text-xs font-bold uppercase">
                    {draft.platform}
                  </span>
                </div>
              </div>

              {/* Platform Selector */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-subtext mb-2">
                  Platform
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {DEFAULT_PLATFORMS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => updateDraft({ platform: p })}
                      className={`px-3 py-2 rounded-xl text-xs font-bold capitalize transition-all border ${
                        draft.platform === p
                          ? 'bg-primary-blue text-white border-primary-blue shadow-glow-blue'
                          : 'bg-dark-bg/60 border-dark-border text-gray-subtext hover:text-white hover:border-white/20'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Media Type Selection */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-subtext mb-2">
                  Media Attachment
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(['text', 'image', 'video', 'carousel'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => updateDraft({ mediaType: type })}
                      className={`px-3 py-2.5 rounded-xl text-xs font-semibold capitalize flex items-center justify-center gap-2 transition-all border ${
                        draft.mediaType === type
                          ? 'bg-primary-purple/20 text-primary-purple border-primary-purple/40 shadow-sm'
                          : 'bg-dark-bg/60 border-dark-border text-gray-subtext hover:text-white hover:border-white/20'
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

              {/* Post Content Input */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-gray-subtext">
                    Post Draft
                  </label>
                  <span className="text-xs text-gray-subtext">
                    {draft.content.length} chars · {contentHashtags.length} hashtags
                  </span>
                </div>
                <textarea
                  value={draft.content}
                  onChange={(e) => updateDraft({ content: e.target.value })}
                  rows={6}
                  placeholder="Draft your post content here... Add #hashtags to expand reach."
                  className="w-full bg-dark-bg/80 border border-dark-border rounded-xl p-4 text-white text-sm focus:outline-none focus:border-primary-blue focus:ring-1 focus:ring-primary-blue resize-none transition-all placeholder:text-gray-600"
                />
              </div>

              {/* Schedule Picker */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-subtext mb-1.5">
                    Schedule Date
                  </label>
                  <input
                    type="date"
                    value={
                      draft.scheduledTime
                        ? new Date(draft.scheduledTime).toISOString().split('T')[0]
                        : ''
                    }
                    onChange={(e) => {
                      if (!e.target.value) {
                        updateDraft({ scheduledTime: null });
                      } else {
                        const d = new Date(e.target.value);
                        d.setHours(10, 0, 0, 0);
                        updateDraft({ scheduledTime: d });
                      }
                    }}
                    className="w-full bg-dark-bg/80 border border-dark-border rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-primary-blue"
                    style={{ colorScheme: 'dark' }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-subtext mb-1.5">
                    Schedule Time
                  </label>
                  <input
                    type="time"
                    value={
                      draft.scheduledTime
                        ? new Date(draft.scheduledTime).toTimeString().slice(0, 5)
                        : ''
                    }
                    onChange={(e) => {
                      if (e.target.value) {
                        const [hours, minutes] = e.target.value.split(':');
                        const d = draft.scheduledTime ? new Date(draft.scheduledTime) : new Date();
                        d.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
                        updateDraft({ scheduledTime: d });
                      }
                    }}
                    className="w-full bg-dark-bg/80 border border-dark-border rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-primary-blue"
                    style={{ colorScheme: 'dark' }}
                  />
                </div>
              </div>

              {/* Success Notification */}
              {publishSuccessMessage && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs font-medium flex items-center gap-2">
                  <span className="material-symbols-outlined text-base">check_circle</span>
                  {publishSuccessMessage}
                </div>
              )}

              {/* Publish / Schedule Button - Never blocked by scoring */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handlePublish}
                  disabled={publishingState || !draft.content.trim()}
                  className="w-full py-3.5 px-6 rounded-xl bg-primary-blue hover:bg-blue-600 text-white font-bold text-sm tracking-wide shadow-glow-blue transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {publishingState ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Publishing Post...
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-lg">send</span>
                      {draft.scheduledTime ? 'Schedule Post for Peak Reach' : 'Publish Post Now'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Reach Analysis Panel (Side Widget) */}
        <div className={isStandalone ? 'lg:col-span-5 space-y-6' : 'w-full space-y-6'}>
          <div className="bg-dark-surface/90 backdrop-blur-xl border border-dark-border rounded-2xl p-6 shadow-elev-2 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-dark-border/60 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-primary-rose/10 border border-primary-rose/30 flex items-center justify-center text-primary-rose">
                  <span className="material-symbols-outlined text-xl">insights</span>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white tracking-tight">
                    Live Reach Analysis
                  </h4>
                  <p className="text-[11px] text-gray-subtext">
                    Real-time predictive score & suggestions
                  </p>
                </div>
              </div>

              {scoringLoading && (
                <div className="flex items-center gap-1.5 text-primary-teal text-xs font-semibold animate-pulse">
                  <span className="material-symbols-outlined text-sm">analytics</span>
                  Scoring...
                </div>
              )}
            </div>

            {/* Live Score Display */}
            <div className="bg-dark-bg/60 border border-dark-border/80 rounded-2xl p-5 text-center relative overflow-hidden">
              <div className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext mb-2">
                Projected Reach Score
              </div>

              <div className="flex items-center justify-center gap-2 my-1">
                <span className="text-5xl font-extrabold text-white tracking-tight">
                  {prediction ? Math.round(prediction.reachScore) : '--'}
                </span>
                <span className="text-sm font-bold text-gray-subtext self-end mb-2">/ 100</span>
              </div>

              {/* Before -> After Delta Indicator */}
              {scoreHistory && (
                <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-semibold animate-fade-in">
                  <span className="text-gray-400">{scoreHistory.before}</span>
                  <span className="text-gray-500">→</span>
                  <span className="text-emerald-400 font-bold">{scoreHistory.after}</span>
                  <span
                    className={`ml-1 font-bold ${
                      scoreHistory.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    ({scoreHistory.delta >= 0 ? `+${scoreHistory.delta}` : scoreHistory.delta} pts)
                  </span>
                </div>
              )}

              {/* Reach Range Breakdown */}
              {prediction && (
                <div className="mt-4 pt-4 border-t border-dark-border/40 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-[10px] text-gray-subtext font-semibold uppercase">
                      Min Reach
                    </div>
                    <div className="text-xs font-bold text-white mt-0.5">
                      {(prediction.estimatedReach.min / 1000).toFixed(1)}k
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-primary-blue font-semibold uppercase">
                      Expected
                    </div>
                    <div className="text-xs font-bold text-primary-blue mt-0.5">
                      {(prediction.estimatedReach.expected / 1000).toFixed(1)}k
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-subtext font-semibold uppercase">
                      Max Reach
                    </div>
                    <div className="text-xs font-bold text-white mt-0.5">
                      {(prediction.estimatedReach.max / 1000).toFixed(1)}k
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Actionable Improvement Suggestions */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h5 className="text-xs font-bold uppercase tracking-wider text-gray-subtext">
                  Actionable Suggestions
                </h5>
                <span className="text-[10px] text-gray-500 font-semibold">
                  {suggestions.length} available
                </span>
              </div>

              {suggestions.length === 0 ? (
                <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl text-center">
                  <span className="material-symbols-outlined text-emerald-400 text-2xl mb-1">
                    verified
                  </span>
                  <p className="text-xs font-bold text-emerald-300">Fully Optimized Post</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    Your draft satisfies all high-reach factors for {draft.platform}!
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {suggestions.map((suggestion) => {
                    const isApplied = appliedSuggestionId === suggestion.id;
                    return (
                      <div
                        key={suggestion.id}
                        className="p-3.5 bg-dark-bg/60 hover:bg-dark-bg border border-dark-border/80 hover:border-primary-blue/40 rounded-xl transition-all flex items-start gap-3 group"
                      >
                        <div className="w-8 h-8 rounded-lg bg-primary-blue/10 border border-primary-blue/20 flex items-center justify-center text-primary-blue shrink-0 mt-0.5">
                          <span className="material-symbols-outlined text-base">
                            {suggestion.icon}
                          </span>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <h6 className="text-xs font-bold text-white truncate">
                              {suggestion.title}
                            </h6>
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-extrabold tracking-wide shrink-0">
                              +{suggestion.pointDelta} pts
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
                            {suggestion.description}
                          </p>

                          <div className="mt-2.5">
                            <button
                              type="button"
                              onClick={suggestion.apply}
                              className="px-3 py-1.5 rounded-lg bg-primary-blue/15 hover:bg-primary-blue text-primary-blue hover:text-white border border-primary-blue/30 text-xs font-bold transition-all flex items-center gap-1.5"
                            >
                              <span className="material-symbols-outlined text-sm">
                                auto_fix_high
                              </span>
                              Apply Suggestion
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Optimal Window Card */}
            {prediction?.optimalPostTime && (
              <div className="p-3.5 bg-primary-teal/5 border border-primary-teal/20 rounded-xl flex items-center gap-3">
                <span className="material-symbols-outlined text-primary-teal text-xl shrink-0">
                  alarm_on
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-bold text-primary-teal uppercase tracking-wide">
                    Optimal Window
                  </div>
                  <div className="text-xs font-semibold text-white truncate mt-0.5">
                    {new Date(prediction.optimalPostTime).toLocaleString([], {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReachAnalysisPanel;
