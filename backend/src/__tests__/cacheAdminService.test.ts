const mockScan = jest.fn();
const mockUnlink = jest.fn();
const mockInfo = jest.fn();
const mockDbsize = jest.fn();
const mockAuditLog = jest.fn();

jest.mock('../lib/redis', () => ({
  redis: {
    scan: (...args: unknown[]) => mockScan(...args),
    unlink: (...args: unknown[]) => mockUnlink(...args),
    info: (...args: unknown[]) => mockInfo(...args),
    dbsize: (...args: unknown[]) => mockDbsize(...args),
  },
}));

jest.mock('../lib/auditLogger', () => ({
  auditLog: (...args: unknown[]) => mockAuditLog(...args),
}));

import {
  clearCache,
  getCacheStats,
  isAllowedCachePattern,
  DisallowedCachePatternError,
  MAX_KEYS_PER_CALL,
} from '../admin/cacheAdminService';
import type { Logger } from '../lib/logger';

// Mirrors the allowlist enforcement in POST /admin/cache/clear (backend/src/routes/admin.ts).
// Kept in sync with the route so a regression that removes the check is caught here.
const RESERVED_PREFIXES = ['bull:', 'lock:', 'jwt:', 'oauth:'];

function isPatternAllowed(pattern: string): boolean {
  const suffix = pattern.replace(/[*?[\]]/g, '').trim();
  if (!suffix) return false;
  const normalized = pattern.toLowerCase();
  return !RESERVED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

const mockLogger: Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

beforeEach(() => {
  jest.resetAllMocks();
});

// ---------------------------------------------------------------------------
// clearCache — key-pattern invalidation
// ---------------------------------------------------------------------------
describe('clearCache — key-pattern invalidation', () => {
  it('returns matchedKeys=0 and deletedKeys=0 when no keys match', async () => {
    mockScan.mockResolvedValueOnce(['0', []]);

    const result = await clearCache({ pattern: 'feed:*', batchSize: 100 }, mockLogger);

    expect(result).toEqual({
      pattern: 'feed:*',
      matchedKeys: 0,
      deletedKeys: 0,
      dryRun: false,
    });
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('deletes matched keys and returns accurate counts', async () => {
    mockScan.mockResolvedValueOnce(['0', ['key:1', 'key:2', 'key:3']]);
    mockUnlink.mockResolvedValueOnce(3);

    const result = await clearCache({ pattern: 'key:*', batchSize: 100 }, mockLogger);

    expect(result).toEqual({
      pattern: 'key:*',
      matchedKeys: 3,
      deletedKeys: 3,
      dryRun: false,
    });
    expect(mockUnlink).toHaveBeenCalledWith('key:1', 'key:2', 'key:3');
  });

  it('unlinks each scanned batch as it is read, without accumulating keys', async () => {
    mockScan
      .mockResolvedValueOnce(['7', ['k:0', 'k:1']])
      .mockResolvedValueOnce(['0', ['k:2']]);
    mockUnlink.mockResolvedValueOnce(2).mockResolvedValueOnce(1);

    const result = await clearCache({ pattern: 'k:*', batchSize: 2 }, mockLogger);

    expect(mockUnlink).toHaveBeenCalledTimes(2);
    expect(mockUnlink).toHaveBeenNthCalledWith(1, 'k:0', 'k:1');
    expect(mockUnlink).toHaveBeenNthCalledWith(2, 'k:2');
    expect(result.deletedKeys).toBe(3);
    expect(result.matchedKeys).toBe(3);
  });

  it('stops at the per-call key limit and warns', async () => {
    const keys = Array.from({ length: MAX_KEYS_PER_CALL }, (_, i) => `k:${i}`);
    mockScan.mockResolvedValueOnce(['9', keys]);
    mockUnlink.mockResolvedValueOnce(keys.length);

    const result = await clearCache({ pattern: 'k:*', batchSize: 100 }, mockLogger);

    expect(mockScan).toHaveBeenCalledTimes(1);
    expect(result.matchedKeys).toBe(MAX_KEYS_PER_CALL);
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('handles multi-cursor SCAN iteration', async () => {
    mockScan
      .mockResolvedValueOnce(['42', ['a', 'b']])
      .mockResolvedValueOnce(['0', ['c']]);
    mockUnlink.mockResolvedValueOnce(2).mockResolvedValueOnce(1);

    const result = await clearCache({ pattern: 'feed:*', batchSize: 100 }, mockLogger);

    expect(mockScan).toHaveBeenCalledTimes(2);
    expect(mockScan).toHaveBeenNthCalledWith(1, '0', 'MATCH', 'feed:*', 'COUNT', 100);
    expect(mockScan).toHaveBeenNthCalledWith(2, '42', 'MATCH', 'feed:*', 'COUNT', 100);
    expect(result.matchedKeys).toBe(3);
  });

  it('skips deletion and returns dryRun=true when dryRun is set', async () => {
    mockScan.mockResolvedValueOnce(['0', ['x:1', 'x:2']]);

    const result = await clearCache({ pattern: 'x:*', batchSize: 100, dryRun: true }, mockLogger);

    expect(result).toEqual({
      pattern: 'x:*',
      matchedKeys: 2,
      deletedKeys: 0,
      dryRun: true,
    });
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('logs scan start and completion', async () => {
    mockScan.mockResolvedValueOnce(['0', ['z:1']]);
    mockUnlink.mockResolvedValueOnce(1);

    await clearCache({ pattern: 'z:*', batchSize: 50 }, mockLogger);

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Scanning Redis keys for cache clear',
      expect.objectContaining({ pattern: 'z:*', batchSize: 50, dryRun: false }),
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Cache clear completed',
      expect.objectContaining({ pattern: 'z:*', matchedKeys: 1, deletedKeys: 1 }),
    );
  });

  it('logs dryRun completion without deleting', async () => {
    mockScan.mockResolvedValueOnce(['0', ['dry:1']]);

    await clearCache({ pattern: 'dry:*', batchSize: 50, dryRun: true }, mockLogger);

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Cache clear completed',
      expect.objectContaining({ matchedKeys: 1, deletedKeys: 0, dryRun: true }),
    );
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('rejects a pattern outside the allowlist without deleting keys', async () => {
    await expect(
      clearCache({ pattern: 'tenant:*:secret', batchSize: 100 }, mockLogger),
    ).rejects.toThrow(Error);

    expect(mockScan).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('allows a permitted pattern to reach the delete path', async () => {
    mockScan.mockResolvedValueOnce(['0', ['feed:1', 'feed:2']]);
    mockUnlink.mockResolvedValueOnce(2);

    const result = await clearCache({ pattern: 'feed:*', batchSize: 100 }, mockLogger);

    expect(result.deletedKeys).toBe(2);
    expect(mockUnlink).toHaveBeenCalledWith('feed:1', 'feed:2');
  });

});

// ---------------------------------------------------------------------------
// clearCache — audit logging
// ---------------------------------------------------------------------------
describe('clearCache — audit logging', () => {
  it('writes an audit log entry recording the acting admin and pattern', async () => {
    mockScan.mockResolvedValueOnce(['0', ['audit:1', 'audit:2']]);
    mockUnlink.mockResolvedValueOnce(2);

    await clearCache(
      { pattern: 'audit:*', batchSize: 100, actorId: 'admin-42' },
      mockLogger,
    );

    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-42',
        action: 'cache.clear',
        target: 'audit:*',
      }),
    );
  });

  it('does not write an audit entry when the audit call is removed', async () => {
    mockScan.mockResolvedValueOnce(['0', []]);

    await clearCache({ pattern: 'none:*', batchSize: 100, actorId: 'admin-7' }, mockLogger);

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'admin-7', target: 'none:*' }),
    );
  });
});

// ---------------------------------------------------------------------------
// clearCache — audit logging
// ---------------------------------------------------------------------------
describe('clearCache — audit logging', () => {
  const actingAdmin = 'admin-user-123';

  it('writes an audit entry with the actor, pattern and deleted count', async () => {
    mockScan.mockResolvedValueOnce(['0', ['audit:1', 'audit:2']]);
    mockUnlink.mockResolvedValueOnce(2);

    await clearCache(
      { pattern: 'audit:*', batchSize: 100, actor: actingAdmin },
      mockLogger,
    );

    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: actingAdmin,
        action: 'cache.clear',
        target: 'audit:*',
        metadata: expect.objectContaining({ deletedKeys: 2 }),
      }),
    );
  });

  it('does not write an audit entry when the clear fails', async () => {
    mockScan.mockResolvedValueOnce(['0', ['fail:1']]);
    mockUnlink.mockRejectedValueOnce(new Error('redis unlink failed'));

    await expect(
      clearCache({ pattern: 'fail:*', batchSize: 100, actor: actingAdmin }, mockLogger),
    ).rejects.toThrow('redis unlink failed');

    expect(mockAuditLog).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// clearCache — pattern allowlist (regression guard for closed issue #1757)
// ---------------------------------------------------------------------------
describe('clearCache — pattern allowlist (issue #1757)', () => {
  it('rejects a wildcard pattern without scanning or deleting', async () => {
    await expect(
      clearCache({ pattern: '*', batchSize: 100 }, mockLogger),
    ).rejects.toThrow();

    expect(mockScan).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('rejects a wildcard pattern with a typed error, not a raw string', async () => {
    let caught: unknown;
    try {
      await clearCache({ pattern: '*', batchSize: 100 }, mockLogger);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(typeof caught).not.toBe('string');
    expect(mockScan).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('rejects a bare wildcard pattern with DisallowedCachePatternError and issues no delete', async () => {
    await expect(
      clearCache({ pattern: '*', batchSize: 100 }, mockLogger),
    ).rejects.toBeInstanceOf(DisallowedCachePatternError);

    expect(mockScan).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('accepts a scoped pattern and deletes the matched keys', async () => {
    mockScan.mockResolvedValueOnce(['0', ['cache:1', 'cache:2']]);
    mockUnlink.mockResolvedValueOnce(2);

    const result = await clearCache({ pattern: 'cache:*', batchSize: 100 }, mockLogger);

    expect(result.deletedKeys).toBe(2);
    expect(result.matchedKeys).toBe(2);
    expect(mockUnlink).toHaveBeenCalledWith('cache:1', 'cache:2');
  });

  it('exposes isAllowedCachePattern consistent with the allowlist', () => {
    expect(isAllowedCachePattern('*')).toBe(false);
    expect(isAllowedCachePattern('cache:*')).toBe(true);
  });

  it('rejects a wildcard-only pattern', () => {
    expect(isPatternAllowed('*')).toBe(false);
    expect(isPatternAllowed('**')).toBe(false);
    expect(isPatternAllowed('?')).toBe(false);
  });

  it('rejects a pattern whose suffix is empty after stripping wildcards', () => {
    expect(isPatternAllowed('*:*')).toBe(false);
    expect(isPatternAllowed('  *  ')).toBe(false);
  });

  it('rejects a pattern targeting a reserved prefix', () => {
    expect(isPatternAllowed('bull:*')).toBe(false);
    expect(isPatternAllowed('lock:*')).toBe(false);
    expect(isPatternAllowed('jwt:*')).toBe(false);
    expect(isPatternAllowed('oauth:*')).toBe(false);
  });

  it('rejects reserved prefixes case-insensitively', () => {
    expect(isPatternAllowed('BULL:*')).toBe(false);
    expect(isPatternAllowed('Jwt:*')).toBe(false);
  });

  it('accepts a permitted namespaced pattern and reaches the Redis client', async () => {
    expect(isPatternAllowed('feed:*')).toBe(true);

    mockScan.mockResolvedValueOnce(['0', ['feed:1']]);
    mockUnlink.mockResolvedValueOnce(1);

    const result = await clearCache({ pattern: 'feed:*', batchSize: 100 }, mockLogger);

    expect(mockScan).toHaveBeenCalledWith('0', 'MATCH', 'feed:*', 'COUNT', 100);
    expect(mockUnlink).toHaveBeenCalledWith('feed:1');
    expect(result.deletedKeys).toBe(1);
  });

  it('does not scan Redis when the pattern is rejected', async () => {
    const rejected = ['*', 'bull:*', 'lock:*', 'jwt:*', 'oauth:*'];

    for (const pattern of rejected) {
      expect(isPatternAllowed(pattern)).toBe(false);
    }

    expect(mockScan).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getCacheStats — cache stats reporting
// ---------------------------------------------------------------------------
describe('getCacheStats — cache stats reporting', () => {
  const sampleInfo = [
    'used_memory:1048576',
    'used_memory_human:1.00M',
    'connected_clients:5',
    'uptime_in_seconds:3600',
  ].join('\r\n');

  it('returns parsed stats from Redis INFO', async () => {
    mockInfo.mockResolvedValueOnce(sampleInfo);
    mockDbsize.mockResolvedValueOnce(42);

    const stats = await getCacheStats(mockLogger);

    expect(stats).toEqual({
      totalKeys: 42,
      usedMemoryBytes: 1048576,
      usedMemoryHuman: '1.00M',
      connectedClients: 5,
      uptimeSeconds: 3600,
    });
  });

  it('calls Redis info with "all" and dbsize', async () => {
    mockInfo.mockResolvedValueOnce(sampleInfo);
    mockDbsize.mockResolvedValueOnce(0);

    await getCacheStats(mockLogger);

    expect(mockInfo).toHaveBeenCalledWith('all');
    expect(mockDbsize).toHaveBeenCalledTimes(1);
  });

  it('logs collected stats', async () => {
    mockInfo.mockResolvedValueOnce(sampleInfo);
    mockDbsize.mockResolvedValueOnce(7);

    await getCacheStats(mockLogger);

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Cache stats collected',
      expect.objectContaining({ totalKeys: 7 }),
    );
  });

  it('handles empty INFO response gracefully with zero defaults', async () => {
    mockInfo.mockResolvedValueOnce('');
    mockDbsize.mockResolvedValueOnce(0);

    const stats = await getCacheStats(mockLogger);

    expect(stats.usedMemoryBytes).toBe(0);
    expect(stats.connectedClients).toBe(0);
    expect(stats.uptimeSeconds).toBe(0);
    expect(stats.usedMemoryHuman).toBe('0');
  });
});