import { circuitBreakerService } from './CircuitBreakerService';
import { createLogger } from '../lib/logger';
import { ServiceUnavailableError } from '../lib/errors';

const logger = createLogger('instagram-service');

const FB_API_VERSION = process.env.FACEBOOK_API_VERSION ?? 'v18.0';
const API_BASE = `https://graph.facebook.com/${FB_API_VERSION}`;

logger.info(`InstagramService using Graph API version ${FB_API_VERSION}`);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InstagramMediaType = 'IMAGE' | 'VIDEO' | 'REELS' | 'CAROUSEL';

/** Supported image aspect ratios per Instagram spec */
const VALID_IMAGE_RATIOS = [
  { label: '1:1', min: 0.99, max: 1.01 },
  { label: '4:5', min: 0.79, max: 0.81 },
  { label: '1.91:1', min: 1.9, max: 1.92 },
];

export interface InstagramAccount {
  id: string;
  name: string;
  username: string;
  biography?: string;
  followers_count?: number;
  media_count?: number;
}

export interface InstagramPublishRequest {
  /** Instagram Business Account ID */
  igAccountId: string;
  /** Page access token for the connected Facebook Page */
  accessToken: string;
  mediaType: InstagramMediaType;
  /** Publicly accessible URL for the image or video */
  mediaUrl: string;
  caption?: string;
  /** Required for REELS */
  shareToFeed?: boolean;
  /** For CAROUSEL — list of publicly accessible media URLs */
  carouselItems?: Array<{ mediaUrl: string; mediaType: 'IMAGE' | 'VIDEO' }>;
  /** Schedule publish time (must be 10 min – 75 days in the future) */
  scheduledPublishTime?: Date;
  /** Image width/height for aspect ratio validation (optional but recommended) */
  imageWidth?: number;
  imageHeight?: number;
}

export interface InstagramPublishResult {
  containerId: string;
  mediaId: string;
  permalink?: string;
  publishedAt: string;
}

