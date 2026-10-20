import { Router, Request } from 'express';
import { z } from 'zod';
import { RoleStore } from '../models/Role';
import { authenticate } from '../middleware/authenticate';
import { checkPermission } from '../middleware/checkPermission';
import { validate } from '../middleware/validate';
import { auditAdmin } from '../middleware/auditAdmin';
import { createLogger } from '../lib/logger';
import { getDiscoveredQueueNames, retryFailedJobs } from '../admin/jobAdminService';
import { clearCache } from '../admin/cacheAdminService';
import { listMigrations, runMigrations, rollbackMigration } from '../admin/migrationService';

const router = Router();

const retrySchema = z.object({
  queueName: z.string().min(1),
  limit: z.number().int().min(1).max(1000).default(100),
  dryRun: z.boolean().default(false),
  jobId: z.string().optional(),
});

const cacheClearSchema = z.object({
  pattern: z.string().min(1),
  batchSize: z.number().int().min(10).max(1000).default(100),
  dryRun: z.boolean().default(false),
});

const migrationRunSchema = z.object({
  name: z.string().optional(),
  dryRun: z.boolean().default(false),
  force: z.boolean().default(false),
  reason: z.string().trim().min(1).max(500).optional(),
});
const logger = createLogger('admin-routes');

// All admin routes require authentication and the users:manage permission
router.use(authenticate, checkPermission('users:manage'));

// ── Job Administration ────────────────────────────────────────────────────────

router.get('/jobs/queues', async (_req, res) => {
  try {
    const queues = await getDiscoveredQueueNames();
    res.json({ queues });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to list queues' });
  }
});

router.post('/jobs/retry', validate(retrySchema), auditAdmin('admin:jobs:retry'), async (req, res) => {
  try {
    const { queueName, limit = 100, dryRun = false, jobId } = req.body;
    if (!queueName) {
      return res.status(400).json({ error: 'queueName is required' });
    }
    const result = await retryFailedJobs({ queueName, limit, dryRun, jobId }, logger);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to retry jobs' });
  }
});

// ── Cache Administration ──────────────────────────────────────────────────────

router.post('/cache/clear', validate(cacheClearSchema), auditAdmin('admin:cache:clear'), async (req, res) => {
  try {
    const { pattern, batchSize = 100, dryRun = false } = req.body;
    if (!pattern) {
      return res.status(400).json({ error: 'pattern is required' });
    }
    const result = await clearCache({ pattern, batchSize, dryRun }, logger);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to clear cache' });
  }
});

// ── Migration Administration ──────────────────────────────────────────────────

router.get('/migrations', async (_req, res) => {
  try {
    const migrations = await listMigrations();
    res.json({ migrations });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to list migrations' });
  }
});

router.post('/migrations/run', validate(migrationRunSchema), auditAdmin('admin:migrations:run'), async (req, res) => {
  try {
    const { name, dryRun, force, reason } = req.body;
    if (force) {
      if (!reason) {
        return res.status(400).json({ error: 'reason is required when force is true' });
      }
      if (process.env.NODE_ENV === 'production' && process.env.ALLOW_FORCE_MIGRATIONS !== 'true') {
        return res.status(403).json({ error: 'force migrations are disabled in production' });
      }
      const userId = (req as Request & { user?: { id: string } }).user?.id;
      if (!userId || !(await RoleStore.hasPermission(userId, 'migrations:force'))) {
        return res.status(403).json({ error: 'Missing permission: migrations:force' });
      }
      logger.warn('Forced migration run', { userId, reason, name });
    }
    const result = await runMigrations({ name, dryRun, force }, logger);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to run migrations' });
  }
});

router.post('/migrations/:name/rollback', auditAdmin('admin:migrations:rollback'), async (req, res) => {
  try {
    const result = await rollbackMigration(req.params.name, logger);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to rollback migration' });
  }
});

export default router;
