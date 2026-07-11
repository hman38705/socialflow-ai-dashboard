import React, { useMemo, useState } from 'react';
import { GlassCard } from '../components/ui/GlassCard';
import { ReachScoreWidget } from '../components/ReachScoreWidget';
import { PostAnalysisInput } from '../types/predictive';
import { parseHashtags } from '../lib/hashtags';

type PredictorPlatform = PostAnalysisInput['platform'];

const MaterialIcon = ({ name, className }: { name: string; className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

const PLATFORMS: { id: PredictorPlatform; label: string }[] = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'x', label: 'X' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'facebook', label: 'Facebook' },
];

const SAMPLE =
  'Excited to announce our new product launch! 🚀 Check it out — link in bio #innovation #tech #startup';

export const PredictorPage: React.FC = () => {
  const [platform, setPlatform] = useState<PredictorPlatform>('instagram');
  const [content, setContent] = useState(SAMPLE);
  const [followers, setFollowers] = useState(120000);

  const hashtags = useMemo(() => parseHashtags(content), [content]);

  const postData: PostAnalysisInput = useMemo(
    () => ({
      content,
      platform,
      hashtags,
      mediaType: 'image',
      followerCount: followers,
      scheduledTime: new Date(Date.now() + 3600_000),
    }),
    [content, platform, hashtags, followers]
  );

  return (
    <div className="space-y-8 pb-20">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-primary-purple/20 border border-primary-purple/30 flex items-center justify-center">
          <MaterialIcon name="psychology" className="text-primary-purple text-2xl" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-white tracking-tight">AI Reach Predictor</h3>
          <p className="text-sm text-gray-subtext">Draft a post and see its projected reach in real time.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <GlassCard className="space-y-6">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">Platform</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPlatform(p.id)}
                  className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                    platform === p.id
                      ? 'bg-primary-purple/20 border-primary-purple/40 text-primary-purple'
                      : 'border-dark-border text-gray-400 hover:text-white hover:border-white/20'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">Post content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={7}
              className="mt-2 w-full resize-none rounded-2xl bg-dark-bg/60 border border-dark-border px-4 py-3 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-primary-purple/50 transition-all"
              placeholder="Type your post…"
            />
            <p className="mt-1 text-[11px] text-gray-subtext">{hashtags.length} hashtags · {content.length} chars</p>
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">
              Audience size · {followers.toLocaleString()}
            </label>
            <input
              type="range"
              min={1000}
              max={1000000}
              step={1000}
              value={followers}
              onChange={(e) => setFollowers(Number(e.target.value))}
              className="mt-3 w-full accent-primary-purple"
            />
          </div>
        </GlassCard>

        <div>
          <ReachScoreWidget postData={postData} />
        </div>
      </div>
    </div>
  );
};
