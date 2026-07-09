import { circuitBreakerService } from './CircuitBreakerService';
import { createLogger } from '../lib/logger';
import { DegradedResponse, degraded } from '../types/degraded';

export { isDegraded } from '../types/degraded';

const logger = createLogger('youtube-service');

export class YouTubeQuotaError extends Error {
  public readonly retryAfter: Date;
  constructor(retryAfter: Date) {
    super(`YouTube API quota exceeded. Quota resets at ${retryAfter.toISOString()}.`);
    this.name = 'YouTubeQuotaError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Parse a YouTube 403 quota-exceeded API error response and throw a
 * YouTubeQuotaError with the reset time, or re-throw the original error.
 */
function handleYouTubeError(status: number, body: any): never {
  if (status === 403) {
    const errors: any[] = body?.error?.errors ?? [];
    const isQuota = errors.some(
      (e) => e.domain === 'youtube.quota' || e.reason === 'quotaExceeded' || e.reason === 'dailyLimitExceeded',
    );
    if (isQuota) {
      // YouTube quota resets at midnight Pacific Time (UTC-7 / UTC-8).
      // The API does not return an exact reset timestamp, so we compute the
      // next midnight PT as the best available estimate.
      const resetTime = nextMidnightPacific();
      throw new YouTubeQuotaError(resetTime);
    }
  }
  throw new Error(`YouTube API error: ${status} — ${JSON.stringify(body)}`);
}

function nextMidnightPacific(): Date {
  // Pacific Standard Time is UTC-8; Pacific Daylight Time is UTC-7.
  // We use a fixed -8 offset as a conservative estimate (quota always resets
  // by midnight PST at the latest).
  const nowUtc = Date.now();
  const pacificOffsetMs = 8 * 60 * 60 * 1000; // UTC-8
  const nowPacific = new Date(nowUtc - pacificOffsetMs);
  const midnightPacific = new Date(
    Date.UTC(
      nowPacific.getUTCFullYear(),
      nowPacific.getUTCMonth(),
      nowPacific.getUTCDate() + 1, // next day
    ) + pacificOffsetMs,
  );
  return midnightPacific;
}

export interface YouTubeVideoStats {
  videoId: string;
  title: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  channelId: string;
  channelTitle: string;
}

export interface YouTubeChannel {
  id: string;
  title: string;
  subscriberCount: number;
  videoCount: number;
  viewCount: number;
}

export interface YouTubeTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

class YouTubeService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;

  constructor() {
    this.clientId = process.env.YOUTUBE_CLIENT_ID || '';
    this.clientSecret = process.env.YOUTUBE_CLIENT_SECRET || '';
    this.redirectUri =
      process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:3000/api/youtube/callback';
  }

  public isConfigured(): boolean {
    return !!this.clientId && !!this.clientSecret;
  }

  /** Step 1: Build the Google OAuth2 authorization URL */
  public getAuthUrl(): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/youtube.readonly',
      access_type: 'offline',
      prompt: 'consent',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  /** Step 2: Exchange authorization code for tokens */
  public async exchangeCode(code: string): Promise<YouTubeTokens> {
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(`OAuth token exchange failed: ${JSON.stringify(err)}`);
    }

    const data = (await response.json()) as any;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  /** Refresh an expired access token */
  public async refreshAccessToken(refreshToken: string): Promise<YouTubeTokens> {
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(`Token refresh failed: ${JSON.stringify(err)}`);
    }

    const data = (await response.json()) as any;
    return {
      accessToken: data.access_token,
      refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  /** Fetch channel info for the authenticated user */
  public async getChannel(accessToken: string): Promise<YouTubeChannel> {
    return circuitBreakerService.execute(
      'youtube',
      async () => {
        const params = new URLSearchParams({
          part: 'snippet,statistics',
          mine: 'true',
        });
        const response = await fetch(`${API_BASE}/channels?${params}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          handleYouTubeError(response.status, body);
        }

        const data = (await response.json()) as any;
        const ch = data.items?.[0];
        if (!ch) throw new Error('No channel found for this account');

        return {
          id: ch.id,
          title: ch.snippet.title,
          subscriberCount: Number(ch.statistics.subscriberCount ?? 0),
          videoCount: Number(ch.statistics.videoCount ?? 0),
          viewCount: Number(ch.statistics.viewCount ?? 0),
        };
      },
      async () => {
        logger.warn('YouTube circuit breaker open, channel fetch skipped');
        throw new Error('YouTube API temporarily unavailable');
      },
    );
  }

  /** Fetch statistics for a list of video IDs */
  public async getVideoStats(
    accessToken: string,
    videoIds: string[],
  ): Promise<YouTubeVideoStats[] | DegradedResponse<YouTubeVideoStats[]>> {
    if (!videoIds.length) return [];

    return circuitBreakerService.execute(
      'youtube',
      async () => {
        const params = new URLSearchParams({
          part: 'snippet,statistics',
          id: videoIds.join(','),
        });
        const response = await fetch(`${API_BASE}/videos?${params}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          handleYouTubeError(response.status, body);
        }

        const data = (await response.json()) as any;
        return (data.items ?? []).map((item: any) => ({
          videoId: item.id,
          title: item.snippet.title,
          publishedAt: item.snippet.publishedAt,
          viewCount: Number(item.statistics.viewCount ?? 0),
          likeCount: Number(item.statistics.likeCount ?? 0),
          commentCount: Number(item.statistics.commentCount ?? 0),
          channelId: item.snippet.channelId,
          channelTitle: item.snippet.channelTitle,
        }));
      },
      async () => {
        logger.warn('YouTube circuit breaker open, returning degraded video stats');
        return degraded<YouTubeVideoStats[]>([], 'YouTube API temporarily unavailable');
      },
    );
  }

  /** List all videos for the authenticated channel, paginating through all pages */
  public async listChannelVideos(
    accessToken: string,
    pageDelayMs = 500,
  ): Promise<string[] | DegradedResponse<string[]>> {
    return circuitBreakerService.execute<string[] | DegradedResponse<string[]>>(
      'youtube',
      async () => {
        const allVideoIds: string[] = [];
        let pageToken: string | undefined;

        do {
          const params = new URLSearchParams({
            part: 'id',
            forMine: 'true',
            type: 'video',
            maxResults: '50',
          });
          if (pageToken) params.set('pageToken', pageToken);

          const response = await fetch(`${API_BASE}/search?${params}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });

          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            handleYouTubeError(response.status, body);
          }

          const data = (await response.json()) as any;
          const ids = (data.items ?? []).map((item: any) => item.id.videoId as string);
          allVideoIds.push(...ids);

          pageToken = data.nextPageToken;

          if (pageToken) {
            await new Promise((r) => setTimeout(r, pageDelayMs));
          }
        } while (pageToken);

        logger.info('YouTube channel videos listed', { totalCount: allVideoIds.length });
        return allVideoIds;
      },
      async () => {
        logger.warn('YouTube circuit breaker open, returning degraded video list');
        return degraded<string[]>([], 'YouTube API temporarily unavailable');
      },
    );
  }

  public getCircuitStatus() {
    return circuitBreakerService.getStats('youtube');
  }
}

export const youTubeService = new YouTubeService();
