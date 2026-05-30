import Redis from 'ioredis';
import { redis } from '../lib/redis';
import { createLogger } from '../lib/logger';

const logger = createLogger('AuthBlacklistService');

const BLACKLIST_PREFIX = 'jwt:blacklist:';

// In-memory LRU fallback for recently blacklisted tokens
const LRU_MAX = 1000;
const lruCache = new Map<string, number>(); // key -> expiry epoch ms

function lruSet(key: string, ttlSeconds: number): void {
  if (lruCache.size >= LRU_MAX) {
    const firstKey = lruCache.keys().next().value;
    if (firstKey !== undefined) lruCache.delete(firstKey);
  }
  lruCache.set(key, Date.now() + ttlSeconds * 1000);
}

function lruHas(key: string): boolean {
  const expiry = lruCache.get(key);
  if (expiry === undefined) return false;
  if (Date.now() > expiry) {
    lruCache.delete(key);
    return false;
  }
  return true;
}

function incrementRedisErrorCounter(): void {
  logger.warn('metric: auth_blacklist_redis_errors_total +1');
}

/**
 * Parses a JWT expiry string (e.g. "15m", "7d", "1h") into seconds.
 * Falls back to the provided default if parsing fails.
 */
function parseTTLSeconds(value: string | undefined, fallbackSeconds: number): number {
  if (!value) return fallbackSeconds;
  const match = value.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return fallbackSeconds;
  const n = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return n * multipliers[unit];
}

function getRedis(): Redis {
  return redis;
}

export const AuthBlacklistService = {
  /**
   * Blacklist an access token until it naturally expires.
   * @param jti  - unique token identifier (jti claim); falls back to sub+iat as key
   * @param ttlSeconds - remaining lifetime of the token in seconds
   */
  blacklistToken: async (tokenKey: string, ttlSeconds: number): Promise<void> => {
    if (ttlSeconds <= 0) return; // already expired, nothing to store
    lruSet(tokenKey, ttlSeconds);
    try {
      await getRedis().set(`${BLACKLIST_PREFIX}${tokenKey}`, '1', 'EX', ttlSeconds);
    } catch (err) {
      logger.warn('Redis unavailable — token blacklist write skipped', { tokenKey, err });
    }
  },

  /**
   * Returns true if the token has been blacklisted.
   * On Redis error, logs a warning, increments the error counter, and falls
   * back to the in-memory LRU cache so valid tokens are not blocked.
   */
  isBlacklisted: async (tokenKey: string): Promise<boolean> => {
    try {
      const result = await getRedis().get(`${BLACKLIST_PREFIX}${tokenKey}`);
      return result !== null;
    } catch (err) {
      incrementRedisErrorCounter();
      logger.warn('Redis unavailable for blacklist check — falling back to LRU cache', { tokenKey, err });
      return lruHas(tokenKey);
    }
  },

  /**
   * Derive a stable cache key from JWT payload fields.
   * Prefers jti; falls back to "<sub>:<iat>" so we never store the raw token.
   */
  keyFromPayload: (payload: { sub?: string; jti?: string; iat?: number }): string => {
    if (payload.jti) return payload.jti;
    return `${payload.sub ?? 'unknown'}:${payload.iat ?? 0}`;
  },

  /**
   * Compute remaining TTL in seconds for an access token.
   */
  accessTokenTTL: (): number => {
    return parseTTLSeconds(process.env.JWT_EXPIRES_IN, 15 * 60); // default 15 min
  },
};
