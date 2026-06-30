/**
 * Tests for LockService TTL extension (issue #718).
 *
 * Verifies that withLock keeps the lock alive for the full operation duration
 * even when the operation runs longer than the initial TTL.
 */

jest.mock('ioredis');
jest.mock('redlock');

import Redlock from 'redlock';

const mockExtend = jest.fn();
const mockUnlock = jest.fn().mockResolvedValue(undefined);
const mockLock = jest.fn();

// Build a fake lock object factory
const makeFakeLock = () => ({
  extend: mockExtend,
  unlock: mockUnlock,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();

  // extend returns a new lock-like object each time
  mockExtend.mockImplementation(() => Promise.resolve(makeFakeLock()));

  // redlock.lock resolves immediately with a fake lock
  (Redlock as unknown as jest.Mock).mockImplementation(() => ({
    lock: mockLock.mockResolvedValue(makeFakeLock()),
  }));
});

afterEach(() => {
  jest.useRealTimers();
});

// Re-require after mocks are set up so the module picks up the mocked Redlock
function getLockService() {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../utils/LockService').LockService as typeof import('../utils/LockService').LockService;
}

describe('LockService.withLock – TTL extension', () => {
  it('acquires the lock and releases it on success', async () => {
    const LockService = getLockService();
    const result = await LockService.withLock('test-key', async () => 'ok', { duration: 1000 });
    expect(result).toBe('ok');
    expect(mockLock).toHaveBeenCalledTimes(1);
    expect(mockUnlock).toHaveBeenCalledTimes(1);
  });

  it('extends the lock at TTL/2 intervals while the operation runs', async () => {
    const LockService = getLockService();
    const duration = 1000;

    // Start a long-running operation that we control manually
    let resolveOp!: () => void;
    const opPromise = LockService.withLock(
      'extend-key',
      () => new Promise<void>((res) => { resolveOp = res; }),
      { duration },
    );

    // Advance time by TTL/2 — one extend should fire
    await jest.advanceTimersByTimeAsync(duration / 2);
    expect(mockExtend).toHaveBeenCalledTimes(1);

    // Advance another TTL/2 — second extend
    await jest.advanceTimersByTimeAsync(duration / 2);
    expect(mockExtend).toHaveBeenCalledTimes(2);

    // Finish the operation
    resolveOp();
    await opPromise;

    // Lock must be released after the operation completes
    expect(mockUnlock).toHaveBeenCalledTimes(1);
  });

  it('stops extending after the operation finishes', async () => {
    const LockService = getLockService();
    const duration = 1000;

    await LockService.withLock('stop-extend-key', async () => 'done', { duration });

    const callsAfterFinish = mockExtend.mock.calls.length;

    // Advance time well past TTL — no more extends should happen
    await jest.advanceTimersByTimeAsync(duration * 3);
    expect(mockExtend.mock.calls.length).toBe(callsAfterFinish);
  });

  it('releases the lock even when the operation throws', async () => {
    const LockService = getLockService();

    await expect(
      LockService.withLock('error-key', async () => { throw new Error('boom'); }, { duration: 500 }),
    ).rejects.toThrow('boom');

    expect(mockUnlock).toHaveBeenCalledTimes(1);
  });

  it('aborts the operation and rejects when a TTL extension fails', async () => {
    mockExtend.mockImplementation(() => Promise.reject(new Error('redis down')));

    const LockService = getLockService();
    const duration = 1000;

    let signalAborted = false;
    const opPromise = LockService.withLock(
      'abort-key',
      (signal) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            signalAborted = true;
            reject(new Error('operation aborted'));
          });
        }),
      { duration },
    );

    await jest.advanceTimersByTimeAsync(duration / 2);

    await expect(opPromise).rejects.toThrow();
    expect(signalAborted).toBe(true);
    expect(mockUnlock).toHaveBeenCalledTimes(1);
  });
});
