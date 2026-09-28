import { Queue } from 'bullmq';
import { createLogger } from '../lib/logger';
import { getNumber, getRedisConnection } from '../config/runtime';

const logger = createLogger('VideoQueue');

export const VIDEO_TRANSCODE_QUEUE_NAME = 'video-transcoding';

/**
 * Cluster-wide cap on concurrent CPU-heavy transcodes. Enforced by BullMQ's
 * Redis-backed global concurrency, so it holds across all pods, not per process.
 */
const DEFAULT_MAX_CONCURRENT = getNumber(process.env.VIDEO_MAX_CONCURRENT_TRANSCODES, 1);

let _queue: Queue | null = null;

/**
 * Redis-backed (BullMQ) queue for video transcoding jobs.
 * Jobs are persisted in Redis, so queued and in-flight work survives restarts.
 */
export function getVideoTranscodeQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(VIDEO_TRANSCODE_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 86400 },
        removeOnFail: { age: 604800 },
      },
    });
  }
  return _queue;
}

class VideoQueue {
  /**
   * Apply the configured cluster-wide concurrency limit (call on worker startup)
   */
  public async applyConcurrencyLimit(): Promise<void> {
    await this.setMaxConcurrent(DEFAULT_MAX_CONCURRENT);
  }

  /**
   * Get queue status, read from Redis so it reflects every pod
   */
  public async getStatus() {
    const queue = getVideoTranscodeQueue();
    const [waiting, active, delayed, globalConcurrency, jobs] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getDelayedCount(),
      queue.getGlobalConcurrency(),
      queue.getWaiting(0, 49),
    ]);

    return {
      queueLength: waiting + delayed,
      activeJobs: active,
      maxConcurrent: globalConcurrency ?? DEFAULT_MAX_CONCURRENT,
      jobs: jobs.map((job) => ({
        id: job.id,
        priority: job.opts.priority ?? 0,
        addedAt: new Date(job.timestamp),
      })),
    };
  }

  /**
   * Set the max number of transcodes running concurrently across the cluster.
   * Active jobs are not interrupted; the new limit applies to subsequent pickups.
   */
  public async setMaxConcurrent(max: number): Promise<void> {
    const clamped = Math.max(1, max);
    await getVideoTranscodeQueue().setGlobalConcurrency(clamped);
    logger.info(`Video transcode global concurrency set to ${clamped}`);
  }
}

export const videoQueue = new VideoQueue();
