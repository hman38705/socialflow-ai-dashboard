import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { checkPermission } from '../middleware/checkPermission';
import { createLogger } from '../lib/logger';
import { getDiscoveredQueueNames, retryFailedJobs } from '../admin/jobAdminService';
import { clearCache } from '../admin/cacheAdminService';
import { listMigrations, runMigrations, rollbackMigration } from '../admin/migrationService';
import { RoleStore } from '../lib/roleStore';

const router = Router();
const logger = createLogger('admin-routes');

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

router.post('/jobs/retry', async (req, res) => {
  const actorId = req.user?.id;
  try {
    const { queueName, limit = 100, dryRun = false, jobId } = req.body;
    if (!queueName) {
      return res.status(400).json({ error: 'queueName is required' });
    }
    const result = await retryFailedJobs({ queueName, limit, dryRun, jobId, actorId }, logger);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retry jobs' });
  }
});

// ── Cache Administration ──────────────────────────────────────────────────────

const CACHE_PREFIX = 'cache:';
const RESERVED_PREFIXES = ['bull:', 'lock:', 'jwt:', 'oauth:'];

router.post('/cache/clear', async (req, res) => {
  const actorId = req.user?.id;
  try {
    const { pattern, batchSize = 100, dryRun = false } = req.body;
    if (!pattern) {
      return res.status(400).json({ error: 'pattern is required' });
    }
    if (typeof pattern !== 'string') {
      return res.status(400).json({ error: 'pattern must be a string' });
    }
    const scoped = pattern.startsWith(CACHE_PREFIX) ? pattern : `${CACHE_PREFIX}${pattern}`;
    const suffix = scoped.slice(CACHE_PREFIX.length);
    if (!suffix.replace(/[*?[\]^-]/g, '') || RESERVED_PREFIXES.some((p) => suffix.startsWith(p))) {
      return res.status(400).json({ error: 'pattern is too broad or targets a reserved prefix' });
    }
    const result = await clearCache({ pattern: scoped, batchSize, dryRun, actorId }, logger);
    res.json(result);
  } catch (error) {
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

router.post('/migrations/run', async (req, res) => {
  const actorId = req.user?.id;
  try {
    const { name, dryRun = false, force = false } = req.body;
    if (force) {
      const allowed = await RoleStore.hasPermission(actorId, 'migrations:force');
      if (!allowed) {
        return res.status(403).json({ error: 'Forbidden: force requires elevated permission' });
      }
    }
    const result = await runMigrations({ name, dryRun, force, actorId }, logger);
    if (result.forbidden) {
      return res.status(403).json({ error: 'Forbidden: force requires elevated permission' });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to run migrations' });
  }
});

router.post('/migrations/:name/rollback', async (req, res) => {
  const actorId = req.user?.id;
  try {
    const result = await rollbackMigration(req.params.name, logger, actorId);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to rollback migration' });
  }
});

export default router;
