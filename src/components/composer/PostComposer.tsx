import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Clock, FileText, Film, Send, Smile, UploadCloud, X as CloseIcon } from 'lucide-react';
import {
  useComposer,
  type ComposerDraft,
  type ComposerMediaItem,
  type ComposerMediaType,
} from '../../contexts/ComposerContext';
import type { PostAnalysisInput } from '../../types/predictive';

export type ComposerPlatformId = PostAnalysisInput['platform'];

export interface PlatformConfig {
  id: ComposerPlatformId;
  label: string;
  /** Character limit enforced for this platform's effective content. */
  limit: number;
  /** Media types this platform accepts as an attachment. */
  media: ComposerMediaType[];
  /** Whether multiple attachments (a carousel) are supported. */
  supportsMultiple: boolean;
}

export const COMPOSER_PLATFORMS: PlatformConfig[] = [
  { id: 'instagram', label: 'Instagram', limit: 2200, media: ['image', 'video', 'gif'], supportsMultiple: true },
  { id: 'tiktok', label: 'TikTok', limit: 2200, media: ['video'], supportsMultiple: false },
  { id: 'x', label: 'X', limit: 280, media: ['image', 'video', 'gif'], supportsMultiple: false },
  { id: 'linkedin', label: 'LinkedIn', limit: 3000, media: ['image', 'video', 'document'], supportsMultiple: true },
  { id: 'facebook', label: 'Facebook', limit: 63206, media: ['image', 'video', 'gif'], supportsMultiple: true },
  { id: 'youtube', label: 'YouTube', limit: 5000, media: ['video'], supportsMultiple: false },
];

export const PLATFORM_CONFIG: Record<ComposerPlatformId, PlatformConfig> = COMPOSER_PLATFORMS.reduce(
  (acc, platform) => {
    acc[platform.id] = platform;
    return acc;
  },
  {} as Record<ComposerPlatformId, PlatformConfig>
);

const EMOJI_OPTIONS = [
  '😀', '😂', '😍', '🔥', '🚀', '🎉', '👏', '💡',
  '✅', '📈', '🙌', '💬', '📸', '🎬', '✨', '❤️',
];

/** Effective content for a platform: its override if set, otherwise the shared content. */
export const effectiveContentFor = (draft: ComposerDraft, platformId: string): string => {
  const override = draft.platformOverrides[platformId];
  return override && override.trim().length > 0 ? override : draft.content;
};

const mediaTypeFromFile = (file: File): ComposerMediaType => {
  if (file.type === 'image/gif') return 'gif';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return 'document';
};

export interface ComposerValidationIssue {
  platformId: ComposerPlatformId | null;
  message: string;
}

export const validateComposerDraft = (draft: ComposerDraft): ComposerValidationIssue[] => {
  const issues: ComposerValidationIssue[] = [];

  if (draft.platforms.length === 0) {
    issues.push({ platformId: null, message: 'Select at least one platform.' });
  }

  draft.platforms.forEach((id) => {
    const config = PLATFORM_CONFIG[id as ComposerPlatformId];
    if (!config) return;
    const content = effectiveContentFor(draft, id).trim();

    if (content.length === 0) {
      issues.push({ platformId: config.id, message: `${config.label}: add some content before publishing.` });
    } else if (content.length > config.limit) {
      issues.push({
        platformId: config.id,
        message: `${config.label}: content is over the ${config.limit.toLocaleString()} character limit.`,
      });
    }

    const unsupported = draft.media.find((item) => !config.media.includes(item.type));
    if (unsupported) {
      issues.push({
        platformId: config.id,
        message: `${config.label} doesn't support ${unsupported.type} attachments.`,
      });
    }

    if (draft.media.length > 1 && !config.supportsMultiple) {
      issues.push({ platformId: config.id, message: `${config.label} only supports a single attachment.` });
    }
  });

  return issues;
};

