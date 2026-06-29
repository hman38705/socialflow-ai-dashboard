import { circuitBreakerService } from './CircuitBreakerService';
import { createLogger } from '../lib/logger';
import Redis from 'ioredis';
import { getRedisConnection } from '../config/runtime';

const logger = createLogger('tiktok-service');

const MAX_RETRIES = 3;

/**
 * Parse the Retry-After header value.
 * Accepts either a delay-seconds integer or an HTTP-date string.
 * Returns the wait duration in milliseconds.
 */
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  // HTTP-date format
  const date = new Date(header);
  if (!isNaN(date.getTime())) {
    const waitMs = date.getTime() - Date.now();
    return waitMs > 0 ? waitMs : 0;
  }
  return null;
}

/**
 * Wraps fetch with Retry-After-aware retry logic for 429 responses.
 * Falls back to exponential backoff when the Retry-After header is absent.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = MAX_RETRIES,
): Promise<Response> {
  let attempt = 0;
  while (true) {
    const response = await fetch(url, init);
    if (response.status !== 429 || attempt >= retries) return response;

    const retryAfterMs =
      parseRetryAfterMs(response.headers.get('Retry-After')) ??
      Math.min(1000 * 2 ** attempt, 30_000); // exponential backoff fallback

    logger.warn('TikTok API rate limited — backing off before retry', {
      url,
      attempt: attempt + 1,
      retryAfterMs,
    });

    await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
    attempt++;
  }
}

const UPLOAD_PROGRESS_PREFIX = 'tiktok:upload:progress:';
const UPLOAD_SESSION_PREFIX = 'tiktok:upload:session:';
const UPLOAD_PROGRESS_TTL = 86400; // 24 hours

// Field name inside the progress hash that tracks the last confirmed chunk index
const LAST_CHUNK_FIELD = '__lastChunk';

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) _redis = new Redis(getRedisConnection());
  return _redis;
}

// TikTok Content Posting API v2 endpoints
const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_VIDEO_INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/video/init/';
const TIKTOK_VIDEO_STATUS_URL = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';

// Chunked upload: TikTok requires chunks between 5 MB and 64 MB
const CHUNK_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB per chunk

export interface TikTokTokens {
  accessToken: string;
  refreshToken: string;
  openId: string;
  expiresAt: number;
  refreshExpiresAt: number;
  scope: string;
}

export interface TikTokVideoUploadRequest {
  /** Local file path or a publicly accessible URL */
  videoSource: string;
  /** 'FILE_UPLOAD' for chunked binary upload, 'PULL_FROM_URL' for URL-based */
  sourceType: 'FILE_UPLOAD' | 'PULL_FROM_URL';
  title: string;
  description?: string;
  privacyLevel?: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'SELF_ONLY';
  disableDuet?: boolean;
  disableComment?: boolean;
  disableStitch?: boolean;
  videoCoverTimestampMs?: number;
}

export interface TikTokVideoStatus {
  publishId: string;
  status: 'PROCESSING_UPLOAD' | 'PUBLISH_COMPLETE' | 'FAILED' | 'PROCESSING_DOWNLOAD';
  failReason?: string;
  publiclyAvailable?: boolean;
  shareUrl?: string;
}

export interface TikTokUserInfo {
  openId: string;
  unionId: string;
  avatarUrl: string;
  displayName: string;
  bioDescription: string;
  profileDeepLink: string;
  isVerified: boolean;
  followerCount: number;
  followingCount: number;
  likesCount: number;
  videoCount: number;
}

class TikTokService {
  private readonly clientKey: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;

  constructor() {
    this.clientKey = process.env.TIKTOK_CLIENT_KEY || '';
    this.clientSecret = process.env.TIKTOK_CLIENT_SECRET || '';
    this.redirectUri =
      process.env.TIKTOK_REDIRECT_URI || 'http://localhost:3000/api/tiktok/callback';
  }

  public isConfigured(): boolean {
    return !!this.clientKey && !!this.clientSecret;
  }

