import { Router, Request, Response } from 'express';
import { authenticate as authMiddleware } from '../middleware/authenticate';
import { checkPermission } from '../middleware/checkPermission';
import { circuitBreakerService } from '../services/CircuitBreakerService';
import { aiService } from '../services/AIService';
import { twitterService } from '../services/TwitterService';

const router = Router();

/**
 * @openapi
 * /circuit-breaker/status:
 *   get:
 *     tags: [Circuit Breaker]
 *     summary: Get status of all circuit breakers
 *     responses:
 *       200:
 *         description: Circuit breaker stats
 */
router.get('/status', (req: Request, res: Response) => {
  try {
    const stats = circuitBreakerService.getStats();
    res.json({
      success: true,
      circuitBreakers: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * @openapi
 * /circuit-breaker/status/{service}:
 *   get:
 *     tags: [Circuit Breaker]
 *     summary: Get status of a specific circuit breaker
 *     parameters:
 *       - in: path
 *         name: service
 *         required: true
 *         schema:
 *           type: string
 *           enum: [ai, twitter, translation]
 *     responses:
 *       200:
 *         description: Circuit breaker status
 *       404:
 *         description: Circuit breaker not found
 */
router.get('/status/:service', (req: Request, res: Response) => {
  try {
    const { service } = req.params;
    const stats = circuitBreakerService.getStats(service as any);
    res.json({
      success: true,
      circuitBreaker: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error instanceof Error ? error.message : 'Circuit breaker not found',
    });
  }
});

/**
 * @openapi
 * /circuit-breaker/reset:
 *   post:
 *     tags: [Circuit Breaker]
 *     summary: Reset all circuit breakers
 *     responses:
 *       200:
 *         description: All circuit breakers reset
 */
// Required permission: settings:manage
router.post('/reset', authMiddleware, checkPermission('settings:manage'), (req: Request, res: Response) => {
  try {
    circuitBreakerService.resetAll();
    res.json({
      success: true,
      message: 'All circuit breakers reset',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * @openapi
 * /circuit-breaker/{service}/open:
 *   post:
 *     tags: [Circuit Breaker]
 *     summary: Manually open a circuit breaker
 *     parameters:
 *       - in: path
 *         name: service
 *         required: true
 *         schema:
 *           type: string
 *           enum: [ai, twitter, translation]
 *     responses:
 *       200:
 *         description: Circuit breaker opened
 */
// Required permission: settings:manage
router.post('/:service/open', authMiddleware, checkPermission('settings:manage'), (req: Request, res: Response) => {
  try {
    const { service } = req.params;
    circuitBreakerService.open(service as any);
    res.json({
      success: true,
      message: `Circuit breaker opened for ${service}`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * @openapi
 * /circuit-breaker/{service}/close:
 *   post:
 *     tags: [Circuit Breaker]
 *     summary: Manually close a circuit breaker
 *     parameters:
 *       - in: path
 *         name: service
 *         required: true
 *         schema:
 *           type: string
 *           enum: [ai, twitter, translation]
 *     responses:
 *       200:
 *         description: Circuit breaker closed
 */
// Required permission: settings:manage
router.post('/:service/close', authMiddleware, checkPermission('settings:manage'), (req: Request, res: Response) => {
  try {
    const { service } = req.params;
    circuitBreakerService.close(service as any);
    res.json({
      success: true,
      message: `Circuit breaker closed for ${service}`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * @openapi
 * /circuit-breaker/health:
 *   get:
 *     tags: [Circuit Breaker]
 *     summary: Health check for all circuit-breaker-protected services
 *     security: []
 *     responses:
 *       200:
 *         description: All services healthy
 *       503:
 *         description: One or more circuits are open
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const health = {
      ai: {
        configured: aiService.isAvailable(),
        circuitOpen: circuitBreakerService.isOpen('ai'),
      },
      twitter: {
        configured: twitterService.isConfigured(),
        circuitOpen: circuitBreakerService.isOpen('twitter'),
      },
      translation: {
        circuitOpen: circuitBreakerService.isOpen('translation'),
      },
    };

    const allHealthy =
      !health.ai.circuitOpen && !health.twitter.circuitOpen && !health.translation.circuitOpen;

    res.status(allHealthy ? 200 : 503).json({
      success: allHealthy,
      services: health,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
