import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Platform } from '../../types';
import { PagedResponse, Post, PostDensity, PostListQuery, PostStatus } from '../../types/post';
import { PostCard } from './PostCard';

const DENSITY_STORAGE_KEY = 'socialflow:postList:density';
const STATUS_OPTIONS: PostStatus[] = ['draft', 'scheduled', 'published', 'failed'];
const PLATFORM_OPTIONS = Object.values(Platform);

export interface PostListProps {
  fetchPosts: (query: PostListQuery) => Promise<PagedResponse<Post>>;
  pageSize?: number;
  onEdit?: (post: Post) => void;
  onDuplicate?: (post: Post) => void;
  onDelete?: (post: Post) => void | Promise<void>;
  onViewAnalytics?: (post: Post) => void;
  /** Controlled selection, so a parent can render a bulk-actions bar alongside this list. */
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  className?: string;
}

function readStoredDensity(): PostDensity {
  if (typeof window === 'undefined') return 'grid';
  const stored = window.localStorage.getItem(DENSITY_STORAGE_KEY);
  return stored === 'table' ? 'table' : 'grid';
}

function buildSkeletonKeys(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `skeleton-${index}`);
}

/**
 * Post list / feed view: grid-or-table density (persisted), status/platform/
 * date/search filters synced to the URL so a filtered view is shareable and
 * survives refresh, page-based pagination matching `PagedResponse`, and
 * skeleton loading that keeps the layout stable.
 */