  // ─── OAuth ────────────────────────────────────────────────────────────────

  /**
   * Step 1: Build the TikTok OAuth2 authorization URL.
   * Scopes required for video posting:
   *   user.info.basic, video.publish, video.upload
   */
  public getAuthUrl(csrfState: string): string {
    const params = new URLSearchParams({
      client_key: this.clientKey,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'user.info.basic,video.publish,video.upload',
      state: csrfState,
    });
    return `${TIKTOK_AUTH_URL}?${params}`;
  }

  /**
   * Step 2: Exchange authorization code for access + refresh tokens.
   */
  public async exchangeCode(code: string): Promise<TikTokTokens> {
    const response = await fetchWithRetry(TIKTOK_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: this.clientKey,
        client_secret: this.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.redirectUri,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(`TikTok token exchange failed: ${JSON.stringify(err)}`);
    }

    const data = (await response.json()) as any;
    if (data.error) {
      throw new Error(`TikTok token exchange error: ${data.error_description || data.error}`);
    }

    return this.mapTokenResponse(data);
  }

  /**
   * Refresh an expired access token using the refresh token.
   */
  public async refreshAccessToken(refreshToken: string): Promise<TikTokTokens> {
    const response = await fetchWithRetry(TIKTOK_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: this.clientKey,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(`TikTok token refresh failed: ${JSON.stringify(err)}`);
    }

    const data = (await response.json()) as any;
    return this.mapTokenResponse(data);
  }

