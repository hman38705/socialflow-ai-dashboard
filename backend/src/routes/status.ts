import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { healthService } from '../services/healthService';
import { getDynamicConfigService, ConfigKey } from '../services/DynamicConfigService';

const router = Router();

// Apply a basic rate limiter: max 10 requests per minute per IP
const statusRateLimiter = rateLimit({
  windowMs: 60 * 1000, // Still fixed window for now, but max is dynamic
  max: async () => {
    const svc = await getDynamicConfigService();
    return svc.get<number>(ConfigKey.RATE_LIMIT_MAX, 10);
  },
  message: {
    error: 'Too many requests, please try again later.',
  },
});

router.get('/', statusRateLimiter, async (_req: Request, res: Response) => {
  // Ensure the response is uncached by the browser or proxies
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  const status = await healthService.getSystemStatus();

  if (status.overallStatus === 'unhealthy') {
    res.status(503).json(status);
  } else {
    res.status(200).json(status);
  }
});

export default router;
