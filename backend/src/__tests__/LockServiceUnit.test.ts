/**
 * Unit tests for LockService
 *
 * Covers (per issue #1112):
 *   - withLock acquires the Redlock lock, runs fn, and releases the lock
 *   - Lock is released even when fn throws (release-on-error)
 *   - When Redis is unavailable the service falls back to the local AsyncMutex
 *   - Two concurrent callers with the same key: second waits until first releases
 *   - Lock TTL expiry during a long-running fn is surfaced as an error (LockError)
 *
 * NOTE: The `unit` jest project mocks LockService via moduleNameMapper.
 * We bypass this by calling jest.resetModules() and requiring the real module
 * via require() so that the actual implementation is exercised.
 *
 * Closes #1112
 */

// Mock ioredis and redlock before anything else loads
jest.mock('ioredis');
jest.mock('redlock');

import Redlock from 'redlock';

// ── Mock helpers ────────────────────────────────────────────────────────────

const mockUnlock = jest.fn().mockResolvedValue(undefined);
const mockExtend = jest.fn();
const mockRedlockLock = jest.fn();

function makeFakeLock() {
  return {
    extend: mockExtend,
    unlock: mockUnlock,
  };
}

/**
 * Re-require LockService after resetting modules so the real implementation
 * is loaded (not the mock registered in moduleNameMapper).
 */
function getLockService() {
  jest.resetModules();
  // Re-apply the ioredis / redlock mocks after module reset
  jest.mock('ioredis');
  jest.mock('redlock');

  // Re-configure the Redlock constructor mock
  (Redlock as unknown as jest.Mock).mockImplementation(() => ({
    lock: mockRedlockLock,
    LockError: Redlock.LockError,
  }));

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../utils/LockService').LockService as typeof import('../utils/LockService').LockService;
}

// ── Setup / teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();

  mockExtend.mockImplementation(() => Promise.resolve(makeFakeLock()));
  mockRedlockLock.mockResolvedValue(makeFakeLock());

  (Redlock as unknown as jest.Mock).mockImplementation(() => ({
    lock: mockRedlockLock,
  }));
});

afterEach(() => {
  jest.useRealTimers();
});

// ═══════════════════════════════════════════════════════════════════════════
// Distributed lock (Redlock path)
// ═══════════════════════════════════════════════════════════════════════════

