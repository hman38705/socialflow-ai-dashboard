import { Router, Request, Response } from 'express';
import { authenticate as authMiddleware } from '../middleware/authenticate';
import { checkPermission } from '../middleware/checkPermission';
import { replicaClient } from '../lib/readReplica';

/**
 * @openapi
 * /analytics:
 *   get:
 *     tags: [Analytics]
 *     summary: Get aggregated analytics
 *     parameters:
 *       - in: query
 *         name: platform
 *         schema:
 *           type: string
 *           enum: [twitter, linkedin, instagram, tiktok]
 *         description: Filter by platform
 *       - in: query
 *         name: from
 *         schema:
 *           type: integer
 *         description: Start of date range (Unix ms)
 *       - in: query
 *         name: to
 *         schema:
 *           type: integer
 *         description: End of date range (Unix ms)
 *     responses:
 *       200:
 *         description: Analytics filters acknowledged
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string }
 *                 filters:
 *                   type: object
 *                   properties:
 *                     platform: { type: string, nullable: true }
 *                     from: { type: integer, nullable: true }
 *                     to: { type: integer, nullable: true }
 *       400:
 *         description: Invalid query parameters
 */
const router = Router();

// Required permission: analytics:view
router.get('/', authMiddleware, checkPermission('analytics:view'), (_req: Request, res: Response) => {
  const { platform, from, to } = _req.query;

  // Validation
  if (platform && !['twitter', 'linkedin', 'instagram', 'tiktok'].includes(platform as string)) {
    return res.status(400).json({ error: 'Invalid platform value.' });
  }
  if ((from && isNaN(Number(from))) || (to && isNaN(Number(to)))) {
    return res.status(400).json({ error: 'from and to must be numeric Unix timestamps.' });
  }

  // The actual data lives in IndexedDB on the client (Electron / browser).
  // This endpoint is the server-side contract; the frontend AnalyticsService
  // is the authoritative store. Return the filter params so the client can
  // apply them locally, or wire up a server DB here when needed.
  //
  // All server-side DB reads for analytics MUST use replicaClient (read replica)
  // to reduce primary database load. Example:
  //   const rows = await replicaClient.analyticsEntry.findMany({ where: { ... } });
  void replicaClient; // replica client is ready for analytics queries
  return res.json({
    message: 'Query analytics via the client-side AnalyticsService.',
    filters: {
      platform: platform ?? null,
      from: from ? Number(from) : null,
      to: to ? Number(to) : null,
    },
  });
});

export default router;
