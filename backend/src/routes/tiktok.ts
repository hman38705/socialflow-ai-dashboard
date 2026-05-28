import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import { authenticate as authMiddleware } from '../middleware/authenticate';
import { checkPermission } from '../middleware/checkPermission';
import { tiktokService } from '../services/TikTokService';
import { enqueueTikTokVideoUpload } from '../jobs/tiktokVideoJob';
import { dispatchEvent } from '../services/WebhookDispatcher';
import { createLogger } from '../lib/logger';

const router = Router();
const logger = createLogger('tiktok-routes');

// ─── OAuth ────────────────────────────────────────────────────────────────────

/**
 * GET /api/tiktok/auth
 * Redirects the user to TikTok's OAuth2 consent screen.
 * Required scopes: user.info.basic, video.publish, video.upload
 */
router.get('/auth', (req: Request, res: Response) => {
  if (!tiktokService.isConfigured()) {
    return res.status(503).json({ error: 'TikTok API not configured.' });
  }
  // CSRF state stored in session/cookie in production; using a random value here
  const state = crypto.randomBytes(16).toString('hex');
  return res.redirect(tiktokService.getAuthUrl(state));
});

/**
 * GET /api/tiktok/callback
 * Handles the OAuth2 redirect from TikTok, exchanges code for tokens.
 */
router.get('/callback', async (req: Request, res: Response) => {
  const { code, error, error_description } = req.query;

  if (error) {
    logger.warn('TikTok OAuth callback error', { error, error_description });
    return res.status(400).json({ error: String(error), description: String(error_description) });
  }

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Missing authorization code.' });
  }

  try {
    const tokens = await tiktokService.exchangeCode(code);
    const userInfo = await tiktokService.getUserInfo(tokens.accessToken);

    return res.json({
      message: 'TikTok connected successfully.',
      openId: tokens.openId,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope,
      user: {
        displayName: userInfo.displayName,
        avatarUrl: userInfo.avatarUrl,
        followerCount: userInfo.followerCount,
        isVerified: userInfo.isVerified,
      },
    });
  } catch (err) {
    logger.error('TikTok OAuth callback failed', { error: (err as Error).message });
    return res.status(500).json({ error: 'Failed to complete TikTok OAuth flow.' });
  }
});

// ─── User ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/tiktok/user
 * Returns the authenticated TikTok user's profile info.
 * Header: x-tiktok-token
 */
router.get('/user', async (req: Request, res: Response) => {
  const accessToken = req.headers['x-tiktok-token'] as string;
  if (!accessToken) {
    return res.status(400).json({ error: 'x-tiktok-token header required.' });
  }

  try {
    const userInfo = await tiktokService.getUserInfo(accessToken);
    return res.json(userInfo);
  } catch (err) {
    logger.error('Failed to fetch TikTok user info', { error: (err as Error).message });
    return res.status(502).json({ error: (err as Error).message });
  }
});

// ─── Video Upload ─────────────────────────────────────────────────────────────

/**
 * POST /api/tiktok/video/upload
 * Enqueues a chunked video upload job.
 *
 * Body (multipart or JSON):
 *   - filePath: absolute server-side path to the video file
 *   - title: video caption/title (max 2200 chars)
 *   - description?: optional description
 *   - privacyLevel?: PUBLIC_TO_EVERYONE | MUTUAL_FOLLOW_FRIENDS | SELF_ONLY
 *   - disableDuet?, disableComment?, disableStitch?: boolean flags
 *
 * Header: x-tiktok-token, x-tiktok-refresh-token, x-tiktok-expires-at
 */
// Required permission: posts:create
router.post('/video/upload', authMiddleware, checkPermission('posts:create'), async (req: Request, res: Response) => {
  const accessToken = req.headers['x-tiktok-token'] as string;
  const refreshToken = req.headers['x-tiktok-refresh-token'] as string;
  const expiresAt = Number(req.headers['x-tiktok-expires-at']);

  if (!accessToken || !refreshToken) {
    return res
      .status(400)
      .json({ error: 'x-tiktok-token and x-tiktok-refresh-token headers required.' });
  }

  const { filePath, title, description, privacyLevel, disableDuet, disableComment, disableStitch } =
    req.body;

  if (!filePath || !title) {
    return res.status(400).json({ error: 'filePath and title are required.' });
  }

  // Validate file exists and get size
  let fileSizeBytes: number;
  try {
    const stat = await fs.promises.stat(filePath);
    fileSizeBytes = stat.size;
  } catch {
    return res.status(400).json({ error: `File not found: ${filePath}` });
  }

  // Basic extension check — TikTok supports mp4, webm, mov
  const ext = path.extname(filePath).toLowerCase();
  if (!['.mp4', '.webm', '.mov'].includes(ext)) {
    return res.status(400).json({ error: 'Unsupported video format. Use mp4, webm, or mov.' });
  }

  try {
    const jobId = await enqueueTikTokVideoUpload({
      accessToken,
      refreshToken,
      expiresAt,
      filePath,
      fileSizeBytes,
      request: {
        videoSource: filePath,
        sourceType: 'FILE_UPLOAD',
        title,
        description,
        privacyLevel: privacyLevel || 'SELF_ONLY',
        disableDuet: disableDuet ?? false,
        disableComment: disableComment ?? false,
        disableStitch: disableStitch ?? false,
      },
    });

    return res.status(202).json({
      message: 'Video upload job enqueued.',
      jobId,
      fileSizeBytes,
    });
  } catch (err) {
    logger.error('Failed to enqueue TikTok video upload', { error: (err as Error).message });
    return res.status(500).json({ error: 'Failed to enqueue video upload.' });
  }
});

