/**
 * cache.test.ts
 *
 * Unit tests for the cache utility (src/utils/cache.ts).
 * Covers withCache, invalidateCache, and invalidateCachePattern.
 *
 * Redis is mocked entirely in-memory — no live Redis connection needed.
 * Each test starts with a clean store via beforeEach.
 */

// ── In-memory Redis mock ──────────────────────────────────────────────────────

const store = new Map<string, string>();

/** Minimal glob match: only handles the '*' wildcard used in Redis SCAN patterns. */
function matchPattern(key: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${regexStr}$`).test(key);
}

let _pipelineKeys: string[] = [];

interface MockPipeline {
  del: jest.Mock<MockPipeline, [string]>;
  exec: jest.Mock<Promise<unknown[]>, []>;
}

const mockPipeline: MockPipeline = {
  del: jest.fn((key: string) => {
    _pipelineKeys.push(key);
    return mockPipeline;
  }),
  exec: jest.fn(async () => {
    _pipelineKeys.forEach(k => store.delete(k));
    _pipelineKeys = [];
    return [];
  }),
};

const mockRedis = {
  get: jest.fn(async (key: string) => store.get(key) ?? null),
  set: jest.fn(async (key: string, value: string, _ex: string, _ttl: number) => {
    store.set(key, value);
    return 'OK';
  }),
  unlink: jest.fn(async (...keys: string[]) => {
    keys.forEach(k => store.delete(k));
    return keys.length;
  }),
  scan: jest.fn(async (cursor: string, _m: string, pattern: string, _c: string, _n: number) => {
    // Single-shot scan: return all matching keys on the first call, then done.
    if (cursor !== '0') return ['0', [] as string[]];
    const matching = [...store.keys()].filter(k => matchPattern(k, pattern));
    return ['0', matching] as [string, string[]];
  }),
  pipeline: jest.fn(() => {
    _pipelineKeys = [];
    return mockPipeline;
  }),
};

jest.mock('ioredis', () => jest.fn(() => mockRedis));

jest.mock('../../config/runtime', () => ({
  getRedisConnection: () => ({ host: '127.0.0.1', port: 6379 }),
}));

// ── Import SUT after mocks ────────────────────────────────────────────────────

import { withCache, invalidateCache, invalidateCachePattern } from '../cache';

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  store.clear();
  _pipelineKeys = [];
  jest.clearAllMocks();

  mockRedis.get.mockImplementation(async (key: string) => store.get(key) ?? null);
  mockRedis.set.mockImplementation(async (key: string, value: string) => {
    store.set(key, value);
    return 'OK';
  });
  mockRedis.unlink.mockImplementation(async (...keys: string[]) => {
    keys.forEach(k => store.delete(k));
    return keys.length;
  });
  mockRedis.scan.mockImplementation(async (cursor: string, _m: string, pattern: string) => {
    if (cursor !== '0') return ['0', []];
    const matching = [...store.keys()].filter(k => matchPattern(k, pattern));
    return ['0', matching];
  });
  mockPipeline.del.mockImplementation((key: string) => {
    _pipelineKeys.push(key);
    return mockPipeline;
  });
  mockPipeline.exec.mockImplementation(async () => {
    _pipelineKeys.forEach(k => store.delete(k));
    _pipelineKeys = [];
    return [];
  });
  mockRedis.pipeline.mockImplementation(() => {
    _pipelineKeys = [];
    return mockPipeline;
  });
});

// ── withCache ─────────────────────────────────────────────────────────────────

describe('withCache()', () => {
  it('calls fetcher on cache miss and returns its value', async () => {
    const fetcher = jest.fn().mockResolvedValue({ id: 1 });
    const result = await withCache('user:1', 300, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: 1 });
  });

  it('stores the result in Redis with the cache: namespace prefix', async () => {
    const fetcher = jest.fn().mockResolvedValue('hello');
    await withCache('greeting', 60, fetcher);
    expect(store.has('cache:greeting')).toBe(true);
  });

  it('stores the result using the correct TTL', async () => {
    const fetcher = jest.fn().mockResolvedValue(42);
    await withCache('counter', 120, fetcher);
    expect(mockRedis.set).toHaveBeenCalledWith(
      'cache:counter',
      JSON.stringify(42),
      'EX',
      120,
    );
  });

  it('returns the cached value on a subsequent call without invoking fetcher again', async () => {
    const fetcher = jest.fn().mockResolvedValue({ name: 'Alice' });
    await withCache('user:alice', 300, fetcher);
    const second = await withCache('user:alice', 300, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ name: 'Alice' });
  });

  it('returns a parsed object (not raw JSON string) on cache hit', async () => {
    store.set('cache:obj', JSON.stringify({ x: 99 }));
    const fetcher = jest.fn();
    const result = await withCache('obj', 60, fetcher);
    expect(result).toEqual({ x: 99 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not store a cache entry when fetcher returns null', async () => {
    const fetcher = jest.fn().mockResolvedValue(null);
    await withCache('nothing', 60, fetcher);
    expect(store.has('cache:nothing')).toBe(false);
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('does not store a cache entry when fetcher returns undefined', async () => {
    const fetcher = jest.fn().mockResolvedValue(undefined);
    await withCache('undef', 60, fetcher);
    expect(store.has('cache:undef')).toBe(false);
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('still returns null when fetcher returns null (no cache bypass)', async () => {
    const fetcher = jest.fn().mockResolvedValue(null);
    const result = await withCache('empty', 60, fetcher);
    expect(result).toBeNull();
  });

  it('different keys are cached independently', async () => {
    await withCache('a', 60, jest.fn().mockResolvedValue('A'));
    await withCache('b', 60, jest.fn().mockResolvedValue('B'));
    expect(store.get('cache:a')).toBe('"A"');
    expect(store.get('cache:b')).toBe('"B"');
  });

  it('calls fetcher again after the cache key is manually deleted', async () => {
    const fetcher = jest.fn().mockResolvedValue('fresh');
    await withCache('item', 60, fetcher);
    store.delete('cache:item');
    await withCache('item', 60, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

// ── invalidateCache ───────────────────────────────────────────────────────────

describe('invalidateCache()', () => {
  it('deletes exactly the namespaced key from Redis', async () => {
    store.set('cache:user:1', '{"id":1}');
    await invalidateCache('user:1');
    expect(store.has('cache:user:1')).toBe(false);
  });

  it('does not delete unrelated keys', async () => {
    store.set('cache:user:1', '{"id":1}');
    store.set('cache:user:2', '{"id":2}');
    await invalidateCache('user:1');
    expect(store.has('cache:user:2')).toBe(true);
  });

  it('uses a pipeline (batches the delete operation)', async () => {
    await invalidateCache('any:key');
    expect(mockRedis.pipeline).toHaveBeenCalled();
    expect(mockPipeline.del).toHaveBeenCalledWith('cache:any:key');
    expect(mockPipeline.exec).toHaveBeenCalled();
  });

  it('deletes multiple keys in a single pipeline call', async () => {
    store.set('cache:k1', '1');
    store.set('cache:k2', '2');
    await invalidateCache('k1', 'k2');
    expect(store.has('cache:k1')).toBe(false);
    expect(store.has('cache:k2')).toBe(false);
  });

  it('is a no-op when the key does not exist', async () => {
    await expect(invalidateCache('nonexistent')).resolves.toBeUndefined();
  });

  it('adds the cache: prefix to each key passed', async () => {
    await invalidateCache('org:5', 'post:7');
    expect(mockPipeline.del).toHaveBeenCalledWith('cache:org:5');
    expect(mockPipeline.del).toHaveBeenCalledWith('cache:post:7');
  });
});

// ── invalidateCachePattern ────────────────────────────────────────────────────

describe('invalidateCachePattern()', () => {
  it('deletes all keys matching the pattern', async () => {
    store.set('cache:org:1:posts', 'a');
    store.set('cache:org:1:users', 'b');
    store.set('cache:org:2:posts', 'c');
    await invalidateCachePattern('org:1:*');
    expect(store.has('cache:org:1:posts')).toBe(false);
    expect(store.has('cache:org:1:users')).toBe(false);
  });

  it('does not delete keys that do not match the pattern', async () => {
    store.set('cache:org:1:posts', 'a');
    store.set('cache:org:2:posts', 'c');
    await invalidateCachePattern('org:1:*');
    expect(store.has('cache:org:2:posts')).toBe(true);
  });

  it('prepends the cache: namespace to the SCAN pattern', async () => {
    await invalidateCachePattern('org:*');
    expect(mockRedis.scan).toHaveBeenCalledWith(
      '0', 'MATCH', 'cache:org:*', 'COUNT', 100,
    );
  });

  it('uses unlink (not del) to remove matched keys', async () => {
    store.set('cache:temp:1', 'x');
    await invalidateCachePattern('temp:*');
    expect(mockRedis.unlink).toHaveBeenCalled();
  });

  it('is a no-op when no keys match the pattern', async () => {
    store.set('cache:user:1', 'x');
    await expect(invalidateCachePattern('org:*')).resolves.toBeUndefined();
    expect(mockRedis.unlink).not.toHaveBeenCalled();
  });

  it('deletes all keys across multiple matching namespaces', async () => {
    store.set('cache:session:a', '1');
    store.set('cache:session:b', '2');
    store.set('cache:session:c', '3');
    await invalidateCachePattern('session:*');
    expect(store.size).toBe(0);
  });
});
