import { circuitBreakerService } from './CircuitBreakerService';
import { createLogger } from '../lib/logger';
import { ValidationError, RateLimitError } from '../lib/errors';

/**
 * Parse a `Retry-After` header value into seconds.
 * Per HTTP spec it's either an integer number of seconds, or an HTTP-date.
 */
function parseRetryAfterSeconds(header: string | null): number | undefined {
  if (!header) return undefined;
  const asSeconds = Number(header);
  if (!Number.isNaN(asSeconds)) return Math.max(0, asSeconds);
  const asDate = Date.parse(header);
  if (!Number.isNaN(asDate)) {
    return Math.max(0, Math.round((asDate - Date.now()) / 1000));
  }
  return undefined;
}

/** Throw a RateLimitError (with parsed Retry-After) for 429 responses; no-op otherwise. */
function throwIfRateLimited(response: Response): void {
  if (response.status !== 429) return;
  const retryAfter = parseRetryAfterSeconds(response.headers.get('retry-after'));
  throw new RateLimitError('LinkedIn API rate limit exceeded', retryAfter, 'LINKEDIN_RATE_LIMIT');
}

const logger = createLogger('linkedin-service');

const API_BASE = 'https://api.linkedin.com/v2';
const AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';

export interface LinkedInTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export interface LinkedInProfile {
  id: string;
  localizedFirstName: string;
  localizedLastName: string;
  vanityName?: string;
}

/** Maximum number of images allowed in a single LinkedIn multi-image post */
export const LINKEDIN_MAX_IMAGES = 20;

export interface LinkedInMediaAsset {
  /** Publicly accessible URL of the image */
  url: string;
  /** Optional alt-text / caption for the image */
  title?: string;
  description?: string;
}

export interface LinkedInShareRequest {
  /** URN of the author — either a person URN or organization URN */
  authorUrn: string;
  text: string;
  /** Optional URL to attach as a link share (ignored when mediaAssets is provided) */
  url?: string;
  title?: string;
  description?: string;
  visibility?: 'PUBLIC' | 'CONNECTIONS';
  /**
   * Up to 20 image assets for a multi-image (carousel) post.
   * When provided, takes precedence over `url`.
   * Throws a ValidationError if more than LINKEDIN_MAX_IMAGES items are supplied.
   */
  mediaAssets?: LinkedInMediaAsset[];
}

export interface LinkedInShareResult {
  id: string;
  activity: string;
}

export interface LinkedInPostStats {
  likeCount: number;
  commentCount: number;
  shareCount: number;
  impressionCount: number;
  clickCount: number;
}

