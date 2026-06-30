/**
 * #1055 — jobMonitor unit tests
 * Covers: queue depth alerting, event routing (completed/failed/stalled/progress),
 * job management operations, and event listener lifecycle.
 */

// ── captured queue-event callbacks (for testing emit routing) ─────────────────
type EventCallback = (...args: any[]) => void;
const capturedQueueEvents: Record<string, Record<string, EventCallback>> = {};

const mockQueueEventsOn = jest.fn((queueName: string, event: string, cb: EventCallback) => {
  if (!capturedQueueEvents[queueName]) capturedQueueEvents[queueName] = {};
  capturedQueueEvents[queueName][event] = cb;
});

// ── mock queueManager ─────────────────────────────────────────────────────────
const mockQueueManager = {
  getQueueNames: jest.fn(),
  getQueueEvents: jest.fn(),
  getQueueStats: jest.fn(),
  getQueue: jest.fn(),
  getWaitingJobs: jest.fn(),
  getActiveJobs: jest.fn(),
  getFailedJobs: jest.fn(),
  retryJob: jest.fn(),
  removeJob: jest.fn(),
  pauseQueue: jest.fn(),
  resumeQueue: jest.fn(),
  clearQueue: jest.fn(),
};

jest.mock('../queues/queueManager', () => ({
  queueManager: mockQueueManager,
}));
jest.mock('../lib/logger', () => ({ createLogger: () => ({ info: jest.fn(), error: jest.fn() }) }));

import { JobMonitor } from '../services/jobMonitor';

function makeQueueEventsFor(name: string) {
  return {
    on: (event: string, cb: EventCallback) => mockQueueEventsOn(name, event, cb),
  };
}

function makeMonitor(queueNames: string[] = []) {
  mockQueueManager.getQueueNames.mockReturnValue(queueNames);
  mockQueueManager.getQueueEvents.mockImplementation((name: string) =>
    makeQueueEventsFor(name),
  );
  return new JobMonitor();
}

beforeEach(() => {
  jest.clearAllMocks();
  // Clear captured event handlers
  Object.keys(capturedQueueEvents).forEach((k) => delete capturedQueueEvents[k]);
});

// ── queue depth — getSystemStats / getQueueStats ──────────────────────────────
describe('JobMonitor — queue depth alerting', () => {
  it('getQueueStats returns null when the queue is not found in queueManager', async () => {
    mockQueueManager.getQueueStats.mockResolvedValue(null);
    const monitor = makeMonitor();

    const stats = await monitor.getQueueStats('non-existent');

    expect(stats).toBeNull();
  });

  it('getQueueStats returns a QueueStats object with all counts', async () => {
    mockQueueManager.getQueueStats.mockResolvedValue({
      waiting: 5, active: 2, completed: 100, failed: 3, delayed: 1,
    });
    const monitor = makeMonitor();

    const stats = await monitor.getQueueStats('my-queue');

    expect(stats).toEqual({
      name: 'my-queue',
      waiting: 5,
      active: 2,
      completed: 100,
      failed: 3,
      delayed: 1,
      paused: 0,
      total: 111, // 5+2+100+3+1
    });
  });

  it('getSystemStats aggregates counts across all registered queues', async () => {
    mockQueueManager.getQueueNames.mockReturnValue(['q1', 'q2']);
    mockQueueManager.getQueueEvents.mockReturnValue({ on: jest.fn() });
    mockQueueManager.getQueueStats
      .mockResolvedValueOnce({ waiting: 10, active: 1, completed: 50, failed: 2, delayed: 0 })
      .mockResolvedValueOnce({ waiting: 4, active: 0, completed: 20, failed: 1, delayed: 3 });

    const monitor = new JobMonitor();
    const sys = await monitor.getSystemStats();

    expect(sys.totalQueues).toBe(2);
    expect(sys.totalJobs).toBe(63 + 28); // 63 for q1, 28 for q2
    expect(sys.queues).toHaveLength(2);
  });

  it('getSystemStats skips queues that return null stats', async () => {
    mockQueueManager.getQueueNames.mockReturnValue(['good', 'bad']);
    mockQueueManager.getQueueEvents.mockReturnValue({ on: jest.fn() });
    mockQueueManager.getQueueStats
      .mockResolvedValueOnce({ waiting: 1, active: 0, completed: 0, failed: 0, delayed: 0 })
      .mockResolvedValueOnce(null);

    const monitor = new JobMonitor();
    const sys = await monitor.getSystemStats();

    expect(sys.totalQueues).toBe(1);
    expect(sys.queues[0].name).toBe('good');
  });

  it('reports correct queue depth (waiting count) per queue', async () => {
    mockQueueManager.getQueueStats.mockResolvedValue({
      waiting: 42, active: 0, completed: 0, failed: 0, delayed: 0,
    });
    const monitor = makeMonitor();

    const stats = await monitor.getQueueStats('heavy-queue');

    expect(stats!.waiting).toBe(42);
    expect(stats!.total).toBe(42);
  });
});

