import { EventEmitter } from 'events';
import { Queue, Worker, QueueEvents, JobsOptions, ConnectionOptions } from 'bullmq';
import Redis from 'ioredis';
import { config } from '../config/config';
import { createLogger } from '../lib/logger';

const logger = createLogger('queue-manager');

/**
 * Parse Redis URL into connection options
 * Supports formats: redis://host:port, redis://user:pass@host:port, rediss://host:port (TLS)
 */
function parseRedisUrl(url: string): ConnectionOptions {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port || '6379', 10),
      password: parsed.password || undefined,
      username: parsed.username || undefined,
      tls: parsed.protocol === 'rediss:' ? {} : undefined,
      maxRetriesPerRequest: null,
      retryStrategy: (times: number) => {
        if (times > 10) {
          logger.error('Redis connection failed after 10 retries');
          return null;
        }
        return Math.min(times * 100, 3000);
      },
    };
  } catch (error) {
    logger.error('Failed to parse REDIS_URL, falling back to default', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      host: 'localhost',
      port: 6379,
      maxRetriesPerRequest: null,
    };
  }
}

/**
 * Create a shared Redis connection using ioredis
 * This connection is used for BullMQ queues
 */
function createRedisConnection(): ConnectionOptions {
  const redisUrl = config.REDIS_URL;

  if (redisUrl) {
    logger.info('Using Redis connection from REDIS_URL');
    return parseRedisUrl(redisUrl);
  }

  // Fallback to individual config values
  logger.info('Using Redis connection from config (REDIS_HOST, REDIS_PORT)');
  return {
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    retryStrategy: (times: number) => {
      if (times > 10) {
        logger.error('Redis connection failed after 10 retries');
        return null;
      }
      return Math.min(times * 100, 3000);
    },
  };
}

// Redis connection configuration using REDIS_URL or fallback
const connection: ConnectionOptions = createRedisConnection();

// Create ioredis instance for direct Redis operations if needed
export const redisClient = config.REDIS_URL
  ? new Redis(config.REDIS_URL)
  : new Redis({
      host: config.REDIS_HOST,
      port: config.REDIS_PORT,
      password: config.REDIS_PASSWORD || undefined,
    });

export async function closeRedisClient(): Promise<void> {
  await redisClient.quit();
}

// Queue options interface
export interface QueueConfig {
  name: string;
  defaultJobOptions?: JobsOptions;
}

/**
 * QueueManager - Centralized queue management for BullMQ
 * Handles creation, lifecycle, and monitoring of all job queues.
 *
 * Emits 'queue-created' (name: string, queue: Queue, events: QueueEvents) whenever
 * a new queue is registered, so observers can attach to queues created later.
 */
export class QueueManager extends EventEmitter {
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();
  private queueEvents: Map<string, QueueEvents> = new Map();

