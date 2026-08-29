import React, { useState } from 'react';
import { Post, PostDensity, PostStatus } from '../../types/post';

export interface PostCardProps {
  post: Post;
  density: PostDensity;
  selected: boolean;
  onSelectChange: (selected: boolean) => void;
  onEdit?: (post: Post) => void;
  onDuplicate?: (post: Post) => void;
  onDelete?: (post: Post) => void | Promise<void>;
  onViewAnalytics?: (post: Post) => void;
}

const STATUS_STYLES: Record<PostStatus, string> = {
  draft: 'bg-white/10 text-gray-subtext',
  scheduled: 'bg-primary-blue/20 text-primary-blue',
  published: 'bg-trend-up/20 text-trend-up',
  failed: 'bg-trend-down/20 text-trend-down',
};

function formatTimestamp(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function excerpt(content: string, max = 140): string {
  return content.length > max ? `${content.slice(0, max - 1)}…` : content;
}

/**
 * Renders a single post as either a grid card (`<li>`) or a table row
 * (`<tr>`) depending on `density`. Row actions (edit/duplicate/delete/view
 * analytics) live here; delete asks for confirmation in place before firing.
 */
export function PostCard({
  post,
  density,
  selected,
  onSelectChange,
  onEdit,
  onDuplicate,
  onDelete,
  onViewAnalytics,
}: PostCardProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const statusBadge = (
    <span className={`rounded-full px-2 py-0.5 text-xs capitalize ${STATUS_STYLES[post.status]}`}>
      {post.status}
    </span>
  );

  const actions = confirmingDelete ? (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-gray-subtext">Delete this post?</span>
      <button
        type="button"
        className="text-trend-down underline"
        onClick={() => {
          setConfirmingDelete(false);
          void onDelete?.(post);
        }}
      >
        Confirm
      </button>
      <button type="button" className="text-gray-subtext underline" onClick={() => setConfirmingDelete(false)}>
        Cancel
      </button>
    </div>
  ) : (
    <div className="flex items-center gap-3 text-xs">
      <button type="button" className="text-primary-blue" onClick={() => onEdit?.(post)}>
        Edit
      </button>
      <button type="button" className="text-gray-subtext" onClick={() => onDuplicate?.(post)}>
        Duplicate
      </button>
      <button type="button" className="text-gray-subtext" onClick={() => onViewAnalytics?.(post)}>
        Analytics
      </button>
      <button type="button" className="text-trend-down" onClick={() => setConfirmingDelete(true)}>
        Delete
      </button>
    </div>
  );

  const checkbox = (
    <input
      type="checkbox"
      checked={selected}
      onChange={(event) => onSelectChange(event.target.checked)}
      aria-label={`Select post ${post.id}`}
    />
  );

  if (density === 'table') {
    return (
      <tr data-post-id={post.id} className="border-b border-dark-border">
        <td className="p-2">{checkbox}</td>
        <td className="p-2 capitalize">{post.platform}</td>
        <td className="max-w-xs p-2 text-sm text-white">{excerpt(post.content, 80)}</td>
        <td className="p-2">{statusBadge}</td>
        <td className="p-2 text-xs text-gray-subtext">{formatTimestamp(post.scheduledAt ?? post.createdAt)}</td>
        <td className="p-2">{actions}</td>
      </tr>
    );
  }

  return (
    <li
      data-post-id={post.id}
      className="flex flex-col gap-2 rounded-lg border border-dark-border bg-dark-surface p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {checkbox}
          <span className="text-xs capitalize text-gray-subtext">{post.platform}</span>
        </div>
        {statusBadge}
      </div>
      <p className="text-sm text-white">{excerpt(post.content)}</p>
      <div className="text-xs text-gray-subtext">{formatTimestamp(post.scheduledAt ?? post.createdAt)}</div>
      {actions}
    </li>
  );
}

export default PostCard;