class LinkedInService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;

  constructor() {
    this.clientId = process.env.LINKEDIN_CLIENT_ID || '';
    this.clientSecret = process.env.LINKEDIN_CLIENT_SECRET || '';
    this.redirectUri =
      process.env.LINKEDIN_REDIRECT_URI || 'http://localhost:3001/api/v1/linkedin/callback';
  }

  public isConfigured(): boolean {
    return !!this.clientId && !!this.clientSecret;
  }

  /**
   * Step 1 — Build the LinkedIn OAuth 2.0 Three-Legged authorization URL.
   * Scopes: r_liteprofile, r_emailaddress, w_member_social
   */
  public getAuthUrl(state: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      state,
      scope: 'r_liteprofile r_emailaddress w_member_social',
    });
    return `${AUTH_URL}?${params}`;
  }

  /**
   * Step 2 — Exchange authorization code for access token.
   */
  public async exchangeCode(code: string): Promise<LinkedInTokens> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      throwIfRateLimited(response);
      const err = await response.json();
      throw new Error(`LinkedIn token exchange failed: ${JSON.stringify(err)}`);
    }

    const data = (await response.json()) as any;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in || 5183944) * 1000,
    };
  }

  /**
   * Get the authenticated member's basic profile.
   * Returns a person URN usable as `authorUrn` in shareContent.
   */
  public async getProfile(accessToken: string): Promise<LinkedInProfile> {
    return circuitBreakerService.execute(
      'linkedin' as any,
      async () => {
        const response = await fetch(
          `${API_BASE}/me?projection=(id,localizedFirstName,localizedLastName,vanityName)`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );

        if (!response.ok) {
          throwIfRateLimited(response);
          throw new Error(`LinkedIn profile fetch failed: ${response.status}`);
        }

        return (await response.json()) as LinkedInProfile;
      },
      async () => {
        throw new Error('LinkedIn API temporarily unavailable');
      },
    );
  }

  /**
   * Share a text post (UGC Post) on behalf of a member or organization.
   * `authorUrn` must be a URN, e.g. `urn:li:person:{id}` or `urn:li:organization:{id}`.
   *
   * Supports three content modes:
   *  - Text-only: no `url` and no `mediaAssets`
   *  - Link share: `url` provided (and no `mediaAssets`)
   *  - Multi-image: `mediaAssets` array with 1–20 items
   */
  public async shareContent(
    accessToken: string,
    request: LinkedInShareRequest,
  ): Promise<LinkedInShareResult> {
    // Validate image count before hitting the network
    if (request.mediaAssets !== undefined) {
      if (request.mediaAssets.length === 0) {
        throw new ValidationError(
          'mediaAssets must contain at least one image',
          undefined,
          'INVALID_PAYLOAD',
        );
      }
      if (request.mediaAssets.length > LINKEDIN_MAX_IMAGES) {
        throw new ValidationError(
          `LinkedIn allows a maximum of ${LINKEDIN_MAX_IMAGES} images per post, but ${request.mediaAssets.length} were provided`,
          undefined,
          'INVALID_PAYLOAD',
        );
      }

      await this.validateMediaAssetUrls(request.mediaAssets);
    }

    return circuitBreakerService.execute(
      'linkedin' as any,
      async () => {
        const shareContent = this.buildShareContent(request);

        const body: Record<string, any> = {
          author: request.authorUrn,
          lifecycleState: 'PUBLISHED',
          specificContent: {
            'com.linkedin.ugc.ShareContent': shareContent,
          },
          visibility: {
            'com.linkedin.ugc.MemberNetworkVisibility': request.visibility ?? 'PUBLIC',
          },
        };

        const response = await fetch(`${API_BASE}/ugcPosts`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          throwIfRateLimited(response);
          const err = await response.json();
          throw new Error(`LinkedIn share failed: ${JSON.stringify(err)}`);
        }

        // LinkedIn returns the post URN in the X-RestLi-Id header
        const postUrn = response.headers.get('x-restli-id') || '';
        return { id: postUrn, activity: postUrn };
      },
      async () => {
        throw new Error('LinkedIn API temporarily unavailable. Post has been queued for retry.');
      },
    );
  }

  private async validateMediaAssetUrls(mediaAssets: LinkedInMediaAsset[]): Promise<void> {
    await Promise.all(
      mediaAssets.map(async (asset) => {
        let response: Response;
        try {
          response = await fetch(asset.url, { method: 'HEAD' });
        } catch {
          throw new ValidationError(
            `LinkedIn image URL is not publicly accessible: ${asset.url}`,
            undefined,
            'INVALID_MEDIA_ASSET',
          );
        }

        if (!response.ok) {
          throw new ValidationError(
            `LinkedIn image URL is not publicly accessible: ${asset.url} returned ${response.status}`,
            undefined,
            'INVALID_MEDIA_ASSET',
          );
        }
      }),
    );
  }

  /**
   * Build the `com.linkedin.ugc.ShareContent` object for the UGC post body.
   * Extracted for testability.
   */
  public buildShareContent(request: LinkedInShareRequest): Record<string, any> {
    const commentary = { text: request.text };

    // Multi-image post (IMAGE category with multiple media items)
    if (request.mediaAssets && request.mediaAssets.length > 0) {
      return {
        shareCommentary: commentary,
        shareMediaCategory: 'IMAGE',
        media: request.mediaAssets.map((asset) => ({
          status: 'READY',
          originalUrl: asset.url,
          ...(asset.title ? { title: { text: asset.title } } : {}),
          ...(asset.description ? { description: { text: asset.description } } : {}),
        })),
      };
    }

    // Link share
    if (request.url) {
      return {
        shareCommentary: commentary,
        shareMediaCategory: 'ARTICLE',
        media: [
          {
            status: 'READY',
            originalUrl: request.url,
            title: { text: request.title || '' },
            description: { text: request.description || '' },
          },
        ],
      };
    }

    // Text-only post
    return {
      shareCommentary: commentary,
      shareMediaCategory: 'NONE',
    };
  }

  /**
   * Retrieve engagement statistics for a UGC post.
   * `postUrn` is the URN returned by shareContent (URL-encoded for the query).
   */
  public async getPostStats(
    accessToken: string,
    postUrn: string,
  ): Promise<LinkedInPostStats> {
    return circuitBreakerService.execute(
      'linkedin' as any,
      async () => {
        const encoded = encodeURIComponent(postUrn);
        const response = await fetch(
          `${API_BASE}/socialActions/${encoded}?projection=(likesSummary,commentsSummary,shareStatistics)`,
          { headers: { Authorization: `Bearer ${accessToken}`, 'X-Restli-Protocol-Version': '2.0.0' } },
        );

        if (!response.ok) {
          throwIfRateLimited(response);
          throw new Error(`LinkedIn stats fetch failed: ${response.status}`);
        }

        const data = (await response.json()) as any;
        return {
          likeCount: data.likesSummary?.totalLikes ?? 0,
          commentCount: data.commentsSummary?.totalFirstLevelComments ?? 0,
          shareCount: data.shareStatistics?.shareCount ?? 0,
          impressionCount: data.shareStatistics?.impressionCount ?? 0,
          clickCount: data.shareStatistics?.clickCount ?? 0,
        };
      },
      async () => {
        logger.warn('LinkedIn circuit breaker open, returning empty stats');
        return { likeCount: 0, commentCount: 0, shareCount: 0, impressionCount: 0, clickCount: 0 };
      },
    );
  }

  public async healthCheck(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const response = await fetch(`${API_BASE}/me`, {
        headers: { Authorization: `Bearer __probe__` },
      });
      // 401 means the API is reachable; any network error means it's not
      return response.status !== 0;
    } catch {
      return false;
    }
  }

  public getCircuitStatus() {
    return circuitBreakerService.getStats('linkedin' as any);
  }
}

export const linkedInService = new LinkedInService();
