import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from '../../types';

export type MediaKind = 'image' | 'video';
export type MediaAttachmentStatus = 'validating' | 'uploading' | 'done' | 'error' | 'cancelled';

export interface MediaAttachment {
  id: string;
  file: File;
  kind: MediaKind;
  previewUrl: string;
  altText: string;
  status: MediaAttachmentStatus;
  progress: number;
  error?: string;
  uploadedUrl?: string;
}

export interface PlatformMediaConstraints {
  platform: Platform;
  maxFiles: number;
  maxImageSizeMB: number;
  maxVideoSizeMB: number;
  maxVideoDurationSec: number;
  allowedImageTypes: string[];
  allowedVideoTypes: string[];
}

/** Media constraints per platform, kept in one place so validation copy always matches reality. */
export const PLATFORM_MEDIA_CONSTRAINTS: Record<Platform, PlatformMediaConstraints> = {
  [Platform.TWITTER]: {
    platform: Platform.TWITTER,
    maxFiles: 4,
    maxImageSizeMB: 5,
    maxVideoSizeMB: 512,
    maxVideoDurationSec: 140, // 2:20
    allowedImageTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    allowedVideoTypes: ['video/mp4', 'video/quicktime'],
  },
  [Platform.INSTAGRAM]: {
    platform: Platform.INSTAGRAM,
    maxFiles: 10,
    maxImageSizeMB: 8,
    maxVideoSizeMB: 100,
    maxVideoDurationSec: 90,
    allowedImageTypes: ['image/jpeg', 'image/png'],
    allowedVideoTypes: ['video/mp4', 'video/quicktime'],
  },
  [Platform.LINKEDIN]: {
    platform: Platform.LINKEDIN,
    maxFiles: 9,
    maxImageSizeMB: 5,
    maxVideoSizeMB: 200,
    maxVideoDurationSec: 600, // 10:00
    allowedImageTypes: ['image/jpeg', 'image/png', 'image/gif'],
    allowedVideoTypes: ['video/mp4'],
  },
  [Platform.FACEBOOK]: {
    platform: Platform.FACEBOOK,
    maxFiles: 10,
    maxImageSizeMB: 4,
    maxVideoSizeMB: 1024,
    maxVideoDurationSec: 14400, // 240:00
    allowedImageTypes: ['image/jpeg', 'image/png', 'image/gif'],
    allowedVideoTypes: ['video/mp4', 'video/quicktime'],
  },
};

export type UploadFn = (
  file: File,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
) => Promise<{ url: string }>;

export interface MediaUploaderProps {
  platform: Platform;
  value: MediaAttachment[];
  onChange: (next: MediaAttachment[]) => void;
  /** Injectable uploader, defaults to a simulated in-browser upload. */
  uploadFn?: UploadFn;
  className?: string;
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.round(totalSeconds);
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}:${remaining.toString().padStart(2, '0')}`;
}

function createId(): string {
  return `media-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function kindOf(file: File): MediaKind | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return null;
}

function readVideoDuration(file: File, objectUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => resolve(video.duration);
    video.onerror = () => reject(new Error('Could not read video metadata'));
    video.src = objectUrl;
  });
}

const defaultUploadFn: UploadFn = (_file, onProgress, signal) =>
  new Promise((resolve, reject) => {
    let percent = 0;
    const interval = window.setInterval(() => {
      percent = Math.min(percent + 10, 100);
      onProgress(percent);
      if (percent >= 100) {
        window.clearInterval(interval);
        resolve({ url: `blob:simulated-upload/${createId()}` });
      }
    }, 120);

    signal.addEventListener('abort', () => {
      window.clearInterval(interval);
      reject(new DOMException('Upload cancelled', 'AbortError'));
    });
  });

/**
 * Drag-and-drop media uploader: validates files against per-platform
 * constraints before upload, tracks per-file progress with cancel, and
 * supports reordering via drag or keyboard plus per-image alt text.
 */
