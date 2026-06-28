import { Queue, Worker } from 'bullmq';
import { getRedisConnection } from '../config/runtime';
import { createLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { withCache, invalidateCache } from '../utils/cache';
import { predictiveService } from '../services/PredictiveService';
import { PlatformMedians } from '../types/predictive';

const logger = createLogger('platform-median-job');

const QUEUE_NAME = 'platform-median-refresh';
const JOB_NAME = 'compute-platform-medians';
const REPEAT_JOB_ID = 'platform-median-repeat';
/** Refresh every 6 hours */
const CRON = '0 */6 * * *';
export const PLATFORM_MEDIANS_CACHE_KEY = 'platform-medians';
const CACHE_TTL_SECONDS = 3600; // 1 hour

let queue: Queue | null = null;
let worker: Worker | null = null;

/** Compute per-platform medians from AnalyticsEntry rows in the last 30 days. */
export async function computePlatformMedians(): Promise<PlatformMedians> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.analyticsEntry.findMany({
    where: { metric: { in: ['reach', 'engagement'] }, recordedAt: { gte: thirtyDaysAgo } },
    select: { platform: true, metric: true, value: true },
  });

  // Group values by platform + metric
  const grouped: Record<string, Record<string, number[]>> = {};
  for (const { platform, metric, value } of rows) {
    grouped[platform] ??= {};
    grouped[platform][metric] ??= [];
    grouped[platform][metric].push(value);
  }

  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  };

  const result: PlatformMedians = {};
  for (const [platform, metrics] of Object.entries(grouped)) {
    result[platform] = {
      ...(metrics['reach'] ? { avgReach: median(metrics['reach']) } : {}),
      ...(metrics['engagement'] ? { avgEngagement: median(metrics['engagement']) } : {}),
    };
  }
  return result;
}

/** Compute medians and cache in Redis for 1 hour. */
export async function computeAndCachePlatformMedians(): Promise<PlatformMedians> {
  return withCache(PLATFORM_MEDIANS_CACHE_KEY, CACHE_TTL_SECONDS, computePlatformMedians);
}

export const startPlatformMedianJob = async (): Promise<void> => {
  // Seed immediately from cache (or DB on cache miss) so the first request
  // uses real data rather than hardcoded defaults.
  try {
    const medians = await computeAndCachePlatformMedians();
    if (Object.keys(medians).length > 0) {
      predictiveService.seedFromMedians(medians);
      logger.info('Platform medians seeded on startup', { platforms: Object.keys(medians) });
    }
  } catch (err) {
    logger.warn('Could not seed platform medians on startup, using defaults', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: getRedisConnection() });
  }

  if (!worker) {
    worker = new Worker(
      QUEUE_NAME,
      async () => {
        const medians = await computePlatformMedians();
        // Bust the cache so the next read picks up fresh values
        await invalidateCache(PLATFORM_MEDIANS_CACHE_KEY);
        await computeAndCachePlatformMedians();
        predictiveService.seedFromMedians(medians);
        logger.info('Platform medians refreshed', { platforms: Object.keys(medians) });
        return medians;
      },
      { connection: getRedisConnection() },
    );

    worker.on('failed', (job, err) => {
      logger.error('Platform median job failed', { jobId: job?.id, error: err.message });
    });
  }

  await queue.add(JOB_NAME, {}, {
    repeat: { pattern: CRON },
    jobId: REPEAT_JOB_ID,
    removeOnComplete: 10,
    removeOnFail: 20,
  });

  logger.info('Platform median scheduler started', { cron: CRON });
};

export const stopPlatformMedianJob = async (): Promise<void> => {
  await worker?.close();
  await queue?.close();
  worker = null;
  queue = null;
};
