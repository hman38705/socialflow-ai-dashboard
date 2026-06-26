import { Router, Response, NextFunction } from 'express';
import { authenticate as authMiddleware } from '../middleware/authenticate';
import { orgMiddleware } from '../middleware/orgMiddleware';
import { checkPermission } from '../middleware/checkPermission';
import { ExportService } from '../services/ExportService';
import { AuthRequest } from '../middleware/authMiddleware';
import { createLogger } from '../lib/logger';

const logger = createLogger('exports-route');

const router = Router();

/** Asserts req.activeOrgId is set — orgMiddleware must run first. */
function requireActiveOrg(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.activeOrgId) {
    res.status(403).json({ error: 'No active organization' });
    return;
  }
  next();
}

/**
 * @openapi
 * /exports/analytics:
 *   get:
 *     tags: [Exports]
 *     summary: Stream analytics data as CSV or JSON
 *     parameters:
 *       - in: query
 *         name: format
 *         required: true
 *         schema:
 *           type: string
 *           enum: [csv, json]
 *       - in: query
 *         name: startDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: endDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: Streamed analytics data
 *       400:
 *         description: Validation error
 */
// Required permission: analytics:export
router.get(
  '/analytics',
  authMiddleware,
  orgMiddleware,
  requireActiveOrg,
  checkPermission('analytics:export'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { format, startDate, endDate } = req.query;
      const organizationId = req.activeOrgId!;

      if (!format || !['csv', 'json'].includes(format as string)) {
        return res.status(400).json({ error: 'format must be "csv" or "json"' });
      }

      if (!startDate || typeof startDate !== 'string') {
        return res.status(400).json({ error: 'startDate is required (ISO format)' });
      }

      if (!endDate || typeof endDate !== 'string') {
        return res.status(400).json({ error: 'endDate is required (ISO format)' });
      }

      const start = new Date(startDate);
      const end = new Date(endDate);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ error: 'Invalid date format' });
      }

      if (format === 'csv') {
        await ExportService.streamAnalyticsAsCSV(organizationId, start, end, res);
      } else {
        await ExportService.streamAnalyticsAsJSON(organizationId, start, end, res);
      }
    } catch (error) {
      logger.error('Export error', { error });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Export failed' });
      }
    }
  },
);

/**
 * @openapi
 * /exports/posts:
 *   get:
 *     tags: [Exports]
 *     summary: Stream posts data as CSV or JSON
 *     parameters:
 *       - in: query
 *         name: format
 *         required: true
 *         schema:
 *           type: string
 *           enum: [csv, json]
 *       - in: query
 *         name: startDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: endDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: Streamed posts data
 *       400:
 *         description: Validation error
 */
// Required permission: analytics:export
router.get(
  '/posts',
  authMiddleware,
  orgMiddleware,
  requireActiveOrg,
  checkPermission('analytics:export'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { format, startDate, endDate } = req.query;
      const organizationId = req.activeOrgId!;

      if (!format || !['csv', 'json'].includes(format as string)) {
        return res.status(400).json({ error: 'format must be "csv" or "json"' });
      }

      if (!startDate || typeof startDate !== 'string') {
        return res.status(400).json({ error: 'startDate is required (ISO format)' });
      }

      if (!endDate || typeof endDate !== 'string') {
        return res.status(400).json({ error: 'endDate is required (ISO format)' });
      }

      const start = new Date(startDate);
      const end = new Date(endDate);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ error: 'Invalid date format' });
      }

      if (format === 'csv') {
        await ExportService.streamPostsAsCSV(organizationId, start, end, res);
      } else {
        await ExportService.streamPostsAsJSON(organizationId, start, end, res);
      }
    } catch (error) {
      logger.error('Export error', { error });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Export failed' });
      }
    }
  },
);

export default router;