// ── getJobs ───────────────────────────────────────────────────────────────────
describe('JobMonitor — getJobs', () => {
  it('returns mapped JobInfo for waiting jobs', async () => {
    const ts = Date.now();
    mockQueueManager.getWaitingJobs.mockResolvedValue([
      { id: 'j1', name: 'my-job', data: { x: 1 }, progress: 0, attemptsMade: 0, timestamp: ts },
    ]);
    const monitor = makeMonitor();

    const jobs = await monitor.getJobs('q', 'waiting');

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ id: 'j1', name: 'my-job', status: 'waiting', attempts: 0 });
  });

  it('returns mapped JobInfo for active jobs', async () => {
    const ts = Date.now();
    mockQueueManager.getActiveJobs.mockResolvedValue([
      { id: 'j2', name: 'active-job', data: {}, progress: 50, attemptsMade: 1, timestamp: ts, processedOn: ts },
    ]);
    const monitor = makeMonitor();

    const jobs = await monitor.getJobs('q', 'active');

    expect(jobs[0]).toMatchObject({ id: 'j2', status: 'active', attempts: 1, progress: 50 });
    expect(jobs[0].processedAt).toBeInstanceOf(Date);
  });

  it('returns mapped JobInfo for failed jobs including failedReason', async () => {
    mockQueueManager.getFailedJobs.mockResolvedValue([
      { id: 'j3', name: 'bad-job', data: {}, progress: 0, attemptsMade: 3,
        timestamp: Date.now(), failedReason: 'timeout' },
    ]);
    const monitor = makeMonitor();

    const jobs = await monitor.getJobs('q', 'failed');

    expect(jobs[0]).toMatchObject({ id: 'j3', status: 'failed', failedReason: 'timeout' });
  });

  it('returns an empty array for unhandled statuses (completed, delayed, paused)', async () => {
    const monitor = makeMonitor();

    for (const status of ['completed', 'delayed', 'paused'] as any[]) {
      const result = await monitor.getJobs('q', status);
      expect(result).toEqual([]);
    }
  });
});

// ── job management ────────────────────────────────────────────────────────────
describe('JobMonitor — job management operations', () => {
  it('retryJob returns true on success', async () => {
    mockQueueManager.retryJob.mockResolvedValue(undefined);
    const monitor = makeMonitor();

    expect(await monitor.retryJob('q', 'j1')).toBe(true);
  });

  it('retryJob returns false when queueManager throws', async () => {
    mockQueueManager.retryJob.mockRejectedValue(new Error('no such job'));
    const monitor = makeMonitor();

    expect(await monitor.retryJob('q', 'j1')).toBe(false);
  });

  it('removeJob returns true on success', async () => {
    mockQueueManager.removeJob.mockResolvedValue(undefined);
    const monitor = makeMonitor();

    expect(await monitor.removeJob('q', 'j1')).toBe(true);
  });

  it('removeJob returns false when queueManager throws', async () => {
    mockQueueManager.removeJob.mockRejectedValue(new Error('locked'));
    const monitor = makeMonitor();

    expect(await monitor.removeJob('q', 'j1')).toBe(false);
  });

  it('pauseQueue returns true on success', async () => {
    mockQueueManager.pauseQueue.mockResolvedValue(undefined);
    const monitor = makeMonitor();

    expect(await monitor.pauseQueue('q')).toBe(true);
  });

  it('pauseQueue returns false on error', async () => {
    mockQueueManager.pauseQueue.mockRejectedValue(new Error('redis down'));
    const monitor = makeMonitor();

    expect(await monitor.pauseQueue('q')).toBe(false);
  });

  it('resumeQueue returns true on success', async () => {
    mockQueueManager.resumeQueue.mockResolvedValue(undefined);
    const monitor = makeMonitor();

    expect(await monitor.resumeQueue('q')).toBe(true);
  });

  it('retryAllFailed retries each failed job and returns count', async () => {
    const retry1 = jest.fn().mockResolvedValue(undefined);
    const retry2 = jest.fn().mockResolvedValue(undefined);
    mockQueueManager.getFailedJobs.mockResolvedValue([
      { id: 'j1', retry: retry1 },
      { id: 'j2', retry: retry2 },
    ]);
    const monitor = makeMonitor();

    const count = await monitor.retryAllFailed('q');

    expect(count).toBe(2);
    expect(retry1).toHaveBeenCalledTimes(1);
    expect(retry2).toHaveBeenCalledTimes(1);
  });

  it('retryAllFailed skips jobs that fail to retry and returns only successful count', async () => {
    mockQueueManager.getFailedJobs.mockResolvedValue([
      { id: 'j1', retry: jest.fn().mockResolvedValue(undefined) },
      { id: 'j2', retry: jest.fn().mockRejectedValue(new Error('busy')) },
    ]);
    const monitor = makeMonitor();

    const count = await monitor.retryAllFailed('q');

    expect(count).toBe(1);
  });
});

