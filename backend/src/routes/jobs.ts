import { Router, Request, Response } from 'express';
import { authenticate as authMiddleware } from '../middleware/authenticate';
import { checkPermission } from '../middleware/checkPermission';
import { jobMonitor, JobStatus } from '../services/jobMonitor';
import { createLogger } from '../lib/logger';

const logger = createLogger('jobs-route');

const router = Router();

/**
 * @openapi
 * /jobs/stats:
 *   get:
 *     tags: [Jobs]
 *     summary: Get system-wide job statistics
 *     responses:
 *       200:
 *         description: Job statistics
 */
router.get('/jobs/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await jobMonitor.getSystemStats();
    res.json(stats);
  } catch (error: any) {
    logger.error('Error getting system stats', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /jobs/queues:
 *   get:
 *     tags: [Jobs]
 *     summary: List all queue names
 *     responses:
 *       200:
 *         description: Queue names
 */
router.get('/jobs/queues', (_req: Request, res: Response) => {
  try {
    const queues = jobMonitor.getQueueNames();
    res.json({ queues, count: queues.length });
  } catch (error: any) {
    logger.error('Error getting queue names', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /jobs/{queue}/stats:
 *   get:
 *     tags: [Jobs]
 *     summary: Get statistics for a specific queue
 *     parameters:
 *       - in: path
 *         name: queue
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Queue statistics
 *       404:
 *         description: Queue not found
 */
router.get('/jobs/:queue/stats', async (req: Request, res: Response) => {
  try {
    const { queue } = req.params;
    const stats = await jobMonitor.getQueueStats(queue);

    if (!stats) {
      return res.status(404).json({ error: 'Queue not found' });
    }

    res.json(stats);
  } catch (error: any) {
    logger.error('Error getting queue stats', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /jobs/{queue}/jobs:
 *   get:
 *     tags: [Jobs]
 *     summary: Get jobs from a queue with optional status filter
 *     parameters:
 *       - in: path
 *         name: queue
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [waiting, active, completed, failed, delayed, paused]
 *           default: waiting
 *       - in: query
 *         name: start
 *         schema:
 *           type: integer
 *           default: 0
 *       - in: query
 *         name: end
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Job list
 */
router.get('/jobs/:queue/jobs', async (req: Request, res: Response) => {
  try {
    const { queue } = req.params;
    const status = (req.query.status as JobStatus) || 'waiting';
    const start = parseInt(req.query.start as string) || 0;
    const end = parseInt(req.query.end as string) || 20;

    const jobs = await jobMonitor.getJobs(queue, status, start, end);
    res.json({ jobs, count: jobs.length, status, start, end });
  } catch (error: any) {
    logger.error('Error getting jobs', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /jobs/{queue}/jobs/{jobId}:
 *   get:
 *     tags: [Jobs]
 *     summary: Get a specific job by ID
 *     parameters:
 *       - in: path
 *         name: queue
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job details
 *       404:
 *         description: Job not found
 *   delete:
 *     tags: [Jobs]
 *     summary: Remove a specific job
 *     parameters:
 *       - in: path
 *         name: queue
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job removed
 *       400:
 *         description: Failed to remove job
 */
router.get('/jobs/:queue/jobs/:jobId', async (req: Request, res: Response) => {
  try {
    const { queue, jobId } = req.params;
    const job = await jobMonitor.getJob(queue, jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(job);
  } catch (error: any) {
    logger.error('Error getting job', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /jobs/{queue}/failed:
 *   get:
 *     tags: [Jobs]
 *     summary: Get failed jobs from a queue
 *     parameters:
 *       - in: path
 *         name: queue
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: start
 *         schema:
 *           type: integer
 *           default: 0
 *       - in: query
 *         name: end
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Failed jobs
 */
router.get('/jobs/:queue/failed', async (req: Request, res: Response) => {
  try {
    const { queue } = req.params;
    const start = parseInt(req.query.start as string) || 0;
    const end = parseInt(req.query.end as string) || 20;

    const failed = await jobMonitor.getJobs(queue, 'failed', start, end);
    res.json({ jobs: failed, count: failed.length });
  } catch (error: any) {
    logger.error('Error getting failed jobs', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /jobs/{queue}/jobs/{jobId}/retry:
 *   post:
 *     tags: [Jobs]
 *     summary: Retry a specific job
 *     parameters:
 *       - in: path
 *         name: queue
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Retry initiated
 *       400:
 *         description: Failed to retry
 */
// Required permission: settings:manage
router.post('/jobs/:queue/jobs/:jobId/retry', authMiddleware, checkPermission('settings:manage'), async (req: Request, res: Response) => {
  try {
    const { queue, jobId } = req.params;
    const success = await jobMonitor.retryJob(queue, jobId);

    if (!success) {
      return res.status(400).json({ error: 'Failed to retry job' });
    }

    res.json({ success: true, message: `Job ${jobId} retry initiated` });
  } catch (error: any) {
    logger.error('Error retrying job', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /jobs/{queue}/retry-all:
 *   post:
 *     tags: [Jobs]
 *     summary: Retry all failed jobs in a queue
 *     parameters:
 *       - in: path
 *         name: queue
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Jobs retried
 */
// Required permission: settings:manage
router.post('/jobs/:queue/retry-all', authMiddleware, checkPermission('settings:manage'), async (req: Request, res: Response) => {
  try {
    const { queue } = req.params;
    const retried = await jobMonitor.retryAllFailed(queue);

    res.json({ success: true, retried, message: `${retried} jobs retried` });
  } catch (error: any) {
    logger.error('Error retrying all failed jobs', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /jobs/:queue/jobs/:jobId
 * Remove a specific job
 */
// Required permission: settings:manage
router.delete('/jobs/:queue/jobs/:jobId', authMiddleware, checkPermission('settings:manage'), async (req: Request, res: Response) => {
  try {
    const { queue, jobId } = req.params;
    const success = await jobMonitor.removeJob(queue, jobId);

    if (!success) {
      return res.status(400).json({ error: 'Failed to remove job' });
    }

    res.json({ success: true, message: `Job ${jobId} removed` });
  } catch (error: any) {
    logger.error('Error removing job', { error });
    res.status(500).json({ error: error.message });
  }
});

export default router;