/** Splits text into plain runs and highlighted hashtag/mention runs for inline highlighting. */
const renderHighlightedContent = (text: string): React.ReactNode[] => {
  const parts = text.split(/([#@][\p{L}0-9_]+)/gu);
  return parts.map((part, index) => {
    if (part.startsWith('#')) {
      return (
        <span key={index} className="text-primary-blue">
          {part}
        </span>
      );
    }
    if (part.startsWith('@')) {
      return (
        <span key={index} className="text-primary-teal">
          {part}
        </span>
      );
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
};

export interface PostComposerProps {
  /** Called after a successful "Schedule" submission, before the composer resets and closes. */
  onSchedule?: (draft: ComposerDraft, targetPostId: string | null) => void;
  /** Called after a successful "Publish now" submission, before the composer resets and closes. */
  onPublish?: (draft: ComposerDraft, targetPostId: string | null) => void;
}

export const PostComposer: React.FC<PostComposerProps> = ({ onSchedule, onPublish }) => {
  const {
    isOpen,
    mode,
    draft,
    targetPostId,
    updateDraft,
    closeComposer,
    saveDraft,
    discardAndClose,
    isCloseConfirmOpen,
    resolveCloseConfirm,
  } = useComposer();

  const [activePlatform, setActivePlatform] = useState<ComposerPlatformId | null>(
    (draft.platforms[0] as ComposerPlatformId) ?? null
  );
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('10:00');
  const [isDragActive, setIsDragActive] = useState(false);
  const [issues, setIssues] = useState<ComposerValidationIssue[]>([]);

  const dialogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keep the active preview/override tab in sync with the selected platforms.
  useEffect(() => {
    if (draft.platforms.length === 0) {
      setActivePlatform(null);
      return;
    }
    if (!activePlatform || !draft.platforms.includes(activePlatform)) {
      setActivePlatform(draft.platforms[0] as ComposerPlatformId);
    }
  }, [draft.platforms, activePlatform]);

  // Focus management + keyboard handling while the modal is open.
  useEffect(() => {
    if (!isOpen) return;

    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialog?.focus();

    const getFocusable = (): HTMLElement[] =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((el) => !el.hasAttribute('disabled'));

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeComposer();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        submit();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const activeConfig = activePlatform ? PLATFORM_CONFIG[activePlatform] : null;
  const activeContent = activePlatform ? effectiveContentFor(draft, activePlatform) : draft.content;
  const hasOverride = activePlatform ? Boolean(draft.platformOverrides[activePlatform]?.trim()) : false;

  const updateActiveContent = (value: string) => {
    if (!activePlatform || !hasOverride) {
      updateDraft({ content: value });
      return;
    }
    updateDraft({ platformOverrides: { ...draft.platformOverrides, [activePlatform]: value } });
  };

  const togglePlatform = (id: ComposerPlatformId) => {
    const isSelected = draft.platforms.includes(id);
    updateDraft({
      platforms: isSelected ? draft.platforms.filter((p) => p !== id) : [...draft.platforms, id],
    });
  };

  const toggleOverride = () => {
    if (!activePlatform) return;
    if (hasOverride) {
      const rest = { ...draft.platformOverrides };
      delete rest[activePlatform];
      updateDraft({ platformOverrides: rest });
    } else {
      updateDraft({ platformOverrides: { ...draft.platformOverrides, [activePlatform]: draft.content } });
    }
  };

  const insertEmoji = (emoji: string) => {
    const textarea = textareaRef.current;
    const current = activeContent;
    if (!textarea) {
      updateActiveContent(current + emoji);
      setIsEmojiPickerOpen(false);
      return;
    }
    const start = textarea.selectionStart ?? current.length;
    const end = textarea.selectionEnd ?? current.length;
    const next = current.slice(0, start) + emoji + current.slice(end);
    updateActiveContent(next);
    setIsEmojiPickerOpen(false);
    requestAnimationFrame(() => {
      textarea.focus();
      const caret = start + emoji.length;
      textarea.setSelectionRange(caret, caret);
    });
  };

  const addFiles = (files: FileList | File[]) => {
    const items: ComposerMediaItem[] = Array.from(files).map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      type: mediaTypeFromFile(file),
      url: URL.createObjectURL(file),
      name: file.name,
      file,
    }));
    updateDraft({ media: [...draft.media, ...items] });
  };

  const removeMedia = (id: string) => {
    updateDraft({ media: draft.media.filter((item) => item.id !== id) });
  };

  const resolvedScheduledAt = useMemo(() => {
    if (!scheduledDate) return null;
    return new Date(`${scheduledDate}T${scheduledTime || '00:00'}`).toISOString();
  }, [scheduledDate, scheduledTime]);

  const submit = () => {
    const validationIssues = validateComposerDraft(draft);
    setIssues(validationIssues);
    if (validationIssues.length > 0) return;

    if (isScheduling) {
      updateDraft({ scheduledAt: resolvedScheduledAt });
      onSchedule?.({ ...draft, scheduledAt: resolvedScheduledAt }, targetPostId);
    } else {
      onPublish?.(draft, targetPostId);
    }
    discardAndClose();
  };

  const handleSaveDraft = () => {
    saveDraft();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto p-0 md:p-8">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={closeComposer} aria-hidden />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'edit' ? 'Edit post' : 'Create new post'}
        tabIndex={-1}
        className="relative z-10 flex h-full w-full flex-col overflow-y-auto rounded-none border-dark-border bg-dark-elev md:my-4 md:h-auto md:max-h-[90vh] md:w-full md:max-w-4xl md:rounded-2xl md:border"
      >
        <div className="flex items-center justify-between border-b border-dark-border px-6 py-5 md:px-8 md:py-6">
          <h2 className="text-lg font-bold tracking-tight text-white">
            {mode === 'edit' ? 'Edit Post' : 'Create New Post'}
          </h2>
          <button
            onClick={closeComposer}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-400 transition-all hover:bg-white/10 hover:text-white"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-6 px-6 py-6 md:px-8">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">
              Platforms
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {COMPOSER_PLATFORMS.map((platform) => {
                const selected = draft.platforms.includes(platform.id);
                return (
                  <button
                    key={platform.id}
                    type="button"
                    onClick={() => togglePlatform(platform.id)}
                    aria-pressed={selected}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-all ${
                      selected
                        ? 'border-primary-blue/40 bg-primary-blue/20 text-primary-blue'
                        : 'border-dark-border text-gray-400 hover:border-white/20 hover:text-white'
                    }`}
                  >
                    {platform.label}
                  </button>
                );
              })}
            </div>
          </div>

          {draft.platforms.length > 1 && (
            <div className="flex flex-wrap gap-1 border-b border-dark-border pb-2">
              {draft.platforms.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActivePlatform(id as ComposerPlatformId)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                    activePlatform === id
                      ? 'bg-primary-blue/20 text-primary-blue'
                      : 'text-gray-subtext hover:text-white'
                  }`}
                >
                  {PLATFORM_CONFIG[id as ComposerPlatformId]?.label ?? id}
                </button>
              ))}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">
                Caption
              </label>
              <div className="flex items-center gap-3">
                {draft.platforms.length > 1 && activePlatform && (
                  <button
                    type="button"
                    onClick={toggleOverride}
                    className="text-[11px] font-semibold text-primary-teal hover:underline"
                  >
                    {hasOverride ? `Remove ${activeConfig?.label} override` : `Customize for ${activeConfig?.label}`}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsEmojiPickerOpen((prev) => !prev)}
                  aria-label="Insert emoji"
                  className="text-gray-subtext hover:text-white"
                >
                  <Smile size={16} />
                </button>
              </div>
            </div>

            {isEmojiPickerOpen && (
              <div
                role="listbox"
                aria-label="Emoji picker"
                className="mt-2 grid grid-cols-8 gap-1 rounded-xl border border-dark-border bg-dark-bg/80 p-2"
              >
                {EMOJI_OPTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => insertEmoji(emoji)}
                    className="rounded-lg p-1.5 text-lg hover:bg-white/10"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}

            <div className="relative mt-2">
              <div
                ref={highlightRef}
                aria-hidden
                className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm text-transparent"
              >
                {renderHighlightedContent(activeContent)}
              </div>
              <textarea
                ref={textareaRef}
                value={activeContent}
                onChange={(event) => updateActiveContent(event.target.value)}
                onScroll={(event) => {
                  if (highlightRef.current) highlightRef.current.scrollTop = event.currentTarget.scrollTop;
                }}
                placeholder="Write your caption… use #hashtags and @mentions"
                rows={6}
                className="relative w-full resize-none rounded-2xl border border-dark-border bg-dark-bg/60 px-4 py-3 text-sm text-white caret-white placeholder:text-gray-600 focus:border-primary-blue/50 focus:outline-none"
              />
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-gray-subtext">
              <span>{hasOverride ? `Custom copy for ${activeConfig?.label}` : 'Shared across all selected platforms'}</span>
              {activeConfig && (
                <span className={activeContent.length > activeConfig.limit ? 'font-semibold text-trend-down' : ''}>
                  {activeContent.length.toLocaleString()} / {activeConfig.limit.toLocaleString()}
                </span>
              )}
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">Media</label>
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragActive(true);
              }}
              onDragLeave={() => setIsDragActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragActive(false);
                if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
              }}
              className={`mt-2 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-all ${
                isDragActive ? 'border-primary-blue/60 bg-primary-blue/10' : 'border-dark-border'
              }`}
            >
              <UploadCloud size={20} className="text-gray-subtext" />
              <p className="text-xs text-gray-subtext">
                Drag and drop files here, or{' '}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="font-semibold text-primary-blue hover:underline"
                >
                  browse
                </button>
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/*"
                className="hidden"
                onChange={(event) => {
                  if (event.target.files?.length) addFiles(event.target.files);
                  event.target.value = '';
                }}
              />
            </div>

            {draft.media.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {draft.media.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-2 rounded-xl border border-dark-border bg-dark-bg/60 px-3 py-2 text-xs text-gray-300"
                  >
                    {item.type === 'video' ? <Film size={14} /> : <FileText size={14} />}
                    <span className="max-w-[10rem] truncate">{item.name}</span>
                    <button
                      type="button"
                      onClick={() => removeMedia(item.id)}
                      aria-label={`Remove ${item.name}`}
                      className="text-gray-500 hover:text-trend-down"
                    >
                      <CloseIcon size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {isScheduling && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">Date</label>
                <input
                  type="date"
                  value={scheduledDate}
                  onChange={(event) => setScheduledDate(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-dark-border bg-dark-bg/60 px-4 py-2.5 text-sm text-white [color-scheme:dark] focus:border-primary-blue/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">Time</label>
                <input
                  type="time"
                  value={scheduledTime}
                  onChange={(event) => setScheduledTime(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-dark-border bg-dark-bg/60 px-4 py-2.5 text-sm text-white [color-scheme:dark] focus:border-primary-blue/50 focus:outline-none"
                />
              </div>
            </div>
          )}

          {issues.length > 0 && (
            <div role="alert" className="space-y-1 rounded-xl border border-trend-down/30 bg-trend-down/10 px-4 py-3">
              {issues.map((issue, index) => (
                <p key={index} className="text-xs font-semibold text-trend-down">
                  {issue.message}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse items-stretch justify-end gap-3 border-t border-dark-border px-6 py-5 md:flex-row md:items-center md:px-8 md:py-6">
          <button
            type="button"
            onClick={handleSaveDraft}
            className="rounded-xl border border-dark-border px-5 py-2.5 text-sm font-bold text-gray-300 transition-all hover:border-white/20 hover:text-white"
          >
            Save Draft
          </button>
          <button
            type="button"
            onClick={() => setIsScheduling((prev) => !prev)}
            className={`flex items-center justify-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-bold transition-all ${
              isScheduling
                ? 'border-primary-teal/40 bg-primary-teal/15 text-primary-teal'
                : 'border-dark-border text-gray-300 hover:border-white/20 hover:text-white'
            }`}
          >
            <Clock size={16} />
            Schedule
          </button>
          <button
            type="button"
            onClick={submit}
            className="flex items-center justify-center gap-2 rounded-xl bg-primary-blue px-6 py-2.5 text-sm font-bold text-white transition-all hover:brightness-110"
          >
            <Send size={16} />
            {isScheduling ? 'Schedule Post' : 'Publish Now'}
          </button>
        </div>
      </div>

      {isCloseConfirmOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60" aria-hidden />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Discard unsaved changes?"
            className="relative z-10 w-full max-w-sm rounded-2xl border border-dark-border bg-dark-elev p-6"
          >
            <h3 className="text-base font-bold text-white">Discard unsaved changes?</h3>
            <p className="mt-1 text-sm text-gray-subtext">
              You have unsaved changes to this post. Choose what to do before closing.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => resolveCloseConfirm('save-draft')}
                className="rounded-xl bg-primary-blue px-4 py-2.5 text-sm font-bold text-white hover:brightness-110"
              >
                Save draft
              </button>
              <button
                type="button"
                onClick={() => resolveCloseConfirm('discard')}
                className="rounded-xl border border-dark-border px-4 py-2.5 text-sm font-bold text-gray-300 hover:border-trend-down/40 hover:text-trend-down"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={() => resolveCloseConfirm('keep-editing')}
                className="rounded-xl px-4 py-2.5 text-sm font-bold text-gray-subtext hover:text-white"
              >
                Keep editing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
