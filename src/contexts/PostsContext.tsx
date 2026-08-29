import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { OpenAPI } from '../api/core/OpenAPI';
import { request as __request } from '../api/core/request';
import type { Post } from '../api/models/Post';
import type { PagedResponse } from '../api/models/PagedResponse';

const DEFAULT_LIMIT = 20;

/**
 * The generated `Post` model doesn't carry a `status` field yet (the
 * backend endpoint this context talks to doesn't exist either — see the
 * FE-057 ticket). `status` is filtered/optimistically-matched on a
 * best-effort basis until both land; every other field is exactly the
 * generated `Post` shape.
 */
export type PostRecord = Post & { status?: 'draft' | 'scheduled' | 'published' };

export interface PostFilter {
  status?: PostRecord['status'];
  platform?: Post['platform'];
  dateFrom?: string;
  dateTo?: string;
}

interface FilterPage {
  ids: string[];
}

interface FilterEntry {
  filter: PostFilter;
  pages: Record<number, FilterPage>;
  total: number;
  pagesCount: number;
  limit: number;
  status: 'idle' | 'loading' | 'loaded' | 'error';
  error: string | null;
}

interface PostsState {
  postsById: Record<string, PostRecord>;
  filters: Record<string, FilterEntry>;
}

const EMPTY_STATE: PostsState = { postsById: {}, filters: {} };

function filterKey(filter: PostFilter): string {
  return JSON.stringify({
    status: filter.status ?? null,
    platform: filter.platform ?? null,
    dateFrom: filter.dateFrom ?? null,
    dateTo: filter.dateTo ?? null,
  });
}

/** Best-effort local match, used only to decide where an optimistic create belongs. */
function matchesFilter(post: PostRecord, filter: PostFilter): boolean {
  if (filter.status && post.status && post.status !== filter.status) return false;
  if (filter.platform && post.platform && post.platform !== filter.platform) return false;
  return true;
}

function genTempId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface PostsPageResult {
  posts: PostRecord[];
  total: number;
  pagesCount: number;
  isLoading: boolean;
  error: string | null;
}

interface PostsContextValue {
  /** Read-only view of a single page for a filter; safe to call every render. */
  getPage: (filter: PostFilter, page: number) => PostsPageResult;
  fetchPage: (filter: PostFilter, page?: number, limit?: number) => Promise<void>;
  createPost: (input: Partial<Post>) => Promise<PostRecord>;
  updatePost: (id: string, patch: Partial<PostRecord>) => Promise<void>;
  deletePost: (id: string) => Promise<void>;
  refresh: (filter: PostFilter) => Promise<void>;
  /** Drops cached pages for one filter, or the entire cache when called with no argument. */
  invalidate: (filter?: PostFilter) => void;
  /** Most recent operation failure, for surfacing as a toast at the call site. */
  lastError: string | null;
}

const PostsContext = createContext<PostsContextValue | null>(null);