export function PostList({
  fetchPosts,
  pageSize = 10,
  onEdit,
  onDuplicate,
  onDelete,
  onViewAnalytics,
  selectedIds: controlledSelectedIds,
  onSelectionChange,
  className,
}: PostListProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [density, setDensity] = useState<PostDensity>(() => readStoredDensity());
  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<string>>(new Set());
  const [data, setData] = useState<PagedResponse<Post> | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedIds = controlledSelectedIds ?? internalSelectedIds;
  const setSelectedIds = useCallback(
    (next: Set<string>) => {
      if (onSelectionChange) {
        onSelectionChange(next);
      } else {
        setInternalSelectedIds(next);
      }
    },
    [onSelectionChange],
  );

  const statusFilter = (searchParams.get('status') as PostStatus | null) ?? undefined;
  const platformFilter = (searchParams.get('platform') as Platform | null) ?? undefined;
  const fromFilter = searchParams.get('from') ?? undefined;
  const toFilter = searchParams.get('to') ?? undefined;
  const qFilter = searchParams.get('q') ?? '';
  const page = Number(searchParams.get('page') ?? '1') || 1;

  const [searchDraft, setSearchDraft] = useState(qFilter);
  const searchDebounceRef = useRef<number | null>(null);

  const updateParams = useCallback(
    (patch: Record<string, string | undefined>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        Object.entries(patch).forEach(([key, val]) => {
          if (val) {
            next.set(key, val);
          } else {
            next.delete(key);
          }
        });
        return next;
      });
    },
    [setSearchParams],
  );

  // Debounce free-text search so it doesn't refetch on every keystroke.
  useEffect(() => {
    if (searchDraft === qFilter) return;
    if (searchDebounceRef.current) window.clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = window.setTimeout(() => {
      updateParams({ q: searchDraft || undefined, page: undefined });
    }, 400);
    return () => {
      if (searchDebounceRef.current) window.clearTimeout(searchDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  // Selection is scoped to a filter set — clear it when filters (not page) change.
  const filterKey = `${statusFilter ?? ''}|${platformFilter ?? ''}|${fromFilter ?? ''}|${toFilter ?? ''}|${qFilter}`;
  const previousFilterKeyRef = useRef(filterKey);
  useEffect(() => {
    if (previousFilterKeyRef.current !== filterKey) {
      previousFilterKeyRef.current = filterKey;
      setSelectedIds(new Set());
    }
  }, [filterKey, setSelectedIds]);

  const query: PostListQuery = useMemo(
    () => ({
      status: statusFilter,
      platform: platformFilter,
      from: fromFilter,
      to: toFilter,
      q: qFilter || undefined,
      page,
      limit: pageSize,
    }),
    [statusFilter, platformFilter, fromFilter, toFilter, qFilter, page, pageSize],
  );

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setErrorMessage(null);

    fetchPosts(query)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : 'Failed to load posts.');
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [fetchPosts, query]);

  const handleDensityChange = useCallback((next: PostDensity) => {
    setDensity(next);
    window.localStorage.setItem(DENSITY_STORAGE_KEY, next);
  }, []);

  const toggleSelected = useCallback(
    (id: string, checked: boolean) => {
      const next = new Set(selectedIds);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      setSelectedIds(next);
    },
    [selectedIds, setSelectedIds],
  );

  const posts = data?.data ?? [];
  const isLoading = status === 'loading' && !data;

  return (
    <div className={className}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          aria-label="Filter by status"
          value={statusFilter ?? ''}
          onChange={(event) => updateParams({ status: event.target.value || undefined, page: undefined })}
          className="rounded border border-dark-border bg-dark-bg px-2 py-1 text-sm text-white"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by platform"
          value={platformFilter ?? ''}
          onChange={(event) => updateParams({ platform: event.target.value || undefined, page: undefined })}
          className="rounded border border-dark-border bg-dark-bg px-2 py-1 text-sm text-white"
        >
          <option value="">All platforms</option>
          {PLATFORM_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        <input
          type="date"
          aria-label="From date"
          value={fromFilter ?? ''}
          onChange={(event) => updateParams({ from: event.target.value || undefined, page: undefined })}
          className="rounded border border-dark-border bg-dark-bg px-2 py-1 text-sm text-white"
        />
        <input
          type="date"
          aria-label="To date"
          value={toFilter ?? ''}
          onChange={(event) => updateParams({ to: event.target.value || undefined, page: undefined })}
          className="rounded border border-dark-border bg-dark-bg px-2 py-1 text-sm text-white"
        />

        <input
          type="search"
          aria-label="Search posts"
          placeholder="Search posts…"
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
          className="min-w-[10rem] flex-1 rounded border border-dark-border bg-dark-bg px-2 py-1 text-sm text-white"
        />

        <div className="ml-auto flex items-center gap-1" role="group" aria-label="Density">
          <button
            type="button"
            aria-pressed={density === 'grid'}
            onClick={() => handleDensityChange('grid')}
            className={`rounded px-2 py-1 text-xs ${density === 'grid' ? 'bg-primary-blue text-white' : 'text-gray-subtext'}`}
          >
            Grid
          </button>
          <button
            type="button"
            aria-pressed={density === 'table'}
            onClick={() => handleDensityChange('table')}
            className={`rounded px-2 py-1 text-xs ${density === 'table' ? 'bg-primary-blue text-white' : 'text-gray-subtext'}`}
          >
            Table
          </button>
        </div>
      </div>

      {status === 'error' && (
        <p role="alert" className="text-sm text-trend-down">
          {errorMessage}
        </p>
      )}

      {isLoading &&
        (density === 'grid' ? (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            {buildSkeletonKeys(pageSize).map((key) => (
              <li key={key} className="h-28 animate-pulse rounded-lg bg-dark-surface" />
            ))}
          </ul>
        ) : (
          <div aria-busy="true" className="flex flex-col gap-1">
            {buildSkeletonKeys(pageSize).map((key) => (
              <div key={key} className="h-10 animate-pulse rounded bg-dark-surface" />
            ))}
          </div>
        ))}

      {!isLoading && status === 'ready' && posts.length === 0 && (
        <p className="text-sm text-gray-subtext">No posts match these filters.</p>
      )}

      {!isLoading &&
        posts.length > 0 &&
        (density === 'grid' ? (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                density="grid"
                selected={selectedIds.has(post.id)}
                onSelectChange={(checked) => toggleSelected(post.id, checked)}
                onEdit={onEdit}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
                onViewAnalytics={onViewAnalytics}
              />
            ))}
          </ul>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs text-gray-subtext">
                <th className="p-2" />
                <th className="p-2">Platform</th>
                <th className="p-2">Content</th>
                <th className="p-2">Status</th>
                <th className="p-2">When</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  density="table"
                  selected={selectedIds.has(post.id)}
                  onSelectChange={(checked) => toggleSelected(post.id, checked)}
                  onEdit={onEdit}
                  onDuplicate={onDuplicate}
                  onDelete={onDelete}
                  onViewAnalytics={onViewAnalytics}
                />
              ))}
            </tbody>
          </table>
        ))}

      {data && data.pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-gray-subtext">
          <span>
            Page {data.page} of {data.pages} · {data.total} posts
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={data.page <= 1}
              onClick={() => updateParams({ page: String(data.page - 1) })}
              className="rounded border border-dark-border px-2 py-1 disabled:opacity-30"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={data.page >= data.pages}
              onClick={() => updateParams({ page: String(data.page + 1) })}
              className="rounded border border-dark-border px-2 py-1 disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default PostList;
