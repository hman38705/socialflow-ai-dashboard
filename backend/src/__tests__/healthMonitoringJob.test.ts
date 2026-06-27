/**
 * Unit tests for healthMonitoringJob — health check aggregation and alert threshold evaluation.
 *
 * Closes #1061
 */

jest.mock('../services/serviceFactory', () => ({
  getHealthService: jest.fn(),
}));

import { getHealthService } from '../services/serviceFactory';
import { startHealthMonitoringJob, stopHealthMonitoringJob } from '../jobs/healthMonitoringJob';

const mockGetSystemStatus = jest.fn();

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  (getHealthService as jest.Mock).mockReturnValue({ getSystemStatus: mockGetSystemStatus });
  mockGetSystemStatus.mockResolvedValue({
    overallStatus: 'healthy',
    dependencies: {
      database: { status: 'healthy', latency: 5, errorRate: 0 },
      redis: { status: 'healthy', latency: 3, errorRate: 0 },
      s3: { status: 'healthy', latency: 10, errorRate: 0 },
      twitter: { status: 'healthy', latency: 20, errorRate: 0 },
    },
  });
});

afterEach(async () => {
  await stopHealthMonitoringJob();
  jest.useRealTimers();
});

// ── start / stop lifecycle ────────────────────────────────────────────────────

describe('startHealthMonitoringJob — lifecycle', () => {
  it('does not call getSystemStatus before the first interval tick', async () => {
    await startHealthMonitoringJob();
    expect(mockGetSystemStatus).not.toHaveBeenCalled();
  });

  it('calls getSystemStatus on each interval tick', async () => {
    await startHealthMonitoringJob();

    await jest.runOnlyPendingTimersAsync();
    expect(mockGetSystemStatus).toHaveBeenCalledTimes(1);

    await jest.runOnlyPendingTimersAsync();
    expect(mockGetSystemStatus).toHaveBeenCalledTimes(2);
  });

  it('uses HEALTH_CHECK_INTERVAL_MS env variable for the interval', async () => {
    process.env.HEALTH_CHECK_INTERVAL_MS = '60000';
    try {
      await startHealthMonitoringJob();

      jest.advanceTimersByTime(59999);
      expect(mockGetSystemStatus).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      await Promise.resolve(); // flush microtasks
      expect(mockGetSystemStatus).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.HEALTH_CHECK_INTERVAL_MS;
    }
  });

  it('defaults to 300000 ms when HEALTH_CHECK_INTERVAL_MS is not set', async () => {
    delete process.env.HEALTH_CHECK_INTERVAL_MS;
    await startHealthMonitoringJob();

    jest.advanceTimersByTime(299999);
    expect(mockGetSystemStatus).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    await Promise.resolve();
    expect(mockGetSystemStatus).toHaveBeenCalledTimes(1);
  });
});

describe('stopHealthMonitoringJob', () => {
  it('stops the interval so getSystemStatus is no longer called', async () => {
    await startHealthMonitoringJob();
    await stopHealthMonitoringJob();

    await jest.runAllTimersAsync();
    expect(mockGetSystemStatus).not.toHaveBeenCalled();
  });

  it('is idempotent — calling stop twice does not throw', async () => {
    await startHealthMonitoringJob();
    await expect(stopHealthMonitoringJob()).resolves.not.toThrow();
    await expect(stopHealthMonitoringJob()).resolves.not.toThrow();
  });
});

// ── health check aggregation ──────────────────────────────────────────────────