/**
 * POST /api/tiktok/video/upload-url
 * Upload a video by providing a publicly accessible URL (no chunking).
 *
 * Body: { videoUrl, title, description?, privacyLevel? }
 * Header: x-tiktok-token
 */
// Required permission: posts:create
router.post('/video/upload-url', authMiddleware, checkPermission('posts:create'), async (req: Request, res: Response) => {
  const accessToken = req.headers['x-tiktok-token'] as string;
  if (!accessToken) {
    return res.status(400).json({ error: 'x-tiktok-token header required.' });
  }

  const { videoUrl, title, description, privacyLevel } = req.body;
  if (!videoUrl || !title) {
    return res.status(400).json({ error: 'videoUrl and title are required.' });
  }

  try {
    const result = await tiktokService.uploadVideoFromUrl(accessToken, {
      videoSource: videoUrl,
      sourceType: 'PULL_FROM_URL',
      title,
      description,
      privacyLevel: privacyLevel || 'SELF_ONLY',
    });

    return res.status(202).json({
      message: 'TikTok video URL upload initiated.',
      publishId: result.publishId,
    });
  } catch (err) {
    logger.error('Failed to upload TikTok video from URL', { error: (err as Error).message });
    return res.status(502).json({ error: (err as Error).message });
  }
});

// ─── Video Status ─────────────────────────────────────────────────────────────

/**
 * GET /api/tiktok/video/status/:publishId
 * Returns the current processing status of an uploaded video.
 * Header: x-tiktok-token
 */
router.get('/video/status/:publishId', async (req: Request, res: Response) => {
  const accessToken = req.headers['x-tiktok-token'] as string;
  if (!accessToken) {
    return res.status(400).json({ error: 'x-tiktok-token header required.' });
  }

  const { publishId } = req.params;

  try {
    const status = await tiktokService.getVideoStatus(accessToken, publishId);
    return res.json(status);
  } catch (err) {
    logger.error('Failed to fetch TikTok video status', { error: (err as Error).message });
    return res.status(502).json({ error: (err as Error).message });
  }
});

// ─── Webhook Callback ─────────────────────────────────────────────────────────

/**
 * POST /api/tiktok/webhook
 * Receives TikTok server-side callbacks for video processing status updates.
 * TikTok sends a POST with a JSON body when video processing completes or fails.
 *
 * Verifies the request using HMAC-SHA256 signature in X-TikTok-Signature header.
 */
router.post('/webhook', async (req: Request, res: Response) => {
  const signature = req.headers['x-tiktok-signature'] as string;
  const webhookSecret = process.env.TIKTOK_WEBHOOK_SECRET || '';

  if (webhookSecret && signature) {
    const rawBody = JSON.stringify(req.body);
    const expected =
      'sha256=' + crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      logger.warn('TikTok webhook signature mismatch');
      return res.status(401).json({ error: 'Invalid webhook signature.' });
    }
  }

  const { event, data } = req.body;
  logger.info('TikTok webhook received', { event, data });

  try {
    if (event === 'video.publish_complete') {
      await dispatchEvent('tiktok.video_published', {
        publishId: data?.publish_id,
        shareUrl: data?.share_url,
        publiclyAvailable: data?.publicly_available,
      });
    } else if (event === 'video.publish_failed') {
      await dispatchEvent('tiktok.video_failed', {
        publishId: data?.publish_id,
        failReason: data?.fail_reason,
      });
    } else {
      await dispatchEvent('tiktok.video_processing', {
        publishId: data?.publish_id,
        event,
        data,
      });
    }
  } catch (err) {
    logger.error('Failed to dispatch TikTok webhook event', { error: (err as Error).message });
  }

  // Always respond 200 quickly to acknowledge receipt
  return res.status(200).json({ received: true });
});

// ─── Health / Status ──────────────────────────────────────────────────────────

/**
 * GET /api/tiktok/status
 * Returns TikTok service configuration and circuit breaker health.
 */
router.get('/status', (_req: Request, res: Response) => {
  return res.json({
    configured: tiktokService.isConfigured(),
    circuit: tiktokService.getCircuitStatus(),
  });
});

export default router;
