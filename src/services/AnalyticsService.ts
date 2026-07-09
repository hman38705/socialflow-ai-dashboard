/**
 * @fileoverview Social Media Analytics Aggregation Service
 * Fetches, normalizes, stores, and schedules analytics data across platforms.
 */

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type Platform = 'twitter' | 'linkedin' | 'instagram' | 'tiktok';
export type Granularity = 'hour' | 'day' | 'week';

/** Normalized analytics record — consistent shape regardless of source platform. */
export interface PostAnalytics {
  /** Composite key: `{platform}:{postId}` */
  id: string;
  platform: Platform;
  postId: string;
  /** Unix ms timestamp of the post */
  postedAt: number;
  likes: number;
  shares: number;
  views: number;
  comments: number;
  /** Unix ms timestamp of last sync */
  syncedAt: number;
}

/** Aggregated analytics bucket for large date ranges. */
export interface AggregatedAnalytics {
  /** Bucket start time (Unix ms) */
  bucketStart: number;
  /** Bucket end time (Unix ms) */
  bucketEnd: number;
  platform: Platform;
  /** Sum of all metrics in this bucket */
  likes: number;
  shares: number;
  views: number;
  comments: number;
  /** Number of posts in this bucket */
  postCount: number;
}

// ---------------------------------------------------------------------------
// IndexedDB storage
// ---------------------------------------------------------------------------

const DB_NAME = 'SocialFlowAnalytics';
const DB_VERSION = 1;
const STORE = 'postAnalytics';