export interface InstagramInsights {
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saved: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class InstagramService {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly redirectUri: string;

  constructor() {
    this.appId = process.env.FACEBOOK_APP_ID || '';
    this.appSecret = process.env.FACEBOOK_APP_SECRET || '';
    this.redirectUri =
      process.env.INSTAGRAM_REDIRECT_URI ||
      process.env.FACEBOOK_REDIRECT_URI ||
      'http://localhost:3000/api/instagram/callback';
  }

  public isConfigured(): boolean {
    return !!this.appId && !!this.appSecret;
  }

  /**
   * Build the Facebook Business Login OAuth URL.
   * Scopes required for Instagram Direct Publishing.
   */
  public getAuthUrl(): string {
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: [
        'instagram_basic',
        'instagram_content_publish',
        'instagram_manage_insights',
        'pages_show_list',
        'pages_read_engagement',
      ].join(','),
    });
    return `https://www.facebook.com/${FB_API_VERSION}/dialog/oauth?${params}`;
  }

  /**
   * Exchange OAuth code for a user access token.
   */
  public async exchangeCode(code: string): Promise<{ accessToken: string; expiresAt: number }> {
    const params = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appSecret,
      redirect_uri: this.redirectUri,
      code,
    });

    const res = await fetch(`${API_BASE}/oauth/access_token?${params}`);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(`Instagram OAuth token exchange failed: ${JSON.stringify(err)}`);
    }

    const data = (await res.json()) as any;
    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    };
  }

  /**
   * Retrieve the Instagram Business Account linked to a Facebook Page.
   */
  public async getIgAccount(pageId: string, pageAccessToken: string): Promise<InstagramAccount> {
    return circuitBreakerService.execute(
      'instagram',
      async () => {
        const params = new URLSearchParams({
          fields:
            'instagram_business_account{id,name,username,biography,followers_count,media_count}',
          access_token: pageAccessToken,
        });

        const res = await fetch(`${API_BASE}/${pageId}?${params}`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(`Failed to fetch Instagram account: ${JSON.stringify(err)}`);
        }

        const data = (await res.json()) as any;
        const iga = data.instagram_business_account;
        if (!iga) throw new Error('No Instagram Business Account linked to this Facebook Page.');
        return iga as InstagramAccount;
      },
      async () => {
        throw new Error('Instagram API temporarily unavailable');
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Container-based publish flow (required by Instagram Graph API)
  //
  //  Step 1 – createContainer()  → returns a container ID
  //  Step 2 – waitForContainer() → polls until container status is FINISHED
  //  Step 3 – publishContainer() → publishes the container, returns media ID
  // ---------------------------------------------------------------------------

  /**
   * Full publish flow: validates, creates container, waits, then publishes.
   */
  public async publish(req: InstagramPublishRequest): Promise<InstagramPublishResult> {
    this.validateRequest(req);

    return circuitBreakerService.execute(
      'instagram',
      async () => {
        let containerId: string;

        if (req.mediaType === 'CAROUSEL') {
          containerId = await this.createCarouselContainer(req);
        } else {
          containerId = await this.createContainer(req);
        }

        await this.waitForContainer(req.igAccountId, containerId, req.accessToken);

        const mediaId = await this.publishContainer(
          req.igAccountId,
          containerId,
          req.accessToken,
          req.scheduledPublishTime,
        );

        const permalink = await this.getPermalink(mediaId, req.accessToken);

        logger.info('Instagram media published', {
          igAccountId: req.igAccountId,
          mediaId,
          mediaType: req.mediaType,
        });

        return {
          containerId,
          mediaId,
          permalink,
          publishedAt: new Date().toISOString(),
        };
      },
      async () => {
        throw new Error('Instagram API temporarily unavailable. Please retry later.');
      },
    );
  }

  /**
   * Step 1a — Create a single-media container (IMAGE, VIDEO, REELS).
   */
  private async createContainer(req: InstagramPublishRequest): Promise<string> {
    const body: Record<string, string> = {
      access_token: req.accessToken,
    };

    if (req.mediaType === 'IMAGE') {
      body.image_url = req.mediaUrl;
      body.media_type = 'IMAGE';
    } else if (req.mediaType === 'VIDEO') {
      body.video_url = req.mediaUrl;
      body.media_type = 'VIDEO';
    } else if (req.mediaType === 'REELS') {
      body.video_url = req.mediaUrl;
      body.media_type = 'REELS';
      body.share_to_feed = req.shareToFeed ? 'true' : 'false';
    }

    if (req.caption) body.caption = req.caption;

    const res = await fetch(`${API_BASE}/${req.igAccountId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(`Failed to create Instagram media container: ${JSON.stringify(err)}`);
    }

    const data = (await res.json()) as any;
    logger.info('Instagram container created', {
      containerId: data.id,
      mediaType: req.mediaType,
    });
    return data.id;
  }

  /**
   * Step 1b — Create a CAROUSEL container (creates child containers first).
   */
  private async createCarouselContainer(req: InstagramPublishRequest): Promise<string> {
    if (!req.carouselItems?.length)
      throw new Error('carouselItems required for CAROUSEL media type');
    if (req.carouselItems.length < 2 || req.carouselItems.length > 10) {
      throw new Error('Carousel must have between 2 and 10 items');
    }

    // Create child containers in parallel
    const childIds = await Promise.all(
      req.carouselItems.map(async (item) => {
        const body: Record<string, string> = {
          access_token: req.accessToken,
          is_carousel_item: 'true',
        };
        if (item.mediaType === 'IMAGE') body.image_url = item.mediaUrl;
        else body.video_url = item.mediaUrl;
        body.media_type = item.mediaType;

        const res = await fetch(`${API_BASE}/${req.igAccountId}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(body).toString(),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(`Failed to create carousel child container: ${JSON.stringify(err)}`);
        }

        const data = (await res.json()) as any;
        return data.id as string;
      }),
    );

    // Create the parent carousel container
    const body = new URLSearchParams({
      media_type: 'CAROUSEL',
      children: childIds.join(','),
      access_token: req.accessToken,
      ...(req.caption ? { caption: req.caption } : {}),
    });

    const res = await fetch(`${API_BASE}/${req.igAccountId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(`Failed to create carousel container: ${JSON.stringify(err)}`);
    }

    const data = (await res.json()) as any;
    logger.info('Instagram carousel container created', {
      containerId: data.id,
      childCount: childIds.length,
    });
    return data.id;
  }

  /**
   * Step 2 — Poll container status until FINISHED (or error out).
   * Instagram requires this before publishing, especially for videos.
   *
   * Uses exponential backoff: delay = baseIntervalMs * 2^attempt (capped at 30 s).
   * Throws ServiceUnavailableError after maxRetries attempts.
   */
  private async waitForContainer(
    igAccountId: string,
    containerId: string,
    accessToken: string,
    maxRetries = 30,
    baseIntervalMs = 2000,
  ): Promise<void> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const params = new URLSearchParams({
        fields: 'status_code,status',
        access_token: accessToken,
      });

      const res = await fetch(`${API_BASE}/${containerId}?${params}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(`Failed to check container status: ${JSON.stringify(err)}`);
      }

      const data = (await res.json()) as any;
      const status: string = data.status_code;

      if (status === 'FINISHED') return;
      if (status === 'ERROR' || status === 'EXPIRED') {
        throw new Error(
          `Instagram container processing failed with status: ${status} — ${data.status}`,
        );
      }

      logger.info('Waiting for Instagram container', { containerId, status, attempt: attempt + 1, maxRetries });

      const delay = Math.min(baseIntervalMs * 2 ** attempt, 30_000);
      await new Promise((r) => setTimeout(r, delay));
    }

    throw new ServiceUnavailableError(
      `Instagram container ${containerId} did not finish processing after ${maxRetries} attempts`,
    );
  }

  /**
   * Step 3 — Publish the container to the Instagram feed.
   */
  private async publishContainer(
    igAccountId: string,
    containerId: string,
    accessToken: string,
    scheduledPublishTime?: Date,
  ): Promise<string> {
    const body: Record<string, string> = {
      creation_id: containerId,
      access_token: accessToken,
    };

    if (scheduledPublishTime) {
      body.published = 'false';
      body.scheduled_publish_time = String(Math.floor(scheduledPublishTime.getTime() / 1000));
    }

    const res = await fetch(`${API_BASE}/${igAccountId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(`Failed to publish Instagram container: ${JSON.stringify(err)}`);
    }

    const data = (await res.json()) as any;
    return data.id;
  }

  /**
   * Fetch media insights for a published post.
   */
  public async getInsights(mediaId: string, accessToken: string): Promise<InstagramInsights> {
    return circuitBreakerService.execute(
      'instagram',
      async () => {
        const params = new URLSearchParams({
          metric: 'impressions,reach,likes,comments,shares,saved',
          access_token: accessToken,
        });

        const res = await fetch(`${API_BASE}/${mediaId}/insights?${params}`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(`Failed to fetch Instagram insights: ${JSON.stringify(err)}`);
        }

        const data = (await res.json()) as any;
        const metrics: Record<string, number> = {};
        for (const item of data.data ?? []) {
          metrics[item.name] = item.values?.[0]?.value ?? 0;
        }

        return {
          impressions: metrics.impressions ?? 0,
          reach: metrics.reach ?? 0,
          likes: metrics.likes ?? 0,
          comments: metrics.comments ?? 0,
          shares: metrics.shares ?? 0,
          saved: metrics.saved ?? 0,
        };
      },
      async () => {
        throw new Error('Instagram API temporarily unavailable');
      },
    );
  }

  public async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/me?access_token=health_check_probe`);
      // A 400 (bad token) means the API is reachable; anything else is a problem
      return res.status === 400 || res.ok;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  private validateRequest(req: InstagramPublishRequest): void {
    if (!req.igAccountId) throw new Error('igAccountId is required');
    if (!req.accessToken) throw new Error('accessToken is required');
    if (!req.mediaUrl && req.mediaType !== 'CAROUSEL') throw new Error('mediaUrl is required');

    if (req.mediaType === 'IMAGE' && req.imageWidth && req.imageHeight) {
      this.validateAspectRatio(req.imageWidth, req.imageHeight);
    }

    if (req.scheduledPublishTime) {
      const minMs = 10 * 60 * 1000; // 10 minutes
      const maxMs = 75 * 24 * 60 * 60 * 1000; // 75 days
      const delta = req.scheduledPublishTime.getTime() - Date.now();
      if (delta < minMs || delta > maxMs) {
        throw new Error('Scheduled publish time must be between 10 minutes and 75 days from now');
      }
    }
  }

  /**
   * Validates image aspect ratio against Instagram's allowed ratios:
   *   1:1, 4:5 (portrait), 1.91:1 (landscape)
   */
  private validateAspectRatio(width: number, height: number): void {
    const ratio = width / height;
    const valid = VALID_IMAGE_RATIOS.some((r) => ratio >= r.min && ratio <= r.max);
    if (!valid) {
      throw new Error(
        `Invalid image aspect ratio (${width}x${height}). ` +
          `Instagram supports: ${VALID_IMAGE_RATIOS.map((r) => r.label).join(', ')}`,
      );
    }
  }

  private async getPermalink(mediaId: string, accessToken: string): Promise<string | undefined> {
    try {
      const params = new URLSearchParams({
        fields: 'permalink',
        access_token: accessToken,
      });
      const res = await fetch(`${API_BASE}/${mediaId}?${params}`);
      if (res.ok) {
        const data = (await res.json()) as any;
        return data.permalink;
      }
    } catch (err) {
      logger.warn('Failed to fetch Instagram permalink', {
        mediaId,
        error: (err as Error).message,
      });
    }
    return undefined;
  }
}

export const instagramService = new InstagramService();
