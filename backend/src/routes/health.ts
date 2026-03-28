import 'reflect-metadata';
import { Router } from 'express';
import { z } from 'zod';
import {
  getHealthService,
  getHealthMonitor,
  getAlertConfigService,
} from '../services/serviceFactory';
import { getIntegrationSnapshot } from '../lib/integrationStatus';
import { validate } from '../middleware/validate';

const router = Router();

// Valid service names for alert configuration
const VALID_SERVICES = ['database', 'redis', 's3', 'twitter', 'youtube', 'facebook'] as const;

// Schema for alert threshold validation
const alertThresholdSchema = z.object({
  errorRatePercent: z
    .number()
    .min(0, 'Error rate percent must be at least 0')
    .max(100, 'Error rate percent must be at most 100'),
  responseTimeMs: z
    .number()
    .int('Response time must be an integer')
    .min(0, 'Response time must be at least 0'),
  consecutiveFailures: z
    .number()
    .int('Consecutive failures must be an integer')
    .min(1, 'Consecutive failures must be at least 1'),
});

// Schema for service alert configuration
const serviceAlertConfigSchema = z.object({
  enabled: z.boolean(),
  thresholds: alertThresholdSchema,
  cooldownMs: z
    .number()
    .int('Cooldown must be an integer')
    .min(0, 'Cooldown must be at least 0'),
});

// Schema for service parameter validation
const serviceParamSchema = z.object({
  service: z.enum(VALID_SERVICES, {
    errorMap: () => ({
      message: `Invalid service name. Must be one of: ${VALID_SERVICES.join(', ')}`,
    }),
  }),
});

/**
 * @openapi
 * /health/readiness:
 *   get:
 *     tags: [Health]
 *     summary: Readiness probe — reports integration enabled/disabled state
 *     security: []
 *     responses:
 *       200:
 *         description: All required integrations are configured
 *       503:
 *         description: One or more integrations are disabled
 */
router.get('/readiness', (req, res) => {
  const integrations = getIntegrationSnapshot();
  if (!integrations) {
    return res.status(503).json({ status: 'starting', integrations: [] });
  }
  const disabled = integrations.filter((i) => !i.enabled);
  const status = disabled.length === 0 ? 'ready' : 'degraded';
  return res.status(disabled.length === 0 ? 200 : 503).json({ status, integrations });
});

/**
 * @openapi
 * /health/status:
 *   get:
 *     tags: [Health]
 *     summary: Get current system health status
 *     security: []
 *     responses:
 *       200:
 *         description: System health status
 *       500:
 *         description: Health check failed
 */
router.get('/status', async (req, res) => {
  try {
    const healthService = getHealthService();
    const status = await healthService.getSystemStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Health check failed',
    });
  }
});

/**
 * @openapi
 * /health/metrics:
 *   get:
 *     tags: [Health]
 *     summary: Get detailed health metrics for all services
 *     security: []
 *     responses:
 *       200:
 *         description: Health metrics
 *       500:
 *         description: Failed to retrieve metrics
 */
router.get('/metrics', (req, res) => {
  try {
    const monitor = getHealthMonitor();
    const metrics = monitor.getMetrics();
    res.json({ metrics });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to retrieve metrics',
    });
  }
});

/**
 * @openapi
 * /health/metrics/{service}:
 *   get:
 *     tags: [Health]
 *     summary: Get health metrics for a specific service
 *     security: []
 *     parameters:
 *       - in: path
 *         name: service
 *         required: true
 *         schema:
 *           type: string
 *           enum: [database, redis, s3, twitter, youtube, facebook]
 *     responses:
 *       200:
 *         description: Service health metrics
 *       404:
 *         description: Service not found
 */
router.get('/metrics/:service', (req, res) => {
  try {
    const monitor = getHealthMonitor();
    const metrics = monitor.getMetrics(req.params.service);
    if (metrics.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }
    res.json({ metrics });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to retrieve metrics',
    });
  }
});

/**
 * @openapi
 * /health/config:
 *   get:
 *     tags: [Health]
 *     summary: Get alert configuration for all services
 *     security: []
 *     responses:
 *       200:
 *         description: Alert configuration map
 */
router.get('/config', (req, res) => {
  try {
    const alertConfigService = getAlertConfigService();
    const services = ['database', 'redis', 's3', 'twitter', 'youtube', 'facebook'];
    const config = Object.fromEntries(
      services.map((service) => [service, alertConfigService.getConfig(service)]),
    );
    res.json(config);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to retrieve config',
    });
  }
});

/**
 * @openapi
 * /health/config/{service}:
 *   put:
 *     tags: [Health]
 *     summary: Update alert configuration for a service
 *     parameters:
 *       - in: path
 *         name: service
 *         required: true
 *         schema:
 *           type: string
 *           enum: [database, redis, s3, twitter, youtube, facebook]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Alert configuration object
 *     responses:
 *       200:
 *         description: Configuration updated
 *       422:
 *         description: Validation error
 *       500:
 *         description: Failed to update config
 */
router.put(
  '/config/:service',
  validate(serviceParamSchema, 'params'),
  validate(serviceAlertConfigSchema, 'body'),
  (req, res) => {
    try {
      const alertConfigService = getAlertConfigService();
      const { service } = req.params;
      const config = req.body;

      alertConfigService.setConfig(service, config);
      res.json({ message: 'Configuration updated', config });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to update config',
      });
    }
  },
);

export default router;