  private mapTokenResponse(data: any): TikTokTokens {
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      openId: data.open_id,
      expiresAt: Date.now() + (data.expires_in || 86400) * 1000,
      refreshExpiresAt: Date.now() + (data.refresh_expires_in || 2592000) * 1000,
      scope: data.scope || '',
    };
  }

  // ─── User Info ────────────────────────────────────────────────────────────

  public async getUserInfo(accessToken: string): Promise<TikTokUserInfo> {
    return circuitBreakerService.execute(
      'tiktok',
      async () => {
        const response = await fetchWithRetry(
          'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,bio_description,profile_deep_link,is_verified,follower_count,following_count,likes_count,video_count',
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          },
        );

        if (!response.ok) {
          const err = await response.json();
          throw new Error(`Failed to fetch TikTok user info: ${JSON.stringify(err)}`);
        }

        const data = (await response.json()) as any;
        const u = data.data?.user;
        return {
          openId: u.open_id,
          unionId: u.union_id,
          avatarUrl: u.avatar_url,
          displayName: u.display_name,
          bioDescription: u.bio_description,
          profileDeepLink: u.profile_deep_link,
          isVerified: u.is_verified,
          followerCount: u.follower_count,
          followingCount: u.following_count,
          likesCount: u.likes_count,
          videoCount: u.video_count,
        };
      },
      async () => {
        throw new Error('TikTok API temporarily unavailable');
      },
    );
  }

  // ─── Video Upload (chunked) ───────────────────────────────────────────────

  /**
   * Initiate a chunked video upload.
   * Returns the publishId and uploadUrl to use for chunk uploads.
   */
  public async initiateVideoUpload(
    accessToken: string,
    fileSizeBytes: number,
    request: TikTokVideoUploadRequest,
  ): Promise<{ publishId: string; uploadUrl: string; chunkSize: number; totalChunks: number }> {
    return circuitBreakerService.execute(
      'tiktok',
      async () => {
        const totalChunks = Math.ceil(fileSizeBytes / CHUNK_SIZE_BYTES);

        const body: Record<string, any> = {
          post_info: {
            title: request.title,
            description: request.description || '',
            privacy_level: request.privacyLevel || 'SELF_ONLY',
            disable_duet: request.disableDuet ?? false,
            disable_comment: request.disableComment ?? false,
            disable_stitch: request.disableStitch ?? false,
            video_cover_timestamp_ms: request.videoCoverTimestampMs ?? 1000,
          },
          source_info: {
            source: request.sourceType,
            video_size: fileSizeBytes,
            chunk_size: CHUNK_SIZE_BYTES,
            total_chunk_count: totalChunks,
          },
        };

        const response = await fetchWithRetry(TIKTOK_VIDEO_INIT_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(`TikTok video init failed: ${JSON.stringify(err)}`);
        }

        const data = (await response.json()) as any;
        if (data.error?.code !== 'ok') {
          throw new Error(`TikTok video init error: ${data.error?.message}`);
        }

        logger.info('TikTok video upload initiated', {
          publishId: data.data.publish_id,
          totalChunks,
        });

        return {
          publishId: data.data.publish_id,
          uploadUrl: data.data.upload_url,
          chunkSize: CHUNK_SIZE_BYTES,
          totalChunks,
        };
      },
      async () => {
        throw new Error('TikTok API temporarily unavailable');
      },
    );
  }

  /**
   * Upload a single chunk of a video file.
   * chunkIndex is 0-based.
   *
   * Progress is persisted in Redis keyed by uploadSessionId so that a failed
   * upload can resume from the last confirmed byte offset rather than
   * re-uploading already-confirmed chunks.
   */
  public async uploadChunk(
    uploadUrl: string,
    chunkData: Buffer,
    chunkIndex: number,
    totalChunks: number,
    totalFileSize: number,
    uploadSessionId: string,
  ): Promise<void> {
    const redis = getRedis();
    const progressKey = `${UPLOAD_PROGRESS_PREFIX}${uploadSessionId}`;

    // Check whether this chunk was already confirmed
    const confirmedStr = await redis.hget(progressKey, String(chunkIndex));
    if (confirmedStr === '1') {
      logger.info('TikTok chunk already uploaded, skipping', { chunkIndex: chunkIndex + 1, totalChunks });
      return;
    }

    const startByte = chunkIndex * CHUNK_SIZE_BYTES;
    const endByte = Math.min(startByte + chunkData.length - 1, totalFileSize - 1);

    try {
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Range': `bytes ${startByte}-${endByte}/${totalFileSize}`,
          'Content-Length': String(chunkData.length),
        },
        body: chunkData,
      });

      if (!response.ok && response.status !== 206) {
        const text = await response.text();
        throw new Error(
          `Chunk ${chunkIndex + 1}/${totalChunks} upload failed (${response.status}): ${text}`,
        );
      }

      // Mark chunk as confirmed, update last successful chunk index, and refresh TTL
      await redis.hset(progressKey, String(chunkIndex), '1');
      await redis.hset(progressKey, LAST_CHUNK_FIELD, String(chunkIndex));
      await redis.expire(progressKey, UPLOAD_PROGRESS_TTL);

      logger.info('TikTok chunk uploaded', { chunkIndex: chunkIndex + 1, totalChunks });
    } catch (error) {
      // Clean up progress key on failure
      await redis.del(progressKey);
      logger.error('TikTok chunk upload failed, progress cleaned up', {
        chunkIndex: chunkIndex + 1,
        totalChunks,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Retrieve the last successfully uploaded chunk index for a session.
   * Returns -1 when no chunks have been confirmed yet.
   */
  public async getLastUploadedChunk(uploadSessionId: string): Promise<number> {
    const redis = getRedis();
    const progressKey = `${UPLOAD_PROGRESS_PREFIX}${uploadSessionId}`;
    const value = await redis.hget(progressKey, LAST_CHUNK_FIELD);
    return value !== null ? Number(value) : -1;
  }

  /**
   * Persist upload session metadata (publishId, uploadUrl, chunk dimensions)
   * under a stable caller-supplied key so that a retried job can resume the
   * same TikTok upload session instead of initiating a new one.
   */
  public async storeUploadSession(
    sessionKey: string,
    data: { publishId: string; uploadUrl: string; chunkSize: number; totalChunks: number },
  ): Promise<void> {
    const redis = getRedis();
    const key = `${UPLOAD_SESSION_PREFIX}${sessionKey}`;
    await redis.hmset(key, {
      publishId: data.publishId,
      uploadUrl: data.uploadUrl,
      chunkSize: String(data.chunkSize),
      totalChunks: String(data.totalChunks),
    });
    await redis.expire(key, UPLOAD_PROGRESS_TTL);
  }

  /**
   * Retrieve a previously stored upload session.
   * Returns null when no session exists for the given key.
   */
  public async getUploadSession(sessionKey: string): Promise<{
    publishId: string;
    uploadUrl: string;
    chunkSize: number;
    totalChunks: number;
  } | null> {
    const redis = getRedis();
    const key = `${UPLOAD_SESSION_PREFIX}${sessionKey}`;
    const data = await redis.hgetall(key);
    if (!data || !data.publishId) return null;
    return {
      publishId: data.publishId,
      uploadUrl: data.uploadUrl,
      chunkSize: Number(data.chunkSize),
      totalChunks: Number(data.totalChunks),
    };
  }

  /**
   * Clear upload session metadata for a completed or abandoned upload.
   */
  public async clearUploadSession(sessionKey: string): Promise<void> {
    await getRedis().del(`${UPLOAD_SESSION_PREFIX}${sessionKey}`);
  }

  /**
   * Clear upload progress tracking for a completed or abandoned session.
   */
  public async clearUploadProgress(uploadSessionId: string): Promise<void> {
    await getRedis().del(`${UPLOAD_PROGRESS_PREFIX}${uploadSessionId}`);
  }

  /**
   * Upload a video from a public URL (no chunking needed).
   */
  public async uploadVideoFromUrl(
    accessToken: string,
    request: TikTokVideoUploadRequest,
  ): Promise<{ publishId: string }> {
    return circuitBreakerService.execute(
      'tiktok',
      async () => {
        const body = {
          post_info: {
            title: request.title,
            description: request.description || '',
            privacy_level: request.privacyLevel || 'SELF_ONLY',
            disable_duet: request.disableDuet ?? false,
            disable_comment: request.disableComment ?? false,
            disable_stitch: request.disableStitch ?? false,
            video_cover_timestamp_ms: request.videoCoverTimestampMs ?? 1000,
          },
          source_info: {
            source: 'PULL_FROM_URL',
            video_url: request.videoSource,
          },
        };

        const response = await fetchWithRetry(TIKTOK_VIDEO_INIT_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(`TikTok URL video upload failed: ${JSON.stringify(err)}`);
        }

        const data = (await response.json()) as any;
        if (data.error?.code !== 'ok') {
          throw new Error(`TikTok URL video upload error: ${data.error?.message}`);
        }

        logger.info('TikTok video upload from URL initiated', { publishId: data.data.publish_id });
        return { publishId: data.data.publish_id };
      },
      async () => {
        throw new Error('TikTok API temporarily unavailable');
      },
    );
  }

  // ─── Video Status ─────────────────────────────────────────────────────────

  /**
   * Poll the processing status of an uploaded video.
   */
  public async getVideoStatus(accessToken: string, publishId: string): Promise<TikTokVideoStatus> {
    return circuitBreakerService.execute(
      'tiktok',
      async () => {
        const response = await fetchWithRetry(TIKTOK_VIDEO_STATUS_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
          },
          body: JSON.stringify({ publish_id: publishId }),
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(`Failed to fetch TikTok video status: ${JSON.stringify(err)}`);
        }

        const data = (await response.json()) as any;
        const d = data.data;

        return {
          publishId,
          status: d.status,
          failReason: d.fail_reason,
          publiclyAvailable: d.publicly_available,
          shareUrl: d.share_url,
        };
      },
      async () => {
        throw new Error('TikTok API temporarily unavailable');
      },
    );
  }

  /**
   * Circuit breaker status for health checks.
   */
  public getCircuitStatus() {
    return circuitBreakerService.getStats('tiktok');
  }
}

export const tiktokService = new TikTokService();
