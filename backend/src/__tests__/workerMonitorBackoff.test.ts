import { WorkerMonitor } from '../monitoring/workerMonitor';
import { Worker } from 'bullmq';

jest.mock('bullmq');

describe('WorkerMonitor - Exponential Backoff', () => {
  let monitor: WorkerMonitor;
  let mockWorkerFactory: jest.Mock;
  let mockWorker: jest.Mocked<Worker>;
  let alertHandler: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockWorker = {
      close: jest.fn().mockResolvedValue(undefined),
      waitUntilReady: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    } as any;

    mockWorkerFactory = jest.fn().mockReturnValue(mockWorker);
    alertHandler = jest.fn();

    monitor = new WorkerMonitor({
      connection: { host: 'localhost', port: 6379 },
      restartBackoffBaseMs: 1000,
      restartBackoffMaxMs: 60000,
      maxRestartsPerHour: 10,
      alertHandler,
    });

    monitor.registerWorker('test-worker', 'test-queue', mockWorkerFactory);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should apply no delay on first restart', async () => {
    const restartPromise = (monitor as any).restartWorker('test-worker', {
      reason: 'test',
    });

    // Should not wait
    await restartPromise;

    expect(mockWorkerFactory).toHaveBeenCalledTimes(1);
    expect(alertHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          consecutiveRestarts: 1,
          backoffDelayMs: 0,
        }),
      }),
    );
  });

  it('should apply exponential backoff on successive restarts', async () => {
    // First restart - no delay
    await (monitor as any).restartWorker('test-worker', { reason: 'test' });
    expect(mockWorkerFactory).toHaveBeenCalledTimes(1);

    // Second restart - 2^1 * 1000ms = 2000ms delay
    const restart2Promise = (monitor as any).restartWorker('test-worker', { reason: 'test' });
    jest.advanceTimersByTime(2000);
    await restart2Promise;
    expect(mockWorkerFactory).toHaveBeenCalledTimes(2);
    expect(alertHandler).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          consecutiveRestarts: 2,
          backoffDelayMs: 2000,
        }),
      }),
    );

    // Third restart - 2^2 * 1000ms = 4000ms delay
    const restart3Promise = (monitor as any).restartWorker('test-worker', { reason: 'test' });
    jest.advanceTimersByTime(4000);
    await restart3Promise;
    expect(mockWorkerFactory).toHaveBeenCalledTimes(3);
    expect(alertHandler).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          consecutiveRestarts: 3,
          backoffDelayMs: 4000,
        }),
      }),
    );
  });

  it('should cap backoff delay at maxBackoffMs', async () => {
    // Simulate many consecutive restarts
    for (let i = 0; i < 10; i++) {
      const restartPromise = (monitor as any).restartWorker('test-worker', { reason: 'test' });
      jest.advanceTimersByTime(60000); // Advance by max delay
      await restartPromise;
    }

    // Last restart should have capped delay
    expect(alertHandler).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          backoffDelayMs: 60000, // Capped at maxBackoffMs
        }),
      }),
    );
  });

  it('should reset consecutive restarts after cooldown period', async () => {
    // First restart
    await (monitor as any).restartWorker('test-worker', { reason: 'test' });

    // Advance time beyond cooldown period (5 minutes)
    jest.advanceTimersByTime(6 * 60 * 1000);

    // Second restart after cooldown - should reset to 0 delay
    await (monitor as any).restartWorker('test-worker', { reason: 'test' });

    expect(alertHandler).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          consecutiveRestarts: 1,
          backoffDelayMs: 0,
        }),
      }),
    );
  });

  it('should not reset consecutive restarts if within cooldown period', async () => {
    // First restart
    await (monitor as any).restartWorker('test-worker', { reason: 'test' });

    // Advance time but stay within cooldown period (< 5 minutes)
    jest.advanceTimersByTime(2 * 60 * 1000);

    // Second restart - should continue exponential backoff
    const restart2Promise = (monitor as any).restartWorker('test-worker', { reason: 'test' });
    jest.advanceTimersByTime(2000);
    await restart2Promise;

    expect(alertHandler).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          consecutiveRestarts: 2,
          backoffDelayMs: 2000,
        }),
      }),
    );
  });

  it('should cap backoff at the 5-minute hard limit even when restartBackoffMaxMs exceeds it', async () => {
    // Configure restartBackoffMaxMs (10 min) intentionally above the hard cap (5 min = 300000 ms)
    const highMaxMonitor = new WorkerMonitor({
      connection: { host: 'localhost', port: 6379 },
      restartBackoffBaseMs: 1000,
      restartBackoffMaxMs: 10 * 60 * 1000, // 10 minutes — exceeds MAX_BACKOFF_MS
      maxRestartsPerHour: 20,
      alertHandler,
    });

    highMaxMonitor.registerWorker('high-max-worker', 'test-queue', mockWorkerFactory);

    // Drive consecutiveRestarts high enough that the uncapped exponential would exceed 5 min
    // 2^9 * 1000 = 512000 ms > 300000 ms (5 min hard cap)
    for (let i = 0; i < 9; i++) {
      const p = (highMaxMonitor as any).restartWorker('high-max-worker', { reason: 'test' });
      jest.advanceTimersByTime(300000);
      await p;
    }

    expect(alertHandler).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          backoffDelayMs: 300000, // Hard cap: 5 minutes regardless of config
        }),
      }),
    );
  });

  it('should respect maxRestartsPerHour limit even with backoff', async () => {
    const limitedMonitor = new WorkerMonitor({
      connection: { host: 'localhost', port: 6379 },
      restartBackoffBaseMs: 100,
      restartBackoffMaxMs: 1000,
      maxRestartsPerHour: 3,
      alertHandler,
    });

    limitedMonitor.registerWorker('limited-worker', 'test-queue', mockWorkerFactory);

    // Perform 3 restarts (at the limit)
    for (let i = 0; i < 3; i++) {
      const restartPromise = (limitedMonitor as any).restartWorker('limited-worker', {
        reason: 'test',
      });
      jest.advanceTimersByTime(1000);
      await restartPromise;
    }

    // Fourth restart should be denied
    await (limitedMonitor as any).restartWorker('limited-worker', { reason: 'test' });

    expect(alertHandler).toHaveBeenLastCalledWith(
      expect.objectContaining({
        severity: 'critical',
        code: 'MONITOR_ERROR',
        message: expect.stringContaining('Restart denied by safety limit'),
      }),
    );
  });
});
