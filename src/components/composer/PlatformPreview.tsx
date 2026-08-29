import React, { useState } from 'react';
import { Image as ImageIcon, Play } from 'lucide-react';
import type { ComposerDraft, ComposerMediaItem } from '../../contexts/ComposerContext';
import { COMPOSER_PLATFORMS, PLATFORM_CONFIG, effectiveContentFor, type ComposerPlatformId } from './PostComposer';

/**
 * Where a platform's rendering truncates long captions before a "see more" affordance.
 * These are deliberately approximate — real client apps vary the cutoff by device,
 * font size, and whether the post has media.
 */
const TRUNCATION_LIMITS: Partial<Record<ComposerPlatformId, number>> = {
  instagram: 125,
  x: 280,
  tiktok: 150,
  linkedin: 210,
  facebook: 477,
  youtube: 100,
};

/** Aspect ratio each platform crops the first media item to, expressed as width / height. */
const MEDIA_ASPECT_RATIO: Record<ComposerPlatformId, number> = {
  instagram: 1,
  tiktok: 9 / 16,
  x: 16 / 9,
  linkedin: 1.91,
  facebook: 1.91,
  youtube: 16 / 9,
};

export interface TruncatedContent {
  visible: string;
  truncated: boolean;
  cutoffIndex: number | null;
}

/** Computes what a platform would show before a "see more" break, and where the cut falls. */
export const truncateForPlatform = (text: string, platformId: ComposerPlatformId): TruncatedContent => {
  const limit = TRUNCATION_LIMITS[platformId];
  if (!limit || text.length <= limit) {
    return { visible: text, truncated: false, cutoffIndex: null };
  }
  return { visible: text.slice(0, limit), truncated: true, cutoffIndex: limit };
};

/**
 * Computes the crop box (as percentages) applied when fitting a media item's natural
 * aspect ratio into the platform's target aspect ratio via a center-crop.
 */
export const cropForPlatform = (
  naturalAspectRatio: number,
  platformId: ComposerPlatformId
): { widthPct: number; heightPct: number } => {
  const target = MEDIA_ASPECT_RATIO[platformId];
  if (naturalAspectRatio >= target) {
    // Source is wider than the target — crop the sides.
    return { widthPct: (target / naturalAspectRatio) * 100, heightPct: 100 };
  }
  // Source is taller than the target — crop top/bottom.
  return { widthPct: 100, heightPct: (naturalAspectRatio / target) * 100 };
};

const PreviewMedia: React.FC<{ item: ComposerMediaItem; platformId: ComposerPlatformId }> = ({
  item,
  platformId,
}) => {
  const ratio = MEDIA_ASPECT_RATIO[platformId];
  return (
    <div
      className="relative w-full overflow-hidden rounded-xl bg-dark-bg/80"
      style={{ aspectRatio: ratio }}
    >
      {item.type === 'video' ? (
        <div className="flex h-full w-full items-center justify-center text-gray-subtext">
          <Play size={24} />
        </div>
      ) : (
        <img src={item.url} alt={item.name} className="h-full w-full object-cover" />
      )}
    </div>
  );
};

const SinglePlatformPreview: React.FC<{ draft: ComposerDraft; platformId: ComposerPlatformId }> = ({
  draft,
  platformId,
}) => {
  const config = PLATFORM_CONFIG[platformId];
  const content = effectiveContentFor(draft, platformId);
  const { visible, truncated } = truncateForPlatform(content, platformId);

  return (
    <div className="rounded-2xl border border-dark-border bg-dark-bg/40 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-white">{config.label}</span>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-subtext">
          Preview — approximate
        </span>
      </div>

      {draft.media[0] && (
        <div className="mt-3">
          <PreviewMedia item={draft.media[0]} platformId={platformId} />
        </div>
      )}

      <p className="mt-3 whitespace-pre-wrap break-words text-sm text-gray-200">
        {visible || <span className="text-gray-600">Nothing to preview yet.</span>}
        {truncated && (
          <>
            <span aria-hidden className="text-gray-600">
              …
            </span>
            <span className="ml-1 text-xs font-semibold text-primary-blue">see more</span>
          </>
        )}
      </p>
    </div>
  );
};

export interface PlatformPreviewProps {
  draft: ComposerDraft;
}

/**
 * Side-by-side (desktop) or tabbed (below `lg`) approximation of how the current draft
 * will render on each selected platform, including where each platform truncates the
 * caption and how the first attachment gets cropped.
 */
export const PlatformPreview: React.FC<PlatformPreviewProps> = ({ draft }) => {
  const selected = COMPOSER_PLATFORMS.filter((platform) => draft.platforms.includes(platform.id));
  const [activeTab, setActiveTab] = useState<ComposerPlatformId | null>(selected[0]?.id ?? null);

  if (selected.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-dark-border p-6 text-center text-xs text-gray-subtext">
        Select a platform to see its preview.
      </div>
    );
  }

  const activePlatformId = selected.find((p) => p.id === activeTab)?.id ?? selected[0].id;

  return (
    <div>
      {/* Tabs shown below `lg`; the side-by-side grid takes over at `lg` and up. */}
      <div className="flex flex-wrap gap-1 border-b border-dark-border pb-2 lg:hidden">
        {selected.map((platform) => (
          <button
            key={platform.id}
            type="button"
            onClick={() => setActiveTab(platform.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              activePlatformId === platform.id
                ? 'bg-primary-blue/20 text-primary-blue'
                : 'text-gray-subtext hover:text-white'
            }`}
          >
            {platform.label}
          </button>
        ))}
      </div>

      <div className="mt-3 lg:hidden">
        <SinglePlatformPreview draft={draft} platformId={activePlatformId} />
      </div>

      <div className="hidden gap-3 lg:grid lg:grid-cols-2">
        {selected.map((platform) => (
          <SinglePlatformPreview key={platform.id} draft={draft} platformId={platform.id} />
        ))}
      </div>
    </div>
  );
};
