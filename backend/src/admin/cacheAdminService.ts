import Redis from 'ioredis';
import { getRedisConnection } from '../config/runtime';
import { Logger } from '../lib/logger';

export interface CacheStats {
  totalKeys: number;
  usedMemoryBytes: number;
  usedMemoryHuman: string;
  connectedClients: number;
  uptimeSeconds: number;
}

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

const collectKeys = async (redis: Redis, pattern: string, batchSize: number): Promise<string[]> => {
  const keys: string[] = [];
  let cursor = '0';

  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', batchSize);
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== '0');

  return keys;
};

export interface ClearCacheOptions {
  pattern: string;
  batchSize: number;
  dryRun?: boolean;
}

export interface ClearCacheResult {
  pattern: string;
  matchedKeys: number;
  deletedKeys: number;
  dryRun: boolean;
}

export const clearCache = async (
  options: ClearCacheOptions,
  logger: Logger,
): Promise<ClearCacheResult> => {
  const redis = new Redis(getRedisConnection());

  try {
    logger.info('Scanning Redis keys for cache clear', {
      pattern: options.pattern,
      batchSize: options.batchSize,
      dryRun: Boolean(options.dryRun),
    });

    const keys = await collectKeys(redis, options.pattern, options.batchSize);

    if (options.dryRun || keys.length === 0) {
      logger.info('Cache clear scan completed', {
        matchedKeys: keys.length,
        deletedKeys: 0,
        dryRun: Boolean(options.dryRun),
      });

      return {
        pattern: options.pattern,
        matchedKeys: keys.length,
        deletedKeys: 0,
        dryRun: Boolean(options.dryRun),
      };
    }

    let deletedKeys = 0;

    for (const batch of chunk(keys, options.batchSize)) {
      deletedKeys += await redis.unlink(...batch);
    }

    logger.info('Cache clear completed', {
      pattern: options.pattern,
      matchedKeys: keys.length,
      deletedKeys,
    });

    return {
      pattern: options.pattern,
      matchedKeys: keys.length,
      deletedKeys,
      dryRun: false,
    };
  } finally {
    redis.disconnect();
  }
};

export const getCacheStats = async (logger: Logger): Promise<CacheStats> => {
  const redis = new Redis(getRedisConnection());

  try {
    const [infoRaw, totalKeys] = await Promise.all([
      redis.info('all'),
      redis.dbsize(),
    ]);

    const extract = (field: string): string => {
      const match = infoRaw.match(new RegExp(`${field}:(\\S+)`));
      return match ? match[1] : '0';
    };

    const stats: CacheStats = {
      totalKeys,
      usedMemoryBytes: parseInt(extract('used_memory'), 10),
      usedMemoryHuman: extract('used_memory_human'),
      connectedClients: parseInt(extract('connected_clients'), 10),
      uptimeSeconds: parseInt(extract('uptime_in_seconds'), 10),
    };

    logger.info('Cache stats collected', stats);

    return stats;
  } finally {
    redis.disconnect();
  }
};
