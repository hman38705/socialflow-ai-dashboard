import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ReachScoreWidget } from './ReachScoreWidget';
import { PostAnalysisInput, ReachPrediction } from '../types/predictive';
import { usePosts } from '../contexts/PostsContext';
import { useToast } from '../contexts/ToastContext';
import { parseHashtags } from '../lib/hashtags';

type ComposerPlatform = PostAnalysisInput['platform'];
type ComposerMedia = NonNullable<PostAnalysisInput['mediaType']>;

interface PostComposerProps {
  open: boolean;
  onClose: () => void;
}

const PLATFORMS: { id: ComposerPlatform; label: string; icon: string }[] = [
  { id: 'instagram', label: 'Instagram', icon: 'photo_camera' },
  { id: 'tiktok', label: 'TikTok', icon: 'music_note' },
  { id: 'x', label: 'X', icon: 'tag' },
  { id: 'linkedin', label: 'LinkedIn', icon: 'work' },
  { id: 'facebook', label: 'Facebook', icon: 'thumb_up' },
  { id: 'youtube', label: 'YouTube', icon: 'play_circle' },
];

const MEDIA_TYPES: { id: ComposerMedia; label: string; icon: string }[] = [
  { id: 'text', label: 'Text', icon: 'notes' },
  { id: 'image', label: 'Image', icon: 'image' },
  { id: 'video', label: 'Video', icon: 'movie' },
  { id: 'carousel', label: 'Carousel', icon: 'view_carousel' },
];

const MaterialIcon = ({ name, className }: { name: string; className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

export const PostComposer: React.FC<PostComposerProps> = ({ open, onClose }) => {
  const { addPost } = usePosts();
  const { toast } = useToast();

  const [platform, setPlatform] = useState<ComposerPlatform>('instagram');
  const [mediaType, setMediaType] = useState<ComposerMedia>('image');
  const [caption, setCaption] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('10:00');
  const [prediction, setPrediction] = useState<ReachPrediction | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus management + keyboard handling while the modal is open.
  useEffect(() => {
    if (!open) return;

    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Move initial focus into the dialog.
    dialog?.focus();

    const getFocusable = (): HTMLElement[] =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((el) => !el.hasAttribute('disabled'));

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // Trap Tab focus within the dialog.
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialog?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  const hashtags = useMemo(() => parseHashtags(caption), [caption]);

  const postData: PostAnalysisInput = useMemo(
    () => ({
      content: caption,
      platform,
      hashtags,
      mediaType,
      scheduledTime: date && time ? new Date(`${date}T${time}`) : new Date(Date.now() + 3600_000),
      followerCount: 120000,
    }),
    [caption, platform, hashtags, mediaType, date, time]
  );

  const reset = () => {
    setCaption('');
    setDate('');
    setTime('10:00');
    setPrediction(null);
  };

  const handleSchedule = (status: 'scheduled' | 'draft') => {
    if (caption.trim().length < 3) {
      toast('Add some caption content before scheduling.', 'error');
      return;
    }
    const scheduledAt =
      date && time ? new Date(`${date}T${time}`).getTime() : Date.now() + 3600_000;
    addPost({
      content: caption.trim(),
      platform,
      hashtags,
      mediaType,
      scheduledAt,
      reachScore: Math.round(prediction?.reachScore ?? 0),
      status,
    });
    toast(
      status === 'scheduled' ? 'Post scheduled successfully.' : 'Draft saved.',
      'success'
    );
    reset();
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto p-4 sm:p-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden
          />

          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Create new post"
            tabIndex={-1}
            initial={{ opacity: 0, y: 30, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="glass-card relative z-10 w-full max-w-4xl my-4 border-white/10"
          >
            <div className="flex items-center justify-between px-8 py-6 border-b border-dark-border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-blue/20 border border-primary-blue/30 flex items-center justify-center">
                  <MaterialIcon name="edit_note" className="text-primary-blue" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white tracking-tight">Create New Post</h2>
                  <p className="text-xs text-gray-subtext">AI reach analysis updates as you type.</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-white/10 text-gray-400 hover:text-white transition-all"
                aria-label="Close"
              >
                <MaterialIcon name="close" />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 p-8">
              {/* Composer */}
              <div className="lg:col-span-3 space-y-6">
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">Platform</label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {PLATFORMS.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setPlatform(p.id)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                          platform === p.id
                            ? 'bg-primary-blue/20 border-primary-blue/40 text-primary-blue'
                            : 'border-dark-border text-gray-400 hover:text-white hover:border-white/20'
                        }`}
                      >
                        <MaterialIcon name={p.icon} className="text-sm" />
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">Caption</label>
                  <textarea
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="Write your caption… use #hashtags to boost discovery 🚀"
                    rows={6}
                    className="mt-2 w-full resize-none rounded-2xl bg-dark-bg/60 border border-dark-border px-4 py-3 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-primary-blue/50 transition-all"
                  />
                  <div className="mt-1 flex items-center justify-between text-[11px] text-gray-subtext">
                    <span>{hashtags.length} hashtag{hashtags.length === 1 ? '' : 's'} detected</span>
                    <span>{caption.length} chars</span>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">Media type</label>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {MEDIA_TYPES.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setMediaType(m.id)}
                        className={`flex flex-col items-center gap-1 py-3 rounded-xl border text-[11px] font-semibold transition-all ${
                          mediaType === m.id
                            ? 'bg-primary-teal/15 border-primary-teal/40 text-primary-teal'
                            : 'border-dark-border text-gray-400 hover:text-white hover:border-white/20'
                        }`}
                      >
                        <MaterialIcon name={m.icon} />
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">Date</label>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="mt-2 w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary-blue/50 [color-scheme:dark]"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">Time</label>
                    <input
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      className="mt-2 w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary-blue/50 [color-scheme:dark]"
                    />
                  </div>
                </div>
              </div>

              {/* Live reach analysis */}
              <div className="lg:col-span-2">
                <ReachScoreWidget postData={postData} onUpdate={setPrediction} />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-8 py-6 border-t border-dark-border">
              <button
                onClick={() => handleSchedule('draft')}
                className="px-5 py-2.5 rounded-xl border border-dark-border text-sm font-bold text-gray-300 hover:text-white hover:border-white/20 transition-all"
              >
                Save Draft
              </button>
              <button
                onClick={() => handleSchedule('scheduled')}
                className="btn-primary px-6 py-2.5 text-sm"
              >
                <MaterialIcon name="send" className="text-sm" />
                Schedule Post
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
