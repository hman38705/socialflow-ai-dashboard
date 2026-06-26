import { Router, Request, Response } from 'express';
import { authenticate as authMiddleware } from '../middleware/authenticate';
import { checkPermission } from '../middleware/checkPermission';
import { linkedInService, LinkedInShareRequest } from '../services/LinkedInService';
import { createLogger } from '../lib/logger';

const router = Router();
const logger = createLogger('linkedin-routes');

/**
 * GET /api/v1/linkedin/auth
 * Redirects the user to LinkedIn's OAuth 2.0 consent screen.
 */
router.get('/auth', (req: Request, res: Response) => {
  if (!linkedInService.isConfigured()) {
    return res.status(503).json({ error: 'LinkedIn API not configured.' });
  }
  const state = (req.query.state as string) || crypto.randomUUID();
  return res.redirect(linkedInService.getAuthUrl(state));
});

/**
 * GET /api/v1/linkedin/callback
 * Handles the OAuth 2.0 redirect and exchanges the code for tokens.
 */
router.get('/callback', async (req: Request, res: Response) => {
  const { code, error, state } = req.query;

  if (error) {
    logger.warn('LinkedIn OAuth callback error', { error });
    return res.status(400).json({ error: String(error) });
  }

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Missing authorization code.' });
  }

  try {
    const tokens = await linkedInService.exchangeCode(code);
    const profile = await linkedInService.getProfile(tokens.accessToken);

    return res.json({
      message: 'LinkedIn connected successfully.',
      expiresAt: tokens.expiresAt,
      profile: {
        id: profile.id,
        name: `${profile.localizedFirstName} ${profile.localizedLastName}`,
        vanityName: profile.vanityName,
        personUrn: `urn:li:person:${profile.id}`,
      },
      state,
    });
  } catch (err) {
    logger.error('LinkedIn OAuth callback failed', { error: (err as Error).message });
    return res.status(500).json({ error: 'Failed to complete OAuth flow.' });
  }
});

/**
 * GET /api/v1/linkedin/profile
 * Returns the authenticated member's profile.
 * Header: x-linkedin-token
 */
router.get('/profile', async (req: Request, res: Response) => {
  const accessToken = req.headers['x-linkedin-token'] as string;
  if (!accessToken) {
    return res.status(400).json({ error: 'x-linkedin-token header required.' });
  }

  try {
    const profile = await linkedInService.getProfile(accessToken);
    return res.json({
      ...profile,
      personUrn: `urn:li:person:${profile.id}`,
    });
  } catch (err) {
    logger.error('Failed to fetch LinkedIn profile', { error: (err as Error).message });
    return res.status(502).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/v1/linkedin/share
 * Publishes a UGC post on LinkedIn.
 * Header: x-linkedin-token
 * Body: { authorUrn, text, url?, title?, description?, visibility?, mediaAssets? }
 *
 * `mediaAssets` is an array of up to 20 objects: { url, title?, description? }
 * When provided it creates a multi-image post and takes precedence over `url`.
 */
// Required permission: posts:create
router.post('/share', authMiddleware, checkPermission('posts:create'), async (req: Request, res: Response) => {
  const accessToken = req.headers['x-linkedin-token'] as string;
  if (!accessToken) {
    return res.status(400).json({ error: 'x-linkedin-token header required.' });
  }

  const { authorUrn, text, url, title, description, visibility, mediaAssets } = req.body;
  if (!authorUrn || !text) {
    return res.status(400).json({ error: 'authorUrn and text are required.' });
  }

  try {
    const shareRequest: LinkedInShareRequest = {
      authorUrn,
      text,
      url,
      title,
      description,
      visibility,
      mediaAssets,
    };
    const result = await linkedInService.shareContent(accessToken, shareRequest);
    return res.status(201).json({ success: true, postUrn: result.id });
  } catch (err) {
    logger.error('Failed to share LinkedIn post', { error: (err as Error).message });
    return res.status(502).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/v1/linkedin/post/:postUrn/stats
 * Returns engagement analytics for a UGC post.
 * Header: x-linkedin-token
 * Param: postUrn — URL-encoded URN of the post
 */
router.get('/post/:postUrn/stats', async (req: Request, res: Response) => {
  const accessToken = req.headers['x-linkedin-token'] as string;
  if (!accessToken) {
    return res.status(400).json({ error: 'x-linkedin-token header required.' });
  }

  try {
    const postUrn = decodeURIComponent(req.params.postUrn);
    const stats = await linkedInService.getPostStats(accessToken, postUrn);
    return res.json(stats);
  } catch (err) {
    logger.error('Failed to fetch LinkedIn post stats', { error: (err as Error).message });
    return res.status(502).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/v1/linkedin/status
 * Returns circuit breaker status and configuration health.
 */
router.get('/status', (_req: Request, res: Response) => {
  return res.json({
    configured: linkedInService.isConfigured(),
    circuit: linkedInService.getCircuitStatus(),
  });
});

export default router;
