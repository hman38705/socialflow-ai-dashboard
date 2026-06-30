import { circuitBreakerService } from './CircuitBreakerService';
import { LockService } from '../utils/LockService';
import { createLogger } from '../lib/logger';
import { DegradedResponse, degraded } from '../types/degraded';

export { isDegraded } from '../types/degraded';

const logger = createLogger('facebook-service');

/**
 * Facebook API Response Types
 */
export interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
  category?: string;
  picture?: {
    data: {
      url: string;
    };
  };
}

export interface FacebookPagePost {
  id: string;
  message?: string;
  created_time: string;
  permalink_url?: string;
}

export interface FacebookTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  pages: FacebookPage[];
}

export interface FacebookPostRequest {
  pageId: string;
  message: string;
  imageUrl?: string;
  scheduledTime?: Date;
}

export interface FacebookComment {
  id: string;
  message: string;
  from: {
    id: string;
    name: string;
  };
  created_time: string;
}

const FB_API_VERSION = process.env.FACEBOOK_API_VERSION ?? 'v18.0';
const API_BASE = `https://graph.facebook.com/${FB_API_VERSION}`;
// OAUTH_TOKEN_URL reserved for future token exchange implementation
const _OAUTH_TOKEN_URL = `https://graph.facebook.com/${FB_API_VERSION}/oauth/access_token`;
const FACEBOOK_AUTH_URL = `https://www.facebook.com/${FB_API_VERSION}/dialog/oauth`;

/** How long before `expiresAt` a token is proactively refreshed. Default: 7 days. */
const REFRESH_WINDOW_MS = Number(
  process.env.FACEBOOK_TOKEN_REFRESH_WINDOW_MS ?? 7 * 24 * 60 * 60 * 1000,
);

/**
 * Thrown when a Facebook token is past (or near) expiry and the proactive
 * refresh attempt itself fails. Callers should treat this as a signal to
 * prompt the user to re-authenticate, rather than a generic API failure.
 */
export class AuthRefreshError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'AuthRefreshError';
  }
}

logger.info(`FacebookService using Graph API version ${FB_API_VERSION}`);

class FacebookService {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly redirectUri: string;

  constructor() {
    this.appId = process.env.FACEBOOK_APP_ID || '';
    this.appSecret = process.env.FACEBOOK_APP_SECRET || '';
    this.redirectUri =
      process.env.FACEBOOK_REDIRECT_URI || 'http://localhost:3000/api/facebook/callback';
  }

  public isConfigured(): boolean {
    return !!this.appId && !!this.appSecret;
  }

