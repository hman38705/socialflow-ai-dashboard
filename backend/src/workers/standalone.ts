/**
 * Standalone worker process entry point.
 *
 * Run by the socialflow-worker container (Dockerfile.worker).
 * The API server (server.ts) no longer starts these workers, so they
 * scale independently via the worker Kubernetes Deployment.
 */
import '../tracing'; // must be first — patches BullMQ and Prisma before they load
import { startWorkers } from './index';
import { closeRedisClient } from '../queues/queueManager';
import { createLogger } from '../lib/logger';

const logger = createLogger('worker-standalone');

const { ai, social } = startWorkers();

const shutdown = async (signal: string): Promise<void> => {
  logger.info(`Received ${signal}. Shutting down workers...`);
  try {
    await Promise.all([ai.close(), social.close()]);
    await closeRedisClient();
    logger.info('Workers shut down cleanly');
    process.exit(0);
  } catch (err) {
    logger.error('Error during worker shutdown', { error: (err as Error).message });
    process.exit(1);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