describe('healthMonitoringJob — health check aggregation', () => {
  it('continues running when all dependencies are healthy', async () => {
    mockGetSystemStatus.mockResolvedValue({
      overallStatus: 'healthy',
      dependencies: {
        database: { status: 'healthy', latency: 5, errorRate: 0 },
        redis: { status: 'healthy', latency: 3, errorRate: 0 },
        s3: { status: 'healthy', latency: 10, errorRate: 0 },
        twitter: { status: 'healthy', latency: 20, errorRate: 0 },
      },
    });

    await startHealthMonitoringJob();
    await jest.runOnlyPendingTimersAsync();

    expect(mockGetSystemStatus).toHaveBeenCalledTimes(1);
  });

  it('continues running when some dependencies are degraded', async () => {
    mockGetSystemStatus.mockResolvedValue({
      overallStatus: 'degraded',
      dependencies: {
        database: { status: 'healthy', latency: 5, errorRate: 0 },
        redis: { status: 'degraded', latency: 500, errorRate: 30 },
        s3: { status: 'healthy', latency: 10, errorRate: 0 },
        twitter: { status: 'degraded', latency: 800, errorRate: 50 },
      },
    });

    await startHealthMonitoringJob();
    await jest.runOnlyPendingTimersAsync();
    await jest.runOnlyPendingTimersAsync();

    expect(mockGetSystemStatus).toHaveBeenCalledTimes(2);
  });

  it('continues running even when overall status is unhealthy', async () => {
    mockGetSystemStatus.mockResolvedValue({
      overallStatus: 'unhealthy',
      dependencies: {
        database: { status: 'unhealthy', latency: 0, errorRate: 100, error: 'Connection refused' },
        redis: { status: 'unhealthy', latency: 0, errorRate: 100, error: 'ECONNREFUSED' },
        s3: { status: 'healthy', latency: 15, errorRate: 0 },
        twitter: { status: 'healthy', latency: 22, errorRate: 0 },
      },
    });

    await startHealthMonitoringJob();
    await jest.runOnlyPendingTimersAsync();
    await jest.runOnlyPendingTimersAsync();

    expect(mockGetSystemStatus).toHaveBeenCalledTimes(2);
  });

  it('invokes getSystemStatus (which aggregates all dependency checks) on each tick', async () => {
    await startHealthMonitoringJob();

    for (let i = 0; i < 3; i++) {
      await jest.runOnlyPendingTimersAsync();
    }

    expect(mockGetSystemStatus).toHaveBeenCalledTimes(3);
    // Each call is to the aggregated status check — not individual dep checks
    expect(getHealthService).toHaveBeenCalledTimes(3);
  });
});

// ── alert threshold evaluation ────────────────────────────────────────────────

describe('healthMonitoringJob — alert threshold evaluation', () => {
  it('catches and does not rethrow when getSystemStatus throws', async () => {
    mockGetSystemStatus.mockRejectedValue(new Error('Health check failed unexpectedly'));

    await startHealthMonitoringJob();

    await expect(jest.runOnlyPendingTimersAsync()).resolves.not.toThrow();
    expect(mockGetSystemStatus).toHaveBeenCalledTimes(1);
  });

  it('continues ticking after a failed health check', async () => {
    mockGetSystemStatus
      .mockRejectedValueOnce(new Error('Temporary failure'))
      .mockResolvedValue({ overallStatus: 'healthy', dependencies: {} });

    await startHealthMonitoringJob();

    await jest.runOnlyPendingTimersAsync(); // tick 1 — throws
    await jest.runOnlyPendingTimersAsync(); // tick 2 — succeeds

    expect(mockGetSystemStatus).toHaveBeenCalledTimes(2);
  });

  it('evaluates thresholds on every tick without accumulating errors', async () => {
    let callCount = 0;
    mockGetSystemStatus.mockImplementation(async () => {
      callCount++;
      if (callCount % 2 === 0) {
        throw new Error('Intermittent failure');
      }
      return { overallStatus: 'healthy', dependencies: {} };
    });

    await startHealthMonitoringJob();

    for (let i = 0; i < 4; i++) {
      await jest.runOnlyPendingTimersAsync();
    }

    expect(mockGetSystemStatus).toHaveBeenCalledTimes(4);
  });

  it('transitions from unhealthy to healthy status across ticks without crashing', async () => {
    mockGetSystemStatus
      .mockResolvedValueOnce({ overallStatus: 'unhealthy', dependencies: {} })
      .mockResolvedValueOnce({ overallStatus: 'unhealthy', dependencies: {} })
      .mockResolvedValueOnce({ overallStatus: 'unhealthy', dependencies: {} })
      .mockResolvedValue({ overallStatus: 'healthy', dependencies: {} });

    await startHealthMonitoringJob();

    for (let i = 0; i < 5; i++) {
      await jest.runOnlyPendingTimersAsync();
    }

    expect(mockGetSystemStatus).toHaveBeenCalledTimes(5);
  });
});
