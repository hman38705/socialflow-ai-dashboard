import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { checkPermission } from '../middleware/checkPermission';
import { createLogger } from '../lib/logger';
import { getDiscoveredQueueNames, retryFailedJobs } from '../admin/jobAdminService';
import { clearCache } from '../admin/cacheAdminService';
import { listMigrations, runMigrations, rollbackMigration } from '../admin/migrationService';

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
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to list queues' });
  }
});

router.post('/jobs/retry', async (req, res) => {
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

router.post('/cache/clear', async (req, res) => {
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

router.post('/migrations/run', async (req, res) => {
  try {
    const { name, dryRun = false, force = false } = req.body;
    const result = await runMigrations({ name, dryRun, force }, logger);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to run migrations' });
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
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to rollback migration' });
  }
});

export default router;
