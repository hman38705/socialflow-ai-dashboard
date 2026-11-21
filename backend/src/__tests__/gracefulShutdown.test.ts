/**
 * gracefulShutdown unit tests.
 *
 * Uses injectable exit handler and fake timers so no real process.exit
 * is ever called and no real timeouts fire.
 */

// ── Env / mocks before any import ────────────────────────────────────────────
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars!!';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-32-chars!!!!!';
process.env.TWITTER_API_KEY = 'test-key';
process.env.TWITTER_API_SECRET = 'test-secret';

// Prevent bootstrap()'s process.exit(1) from crashing the test runner
// (bootstrap runs at module load time; we only care about gracefulShutdown)
const mockProcessExit = jest.spyOn(process, 'exit').mockImplementation((() => {}) as any);

// Heavy deps that would fail in unit context
jest.mock('../lib/prisma', () => ({ prisma: { $disconnect: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('../monitoring/workerMonitorInstance', () => ({
  startWorkerMonitor: jest.fn(), stopWorkerMonitor: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../jobs/healthMonitoringJob', () => ({
  startHealthMonitoringJob: jest.fn(), stopHealthMonitoringJob: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../jobs/dataPruningJob', () => ({
  startDataPruningJob: jest.fn(), stopDataPruningJob: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../jobs/youtubeSyncJob', () => ({
  startYouTubeSyncJob: jest.fn(), stopYouTubeSyncJob: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../queues/queueManager', () => ({
  queueManager: { closeAll: jest.fn().mockResolvedValue(undefined) },
  closeRedisClient: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../jobs/workers', () => ({ initializeWorkers: jest.fn() }));
jest.mock('../workers/index', () => ({ startWorkers: jest.fn() }));
jest.mock('../jobs/tiktokVideoJob', () => ({ startTikTokVideoWorker: jest.fn() }));
jest.mock('../queues/twitterWebhookQueue', () => ({ startTwitterWebhookWorker: jest.fn(() => null) }));
jest.mock('../monitoring/healthMonitoringInstance', () => ({ initializeHealthMonitoring: jest.fn() }));
jest.mock('../services/SocketService', () => ({ SocketService: { getInstance: jest.fn(() => ({ initialize: jest.fn() })), initialize: jest.fn() } }));
jest.mock('../services/SearchService', () => ({ initSearchIndex: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../app', () => ({
  __esModule: true,
  default: {
    listen: jest.fn((_port: number, cb: () => void) => {
      cb();
      return { on: jest.fn() };
    }),
  },
}));

import { gracefulShutdown, _resetShutdownState, bootstrap, ShutdownDeps } from '../server';
import { prisma } from '../lib/prisma';
import { stopWorkerMonitor } from '../monitoring/workerMonitorInstance';
import { stopHealthMonitoringJob } from '../jobs/healthMonitoringJob';
import { stopDataPruningJob } from '../jobs/dataPruningJob';
import { stopYouTubeSyncJob } from '../jobs/youtubeSyncJob';
import { queueManager, closeRedisClient } from '../queues/queueManager';
import { sseTicketService } from '../services/sseTicketService';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeServer(closeErr?: Error) {
  return {
    close: jest.fn((cb: (err?: Error) => void) => cb(closeErr)),
  } as any;
}

function makeDeps(overrides: Partial<ShutdownDeps> = {}): ShutdownDeps {
  return {
    server: makeServer(),
    webhookWorker: null,
    twitterWebhookWorker: null,
    ...overrides,
  };
}

beforeEach(() => {
  _resetShutdownState();
  jest.clearAllMocks();
  // Re-suppress process.exit after clearAllMocks resets the spy
  mockProcessExit.mockImplementation((() => {}) as any);
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

afterAll(() => {
  mockProcessExit.mockRestore();
});

// ═══════════════════════════════════════════════════════════════════════════════
// SSE ticket sweep interval
// ═══════════════════════════════════════════════════════════════════════════════

describe('sseTicketService — sweep interval', () => {
  it('unrefs the sweep interval so it does not keep the process alive', () => {
    const handle = (sseTicketService as any).sweepInterval as NodeJS.Timeout | undefined;
    expect(handle).toBeDefined();
    expect(handle!.hasRef()).toBe(false);
  });

  it('captures the sweep interval handle via setInterval and asserts it is unref\'d', () => {
    // Isolate from other timers in the shutdown suite
    jest.useRealTimers();
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    // Stop any pre-existing interval so start() creates a fresh one
    (sseTicketService as any).stop?.();

    try {
      sseTicketService.start();

      expect(setIntervalSpy).toHaveBeenCalled();
      const handle = setIntervalSpy.mock.results[setIntervalSpy.mock.results.length - 1]
        .value as NodeJS.Timeout;
      expect(handle).toBeDefined();
      expect(typeof handle.hasRef).toBe('function');
      expect(handle.hasRef()).toBe(false);
      expect((sseTicketService as any).sweepInterval).toBe(handle);
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });

  it('clears the sweep interval on shutdown so no timer remains after close', () => {
    jest.useRealTimers();
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

    try {
      sseTicketService.start();
      const handle = (sseTicketService as any).sweepInterval as NodeJS.Timeout | undefined;
      expect(handle).toBeDefined();

      (sseTicketService as any).stop?.();

      expect(clearIntervalSpy).toHaveBeenCalledWith(handle);
      expect((sseTicketService as any).sweepInterval).toBeUndefined();
    } finally {
      clearIntervalSpy.mockRestore();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Success path
// ═══════════════════════════════════════════════════════════════════════════════

describe('gracefulShutdown — success path', () => {
  it('calls exit(0) on SIGTERM after all resources are cleaned up', async () => {
    const exit = jest.fn();
    await gracefulShutdown('SIGTERM', 0, makeDeps(), { exit, timeoutMs: 5000 });
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('calls exit(1) on uncaughtException', async () => {
    const exit = jest.fn();
    await gracefulShutdown('uncaughtException', 1, makeDeps(), { exit, timeoutMs: 5000 });
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('closes HTTP server before other resources', async () => {
    const order: string[] = [];
    const server = {
      close: jest.fn((cb: (err?: Error) => void) => { order.push('server'); cb(); }),
    } as any;
    (stopWorkerMonitor as jest.Mock).mockImplementation(async () => { order.push('workerMonitor'); });
    (prisma.$disconnect as jest.Mock).mockImplementation(async () => { order.push('prisma'); });

    const exit = jest.fn();
    await gracefulShutdown('SIGTERM', 0, { server, webhookWorker: null, twitterWebhookWorker: null }, { exit, timeoutMs: 5000 });

    expect(order[0]).toBe('server');
    expect(order).toContain('workerMonitor');
    expect(order[order.length - 1]).toBe('prisma');
  });

  it('closes webhookWorker and twitterWebhookWorker when present', async () => {
    const webhookWorker = { close: jest.fn().mockResolvedValue(undefined) } as any;
    const twitterWebhookWorker = { close: jest.fn().mockResolvedValue(undefined) } as any;
    const exit = jest.fn();

    await gracefulShutdown('SIGTERM', 0, { server: null, webhookWorker, twitterWebhookWorker }, { exit, timeoutMs: 5000 });

    expect(webhookWorker.close).toHaveBeenCalled();
    expect(twitterWebhookWorker.close).toHaveBeenCalled();
  });

  it('calls all cleanup functions', async () => {
    const exit = jest.fn();
    await gracefulShutdown('SIGTERM', 0, makeDeps(), { exit, timeoutMs: 5000 });

    expect(stopWorkerMonitor).toHaveBeenCalled();
    expect(stopHealthMonitoringJob).toHaveBeenCalled();
    expect(stopDataPruningJob).toHaveBeenCalled();
    expect(stopYouTubeSyncJob).toHaveBeenCalled();
    expect(queueManager.closeAll).toHaveBeenCalled();
    expect(closeRedisClient).toHaveBeenCalled();
    expect(prisma.$disconnect).toHaveBeenCalled();
  });

  it('calls closeRedisClient after queueManager.closeAll', async () => {
    const order: string[] = [];
    (queueManager.closeAll as jest.Mock).mockImplementation(async () => { order.push('closeAll'); });
    (closeRedisClient as jest.Mock).mockImplementation(async () => { order.push('closeRedisClient'); });

    const exit = jest.fn();
    await gracefulShutdown('SIGTERM', 0, makeDeps(), { exit, timeoutMs: 5000 });

    expect(order.indexOf('closeAll')).toBeLessThan(order.indexOf('closeRedisClient'));
  });

  it('skips HTTP server close when server is null', async () => {
    const exit = jest.fn();
    await gracefulShutdown('SIGTERM', 0, { server: null, webhookWorker: null, twitterWebhookWorker: null }, { exit, timeoutMs: 5000 });
    expect(exit).toHaveBeenCalledWith(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Timeout path
// ═══════════════════════════════════════════════════════════════════════════════

describe('gracefulShutdown — timeout path', () => {
  it('calls exit(1) when shutdown exceeds timeoutMs', async () => {
    const exit = jest.fn();
    // Server that never calls its callback → shutdown hangs
    const hangingServer = { close: jest.fn() } as any;

    // Don't await — the promise never resolves because the server never closes
    gracefulShutdown(
      'SIGTERM', 0,
      { server: hangingServer, webhookWorker: null, twitterWebhookWorker: null },
      { exit, timeoutMs: 100 },
    );

    // Advance past the timeout — the force-exit callback fires synchronously
    jest.advanceTimersByTime(100);

    expect(exit).toHaveBeenCalledWith(1);
  });
});
