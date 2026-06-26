import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { getRedisConnection } from '../config/runtime';
import { createLogger } from '../lib/logger';
import { facebookService } from '../services/FacebookService';

const logger = createLogger('facebook-token-refresh-job');

/**
 * Facebook OAuth error code 190 subcodes indicating permanent token revocation.
 * These are non-retryable: the user must reconnect the app.
 *   458 — user removed app from their Facebook account
 *   460 — password change invalidated token
 *   463 — token has expired (non-recoverable)
 *   467 — token has been invalidated (logout / session revoked)
 */
const REVOCATION_SUBCODES = new Set([458, 460, 463, 467]);

function isFacebookRevocation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  try {
    // Errors from FacebookService are stringified: "...failed: <json>"
    const jsonMatch = msg.match(/failed: (\{.+\})$/s);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      const inner = parsed?.error ?? parsed;
      const code    = Number(inner?.code    ?? inner?.error_code    ?? 0);
      const subcode = Number(inner?.subcode ?? inner?.error_subcode ?? 0);
      return code === 190 && REVOCATION_SUBCODES.has(subcode);
    }
  } catch {
    // parse failure → not a revocation error
  }
  return false;
}

async function handleRevocation(key: string, redis: Redis): Promise<void> {
  await redis.hset(key, {
    status:           'disconnected',
    disconnectedAt:   String(Date.now()),
    disconnectReason: 'token_revoked',
  });
  // Remove the TTL so the disconnected state persists for auditing
  await redis.persist(key);
  logger.warn('Facebook token revoked — marked disconnected', { key });
}

const QUEUE_NAME = 'facebook-token-refresh';
const JOB_NAME = 'refresh-facebook-tokens';
const REPEAT_JOB_ID = 'facebook-token-refresh-repeat';

// Run daily at 03:00 UTC
const REFRESH_CRON = process.env.FACEBOOK_TOKEN_REFRESH_CRON || '0 3 * * *';

// Refresh tokens that expire within 10 days (Facebook long-lived tokens last 60 days)
const REFRESH_THRESHOLD_DAYS = 10;

/**
 * Redis key pattern for stored Facebook long-lived tokens.
 * Hash fields: accessToken, expiresAt (unix ms as string)
 *
 * Key: facebook:token:<userId>
 */
export const FACEBOOK_TOKEN_KEY = (userId: string) => `facebook:token:${userId}`;

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) _redis = new Redis(getRedisConnection());
  return _redis;
}

let queue: Queue | null = null;
let worker: Worker | null = null;

export const startFacebookTokenRefreshJob = async (): Promise<void> => {
  if (!facebookService.isConfigured()) {
    logger.info('Facebook API not configured, token refresh job skipped');
    return;
  }

  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: getRedisConnection() });
  }

  if (!worker) {
    worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        const redis = getRedis();
        const thresholdMs = REFRESH_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
        const expiryBefore = Date.now() + thresholdMs;

        // Scan for all facebook:token:* keys
        const keys: string[] = [];
        let cursor = '0';
        do {
          const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', 'facebook:token:*', 'COUNT', 100);
          cursor = nextCursor;
          keys.push(...batch);
        } while (cursor !== '0');

        logger.info('Facebook token refresh: scanning tokens', { jobId: job.id, total: keys.length });

        let refreshed = 0;
        let failed = 0;

        for (const key of keys) {
          const data = await redis.hgetall(key);
          if (!data.accessToken || !data.expiresAt) continue;

          const expiresAt = Number(data.expiresAt);
          if (expiresAt > expiryBefore) continue; // not expiring soon

          try {
            const result = await facebookService.getLongLivedUserToken(data.accessToken);
            await redis.hset(key, {
              accessToken: result.accessToken,
              expiresAt: String(result.expiresAt),
            });
            // Extend Redis TTL to match the new token lifetime (60 days + buffer)
            await redis.expireat(key, Math.ceil(result.expiresAt / 1000) + 86400);
            refreshed++;
            logger.info('Facebook token refreshed', { key });
          } catch (err: unknown) {
            if (isFacebookRevocation(err)) {
              await handleRevocation(key, redis);
              // Revocation is terminal — do not count as a retryable failure
              continue;
            }
            logger.error('Failed to refresh Facebook token', { key, error: err instanceof Error ? err.message : String(err) });
            failed++;
          }
        }

        logger.info('Facebook token refresh complete', { jobId: job.id, refreshed, failed });
        return { refreshed, failed };
      },
      { connection: getRedisConnection() },
    );

    worker.on('completed', (job) => {
      logger.info('Facebook token refresh job completed', { jobId: job.id, result: job.returnvalue });
    });

    worker.on('failed', (job, error) => {
      logger.error('Facebook token refresh job failed', { jobId: job?.id, error: error.message });
    });
  }

  await queue.add(
    JOB_NAME,
    {},
    {
      repeat: { pattern: REFRESH_CRON },
      jobId: REPEAT_JOB_ID,
      removeOnComplete: 10,
      removeOnFail: 50,
    },
  );

  logger.info('Facebook token refresh job started', { cron: REFRESH_CRON });
};

export const stopFacebookTokenRefreshJob = async (): Promise<void> => {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
  logger.info('Facebook token refresh job stopped');
};