export const PostsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<PostsState>(EMPTY_STATE);
  const [lastError, setLastError] = useState<string | null>(null);
  // Tracks requests currently in flight, keyed by `${filterKey}:${page}:${limit}`,
  // so an identical concurrent fetch reuses the pending promise instead of
  // issuing a second network request.
  const inFlightRef = useRef<Map<string, Promise<void>>>(new Map());

  const clearAll = useCallback(() => {
    inFlightRef.current.clear();
    setState(EMPTY_STATE);
  }, []);

  // Cleared entirely on logout and on org switch. Neither AuthContext nor
  // an org-switch context exists yet in this rebuild, so this listens for
  // the DOM events they're expected to dispatch (`sf:auth-logout`,
  // `sf:org-switch`) rather than importing modules that don't exist.
  useEffect(() => {
    window.addEventListener('sf:auth-logout', clearAll);
    window.addEventListener('sf:org-switch', clearAll);
    return () => {
      window.removeEventListener('sf:auth-logout', clearAll);
      window.removeEventListener('sf:org-switch', clearAll);
    };
  }, [clearAll]);

  const getPage = useCallback(
    (filter: PostFilter, page: number): PostsPageResult => {
      const entry = state.filters[filterKey(filter)];
      const pageIds = entry?.pages[page]?.ids ?? [];
      return {
        posts: pageIds.map((id) => state.postsById[id]).filter((p): p is PostRecord => !!p),
        total: entry?.total ?? 0,
        pagesCount: entry?.pagesCount ?? 0,
        isLoading: entry?.status === 'loading',
        error: entry?.error ?? null,
      };
    },
    [state]
  );

  const fetchPage = useCallback(async (filter: PostFilter, page = 1, limit = DEFAULT_LIMIT): Promise<void> => {
    const key = filterKey(filter);
    const inFlightKey = `${key}:${page}:${limit}`;
    const pending = inFlightRef.current.get(inFlightKey);
    if (pending) return pending;

    const run = (async () => {
      setState((prev) => {
        const existing = prev.filters[key];
        return {
          ...prev,
          filters: {
            ...prev.filters,
            [key]: {
              filter,
              pages: existing?.pages ?? {},
              total: existing?.total ?? 0,
              pagesCount: existing?.pagesCount ?? 0,
              limit,
              status: 'loading',
              error: null,
            },
          },
        };
      });

      try {
        const response = await __request<PagedResponse>(OpenAPI, {
          method: 'GET',
          url: '/posts',
          query: {
            status: filter.status,
            platform: filter.platform,
            dateFrom: filter.dateFrom,
            dateTo: filter.dateTo,
            page,
            limit,
          },
        });

        const posts = (response.data ?? []) as PostRecord[];
        setState((prev) => {
          const postsById = { ...prev.postsById };
          for (const post of posts) {
            if (post.id) postsById[post.id] = post;
          }
          const existing = prev.filters[key];
          return {
            postsById,
            filters: {
              ...prev.filters,
              [key]: {
                filter,
                pages: {
                  ...(existing?.pages ?? {}),
                  [page]: { ids: posts.map((p) => p.id!).filter(Boolean) },
                },
                total: response.total ?? posts.length,
                pagesCount: response.pages ?? 1,
                limit,
                status: 'loaded',
                error: null,
              },
            },
          };
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load posts.';
        setState((prev) => {
          const existing = prev.filters[key];
          if (!existing) return prev;
          return {
            ...prev,
            filters: { ...prev.filters, [key]: { ...existing, status: 'error', error: message } },
          };
        });
        setLastError(message);
      } finally {
        inFlightRef.current.delete(inFlightKey);
      }
    })();

    inFlightRef.current.set(inFlightKey, run);
    return run;
  }, []);

  const refresh = useCallback(
    async (filter: PostFilter): Promise<void> => {
      const key = filterKey(filter);
      const limit = state.filters[key]?.limit ?? DEFAULT_LIMIT;
      setState((prev) => {
        const { [key]: _removed, ...rest } = prev.filters;
        return { ...prev, filters: rest };
      });
      await fetchPage(filter, 1, limit);
    },
    [state.filters, fetchPage]
  );

  const invalidate = useCallback((filter?: PostFilter) => {
    if (!filter) {
      clearAll();
      return;
    }
    const key = filterKey(filter);
    setState((prev) => {
      const { [key]: _removed, ...rest } = prev.filters;
      return { ...prev, filters: rest };
    });
  }, [clearAll]);

  const createPost = useCallback(async (input: Partial<Post>): Promise<PostRecord> => {
    const tempId = genTempId();
    const optimistic: PostRecord = {
      ...input,
      id: tempId,
      createdAt: new Date().toISOString(),
      status: (input as PostRecord).status ?? 'draft',
    };

    let snapshot: PostsState | null = null;
    setState((prev) => {
      snapshot = prev;
      const postsById = { ...prev.postsById, [tempId]: optimistic };
      const filters = { ...prev.filters };
      for (const [key, entry] of Object.entries(filters)) {
        if (!matchesFilter(optimistic, entry.filter)) continue;
        const page1 = entry.pages[1] ?? { ids: [] };
        filters[key] = {
          ...entry,
          pages: { ...entry.pages, 1: { ids: [tempId, ...page1.ids] } },
          total: entry.total + 1,
        };
      }
      return { postsById, filters };
    });

    try {
      const created = (await __request<Post>(OpenAPI, {
        method: 'POST',
        url: '/posts',
        body: input,
        mediaType: 'application/json',
      })) as PostRecord;

      setState((prev) => {
        const postsById = { ...prev.postsById };
        delete postsById[tempId];
        if (created.id) postsById[created.id] = created;
        const filters = { ...prev.filters };
        for (const [key, entry] of Object.entries(filters)) {
          const pages = { ...entry.pages };
          for (const [pageNum, page] of Object.entries(pages)) {
            if (page.ids.includes(tempId)) {
              pages[Number(pageNum)] = {
                ids: page.ids.map((id) => (id === tempId ? created.id! : id)),
              };
            }
          }
          filters[key] = { ...entry, pages };
        }
        return { postsById, filters };
      });

      return created;
    } catch (err) {
      if (snapshot) setState(snapshot);
      const message = err instanceof Error ? err.message : 'Failed to create post.';
      setLastError(message);
      throw err;
    }
  }, []);

  const updatePost = useCallback(async (id: string, patch: Partial<PostRecord>): Promise<void> => {
    let snapshot: PostsState | null = null;
    setState((prev) => {
      const existing = prev.postsById[id];
      if (!existing) return prev;
      snapshot = prev;
      return { ...prev, postsById: { ...prev.postsById, [id]: { ...existing, ...patch } } };
    });

    try {
      const updated = (await __request<Post>(OpenAPI, {
        method: 'PATCH',
        url: '/posts/{id}',
        path: { id },
        body: patch,
        mediaType: 'application/json',
      })) as PostRecord;

      setState((prev) => {
        const existing = prev.postsById[id];
        if (!existing) return prev;
        return { ...prev, postsById: { ...prev.postsById, [id]: { ...existing, ...updated } } };
      });
    } catch (err) {
      if (snapshot) setState(snapshot);
      const message = err instanceof Error ? err.message : 'Failed to update post.';
      setLastError(message);
      throw err;
    }
  }, []);

  const deletePost = useCallback(async (id: string): Promise<void> => {
    let snapshot: PostsState | null = null;
    setState((prev) => {
      if (!prev.postsById[id]) return prev;
      snapshot = prev;
      const postsById = { ...prev.postsById };
      delete postsById[id];
      const filters = { ...prev.filters };
      for (const [key, entry] of Object.entries(filters)) {
        let touched = false;
        const pages = { ...entry.pages };
        for (const [pageNum, page] of Object.entries(pages)) {
          if (page.ids.includes(id)) {
            pages[Number(pageNum)] = { ids: page.ids.filter((pid) => pid !== id) };
            touched = true;
          }
        }
        if (touched) {
          filters[key] = { ...entry, pages, total: Math.max(0, entry.total - 1) };
        }
      }
      return { postsById, filters };
    });

    try {
      await __request(OpenAPI, { method: 'DELETE', url: '/posts/{id}', path: { id } });
    } catch (err) {
      if (snapshot) setState(snapshot);
      const message = err instanceof Error ? err.message : 'Failed to delete post.';
      setLastError(message);
      throw err;
    }
  }, []);

  const value = useMemo<PostsContextValue>(
    () => ({ getPage, fetchPage, createPost, updatePost, deletePost, refresh, invalidate, lastError }),
    [getPage, fetchPage, createPost, updatePost, deletePost, refresh, invalidate, lastError]
  );

  return <PostsContext.Provider value={value}>{children}</PostsContext.Provider>;
};

export const usePosts = (): PostsContextValue => {
  const ctx = useContext(PostsContext);
  if (!ctx) throw new Error('usePosts must be used within a PostsProvider');
  return ctx;
};