  /**
   * Create a new queue or return existing one
   */
  createQueue(name: string, options?: Partial<JobsOptions>): Queue {
    if (this.queues.has(name)) {
      return this.queues.get(name)!;
    }

    const queue = new Queue(name, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 1000,
        ...options,
      },
    });

    // Set up queue events for monitoring
    const queueEvents = new QueueEvents(name, { connection });
    this.queueEvents.set(name, queueEvents);

    queueEvents.on('completed', ({ jobId, returnvalue }) => {
      logger.info(`Job ${jobId} completed`, { queueName: name, jobId, returnvalue });
    });

    queueEvents.on('failed', ({ jobId, failedReason }) => {
      logger.error(`Job ${jobId} failed`, { queueName: name, jobId, failedReason });
    });

    queueEvents.on('stalled', ({ jobId }) => {
      logger.warn(`Job ${jobId} stalled`, { queueName: name, jobId });
    });

    this.queues.set(name, queue);
    logger.info(`Queue "${name}" created`, { queueName: name });
    this.emit('queue-created', name, queue, queueEvents);

    return queue;
  }

  /**
   * Create a worker for processing jobs
   */
  createWorker(
    name: string,
    processor: (job: any) => Promise<any>,
    options: { concurrency?: number; limiter?: any } = {},
  ): Worker {
    if (this.workers.has(name)) {
      return this.workers.get(name)!;
    }

    const worker = new Worker(name, processor, {
      connection,
      concurrency: options.concurrency || 5,
      limiter: options.limiter,
    });

    // Error handling
    worker.on('failed', (job, err) => {
      logger.error(`Job ${job?.id} failed`, {
        queueName: name,
        jobId: job?.id,
        error: err.message,
      });
    });

    worker.on('completed', (job) => {
      logger.info(`Job ${job.id} completed`, { queueName: name, jobId: job.id });
    });

    worker.on('active', (job) => {
      logger.info(`Job ${job.id} started processing`, { queueName: name, jobId: job.id });
    });

    worker.on('stalled', (jobId) => {
      logger.warn(`Job ${jobId} stalled and will be retried`, { queueName: name, jobId });
    });

    worker.on('error', (err) => {
      logger.error(`Worker error for queue "${name}"`, { queueName: name, error: err.message });
    });

    this.workers.set(name, worker);
    logger.info(`Worker for queue "${name}" created`, { queueName: name });

    return worker;
  }

  /**
   * Get a queue by name
   */
  getQueue(name: string): Queue | undefined {
    return this.queues.get(name);
  }

  /**
   * Get a worker by name
   */
  getWorker(name: string): Worker | undefined {
    return this.workers.get(name);
  }

  /**
   * Get queue events for monitoring
   */
  getQueueEvents(name: string): QueueEvents | undefined {
    return this.queueEvents.get(name);
  }

  /**
   * Get all queue statistics
   */
  async getQueueStats(name: string): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  } | null> {
    const queue = this.queues.get(name);
    if (!queue) return null;

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }

  /**
   * Add a job to a queue
   */
  async addJob(
    queueName: string,
    jobName: string,
    data: any,
    options?: {
      priority?: number;
      delay?: number;
      repeat?: any;
      cron?: string;
      jobId?: string;
    },
  ): Promise<string | undefined> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue "${queueName}" not found`);
    }

    const job = await queue.add(jobName, data, {
      priority: options?.priority,
      delay: options?.delay,
      repeat: options?.repeat,
      jobId:
        options?.jobId ?? `${queueName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    });

    logger.info(`Job "${jobName}" added to queue "${queueName}"`, {
      queueName,
      jobName,
      jobId: job.id,
    });
    return job.id;
  }

  /**
   * Add bulk jobs to a queue
   */
  async addBulkJobs(
    queueName: string,
    jobs: Array<{
      name: string;
      data: any;
      options?: { priority?: number; delay?: number };
    }>,
  ): Promise<string[]> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue "${queueName}" not found`);
    }

    const bulkJobs = jobs.map((job) => ({
      name: job.name,
      data: job.data,
      opts: {
        priority: job.options?.priority,
        delay: job.options?.delay,
      },
    }));

    const addedJobs = await queue.addBulk(bulkJobs);
    logger.info(`Added ${addedJobs.length} jobs to queue "${queueName}"`, {
      queueName,
      count: addedJobs.length,
    });

    return addedJobs.map((job) => job.id as string);
  }

  /**
   * Get failed jobs from a queue
   */
  async getFailedJobs(name: string, start: number = 0, end: number = 20): Promise<any[]> {
    const queue = this.queues.get(name);
    if (!queue) return [];

    return await queue.getFailed(start, end);
  }

  /**
   * Get waiting jobs from a queue
   */
  async getWaitingJobs(name: string, start: number = 0, end: number = 20): Promise<any[]> {
    const queue = this.queues.get(name);
    if (!queue) return [];

    return await queue.getWaiting(start, end);
  }

  /**
   * Get active jobs from a queue
   */
  async getActiveJobs(name: string, start: number = 0, end: number = 20): Promise<any[]> {
    const queue = this.queues.get(name);
    if (!queue) return [];

    return await queue.getActive(start, end);
  }

  /**
   * Pause a queue
   */
  async pauseQueue(name: string): Promise<void> {
    const queue = this.queues.get(name);
    if (queue) {
      await queue.pause();
      logger.info(`Queue "${name}" paused`, { queueName: name });
    }
  }

  /**
   * Resume a queue
   */
  async resumeQueue(name: string): Promise<void> {
    const queue = this.queues.get(name);
    if (queue) {
      await queue.resume();
      logger.info(`Queue "${name}" resumed`, { queueName: name });
    }
  }

  /**
   * Clear all jobs from a queue
   */
  async clearQueue(name: string): Promise<void> {
    const queue = this.queues.get(name);
    if (queue) {
      await queue.drain();
      logger.info(`Queue "${name}" cleared`, { queueName: name });
    }
  }

  /**
   * Remove a specific job
   */
  async removeJob(queueName: string, jobId: string): Promise<void> {
    const queue = this.queues.get(queueName);
    if (queue) {
      const job = await queue.getJob(jobId);
      if (job) {
        await job.remove();
        logger.info(`Job ${jobId} removed from queue "${queueName}"`, { queueName, jobId });
      }
    }
  }

  /**
   * Retry a failed job
   */
  async retryJob(queueName: string, jobId: string): Promise<void> {
    const queue = this.queues.get(queueName);
    if (queue) {
      const job = await queue.getJob(jobId);
      if (job) {
        await job.retry();
        logger.info(`Job ${jobId} retry initiated`, { queueName, jobId });
      }
    }
  }

  /**
   * Get list of all queue names
   */
  getQueueNames(): string[] {
    return Array.from(this.queues.keys());
  }

  /**
   * Refresh queue metrics (no-op stub — metrics are fetched on demand via getQueueStats)
   */
  async refreshQueueMetrics(): Promise<void> {
    // Metrics are computed on-demand; nothing to pre-fetch here.
  }

  /**
   * Close all queues and workers gracefully.
   * Workers are drained first so in-flight jobs can complete before
   * the Redis connection is torn down.
   */
  async closeAll(): Promise<void> {
    logger.info('Closing all queues and workers...');

    // 1. Drain workers — wait for in-flight jobs to finish
    await Promise.all(Array.from(this.workers.values()).map((worker) => worker.close()));

    // 2. Close queue events and queues
    await Promise.all([
      ...Array.from(this.queueEvents.values()).map((events) => events.close()),
      ...Array.from(this.queues.values()).map((queue) => queue.close()),
    ]);

    // 3. Close the shared Redis client last
    await closeRedisClient();

    logger.info('All queues, workers, and connections closed');
  }
}

// Singleton instance
export const queueManager = new QueueManager();

// Export connection config for direct access if needed
export { connection as redisConnection };
