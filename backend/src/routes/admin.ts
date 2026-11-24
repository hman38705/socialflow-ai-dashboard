import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { checkPermission } from '../middleware/checkPermission';
import { createLogger } from '../lib/logger';
import { BadRequestError, ErrorCodes } from '../lib/errors';
import { getDiscoveredQueueNames, retryFailedJobs } from '../admin/jobAdminService';
import { clearCache } from '../admin/cacheAdminService';
import { listMigrations, runMigrations, rollbackMigration } from '../admin/migrationService';

const router = Router();
const logger = createLogger('admin-routes');

// ── Request Validation Schemas ────────────────────────────────────────────────

const retryJobsBodySchema = z.object({
  queueName: z.string().min(1),
  limit: z.number().int().min(1).max(1000).default(100),
  dryRun: z.boolean().default(false),
  jobId: z.string().optional(),
});

const clearCacheBodySchema = z.object({
  pattern: z.string().min(1),
  batchSize: z.number().int().min(1).max(1000).default(100),
  dryRun: z.boolean().default(false),
});

const runMigrationsBodySchema = z.object({
  name: z.string().optional(),
  dryRun: z.boolean().default(false),
  force: z.boolean().default(false),
});

function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new BadRequestError('Invalid request parameters', ErrorCodes.VALIDATION_ERROR, details);
  }
  return result.data;
}

// All admin routes require authentication and the users:manage permission
router.use(authenticate, checkPermission('users:manage'));

// ── Job Administration ────────────────────────────────────────────────────────

router.get('/jobs/queues', async (_req, res) => {
  try {
    const queues = await getDiscoveredQueueNames();
    res.json({ queues });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list queues' });
  }
});

router.post('/jobs/retry', async (req, res, next) => {
  try {
    const { queueName, limit, dryRun, jobId } = parseBody(retryJobsBodySchema, req.body);
    const result = await retryFailedJobs({ queueName, limit, dryRun, jobId }, logger);
    res.json(result);
  } catch (error) {
    if (error instanceof BadRequestError) {
      return next(error);
    }
    res.status(500).json({ error: 'Failed to retry jobs' });
  }
});

// ── Cache Administration ──────────────────────────────────────────────────────

const CACHE_PREFIX = 'cache:';
const RESERVED_PREFIXES = ['bull:', 'lock:', 'jwt:', 'oauth:'];

router.post('/cache/clear', async (req, res, next) => {
  try {
    const { pattern, batchSize, dryRun } = parseBody(clearCacheBodySchema, req.body);
    const scoped = pattern.startsWith(CACHE_PREFIX) ? pattern : `${CACHE_PREFIX}${pattern}`;
    const suffix = scoped.slice(CACHE_PREFIX.length);
    if (!suffix.replace(/[*?[\]^-]/g, '') || RESERVED_PREFIXES.some((p) => suffix.startsWith(p))) {
      return res.status(400).json({ error: 'pattern is too broad or targets a reserved prefix' });
    }
    const result = await clearCache({ pattern: scoped, batchSize, dryRun }, logger);
    res.json(result);
  } catch (error) {
    if (error instanceof BadRequestError) {
      return next(error);
    }
    res.status(500).json({ error: 'Failed to clear cache' });
  }
});

// ── Migration Administration ──────────────────────────────────────────────────

router.get('/migrations', async (_req, res) => {
  try {
    const migrations = await listMigrations();
    res.json({ migrations });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list migrations' });
  }
});

router.post('/migrations/run', async (req, res, next) => {
  try {
    const { name, dryRun, force } = parseBody(runMigrationsBodySchema, req.body);
    const result = await runMigrations({ name, dryRun, force }, logger);
    res.json(result);
  } catch (error) {
    if (error instanceof BadRequestError) {
      return next(error);
    }
    res.status(500).json({ error: 'Failed to run migrations' });
  }
});

router.post('/migrations/:name/rollback', async (req, res) => {
  try {
    const result = await rollbackMigration(req.params.name, logger);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to rollback migration' });
  }
});

export default router;
