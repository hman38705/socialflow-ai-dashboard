import Redis from 'ioredis';
import { getRedisConnection } from '../config/runtime';

/** Mirrors the shape of TwoFactorLockoutStore in src/services/twoFactorService.ts */
export interface TwoFactorLockoutStore {
  recordFailedAttempt(userId: string): Promise<void>;
  isLockedOut(userId: string): Promise<boolean>;
  getLockoutRemainingMs(userId: string): Promise<number>;
  resetFailedAttempts(userId: string): Promise<void>;
}

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_S = 5 * 60; // 5 minutes
const PREFIX = '2fa:lockout:';
const ATTEMPTS_SUFFIX = ':attempts';
const LOCKED_SUFFIX = ':locked_until';

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (!_redis) _redis = new Redis(getRedisConnection());
  return _redis;
}

export const redisTwoFactorLockoutStore: TwoFactorLockoutStore = {
  async recordFailedAttempt(userId: string): Promise<void> {
    const redis = getRedis();
    const attemptsKey = `${PREFIX}${userId}${ATTEMPTS_SUFFIX}`;
    const lockedKey = `${PREFIX}${userId}${LOCKED_SUFFIX}`;

    const attempts = await redis.incr(attemptsKey);
    // Keep the attempts key alive for the lockout window
    await redis.expire(attemptsKey, LOCKOUT_DURATION_S);

    if (attempts >= LOCKOUT_THRESHOLD) {
      await redis.set(lockedKey, '1', 'EX', LOCKOUT_DURATION_S);
    }
  },

  async isLockedOut(userId: string): Promise<boolean> {
    const result = await getRedis().get(`${PREFIX}${userId}${LOCKED_SUFFIX}`);
    return result !== null;
  },

  async getLockoutRemainingMs(userId: string): Promise<number> {
    const ttl = await getRedis().pttl(`${PREFIX}${userId}${LOCKED_SUFFIX}`);
    return ttl > 0 ? ttl : 0;
  },

  async resetFailedAttempts(userId: string): Promise<void> {
    const redis = getRedis();
    await redis.del(
      `${PREFIX}${userId}${ATTEMPTS_SUFFIX}`,
      `${PREFIX}${userId}${LOCKED_SUFFIX}`,
    );
  },
};
