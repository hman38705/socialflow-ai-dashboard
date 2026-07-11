import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GlassCard } from '../components/ui/GlassCard';
import { usePosts, ScheduledPost, PostStatus } from '../contexts/PostsContext';
import { useComposer } from '../contexts/ComposerContext';
import { useToast } from '../contexts/ToastContext';

const MaterialIcon = ({ name, className }: { name: string; className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

const PLATFORM_ICON: Record<string, string> = {
  instagram: 'photo_camera',
  tiktok: 'music_note',
  x: 'tag',
  linkedin: 'work',
  facebook: 'thumb_up',
  youtube: 'play_circle',
};

const STATUS_STYLE: Record<PostStatus, string> = {
  scheduled: 'bg-primary-blue/15 text-primary-blue border-primary-blue/30',
  published: 'bg-green-500/15 text-green-400 border-green-500/30',
  draft: 'bg-white/5 text-gray-subtext border-white/10',
};

const formatWhen = (ms: number): string => {
  const d = new Date(ms);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const day = isToday
    ? 'Today'
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${day} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

const scoreColor = (s: number): string => {
  if (s >= 80) return 'text-green-400';
  if (s >= 60) return 'text-primary-blue';
  if (s >= 40) return 'text-yellow-400';
  return 'text-red-400';
};

export const SchedulerPage: React.FC = () => {
  const { posts, removePost, updateStatus } = usePosts();
  const { openComposer } = useComposer();
  const { toast } = useToast();

  const sorted = useMemo(
    () => [...posts].sort((a, b) => a.scheduledAt - b.scheduledAt),
    [posts]
  );

  return (
    <div className="space-y-8 pb-20">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-white tracking-tight">Content Calendar</h3>
          <p className="text-sm text-gray-subtext">{sorted.length} posts in your queue</p>
        </div>
        <button
          onClick={openComposer}
          className="btn-primary px-5 py-2.5 text-sm"
        >
          <MaterialIcon name="add" className="text-sm" />
          New Post
        </button>
      </div>

      {sorted.length === 0 ? (
        <GlassCard className="!p-16 text-center border-dashed">
          <MaterialIcon name="event_upcoming" className="text-5xl text-gray-600 mb-4" />
          <p className="text-lg font-bold text-white mb-1">Your queue is empty</p>
          <p className="text-sm text-gray-subtext mb-6">Schedule your first post to see it here.</p>
          <button
            onClick={openComposer}
            className="px-6 py-2.5 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-sm font-bold transition-all"
          >
            Create a Post
          </button>
        </GlassCard>
      ) : (
        <div className="space-y-4">
          <AnimatePresence mode="popLayout">
            {sorted.map((post: ScheduledPost, index) => (
              <motion.div
                key={post.id}
                layout
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ delay: index * 0.04 }}
              >
                <GlassCard className="!p-0 group">
                  <div className="flex items-stretch gap-5 p-5">
                    <div className="flex flex-col items-center justify-center min-w-[60px]">
                      <div className={`tnum text-2xl font-bold glow-text ${scoreColor(post.reachScore)}`}>
                        {post.reachScore || '—'}
                      </div>
                      <div className="text-[9px] font-bold uppercase tracking-widest opacity-40">Reach</div>
                    </div>

                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-wider text-primary-blue">
                          <MaterialIcon name={PLATFORM_ICON[post.platform] ?? 'public'} className="text-xs" />
                          {post.platform}
                        </span>
                        <span className={`px-2.5 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider ${STATUS_STYLE[post.status]}`}>
                          {post.status}
                        </span>
                        <span className="text-[11px] text-gray-subtext font-medium flex items-center gap-1">
                          <MaterialIcon name="schedule" className="text-xs" />
                          {formatWhen(post.scheduledAt)}
                        </span>
                      </div>
                      <p className="text-sm text-white/90 leading-relaxed line-clamp-2">{post.content}</p>
                    </div>

                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      {post.status !== 'published' && (
                        <button
                          onClick={() => {
                            updateStatus(post.id, 'published');
                            toast('Post published.', 'success');
                          }}
                          className="w-9 h-9 flex items-center justify-center bg-white/5 rounded-xl hover:bg-green-500/20 text-gray-400 hover:text-green-400 transition-all"
                          title="Publish now"
                        >
                          <MaterialIcon name="send" className="text-lg" />
                        </button>
                      )}
                      <button
                        onClick={() => {
                          removePost(post.id);
                          toast('Post removed from queue.', 'info');
                        }}
                        className="w-9 h-9 flex items-center justify-center bg-white/5 rounded-xl hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-all"
                        title="Delete"
                      >
                        <MaterialIcon name="delete" className="text-lg" />
                      </button>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};
