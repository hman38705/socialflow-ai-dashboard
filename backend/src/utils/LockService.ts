import Redlock from 'redlock';
import Redis from 'ioredis';
import { createLogger } from '../lib/logger';
import { getRedisConnection } from '../config/runtime';

const logger = createLogger('lock-service');

let redisClient: Redis | null = null;
let redlockInstance: Redlock | null = null;
let redisAvailable = true;

function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(getRedisConnection());
  }
  return redisClient;
}

function getRedlock(): Redlock | null {
  if (!redlockInstance && redisAvailable) {
    try {
      const client = getRedisClient();
      redlockInstance = new Redlock([client as any], {
        driftFactor: 0.01,
        retryCount: 3,
        retryDelay: 200,
        retryJitter: 200,
      });
    } catch (err) {
      logger.warn('Redis not available — LockService will use local mutex fallback', {
        error: err instanceof Error ? err.message : String(err),
      });
      redisAvailable = false;
      return null;
    }
  }
  return redlockInstance;
}

/**
 * A simple async mutex for local fallback when Redis is unavailable.
 * Uses a promise-based queue so that only one caller holds the lock at a time.
 */
class AsyncMutex {
  private currentQueue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return this.release.bind(this);
    }
    return new Promise<() => void>((resolve) => {
      this.currentQueue.push(() => {
        this.locked = true;
        resolve(this.release.bind(this));
      });
    });
  }

  private release(): void {
    if (this.currentQueue.length > 0) {
      const next = this.currentQueue.shift();
      next?.();
    } else {
      this.locked = false;
    }
  }
}

const localMutexes = new Map<string, AsyncMutex>();

function getLocalMutex(key: string): AsyncMutex {
  let mutex = localMutexes.get(key);
  if (!mutex) {
    mutex = new AsyncMutex();
    localMutexes.set(key, mutex);
  }
  return mutex;
}

export interface LockOptions {
  duration?: number;
  retries?: number;
}

export const LockService = {
  /**
   * Acquire a lock and execute a function.
   * A background interval extends the lock TTL every TTL/2 ms so the lock
   * is held for the full duration of the operation even when it exceeds the
   * initial TTL.
   *
   * If Redis is unavailable, falls back to a local in-process AsyncMutex.
   */
  async withLock<T>(key: string, fn: () => Promise<T>, options: LockOptions = {}): Promise<T> {
    const duration = options.duration || 30000; // 30 seconds default
    const lockKey = `lock:${key}`;

    // If Redis is unavailable, use the local mutex fallback
    const redlock = getRedlock();
    if (!redlock) {
      logger.warn(`Redis unavailable — using local mutex fallback for key: ${lockKey}`);
      const mutex = getLocalMutex(key);
      const release = await mutex.acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    }

    let lock;
    try {
      lock = await redlock.lock(lockKey, duration);
      logger.info(`Lock acquired: ${lockKey}`);

      // Extend the lock TTL every TTL/2 ms while the operation is running.
      let currentLock = lock;
      const extendInterval = setInterval(async () => {
        try {
          currentLock = await currentLock.extend(duration);
          logger.debug(`Lock extended: ${lockKey}`);
        } catch (extErr) {
          logger.warn(`Failed to extend lock: ${lockKey}`, {
            error: extErr instanceof Error ? extErr.message : String(extErr),
          });
        }
      }, Math.floor(duration / 2));

      try {
        return await fn();
      } finally {
        clearInterval(extendInterval);
        await currentLock.unlock().catch((err) => {
          logger.error(`Failed to unlock ${lockKey}`, { error: err.message });
        });
        logger.info(`Lock released: ${lockKey}`);
      }
    } catch (err) {
      if (err instanceof Redlock.LockError) {
        logger.warn(`Failed to acquire lock: ${lockKey}`, { error: err.message });
        throw new Error(`Could not acquire lock for ${key}`);
      }
      throw err;
    }
  },

  /**
   * Try to acquire a lock without retries
   */
  async tryLock(key: string, duration: number = 30000): Promise<Redlock.Lock | null> {
    const lockKey = `lock:${key}`;
    const redlock = getRedlock();
    if (!redlock) {
      logger.warn(`Redis unavailable — cannot tryLock remotely for: ${lockKey}`);
      return null;
    }
    try {
      const lock = await redlock.lock(lockKey, duration);
      logger.info(`Lock acquired: ${lockKey}`);
      return lock;
    } catch (err) {
      if (err instanceof Redlock.LockError) {
        logger.warn(`Lock already held: ${lockKey}`);
        return null;
      }
      throw err;
    }
  },

  /**
   * Release a lock manually
   */
  async releaseLock(lock: Redlock.Lock): Promise<void> {
    try {
      await lock.unlock();
      logger.info(`Lock released manually`);
    } catch (err) {
      logger.error(`Failed to release lock`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
};