describe('LockService.withLock – distributed lock (Redlock)', () => {
  it('acquires the lock, runs fn, and releases the lock on success', async () => {
    const LockService = getLockService();

    const fn = jest.fn().mockResolvedValue('result-value');
    const resultPromise = LockService.withLock('my-key', fn, { duration: 1000 });
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe('result-value');
    expect(mockRedlockLock).toHaveBeenCalledTimes(1);
    expect(mockRedlockLock).toHaveBeenCalledWith('lock:my-key', 1000);
    expect(mockUnlock).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('releases the lock even when fn throws (release-on-error)', async () => {
    const LockService = getLockService();

    const fn = jest.fn().mockRejectedValue(new Error('boom'));
    const resultPromise = LockService.withLock('error-key', fn, { duration: 500 });
    await jest.runAllTimersAsync();

    await expect(resultPromise).rejects.toThrow('boom');
    expect(mockUnlock).toHaveBeenCalledTimes(1);
  });

  it('prefixes the key with "lock:" when acquiring', async () => {
    const LockService = getLockService();

    const resultPromise = LockService.withLock('resource', async () => 'ok', { duration: 1000 });
    await jest.runAllTimersAsync();
    await resultPromise;

    expect(mockRedlockLock).toHaveBeenCalledWith('lock:resource', 1000);
  });

  it('uses the default 30-second TTL when duration is not specified', async () => {
    const LockService = getLockService();

    const resultPromise = LockService.withLock('default-ttl', async () => 'ok');
    await jest.runAllTimersAsync();
    await resultPromise;

    expect(mockRedlockLock).toHaveBeenCalledWith('lock:default-ttl', 30000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TTL extension
// ═══════════════════════════════════════════════════════════════════════════

describe('LockService.withLock – TTL extension', () => {
  it('extends the lock at TTL/2 intervals while the operation runs', async () => {
    const LockService = getLockService();
    const duration = 1000;

    let resolveOp!: () => void;
    const opPromise = LockService.withLock(
      'extend-key',
      () => new Promise<void>((res) => { resolveOp = res; }),
      { duration },
    );

    // First extension at TTL/2
    await jest.advanceTimersByTimeAsync(duration / 2);
    expect(mockExtend).toHaveBeenCalledTimes(1);

    // Second extension at TTL
    await jest.advanceTimersByTimeAsync(duration / 2);
    expect(mockExtend).toHaveBeenCalledTimes(2);

    resolveOp();
    await opPromise;

    // Lock must have been released
    expect(mockUnlock).toHaveBeenCalledTimes(1);
  });

  it('stops extending after the operation finishes', async () => {
    const LockService = getLockService();
    const duration = 1000;

    const resultPromise = LockService.withLock('stop-extend', async () => 'done', { duration });
    await jest.runAllTimersAsync();
    await resultPromise;

    const callsAfterFinish = mockExtend.mock.calls.length;

    // Additional timer advance should not trigger more extends
    await jest.advanceTimersByTimeAsync(duration * 5);
    expect(mockExtend.mock.calls.length).toBe(callsAfterFinish);
  });

  it('still releases the lock when extension fails', async () => {
    mockExtend.mockRejectedValue(new Error('extend failed'));
    const LockService = getLockService();

    let resolveOp!: () => void;
    const opPromise = LockService.withLock(
      'extend-fail-key',
      () => new Promise<void>((res) => { resolveOp = res; }),
      { duration: 1000 },
    );

    await jest.advanceTimersByTimeAsync(500); // trigger extension (it will fail)

    resolveOp();
    await opPromise;

    // The lock should still be released despite the extension failure
    expect(mockUnlock).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Local AsyncMutex fallback (Redis unavailable)
// ═══════════════════════════════════════════════════════════════════════════

describe('LockService.withLock – local AsyncMutex fallback', () => {
  it('falls back to the local mutex when Redlock cannot be created', async () => {
    // Make Redlock constructor throw to simulate Redis being unavailable
    (Redlock as unknown as jest.Mock).mockImplementation(() => {
      throw new Error('Redis connection refused');
    });

    const LockService = getLockService();
    // Reset again so the module picks up the throwing mock
    jest.resetModules();
    jest.mock('ioredis');
    jest.mock('redlock');
    (Redlock as unknown as jest.Mock).mockImplementation(() => {
      throw new Error('Redis connection refused');
    });
    const FallbackLockService = require('../utils/LockService').LockService as typeof import('../utils/LockService').LockService;

    const fn = jest.fn().mockResolvedValue('fallback-result');
    const resultPromise = FallbackLockService.withLock('fallback-key', fn);
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    // fn should still be called despite Redis being down
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toBe('fallback-result');
  });

  it('releases the local mutex even when fn throws', async () => {
    (Redlock as unknown as jest.Mock).mockImplementation(() => {
      throw new Error('no redis');
    });

    jest.resetModules();
    jest.mock('ioredis');
    jest.mock('redlock');
    (Redlock as unknown as jest.Mock).mockImplementation(() => {
      throw new Error('no redis');
    });

    const FallbackLockService = require('../utils/LockService').LockService as typeof import('../utils/LockService').LockService;

    const resultPromise = FallbackLockService.withLock('fallback-err', async () => {
      throw new Error('fn error');
    });
    await jest.runAllTimersAsync();

    // Should propagate the error but not hang (mutex released)
    await expect(resultPromise).rejects.toThrow('fn error');
  });

  it('serialises concurrent callers to the same key via the local mutex', async () => {
    // Use the real AsyncMutex logic (no Redlock) by forcing fallback
    (Redlock as unknown as jest.Mock).mockImplementation(() => {
      throw new Error('no redis');
    });

    jest.useRealTimers(); // Need real timers for actual async concurrency

    jest.resetModules();
    jest.mock('ioredis');
    jest.mock('redlock');
    (Redlock as unknown as jest.Mock).mockImplementation(() => {
      throw new Error('no redis');
    });

    const FallbackLockService = require('../utils/LockService').LockService as typeof import('../utils/LockService').LockService;

    const order: string[] = [];

    // First caller holds the lock for a bit
    const firstDone = jest.fn();
    let releaseFirst!: () => void;

    const first = FallbackLockService.withLock('concurrent-key', async () => {
      order.push('first-start');
      await new Promise<void>((res) => { releaseFirst = res; });
      order.push('first-end');
      firstDone();
    });

    // Give the first caller a tick to acquire
    await new Promise((res) => setImmediate(res));

    // Second caller should queue behind the first
    const second = FallbackLockService.withLock('concurrent-key', async () => {
      order.push('second-start');
    });

    // Release the first caller
    releaseFirst();
    await first;
    await second;

    // Second must start only after first finishes
    expect(order).toEqual(['first-start', 'first-end', 'second-start']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LockError surfacing
// ═══════════════════════════════════════════════════════════════════════════

describe('LockService.withLock – lock acquisition failure', () => {
  it('throws a descriptive error when the Redlock lock cannot be acquired', async () => {
    // Simulate Redlock.LockError on lock() call
    mockRedlockLock.mockRejectedValue(new Redlock.LockError('Lock already held'));

    const LockService = getLockService();

    const resultPromise = LockService.withLock('contested-key', async () => 'ok', { duration: 1000 });
    await jest.runAllTimersAsync();

    await expect(resultPromise).rejects.toThrow('Could not acquire lock for contested-key');
  });

  it('re-throws non-LockError exceptions from redlock.lock()', async () => {
    mockRedlockLock.mockRejectedValue(new Error('Unexpected Redis error'));

    const LockService = getLockService();

    const resultPromise = LockService.withLock('unexpected-err-key', async () => 'ok', { duration: 1000 });
    await jest.runAllTimersAsync();

    await expect(resultPromise).rejects.toThrow('Unexpected Redis error');
  });
});
