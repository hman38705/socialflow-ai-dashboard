import { timingSafeEqual } from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { register } from '../lib/metrics';
import { queueManager } from '../queues/queueManager';

const router = Router();

function isTokenMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

function metricsAuth(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.METRICS_TOKEN;

  if (!token) {
    res.status(503).json({ error: 'Metrics endpoint is not configured.' });
    return;
  }

  const authHeader = req.headers.authorization ?? '';
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!provided || !isTokenMatch(provided, token)) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="metrics"');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

router.get('/', metricsAuth, async (_req: Request, res: Response) => {
  await queueManager.refreshQueueMetrics();
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

export default router;
