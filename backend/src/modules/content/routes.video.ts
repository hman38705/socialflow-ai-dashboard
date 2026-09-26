import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { videoService } from '../../services/VideoService';
import { videoQueue } from '../../queues/VideoQueue';
import { videoHealthService } from '../../services/VideoHealthService';
import { authMiddleware, AuthRequest } from '../../middleware/authMiddleware';

const router = Router();

// jobId -> owning userId; jobs are only visible to the user who created them
const jobOwners = new Map<string, string>();
const ownsJob = (jobId: string, userId: string | undefined) =>
  !!userId && jobOwners.get(jobId) === userId;

/**
 * GET /api/video/health
 * Check video service health (FFmpeg availability) — intentionally unauthenticated
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const health = await videoHealthService.getHealthStatus();
    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (_error) {
    res.status(500).json({
      status: 'unhealthy',
      error: 'Failed to check health status',
    });
  }
});

router.use(authMiddleware);

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
 * POST /api/video/upload
 * Upload a video and start transcoding
 */
router.post('/upload', upload.single('video'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    const inputPath = req.file.path;
    const options = req.body.options ? JSON.parse(req.body.options) : {};

    // Create transcoding job
    const jobId = await videoService.createTranscodingJob(inputPath, options, req.user!.id);
    jobOwners.set(jobId, req.user!.id);

    res.status(202).json({
      message: 'Video uploaded successfully. Transcoding started.',
      jobId,
      status: 'pending',
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload video' });
  }
});

/**
 * GET /api/video/job/:jobId
 * Get transcoding job status
 */
router.get('/job/:jobId', async (req: AuthRequest, res: Response) => {
  const { jobId } = req.params;
  const job = ownsJob(jobId, req.user?.id) ? await videoService.getJob(jobId) : undefined;

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json(job);
});

/**
 * GET /api/video/jobs
 * Get all transcoding jobs
 */
router.get('/jobs', async (req: AuthRequest, res: Response) => {
  const jobs = (await videoService.getAllJobs()).filter((j) => ownsJob(j.id, req.user?.id));
  res.json({ jobs });
});

/**
 * DELETE /api/video/job/:jobId
 * Cancel a transcoding job
 */
router.delete('/job/:jobId', async (req: AuthRequest, res: Response) => {
  const { jobId } = req.params;
  const cancelled = ownsJob(jobId, req.user?.id) && (await videoService.cancelJob(jobId));

  if (!cancelled) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({ message: 'Job cancelled successfully' });
});

/**
 * GET /api/video/queue/status
 * Get queue status
 */
router.get('/queue/status', (req: Request, res: Response) => {
  const status = videoQueue.getStatus();
  res.json(status);
});

export default router;
