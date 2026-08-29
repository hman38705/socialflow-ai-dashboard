import { Platform } from './index';

export type PostStatus = 'draft' | 'scheduled' | 'published' | 'failed';

export interface Post {
  id: string;
  content: string;
  platform: Platform;
  status: PostStatus;
  scheduledAt: string | null;
  createdAt: string;
  mediaUrls?: string[];
}

/** Matches the backend `PagedResponse` schema (`data`, `total`, `page`, `limit`, `pages`). */
export interface PagedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface PostListQuery {
  status?: PostStatus;
  platform?: Platform;
  from?: string;
  to?: string;
  q?: string;
  page: number;
  limit: number;
}

export type PostDensity = 'grid' | 'table';

/** Outcome of a single item within a bulk action, so partial failures can be reported per-item. */
export interface BulkActionResult {
  id: string;
  success: boolean;
  error?: string;
}
