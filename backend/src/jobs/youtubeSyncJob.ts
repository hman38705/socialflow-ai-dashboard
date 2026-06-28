import { Queue, Worker } from 'bullmq';
import { getRedisConnection } from '../config/runtime';
import { createLogger } from '../lib/logger';
import { youTubeService, YouTubeQuotaError } from '../services/YouTubeService';

const logger = createLogger('youtube-sync-job');

const QUEUE_NAME = 'youtube-analytics-sync';
const JOB_NAME = 'sync-youtube-analytics';
const REPEAT_JOB_ID = 'youtube-analytics-repeat';

// Cron: every 6 hours
const SYNC_CRON = process.env.YOUTUBE_SYNC_CRON || '0 */6 * * *';

let queue: Queue | null = null;
let worker: Worker | null = null;

export interface YouTubeSyncPayload {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export const startYouTubeSyncJob = async (): Promise<void> => {
  if (!youTubeService.isConfigured()) {
    logger.info('YouTube API not configured, sync job skipped');
    return;
  }

  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: getRedisConnection() });
  }

  if (!worker) {
    worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        const { accessToken, refreshToken, expiresAt } = job.data as YouTubeSyncPayload;

        let token = accessToken;
        if (Date.now() >= expiresAt) {
          logger.info('Access token expired, refreshing', { jobId: job.id });
          const refreshed = await youTubeService.refreshAccessToken(refreshToken);
          token = refreshed.accessToken;
        }

        try {
          const videoIds = await youTubeService.listChannelVideos(token);
          const resolvedIds = Array.isArray(videoIds) ? videoIds : [];
          const stats = await youTubeService.getVideoStats(token, resolvedIds);
          const resolvedStats = Array.isArray(stats) ? stats : [];

          logger.info('YouTube analytics synced', {
            jobId: job.id,
            videoCount: resolvedStats.length,
          });

          return { synced: resolvedStats.length, timestamp: new Date().toISOString() };
        } catch (err) {
          if (err instanceof YouTubeQuotaError) {
            const delayMs = err.retryAfter.getTime() - Date.now();
            logger.warn('YouTube quota exceeded, delaying retry until quota resets', {
              jobId: job.id,
              retryAfter: err.retryAfter.toISOString(),
              delayMs,
            });
            await new Promise((resolve) => setTimeout(resolve, Math.max(delayMs, 0)));
          }
          throw err;
        }
      },
      { connection: getRedisConnection() },
    );

    worker.on('completed', (job) => {
      logger.info('YouTube sync job completed', { jobId: job.id, result: job.returnvalue });
    });

    worker.on('failed', (job, error) => {
      logger.error('YouTube sync job failed', { jobId: job?.id, error: error.message });
    });
  }

  await queue.add(
    JOB_NAME,
    {},
    {
      repeat: { pattern: SYNC_CRON },
      jobId: REPEAT_JOB_ID,
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  );

  logger.info('YouTube analytics sync job started', { cron: SYNC_CRON });
};

export const stopYouTubeSyncJob = async (): Promise<void> => {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
  logger.info('YouTube analytics sync job stopped');
};

/** Manually enqueue a one-off sync (e.g. after OAuth callback) */
export const enqueueYouTubeSync = async (payload: YouTubeSyncPayload): Promise<void> => {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: getRedisConnection() });
  }
  await queue.add(JOB_NAME, payload, { removeOnComplete: 10, removeOnFail: 20 });
  logger.info('YouTube one-off sync enqueued');
};