  /**
   * Step 1: Build the Facebook OAuth2 authorization URL
   * Handles both user login and page access token retrieval
   */
  public getAuthUrl(): string {
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'pages_manage_posts,pages_read_engagement,pages_manage_metadata',
      auth_type: 'rerequest',
    });
    return `${FACEBOOK_AUTH_URL}?${params}`;
  }

  /**
   * Step 2: Exchange authorization code for user access token
   */
  public async exchangeCode(code: string): Promise<{ userAccessToken: string; expiresAt: number }> {
    const params = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appSecret,
      redirect_uri: this.redirectUri,
      code,
    });

    const response = await fetch(`${API_BASE}/oauth/access_token?${params}`);

    if (!response.ok) {
      const err = await response.json();
      throw new Error(`Facebook OAuth token exchange failed: ${JSON.stringify(err)}`);
    }

    const data = (await response.json()) as any;
    return {
      userAccessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    };
  }

  /**
   * Step 3: Get long-lived user access token (optional, for better token management)
   */
  public async getLongLivedUserToken(
    shortLivedToken: string,
  ): Promise<{ accessToken: string; expiresAt: number }> {
    const params = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appSecret,
      fb_exchange_token: shortLivedToken,
      grant_type: 'fb_exchange_token',
    });

    const response = await fetch(`${API_BASE}/oauth/access_token?${params}`);

    if (!response.ok) {
      const err = await response.json();
      throw new Error(`Facebook long-lived token exchange failed: ${JSON.stringify(err)}`);
    }

    const data = (await response.json()) as any;
    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 5184000) * 1000, // 60 days default
    };
  }

  /**
   * Proactively refresh a long-lived token if it is within REFRESH_WINDOW_MS
   * of expiring. Call this before any Graph API call that uses a stored
   * user token. Throws AuthRefreshError (instead of a generic Graph API
   * error) if the refresh attempt itself fails, so callers can prompt the
   * user to re-authenticate.
   */
  public async ensureFreshToken(tokens: FacebookTokens): Promise<FacebookTokens> {
    if (tokens.expiresAt - Date.now() >= REFRESH_WINDOW_MS) {
      return tokens;
    }
    try {
      const refreshed = await this.getLongLivedUserToken(tokens.accessToken);
      return { ...tokens, accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt };
    } catch (err) {
      throw new AuthRefreshError('Failed to refresh Facebook access token', err);
    }
  }

  /**
   * Step 4: Get list of pages the user manages with page access tokens
   */
  public async getUserPages(userAccessToken: string): Promise<FacebookPage[]> {
    return circuitBreakerService.execute(
      'facebook',
      async () => {
        const params = new URLSearchParams({
          fields: 'id,name,access_token,category,picture.width(200).height(200)',
          access_token: userAccessToken,
        });

        const response = await fetch(`${API_BASE}/me/accounts?${params}`);

        if (!response.ok) {
          const err = await response.json();
          throw new Error(`Failed to fetch Facebook pages: ${JSON.stringify(err)}`);
        }

        const data = (await response.json()) as any;
        return data.data || [];
      },
      async () => {
        logger.warn('Facebook circuit breaker open, page fetch skipped');
        throw new Error('Facebook API temporarily unavailable');
      },
    );
  }

  /**
   * Get a specific page's access token (for cross-platform token handling)
   */
  public async getPageAccessToken(userAccessToken: string, pageId: string): Promise<string> {
    return circuitBreakerService.execute(
      'facebook',
      async () => {
        const params = new URLSearchParams({
          fields: 'access_token',
          access_token: userAccessToken,
        });

        const response = await fetch(`${API_BASE}/${pageId}?${params}`);

        if (!response.ok) {
          const err = await response.json();
          throw new Error(`Failed to fetch page access token: ${JSON.stringify(err)}`);
        }

        const data = (await response.json()) as any;
        return data.access_token;
      },
      async () => {
        throw new Error('Facebook API temporarily unavailable');
      },
    );
  }

  /**
   * Post text or image content to a Facebook Page
   */
  public async postToPage(request: FacebookPostRequest): Promise<FacebookPagePost> {
    return LockService.withLock(`facebook:post:${request.pageId}`, async () => {
      return circuitBreakerService.execute(
        'facebook',
        async () => {
          const pageAccessToken = request.imageUrl
            ? await this.getPageAccessTokenForPost(request.pageId)
            : await this.getPageAccessTokenForPost(request.pageId);

          const params = new URLSearchParams({
            message: request.message,
            access_token: pageAccessToken,
          });

          // Add image if provided
          if (request.imageUrl) {
            params.append('url', request.imageUrl);
          }

          // Handle scheduled posts
          if (request.scheduledTime) {
            params.append('published', 'false');
            params.append(
              'scheduled_publish_time',
              String(Math.floor(request.scheduledTime.getTime() / 1000)),
            );
          }

          const endpoint = request.imageUrl
            ? `${API_BASE}/${request.pageId}/photos`
            : `${API_BASE}/${request.pageId}/feed`;

          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params.toString(),
          });

          if (!response.ok) {
            const err = await response.json();
            throw new Error(`Failed to post to Facebook page: ${JSON.stringify(err)}`);
          }

          const data = (await response.json()) as any;

          // Get the permalink for the created post
          const permalink = await this.getPostPermalink(request.pageId, data.id, pageAccessToken);

          return {
            id: data.id,
            message: request.message,
            created_time: new Date().toISOString(),
            permalink_url: permalink,
          };
        },
        async () => {
          throw new Error('Facebook API temporarily unavailable. Post has been queued for retry.');
        },
      );
    });
  }

  /**
   * Get the permalink URL for a post
   */
  private async getPostPermalink(
    pageId: string,
    postId: string,
    accessToken: string,
  ): Promise<string | undefined> {
    try {
      const params = new URLSearchParams({
        fields: 'permalink_url',
        access_token: accessToken,
      });

      const response = await fetch(`${API_BASE}/${postId}?${params}`);
      if (response.ok) {
        const data = (await response.json()) as any;
        return data.permalink_url;
      }
    } catch (error) {
      logger.warn('Failed to get post permalink', { error });
    }
    return undefined;
  }

  /**
   * Get page access token from stored tokens (simplified for cross-platform handling)
   * In production, this would retrieve from database based on user/page mapping
   */
  private async getPageAccessTokenForPost(_pageId: string): Promise<string> {
    // This is a placeholder - in production, you'd store and retrieve page access tokens
    // from your database associated with the user
    throw new Error('Page access token not found. Please reconnect your Facebook account.');
  }

  /**
   * Get page access token with user token (for immediate posting).
   * Pass the full FacebookTokens (instead of a bare string) to enable
   * proactive refresh of a soon-to-expire token before the Graph API call.
   */
  public async postToPageWithUserToken(
    userAccessToken: string | FacebookTokens,
    request: FacebookPostRequest,
  ): Promise<FacebookPagePost> {
    const accessToken =
      typeof userAccessToken === 'string'
        ? userAccessToken
        : (await this.ensureFreshToken(userAccessToken)).accessToken;

    return circuitBreakerService.execute(
      'facebook',
      async () => {
        // Get the page access token first
        const pageAccessToken = await this.getPageAccessToken(accessToken, request.pageId);

        const params = new URLSearchParams({
          message: request.message,
          access_token: pageAccessToken,
        });

        // Add image if provided
        if (request.imageUrl) {
          params.append('url', request.imageUrl);
        }

        // Handle scheduled posts
        if (request.scheduledTime) {
          params.append('published', 'false');
          params.append(
            'scheduled_publish_time',
            String(Math.floor(request.scheduledTime.getTime() / 1000)),
          );
        }

        const endpoint = request.imageUrl
          ? `${API_BASE}/${request.pageId}/photos`
          : `${API_BASE}/${request.pageId}/feed`;

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(`Failed to post to Facebook page: ${JSON.stringify(err)}`);
        }

        const data = (await response.json()) as any;

        const permalink = await this.getPostPermalink(request.pageId, data.id, pageAccessToken);

        return {
          id: data.id,
          message: request.message,
          created_time: new Date().toISOString(),
          permalink_url: permalink,
        };
      },
      async () => {
        throw new Error('Facebook API temporarily unavailable. Post has been queued for retry.');
      },
    );
  }

  /**
   * Get comments for a post (for comment moderation)
   */
  public async getPostComments(
    pageId: string,
    postId: string,
    accessToken: string,
  ): Promise<FacebookComment[] | DegradedResponse<FacebookComment[]>> {
    return circuitBreakerService.execute(
      'facebook',
      async () => {
        const params = new URLSearchParams({
          fields: 'id,message,from,created_time',
          access_token: accessToken,
        });

        const response = await fetch(`${API_BASE}/${postId}/comments?${params}`);

        if (!response.ok) {
          const err = await response.json();
          throw new Error(`Failed to fetch comments: ${JSON.stringify(err)}`);
        }

        const data = (await response.json()) as any;
        return data.data || [];
      },
      async () => {
        logger.warn('Facebook circuit breaker open, comments fetch skipped');
        return degraded<FacebookComment[]>([], 'Facebook API temporarily unavailable');
      },
    );
  }

  /**
   * Reply to a comment
   */
  public async replyToComment(
    pageId: string,
    commentId: string,
    message: string,
    accessToken: string,
  ): Promise<{ id: string }> {
    return circuitBreakerService.execute(
      'facebook',
      async () => {
        const params = new URLSearchParams({
          message,
          access_token: accessToken,
        });

        const response = await fetch(`${API_BASE}/${commentId}/comments`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(`Failed to reply to comment: ${JSON.stringify(err)}`);
        }

        return (await response.json()) as { id: string };
      },
      async () => {
        throw new Error('Facebook API temporarily unavailable');
      },
    );
  }

  /**
   * Delete a comment (for moderation)
   */
  public async deleteComment(commentId: string, accessToken: string): Promise<boolean> {
    return circuitBreakerService.execute(
      'facebook',
      async () => {
        const params = new URLSearchParams({
          access_token: accessToken,
        });

        const response = await fetch(`${API_BASE}/${commentId}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });

        return response.ok;
      },
      async () => {
        throw new Error('Facebook API temporarily unavailable');
      },
    );
  }

  /**
   * Get page insights (for analytics)
   */
  public async getPageInsights(
    pageId: string,
    accessToken: string,
    metrics: string[] = ['page_impressions', 'page_engagement', 'page_fan_count'],
  ): Promise<any | DegradedResponse<{ data: never[] }>> {
    return circuitBreakerService.execute(
      'facebook',
      async () => {
        const params = new URLSearchParams({
          metrics: metrics.join(','),
          access_token: accessToken,
        });

        const response = await fetch(`${API_BASE}/${pageId}/insights?${params}`);

        if (!response.ok) {
          const err = await response.json();
          throw new Error(`Failed to fetch page insights: ${JSON.stringify(err)}`);
        }

        return await response.json();
      },
      async () => {
        logger.warn('Facebook circuit breaker open, insights fetch skipped');
        return degraded<{ data: never[] }>({ data: [] }, 'Facebook API temporarily unavailable');
      },
    );
  }

  /**
   * Health check for Facebook API
   */
  public async healthCheck(): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }

    try {
      const params = new URLSearchParams({
        client_id: this.appId,
        client_secret: this.appSecret,
        grant_type: 'client_credentials',
      });

      const response = await fetch(`${API_BASE}/oauth/access_token?${params}`);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get circuit breaker status
   */
  public getCircuitStatus() {
    return circuitBreakerService.getStats('facebook');
  }
}

export const facebookService = new FacebookService();
