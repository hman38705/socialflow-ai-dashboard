import { Queue, Worker } from 'bullmq';
import { getRedisConnection } from '../config/runtime';
import { createLogger } from '../lib/logger';
import { retryPendingDeliveries } from '../services/WebhookDispatcher';

const logger = createLogger('webhook-retry-job');

const QUEUE_NAME = 'webhook-retry';
const JOB_NAME = 'retry-pending-deliveries';
const REPEAT_JOB_ID = 'webhook-retry-repeat';
/** Poll for due retries every minute (shortest retry delay is well above this) */
const INTERVAL_MS = 60 * 1000;

let queue: Queue | null = null;
let worker: Worker | null = null;

/**
 * Schedule retryPendingDeliveries() as a repeatable BullMQ job.
 * Using a single Redis-backed repeatable job means only one pod runs each tick.
 */
export const startWebhookRetryJob = async (): Promise<void> => {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: getRedisConnection() });
  }

  if (!worker) {
    worker = new Worker(QUEUE_NAME, () => retryPendingDeliveries(), {
      connection: getRedisConnection(),
      concurrency: 1,
    });

    worker.on('failed', (job, err) => {
      logger.error('Webhook retry job failed', { jobId: job?.id, error: err.message });
    });
  }

  await queue.add(JOB_NAME, {}, {
    repeat: { every: INTERVAL_MS },
    jobId: REPEAT_JOB_ID,
    removeOnComplete: 10,
    removeOnFail: 20,
  });

  logger.info('Webhook retry scheduler started', { intervalMs: INTERVAL_MS });
};

export const stopWebhookRetryJob = async (): Promise<void> => {
  await worker?.close();
  await queue?.close();
  worker = null;
  queue = null;
};
