import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { authenticate as authMiddleware } from '../middleware/authenticate';
import { checkPermission } from '../middleware/checkPermission';
import { videoService } from '../services/VideoService';
import { videoQueue } from '../queues/VideoQueue';
import { videoHealthService } from '../services/VideoHealthService';
import { createLogger } from '../lib/logger';

const logger = createLogger('video-route');

const router = Router();

// Configure multer for video uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'videos');
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'video/mp4',
      'video/mpeg',
      'video/quicktime',
      'video/x-msvideo',
      'video/webm',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only video files are allowed.'));
    }
  },
});

/**
 * @openapi
 * /video/upload:
 *   post:
 *     tags: [Video]
 *     summary: Upload a video and start transcoding
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [video]
 *             properties:
 *               video:
 *                 type: string
 *                 format: binary
 *                 description: Video file (mp4, mpeg, mov, avi, webm — max 500 MB)
 *               options:
 *                 type: string
 *                 description: JSON-encoded transcoding options
 *     responses:
 *       202:
 *         description: Transcoding job queued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jobId: { type: string }
 *                 status: { type: string }
 *       400:
 *         description: No video file provided
 *       500:
 *         description: Upload failed
 */
// Required permission: posts:create
router.post('/upload', authMiddleware, checkPermission('posts:create'), upload.single('video'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    const inputPath = req.file.path;
    const options = req.body.options ? JSON.parse(req.body.options) : {};

    // Create transcoding job
    const jobId = await videoService.createTranscodingJob(inputPath, options);

    res.status(202).json({
      message: 'Video uploaded successfully. Transcoding started.',
      jobId,
      status: 'pending',
    });
  } catch (error) {
    logger.error('Upload error', { error });
    res.status(500).json({ error: 'Failed to upload video' });
  }
});

/**
 * @openapi
 * /video/job/{jobId}:
 *   get:
 *     tags: [Video]
 *     summary: Get transcoding job status
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VideoJob'
 *       404:
 *         description: Job not found
 *   delete:
 *     tags: [Video]
 *     summary: Cancel a transcoding job
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job cancelled
 *       404:
 *         description: Job not found
 */
router.get('/job/:jobId', (req: Request, res: Response) => {
  const { jobId } = req.params;
  const job = videoService.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json(job);
});

/**
 * @openapi
 * /video/jobs:
 *   get:
 *     tags: [Video]
 *     summary: List all transcoding jobs
 *     responses:
 *       200:
 *         description: Array of jobs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jobs:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/VideoJob'
 */
router.get('/jobs', (req: Request, res: Response) => {
  const jobs = videoService.getAllJobs();
  res.json({ jobs });
});

/**
 * DELETE /api/video/job/:jobId
 * Cancel a transcoding job
 */
// Required permission: posts:delete
router.delete('/job/:jobId', authMiddleware, checkPermission('posts:delete'), async (req: Request, res: Response) => {
  const { jobId } = req.params;
  const cancelled = await videoService.cancelJob(jobId);

  if (!cancelled) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({ message: 'Job cancelled successfully' });
});

/**
 * @openapi
 * /video/queue/status:
 *   get:
 *     tags: [Video]
 *     summary: Get video queue status
 *     responses:
 *       200:
 *         description: Queue status
 */
router.get('/queue/status', (req: Request, res: Response) => {
  const status = videoQueue.getStatus();
  res.json(status);
});

/**
 * @openapi
 * /video/health:
 *   get:
 *     tags: [Video]
 *     summary: Check video service health (FFmpeg availability)
 *     security: []
 *     responses:
 *       200:
 *         description: Service is healthy
 *       503:
 *         description: Service is unhealthy
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const health = await videoHealthService.getHealthStatus();
    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: 'Failed to check health status',
    });
  }
});

export default router;