// ── event listener lifecycle ──────────────────────────────────────────────────
describe('JobMonitor — event listener lifecycle', () => {
  it('on() registers a listener and it is called on emit', () => {
    const monitor = makeMonitor(['test-queue']);
    const listener = jest.fn();

    monitor.on('job-completed', listener);
    capturedQueueEvents['test-queue']['completed']({ jobId: 'j1', returnvalue: 'ok' });

    expect(listener).toHaveBeenCalledWith({
      queue: 'test-queue', jobId: 'j1', returnvalue: 'ok',
    });
  });

  it('off() removes a listener so it is no longer called', () => {
    const monitor = makeMonitor(['test-queue']);
    const listener = jest.fn();

    monitor.on('job-completed', listener);
    monitor.off('job-completed', listener);
    capturedQueueEvents['test-queue']['completed']({ jobId: 'j2', returnvalue: 'x' });

    expect(listener).not.toHaveBeenCalled();
  });

  it('forwards job-failed events with queue name, jobId, and failedReason', () => {
    const monitor = makeMonitor(['test-queue']);
    const listener = jest.fn();

    monitor.on('job-failed', listener);
    capturedQueueEvents['test-queue']['failed']({ jobId: 'j3', failedReason: 'timeout' });

    expect(listener).toHaveBeenCalledWith({
      queue: 'test-queue', jobId: 'j3', failedReason: 'timeout',
    });
  });

  it('forwards job-stalled events', () => {
    const monitor = makeMonitor(['test-queue']);
    const listener = jest.fn();

    monitor.on('job-stalled', listener);
    capturedQueueEvents['test-queue']['stalled']({ jobId: 'j4' });

    expect(listener).toHaveBeenCalledWith({ queue: 'test-queue', jobId: 'j4' });
  });

  it('forwards job-progress events with progress data', () => {
    const monitor = makeMonitor(['test-queue']);
    const listener = jest.fn();

    monitor.on('job-progress', listener);
    capturedQueueEvents['test-queue']['progress']({ jobId: 'j5', data: 75 });

    expect(listener).toHaveBeenCalledWith({ queue: 'test-queue', jobId: 'j5', progress: 75 });
  });

  it('multiple listeners on the same event are all called', () => {
    const monitor = makeMonitor(['test-queue']);
    const l1 = jest.fn();
    const l2 = jest.fn();

    monitor.on('job-completed', l1);
    monitor.on('job-completed', l2);
    capturedQueueEvents['test-queue']['completed']({ jobId: 'j6', returnvalue: null });

    expect(l1).toHaveBeenCalledTimes(1);
    expect(l2).toHaveBeenCalledTimes(1);
  });

  it('registers event listeners across multiple queues', () => {
    const monitor = makeMonitor(['q-a', 'q-b']);
    const listener = jest.fn();

    monitor.on('job-completed', listener);
    capturedQueueEvents['q-a']['completed']({ jobId: 'a1', returnvalue: null });
    capturedQueueEvents['q-b']['completed']({ jobId: 'b1', returnvalue: null });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ queue: 'q-a' }));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ queue: 'q-b' }));
  });
});
