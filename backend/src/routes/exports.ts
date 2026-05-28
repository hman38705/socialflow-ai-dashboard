import { Router, Request, Response } from 'express';
import { authenticate as authMiddleware } from '../middleware/authenticate';
import { checkPermission } from '../middleware/checkPermission';
import { ExportService } from '../services/ExportService';

const router = Router();

/**
 * @openapi
 * /exports/analytics:
 *   get:
 *     tags: [Exports]
 *     summary: Stream analytics data as CSV or JSON
 *     parameters:
 *       - in: query
 *         name: organizationId
 *         required: true
 *         schema:
 *           type: string
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
router.get('/analytics', authMiddleware, checkPermission('analytics:export'), async (req: Request, res: Response) => {
  try {
    const { organizationId, format, startDate, endDate } = req.query;

    if (!organizationId || typeof organizationId !== 'string') {
      return res.status(400).json({ error: 'organizationId is required' });
    }

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
    console.error('Export error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Export failed' });
    }
  }
});

/**
 * @openapi
 * /exports/posts:
 *   get:
 *     tags: [Exports]
 *     summary: Stream posts data as CSV or JSON
 *     parameters:
 *       - in: query
 *         name: organizationId
 *         required: true
 *         schema:
 *           type: string
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
router.get('/posts', authMiddleware, checkPermission('analytics:export'), async (req: Request, res: Response) => {
  try {
    const { organizationId, format, startDate, endDate } = req.query;

    if (!organizationId || typeof organizationId !== 'string') {
      return res.status(400).json({ error: 'organizationId is required' });
    }

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
    console.error('Export error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Export failed' });
    }
  }
});

export default router;
