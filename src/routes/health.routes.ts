import { Router, Request, Response } from 'express';

const router = Router();

/**
 * @route   GET /api/health
 * @desc    Health check endpoint
 * @access  Public
 */
router.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    message: 'SocialFlow API is running',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

export default router;