export function MediaUploader({ platform, value, onChange, uploadFn = defaultUploadFn, className }: MediaUploaderProps) {
  const constraints = PLATFORM_MEDIA_CONSTRAINTS[platform];
  const inputRef = useRef<HTMLInputElement>(null);
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    return () => {
      controllersRef.current.forEach((controller) => controller.abort());
    };
  }, []);

  const updateAttachment = useCallback(
    (id: string, patch: Partial<MediaAttachment>) => {
      onChange(value.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    },
    [onChange, value],
  );

  const startUpload = useCallback(
    (attachment: MediaAttachment) => {
      const controller = new AbortController();
      controllersRef.current.set(attachment.id, controller);
      updateAttachment(attachment.id, { status: 'uploading', progress: 0 });

      uploadFn(
        attachment.file,
        (percent) => updateAttachment(attachment.id, { progress: percent }),
        controller.signal,
      )
        .then((result) => {
          controllersRef.current.delete(attachment.id);
          updateAttachment(attachment.id, { status: 'done', progress: 100, uploadedUrl: result.url });
        })
        .catch(() => {
          controllersRef.current.delete(attachment.id);
          updateAttachment(attachment.id, { status: 'cancelled' });
        });
    },
    [uploadFn, updateAttachment],
  );

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const incoming = Array.from(files);
      const remainingSlots = Math.max(constraints.maxFiles - value.length, 0);
      const accepted = incoming.slice(0, remainingSlots);

      const newAttachments: MediaAttachment[] = accepted.map((file) => {
        const kind = kindOf(file);
        const previewUrl = URL.createObjectURL(file);
        const base: MediaAttachment = {
          id: createId(),
          file,
          kind: kind ?? 'image',
          previewUrl,
          altText: '',
          status: 'validating',
          progress: 0,
        };

        if (!kind) {
          return { ...base, status: 'error', error: `Unsupported file type "${file.type || 'unknown'}".` };
        }

        const allowedTypes = kind === 'image' ? constraints.allowedImageTypes : constraints.allowedVideoTypes;
        if (!allowedTypes.includes(file.type)) {
          return { ...base, status: 'error', error: `${file.type} isn't supported on ${platform}.` };
        }

        const maxSizeMB = kind === 'image' ? constraints.maxImageSizeMB : constraints.maxVideoSizeMB;
        const maxSizeBytes = maxSizeMB * 1024 * 1024;
        if (file.size > maxSizeBytes) {
          const actualMB = (file.size / (1024 * 1024)).toFixed(1);
          return {
            ...base,
            status: 'error',
            error: `File is ${actualMB}MB; ${platform} allows up to ${maxSizeMB}MB.`,
          };
        }

        return base;
      });

      onChange([...value, ...newAttachments]);

      // Async validation (video duration) + kick off upload for anything that passed sync checks.
      for (const attachment of newAttachments) {
        if (attachment.status === 'error') {
          continue;
        }

        if (attachment.kind === 'video') {
          try {
            const durationSec = await readVideoDuration(attachment.file, attachment.previewUrl);
            if (durationSec > constraints.maxVideoDurationSec) {
              updateAttachment(attachment.id, {
                status: 'error',
                error: `Video is ${formatDuration(durationSec)}; ${platform} allows ${formatDuration(
                  constraints.maxVideoDurationSec,
                )}.`,
              });
              continue;
            }
          } catch {
            updateAttachment(attachment.id, { status: 'error', error: 'Could not read video metadata.' });
            continue;
          }
        }

        startUpload(attachment);
      }
    },
    [constraints, onChange, platform, startUpload, updateAttachment, value],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragOver(false);
      if (event.dataTransfer.files.length) {
        void addFiles(event.dataTransfer.files);
      }
    },
    [addFiles],
  );

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (event.target.files?.length) {
        void addFiles(event.target.files);
      }
      event.target.value = '';
    },
    [addFiles],
  );

  const handleCancel = useCallback((id: string) => {
    controllersRef.current.get(id)?.abort();
  }, []);

  const handleRemove = useCallback(
    (id: string) => {
      const target = value.find((item) => item.id === id);
      if (target) {
        controllersRef.current.get(id)?.abort();
        controllersRef.current.delete(id);
        URL.revokeObjectURL(target.previewUrl);
      }
      onChange(value.filter((item) => item.id !== id));
    },
    [onChange, value],
  );

  const moveAttachment = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (toIndex < 0 || toIndex >= value.length) return;
      const next = value.slice();
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      onChange(next);
    },
    [onChange, value],
  );

  const handleAltTextChange = useCallback(
    (id: string, altText: string) => {
      updateAttachment(id, { altText });
    },
    [updateAttachment],
  );

  const dragIndexRef = useRef<number | null>(null);

  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={0}
        aria-label="Add photos or videos"
        data-drag-over={isDragOver}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm transition-colors ${
          isDragOver ? 'border-primary-blue bg-primary-blue/10' : 'border-dark-border bg-dark-surface'
        }`}
      >
        <span className="text-gray-subtext">Drag and drop photos or videos, or click to browse</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,video/*"
          onChange={handleInputChange}
          className="sr-only"
          aria-hidden="true"
        />
      </div>

      {value.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {value.map((attachment, index) => (
            <li
              key={attachment.id}
              draggable
              onDragStart={() => {
                dragIndexRef.current = index;
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragIndexRef.current !== null) {
                  moveAttachment(dragIndexRef.current, index);
                  dragIndexRef.current = null;
                }
              }}
              className="relative flex flex-col gap-1 rounded-lg border border-dark-border bg-dark-surface p-2"
              data-status={attachment.status}
            >
              <div className="relative overflow-hidden rounded">
                {attachment.kind === 'image' ? (
                  <img src={attachment.previewUrl} alt="" className="h-24 w-full object-cover" />
                ) : (
                  <video src={attachment.previewUrl} className="h-24 w-full object-cover" muted />
                )}

                {(attachment.status === 'uploading' || attachment.status === 'validating') && (
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
                    <div
                      className="h-full bg-primary-blue transition-all"
                      style={{ width: `${attachment.progress}%` }}
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-1">
                <button
                  type="button"
                  aria-label={`Move ${attachment.file.name} left`}
                  disabled={index === 0}
                  onClick={() => moveAttachment(index, index - 1)}
                  className="rounded px-1 text-xs text-gray-subtext disabled:opacity-30"
                >
                  ←
                </button>
                {attachment.status === 'uploading' && (
                  <button
                    type="button"
                    onClick={() => handleCancel(attachment.id)}
                    className="text-xs text-gray-subtext underline"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleRemove(attachment.id)}
                  aria-label={`Remove ${attachment.file.name}`}
                  className="text-xs text-trend-down"
                >
                  Remove
                </button>
                <button
                  type="button"
                  aria-label={`Move ${attachment.file.name} right`}
                  disabled={index === value.length - 1}
                  onClick={() => moveAttachment(index, index + 1)}
                  className="rounded px-1 text-xs text-gray-subtext disabled:opacity-30"
                >
                  →
                </button>
              </div>

              {attachment.status === 'error' && (
                <p role="alert" className="text-xs text-trend-down">
                  {attachment.error}
                </p>
              )}

              {attachment.kind === 'image' && attachment.status !== 'error' && (
                <div className="flex flex-col gap-0.5">
                  <label htmlFor={`alt-text-${attachment.id}`} className="text-[11px] text-gray-subtext">
                    Alt text
                  </label>
                  <input
                    id={`alt-text-${attachment.id}`}
                    type="text"
                    value={attachment.altText}
                    onChange={(event) => handleAltTextChange(attachment.id, event.target.value)}
                    placeholder="Describe this image"
                    className="rounded border border-dark-border bg-dark-bg px-1 py-0.5 text-xs text-white"
                  />
                  {!attachment.altText && (
                    <span className="text-[11px] text-amber-400">Add alt text for accessibility</span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default MediaUploader;
