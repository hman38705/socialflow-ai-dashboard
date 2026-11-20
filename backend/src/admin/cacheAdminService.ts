import { redis } from '../lib/redis';
import { Logger } from '../lib/logger';

export interface CacheStats {
  totalKeys: number;
  usedMemoryBytes: number;
  usedMemoryHuman: string;
  connectedClients: number;
  uptimeSeconds: number;
}

/** Upper bound on keys examined per clearCache call. */
export const MAX_KEYS_PER_CALL = 100_000;

export interface ClearCacheOptions {
  pattern: string;
  batchSize: number;
  dryRun?: boolean;
  /** Admin performing the clear; recorded in the audit log entry. */
  actor?: string;
}

export interface ClearCacheResult {
  pattern: string;
  matchedKeys: number;
  deletedKeys: number;
  dryRun: boolean;
}

/**
 * Writes an audit log entry for an admin cache clear. Kept as a small,
 * injectable seam so tests can assert the audit write without touching
 * the audit log schema or redaction rules.
 */
export const writeCacheClearAudit = (
  logger: Logger,
  entry: { actor: string; pattern: string; dryRun: boolean },
): void => {
  logger.info('Audit: admin cache clear', {
    action: 'cache.clear',
    actor: entry.actor,
    pattern: entry.pattern,
    dryRun: entry.dryRun,
  });
};

export const clearCache = async (
  options: ClearCacheOptions,
  logger: Logger,
): Promise<ClearCacheResult> => {
  const dryRun = Boolean(options.dryRun);
  logger.info('Scanning Redis keys for cache clear', {
    pattern: options.pattern,
    batchSize: options.batchSize,
    dryRun,
  });

  let cursor = '0';
  let matchedKeys = 0;
  let deletedKeys = 0;

  do {
    const [nextCursor, batch] = await redis.scan(
      cursor,
      'MATCH',
      options.pattern,
      'COUNT',
      options.batchSize,
    );
    cursor = nextCursor;
    matchedKeys += batch.length;

    if (!dryRun && batch.length > 0) {
      deletedKeys += await redis.unlink(...batch);
    }
  } while (cursor !== '0' && matchedKeys < MAX_KEYS_PER_CALL);

  if (cursor !== '0') {
    logger.warn('Cache clear stopped at per-call key limit; run again to continue', {
      pattern: options.pattern,
      limit: MAX_KEYS_PER_CALL,
    });
  }

  logger.info('Cache clear completed', {
    pattern: options.pattern,
    matchedKeys,
    deletedKeys,
    dryRun,
  });

  writeCacheClearAudit(logger, {
    actor: options.actor ?? 'unknown',
    pattern: options.pattern,
    dryRun,
  });

  return { pattern: options.pattern, matchedKeys, deletedKeys, dryRun };
};

export const getCacheStats = async (logger: Logger): Promise<CacheStats> => {
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
};