class AnalyticsDB {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => { this.db = req.result; resolve(); };
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('platform', 'platform', { unique: false });
          store.createIndex('syncedAt', 'syncedAt', { unique: false });
          store.createIndex('postedAt', 'postedAt', { unique: false });
        }
      };
    });
  }

  private tx(mode: IDBTransactionMode) {
    if (!this.db) throw new Error('AnalyticsDB not initialized');
    return this.db.transaction([STORE], mode).objectStore(STORE);
  }

  async upsertMany(records: PostAnalytics[]): Promise<void> {
    if (!this.db) throw new Error('AnalyticsDB not initialized');
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE], 'readwrite');
      const store = tx.objectStore(STORE);
      records.forEach(r => store.put(r));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getByPlatform(platform: Platform): Promise<PostAnalytics[]> {
    return new Promise((resolve, reject) => {
      const req = this.tx('readonly').index('platform').getAll(platform);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getAll(): Promise<PostAnalytics[]> {
    return new Promise((resolve, reject) => {
      const req = this.tx('readonly').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getByDateRange(from: number, to: number): Promise<PostAnalytics[]> {
    return new Promise((resolve, reject) => {
      const req = this.tx('readonly').index('postedAt').getAll(IDBKeyRange.bound(from, to));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
}

export const analyticsDB = new AnalyticsDB();

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseDelayMs = 500,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Platform fetchers
// ---------------------------------------------------------------------------

type Fetcher = (accountId: string) => Promise<PostAnalytics[]>;

/** Maps a Twitter API v2 tweet object to PostAnalytics. */
function normalizeTwitterTweet(tweet: any): PostAnalytics {
  const m = tweet.public_metrics ?? {};
  return {
    id: `twitter:${tweet.id}`,
    platform: 'twitter',
    postId: tweet.id,
    postedAt: tweet.created_at ? new Date(tweet.created_at).getTime() : Date.now(),
    likes: m.like_count ?? 0,
    shares: (m.retweet_count ?? 0) + (m.quote_count ?? 0),
    views: m.impression_count ?? 0,
    comments: m.reply_count ?? 0,
    syncedAt: 0, // stamped by caller
  };
}

const fetchTwitter: Fetcher = async (accountId) => {
  const token = (window as any).__TWITTER_BEARER_TOKEN__ ?? '';
  if (!token) {
    console.warn('[Analytics] TWITTER_BEARER_TOKEN not available in client context');
    return [];
  }
  return withRetry(async () => {
    const params = new URLSearchParams({
      max_results: '100',
      'tweet.fields': 'created_at,public_metrics',
    });
    const res = await fetch(
      `https://api.twitter.com/2/users/${accountId}/tweets?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') ?? 60) * 1000;
      await new Promise((r) => setTimeout(r, retryAfter));
      throw new Error('Twitter rate limited — retrying');
    }
    if (!res.ok) throw new Error(`Twitter API error: ${res.status}`);
    const data = await res.json();
    return (data.data ?? []).map(normalizeTwitterTweet);
  });
};

/** Maps a LinkedIn UGC post + stats to PostAnalytics. */
function normalizeLinkedInPost(post: any, stats: any): PostAnalytics {
  return {
    id: `linkedin:${post.id}`,
    platform: 'linkedin',
    postId: post.id,
    postedAt: post.created?.time ?? Date.now(),
    likes: stats?.likesSummary?.totalLikes ?? 0,
    shares: stats?.shareStatistics?.shareCount ?? 0,
    views: stats?.shareStatistics?.impressionCount ?? 0,
    comments: stats?.commentsSummary?.totalFirstLevelComments ?? 0,
    syncedAt: 0,
  };
}

const fetchLinkedIn: Fetcher = async (accountId) => {
  const token = (window as any).__LINKEDIN_ACCESS_TOKEN__ ?? '';
  if (!token) {
    console.warn('[Analytics] LinkedIn access token not available in client context');
    return [];
  }
  return withRetry(async () => {
    const headers = {
      Authorization: `Bearer ${token}`,
      'X-Restli-Protocol-Version': '2.0.0',
    };
    const postsRes = await fetch(
      `https://api.linkedin.com/v2/ugcPosts?q=authors&authors=List(${encodeURIComponent(accountId)})&count=50`,
      { headers },
    );
    if (postsRes.status === 429) throw new Error('LinkedIn rate limited — retrying');
    if (!postsRes.ok) throw new Error(`LinkedIn API error: ${postsRes.status}`);
    const postsData = await postsRes.json();
    const posts: any[] = postsData.elements ?? [];

    return Promise.all(
      posts.map(async (post) => {
        try {
          const statsRes = await fetch(
            `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(post.id)}?projection=(likesSummary,commentsSummary,shareStatistics)`,
            { headers },
          );
          const stats = statsRes.ok ? await statsRes.json() : {};
          return normalizeLinkedInPost(post, stats);
        } catch {
          return normalizeLinkedInPost(post, {});
        }
      }),
    );
  });
};

/** Maps an Instagram Graph API media object to PostAnalytics. */
function normalizeInstagramMedia(media: any): PostAnalytics {
  return {
    id: `instagram:${media.id}`,
    platform: 'instagram',
    postId: media.id,
    postedAt: media.timestamp ? new Date(media.timestamp).getTime() : Date.now(),
    likes: media.like_count ?? 0,
    shares: 0, // Instagram Graph API does not expose share counts
    views: media.impressions ?? media.video_views ?? 0,
    comments: media.comments_count ?? 0,
    syncedAt: 0,
  };
}

const fetchInstagram: Fetcher = async (accountId) => {
  const token = (window as any).__INSTAGRAM_ACCESS_TOKEN__ ?? '';
  if (!token) {
    console.warn('[Analytics] Instagram access token not available in client context');
    return [];
  }
  return withRetry(async () => {
    const params = new URLSearchParams({
      fields: 'id,timestamp,like_count,comments_count,impressions,video_views',
      access_token: token,
      limit: '50',
    });
    const res = await fetch(
      `https://graph.facebook.com/v18.0/${accountId}/media?${params}`,
    );
    if (res.status === 429) throw new Error('Instagram rate limited — retrying');
    if (!res.ok) throw new Error(`Instagram API error: ${res.status}`);
    const data = await res.json();
    return (data.data ?? []).map(normalizeInstagramMedia);
  });
};

/** Maps a TikTok video object to PostAnalytics. */
function normalizeTikTokVideo(video: any): PostAnalytics {
  const s = video.statistics ?? {};
  return {
    id: `tiktok:${video.id}`,
    platform: 'tiktok',
    postId: video.id,
    postedAt: video.create_time ? video.create_time * 1000 : Date.now(),
    likes: s.digg_count ?? 0,
    shares: s.share_count ?? 0,
    views: s.play_count ?? 0,
    comments: s.comment_count ?? 0,
    syncedAt: 0,
  };
}

const fetchTikTok: Fetcher = async (accountId) => {
  const token = (window as any).__TIKTOK_ACCESS_TOKEN__ ?? '';
  if (!token) {
    console.warn('[Analytics] TikTok access token not available in client context');
    return [];
  }
  return withRetry(async () => {
    const body = {
      filters: { video_ids: [] },
      fields: ['id', 'create_time', 'statistics'],
      cursor: 0,
      max_count: 20,
    };
    const res = await fetch(
      `https://open.tiktokapis.com/v2/video/list/?fields=id,create_time,statistics`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify(body),
      },
    );
    if (res.status === 429) throw new Error('TikTok rate limited — retrying');
    if (!res.ok) throw new Error(`TikTok API error: ${res.status}`);
    const data = await res.json();
    if (data.error?.code && data.error.code !== 'ok') {
      throw new Error(`TikTok API error: ${data.error.message}`);
    }
    return (data.data?.videos ?? []).map(normalizeTikTokVideo);
  });
};

const FETCHERS: Record<Platform, Fetcher> = {
  twitter: fetchTwitter,
  linkedin: fetchLinkedIn,
  instagram: fetchInstagram,
  tiktok: fetchTikTok,
};

// ---------------------------------------------------------------------------
// Time-bucket aggregation
// ---------------------------------------------------------------------------

/**
 * Determine granularity based on date range.
 * - < 7 days: hourly
 * - < 90 days: daily
 * - >= 90 days: weekly
 */
function getGranularity(from: number, to: number): Granularity {
  const rangeMs = to - from;
  const days = rangeMs / (1000 * 60 * 60 * 24);
  if (days < 7) return 'hour';
  if (days < 90) return 'day';
  return 'week';
}

/**
 * Get bucket size in milliseconds.
 */
function getBucketSizeMs(granularity: Granularity): number {
  switch (granularity) {
    case 'hour': return 60 * 60 * 1000;
    case 'day': return 24 * 60 * 60 * 1000;
    case 'week': return 7 * 24 * 60 * 60 * 1000;
  }
}

/**
 * Aggregate analytics records by time bucket.
 */
function aggregateByTimeBucket(
  records: PostAnalytics[],
  granularity: Granularity,
  from: number,
  to: number,
): AggregatedAnalytics[] {
  const bucketSizeMs = getBucketSizeMs(granularity);
  const buckets = new Map<number, AggregatedAnalytics>();

  // Initialize buckets for the entire range
  for (let bucketStart = from; bucketStart < to; bucketStart += bucketSizeMs) {
    const bucketEnd = Math.min(bucketStart + bucketSizeMs, to);
    const key = bucketStart;
    buckets.set(key, {
      bucketStart,
      bucketEnd,
      platform: records[0]?.platform ?? 'twitter',
      likes: 0,
      shares: 0,
      views: 0,
      comments: 0,
      postCount: 0,
    });
  }

  // Aggregate records into buckets
  records.forEach((record) => {
    const bucketIndex = Math.floor((record.postedAt - from) / bucketSizeMs);
    const bucketStart = from + bucketIndex * bucketSizeMs;
    const bucket = buckets.get(bucketStart);
    if (bucket) {
      bucket.likes += record.likes;
      bucket.shares += record.shares;
      bucket.views += record.views;
      bucket.comments += record.comments;
      bucket.postCount += 1;
    }
  });

  return Array.from(buckets.values());
}

// ---------------------------------------------------------------------------
// AnalyticsService
// ---------------------------------------------------------------------------

export class AnalyticsService {
  private schedulerHandle: ReturnType<typeof setInterval> | null = null;

  /** Fetch + store analytics for all enabled platforms. */
  async sync(accountIds: Partial<Record<Platform, string>>): Promise<void> {
    await analyticsDB.init();
    const now = Date.now();

    const results = await Promise.allSettled(
      (Object.entries(accountIds) as [Platform, string][]).map(async ([platform, id]) => {
        const records = await FETCHERS[platform](id);
        const stamped = records.map(r => ({ ...r, syncedAt: now }));
        if (stamped.length) await analyticsDB.upsertMany(stamped);
      })
    );

    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`[Analytics] sync failed for platform index ${i}:`, r.reason);
      }
    });
  }

  /**
   * Start scheduled sync.
   * @param accountIds  Map of platform → account/user ID
   * @param intervalMs  Polling interval in ms (default: 15 minutes)
   */
  startScheduler(
    accountIds: Partial<Record<Platform, string>>,
    intervalMs = 15 * 60 * 1000
  ): void {
    if (this.schedulerHandle) return; // already running
    this.sync(accountIds); // immediate first run
    this.schedulerHandle = setInterval(() => this.sync(accountIds), intervalMs);
  }

  stopScheduler(): void {
    if (this.schedulerHandle) {
      clearInterval(this.schedulerHandle);
      this.schedulerHandle = null;
    }
  }

  // Convenience read methods for dashboard charts

  async getAll(): Promise<PostAnalytics[]> {
    await analyticsDB.init();
    return analyticsDB.getAll();
  }

  async getByPlatform(platform: Platform): Promise<PostAnalytics[]> {
    await analyticsDB.init();
    return analyticsDB.getByPlatform(platform);
  }

  async getByDateRange(from: number, to: number): Promise<PostAnalytics[]> {
    await analyticsDB.init();
    return analyticsDB.getByDateRange(from, to);
  }

  /**
   * Get aggregated analytics for a date range with automatic granularity.
   * Returns time-bucketed data to reduce payload size for large date ranges.
   */
  async getAggregated(
    from: number,
    to: number,
    platform?: Platform,
  ): Promise<AggregatedAnalytics[]> {
    await analyticsDB.init();
    const records = platform
      ? await this.getByPlatform(platform).then(r => r.filter(x => x.postedAt >= from && x.postedAt <= to))
      : await this.getByDateRange(from, to);

    const granularity = getGranularity(from, to);
    return aggregateByTimeBucket(records, granularity, from, to);
  }
}

export const analyticsService = new AnalyticsService();
