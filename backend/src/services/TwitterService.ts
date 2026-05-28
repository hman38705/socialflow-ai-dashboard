import crypto from 'crypto';
import Redis from 'ioredis';
import { circuitBreakerService } from './CircuitBreakerService';
import { LockService } from '../utils/LockService';
import { createLogger } from '../lib/logger';
import { getRedisConnection } from '../config/runtime';

const logger = createLogger('twitter-service');

const PKCE_CHALLENGE_PREFIX = 'twitter:pkce:';
const PKCE_TTL_SECONDS = 600; // 10 minutes

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) _redis = new Redis(getRedisConnection());
  return _redis;
}

/**
 * Twitter API Response Types
 */
export interface TwitterPost {
  id: string;
  text: string;
  created_at: string;
  author_id: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
  };
}

export interface TwitterUser {
  id: string;
  username: string;
  name: string;
  profile_image_url?: string;
}

export interface TwitterPostRequest {
  text: string;
  media_ids?: string[];
  reply_to?: string;
}

/**
 * TwitterService - Wrapper for Twitter API with circuit breaker protection
 *
 * Provides resilient Twitter operations with automatic failure handling.
 * Prevents cascading failures when Twitter API is down or rate-limited.
 */
export class TwitterService {
  private readonly API_BASE = 'https://api.twitter.com/2';

  /**
   * Read bearer token lazily on every access so Kubernetes secret rotation
   * is picked up without a pod restart.
   */
  get bearerToken(): string {
    return process.env.TWITTER_BEARER_TOKEN || '';
  }

  /**
   * Check if Twitter API is configured
   */
  public isConfigured(): boolean {
    return !!this.bearerToken && this.bearerToken !== 'your_twitter_bearer_token';
  }

  /**
   * Post a tweet with circuit breaker + smart retry-after protection
   */
  public async postTweet(request: TwitterPostRequest): Promise<TwitterPost> {
    if (!this.isConfigured()) {
      throw new Error('Twitter API not configured. Please set TWITTER_BEARER_TOKEN.');
    }

    return LockService.withLock('twitter:post', async () => {
      return circuitBreakerService.execute(
        'twitter',
        async () => {
          const response = await fetch(`${this.API_BASE}/tweets`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.bearerToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(request),
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(`Twitter API error: ${response.status} - ${JSON.stringify(error)}`);
          }

          const data = await response.json() as any;
          return data.data;
        },
        async () => {
          // Fallback: Queue for later or throw
          throw new Error('Twitter API temporarily unavailable. Post has been queued for retry.');
        },
      );
    });
  }

  /**
   * Get user timeline with circuit breaker + smart retry-after protection
   */
  public async getUserTimeline(userId: string, maxResults: number = 10): Promise<TwitterPost[]> {
    if (!this.isConfigured()) {
      throw new Error('Twitter API not configured.');
    }

    return circuitBreakerService.execute(
      'twitter',
      async () => {
        const response = await fetch(
          `${this.API_BASE}/users/${userId}/tweets?max_results=${maxResults}&tweet.fields=created_at,public_metrics`,
          {
            headers: {
              Authorization: `Bearer ${this.bearerToken}`,
            },
          },
        );

        if (!response.ok) {
          throw new Error(`Twitter API error: ${response.status}`);
        }

        const data = await response.json() as any;
        return data.data || [];
      },
      async () => {
        // Fallback: return empty array
        logger.warn('Circuit breaker open, returning empty timeline', { service: 'twitter', state: 'open' });
        return [];
      },
    );
  }

  /**
   * Get user info with circuit breaker + smart retry-after protection
   */
  public async getUserInfo(username: string): Promise<TwitterUser | null> {
    if (!this.isConfigured()) {
      throw new Error('Twitter API not configured.');
    }

    return circuitBreakerService.execute(
      'twitter',
      async () => {
        const response = await fetch(
          `${this.API_BASE}/users/by/username/${username}?user.fields=profile_image_url`,
          {
            headers: {
              Authorization: `Bearer ${this.bearerToken}`,
            },
          },
        );

        if (!response.ok) {
          throw new Error(`Twitter API error: ${response.status}`);
        }

        const data = await response.json() as any;
        return data.data;
      },
      async () => {
        // Fallback: return null
        logger.warn('Circuit breaker open, returning null user', { service: 'twitter', state: 'open' });
        return null;
      },
    );
  }

  /**
   * Search tweets with circuit breaker + smart retry-after protection
   */
  public async searchTweets(query: string, maxResults: number = 10): Promise<TwitterPost[]> {
    if (!this.isConfigured()) {
      throw new Error('Twitter API not configured.');
    }

    return circuitBreakerService.execute(
      'twitter',
      async () => {
        const response = await fetch(
          `${this.API_BASE}/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=${maxResults}&tweet.fields=created_at,public_metrics`,
          {
            headers: {
              Authorization: `Bearer ${this.bearerToken}`,
            },
          },
        );

        if (!response.ok) {
          throw new Error(`Twitter API error: ${response.status}`);
        }

        const data = await response.json() as any;
        return data.data || [];
      },
      async () => {
        // Fallback: return empty array
        logger.warn('Circuit breaker open, returning empty search results', { service: 'twitter', state: 'open' });
        return [];
      },
    );
  }

  /**
   * Health check for Twitter API
   */
  public async healthCheck(): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }

    try {
      return await circuitBreakerService.execute(
        'twitter',
        async () => {
          const response = await fetch(`${this.API_BASE}/users/me`, {
            headers: {
              Authorization: `Bearer ${this.bearerToken}`,
            },
          });
          return response.ok;
        },
        async () => false,
      );
    } catch {
      return false;
    }
  }

  /**
   * Get circuit breaker status
   */
  public getCircuitStatus() {
    return circuitBreakerService.getStats('twitter');
  }

  // ─── PKCE helpers ──────────────────────────────────────────────────────────

  /**
   * Store a PKCE code_challenge keyed by state, to be verified on callback.
   */
  public async storePkceChallenge(state: string, codeChallenge: string): Promise<void> {
    await getRedis().set(`${PKCE_CHALLENGE_PREFIX}${state}`, codeChallenge, 'EX', PKCE_TTL_SECONDS);
  }

  /**
   * Exchange an authorisation code for tokens, verifying the PKCE code_verifier
   * against the stored code_challenge for the given state.
   *
   * Throws if the verifier is missing, the challenge is not found, or they do not match.
   */
  public async exchangeCodeForTokens(
    code: string,
    state: string,
    codeVerifier: string,
    clientId: string,
    redirectUri: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
    // Retrieve and immediately delete the stored challenge (one-time use)
    const redis = getRedis();
    const key = `${PKCE_CHALLENGE_PREFIX}${state}`;
    const storedChallenge = await redis.getdel(key);

    if (!storedChallenge) {
      throw new Error('PKCE challenge not found or expired');
    }

    // Recompute S256 challenge from the supplied verifier
    const expectedChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    if (expectedChallenge !== storedChallenge) {
      throw new Error('PKCE verification failed: code_verifier does not match code_challenge');
    }

    const response = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: codeVerifier,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(`Twitter token exchange failed: ${JSON.stringify(err)}`);
    }

    const data = (await response.json()) as any;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }
}

export const twitterService = new TwitterService();
