import { Router, Request, Response } from 'express';
import { youTubeService } from '../services/YouTubeService';
import { enqueueYouTubeSync } from '../jobs/youtubeSyncJob';
import { createLogger } from '../lib/logger';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const logger = createLogger('youtube-routes');

/**
 * GET /api/youtube/auth
 * Redirects the user to Google's OAuth2 consent screen.
 */
router.get('/auth', (_req: Request, res: Response) => {
  if (!youTubeService.isConfigured()) {
    return res.status(503).json({ error: 'YouTube API not configured.' });
  }
  return res.redirect(youTubeService.getAuthUrl());
});

/**
 * GET /api/youtube/callback
 * Handles the OAuth2 redirect, exchanges the code for tokens,
 * and triggers an immediate analytics sync.
 */
router.get('/callback', async (req: Request, res: Response) => {
  const { code, error } = req.query;

  if (error) {
    logger.warn('OAuth callback error', { error });
    return res.status(400).json({ error: String(error) });
  }

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Missing authorization code.' });
  }

  try {
    const tokens = await youTubeService.exchangeCode(code);
    // Trigger an immediate sync with the fresh tokens
    await enqueueYouTubeSync(tokens);
    return res.json({
      message: 'YouTube connected. Analytics sync queued.',
      expiresAt: tokens.expiresAt,
    });
  } catch (err) {
    logger.error('OAuth callback failed', { error: (err as Error).message });
    return res.status(500).json({ error: 'Failed to complete OAuth flow.' });
  }
});

// All data-returning routes below require a valid SocialFlow session.
router.use(authMiddleware);

/**
 * GET /api/youtube/channel
 * Returns channel metadata for the authenticated user.
 * The YouTube access token is read server-side from the authenticated
 * user's stored credentials, never from a caller-supplied query param.
 */
router.get('/channel', async (req: Request, res: Response) => {
  const accessToken = (req as any).user?.youTubeAccessToken as string | undefined;
  if (!accessToken) {
    return res.status(400).json({ error: 'YouTube account not connected.' });
  }

  try {
    const channel = await youTubeService.getChannel(accessToken);
    return res.json(channel);
  } catch (err) {
    logger.error('Failed to fetch channel', { error: (err as Error).message });
    return res.status(502).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/youtube/videos/stats
 * Returns statistics for given video IDs.
 * Query: ids (comma-separated)
 * The YouTube access token is read server-side from the authenticated
 * user's stored credentials, never from a caller-supplied query param.
 */
router.get('/videos/stats', async (req: Request, res: Response) => {
  const { ids } = req.query;
  const accessToken = (req as any).user?.youTubeAccessToken as string | undefined;
  if (!accessToken || !ids) {
    return res.status(400).json({ error: 'ids query param required and YouTube account must be connected.' });
  }

  const videoIds = (ids as string)
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  try {
    const stats = await youTubeService.getVideoStats(accessToken, videoIds);
    return res.json(stats);
  } catch (err) {
    logger.error('Failed to fetch video stats', { error: (err as Error).message });
    return res.status(502).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/youtube/status
 * Returns circuit breaker status and configuration health.
 */
router.get('/status', (_req: Request, res: Response) => {
  return res.json({
    configured: youTubeService.isConfigured(),
    circuit: youTubeService.getCircuitStatus(),
  });
});

export default router;
