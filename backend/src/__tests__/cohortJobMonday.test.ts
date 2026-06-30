/**
 * Tests for Monday cohort-job sequencing (issue: weekly must wait for daily).
 *
 * All Redis and service calls are mocked — no real infrastructure required.
 */

// ── mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../queues/queueManager', () => ({
  queueManager: {
    createWorker: jest.fn(),
    createQueue: jest.fn(() => ({ name: 'mock-queue' })),
    addJob: jest.fn(),
  },
  redisClient: {
    exists: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
  },
}));

jest.mock('../services/CohortService', () => ({
  cohortService: {
    invalidateCache: jest.fn(),
    computeCohorts: jest.fn(),
  },
}));

// ── imports ───────────────────────────────────────────────────────────────────

import { redisClient } from '../queues/queueManager';
import { cohortService } from '../services/CohortService';
import {
  processCohortJob,
  dailyCompleteKey,
  isMonday,
  waitForDailyComplete,
  WaitOptions,
} from '../jobs/cohortJob';

// ── helpers ───────────────────────────────────────────────────────────────────

const mockExists = redisClient.exists as jest.Mock;
const mockSet = redisClient.set as jest.Mock;

const MONDAY  = new Date('2026-01-05T01:00:00Z'); // UTC Monday
const TUESDAY = new Date('2026-01-06T01:00:00Z'); // UTC Tuesday

function makeJob(id: string, data: Record<string, unknown>): any {
  return { id, name: 'compute-cohorts', data, updateProgress: jest.fn() };
}

const mockResult = {
  totalUsers: 10,
  segments: [{ cohort: 'power', count: 10 }],
  computedAt: new Date('2026-01-05T00:00:00Z'),
};

// Suppress logger noise
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

beforeEach(() => {
  jest.clearAllMocks();
  (cohortService.computeCohorts as jest.Mock).mockResolvedValue(mockResult);
});

// ── unit helpers ──────────────────────────────────────────────────────────────

describe('isMonday', () => {
  it('returns true for a Monday UTC date', () => {
    expect(isMonday(new Date('2026-01-05T00:00:00Z'))).toBe(true);
  });

  it('returns false for a non-Monday UTC date', () => {
    expect(isMonday(new Date('2026-01-06T00:00:00Z'))).toBe(false);
  });
});

describe('dailyCompleteKey', () => {
  it('returns a key scoped to the UTC date', () => {
    expect(dailyCompleteKey(new Date('2026-01-05T00:30:00Z'))).toBe('cohort:daily-complete:2026-01-05');
  });
});

describe('waitForDailyComplete', () => {
  it('resolves true immediately when the key already exists', async () => {
    mockExists.mockResolvedValueOnce(1);
    const result = await waitForDailyComplete(MONDAY, { pollMs: 10, timeoutMs: 100 });
    expect(result).toBe(true);
    expect(mockExists).toHaveBeenCalledTimes(1);
  });

  it('resolves true after the key appears on a subsequent poll', async () => {
    mockExists
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    const result = await waitForDailyComplete(MONDAY, { pollMs: 10, timeoutMs: 500 });
    expect(result).toBe(true);
    expect(mockExists).toHaveBeenCalledTimes(3);
  });

  it('resolves false when the key never appears within the timeout', async () => {
    mockExists.mockResolvedValue(0);
    const result = await waitForDailyComplete(MONDAY, { pollMs: 10, timeoutMs: 30 });
    expect(result).toBe(false);
  });
});

// ── processCohortJob — daily job ──────────────────────────────────────────────

describe('processCohortJob — daily', () => {
  it('writes the daily-complete Redis key after computing', async () => {
    const job = makeJob('d1', { triggeredBy: 'daily', organizationId: 'org-1' });
    await processCohortJob(job, MONDAY);
    expect(mockSet).toHaveBeenCalledWith('cohort:daily-complete:2026-01-05', '1', 'EX', 7200);
  });

  it('writes the key even on a non-Monday (daily always signals)', async () => {
    const job = makeJob('d2', { triggeredBy: 'daily' });
    await processCohortJob(job, TUESDAY);
    expect(mockSet).toHaveBeenCalledWith('cohort:daily-complete:2026-01-06', '1', 'EX', 7200);
  });
});

// ── processCohortJob — weekly job on Monday ───────────────────────────────────

const SHORT_WAIT: WaitOptions = { pollMs: 10, timeoutMs: 500 };

describe('processCohortJob — weekly on Monday', () => {
  it('waits for the daily-complete key before computing', async () => {
    mockExists.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    const job = makeJob('w1', { triggeredBy: 'weekly' });
    await processCohortJob(job, MONDAY, SHORT_WAIT);
    expect(mockExists).toHaveBeenCalledWith('cohort:daily-complete:2026-01-05');
    expect(cohortService.computeCohorts).toHaveBeenCalledTimes(1);
  });

  it('throws when the daily job does not complete within the timeout', async () => {
    mockExists.mockResolvedValue(0);
    const job = makeJob('w2', { triggeredBy: 'weekly' });
    await expect(
      processCohortJob(job, MONDAY, { pollMs: 10, timeoutMs: 50 }),
    ).rejects.toThrow('Weekly cohort job timed out waiting for daily job to complete on Monday');
    expect(cohortService.computeCohorts).not.toHaveBeenCalled();
  });

  it('proceeds immediately when the daily key is already present', async () => {
    mockExists.mockResolvedValueOnce(1);
    const job = makeJob('w3', { triggeredBy: 'weekly' });
    await processCohortJob(job, MONDAY, SHORT_WAIT);
    expect(mockExists).toHaveBeenCalledTimes(1);
    expect(cohortService.computeCohorts).toHaveBeenCalledTimes(1);
  });
});

// ── processCohortJob — weekly job on non-Monday ───────────────────────────────

describe('processCohortJob — weekly on non-Monday', () => {
  it('skips the wait and computes immediately', async () => {
    const job = makeJob('w4', { triggeredBy: 'weekly' });
    await processCohortJob(job, TUESDAY);
    expect(mockExists).not.toHaveBeenCalled();
    expect(cohortService.computeCohorts).toHaveBeenCalledTimes(1);
  });
});

// ── processCohortJob — ordering guarantee ─────────────────────────────────────

describe('processCohortJob — ordering guarantee on Monday', () => {
  it('computeCohorts is called only after the daily-complete key is confirmed', async () => {
    const callOrder: string[] = [];
    mockExists.mockImplementationOnce(async () => { callOrder.push('exists'); return 1; });
    (cohortService.computeCohorts as jest.Mock).mockImplementationOnce(async () => {
      callOrder.push('compute');
      return mockResult;
    });

    const job = makeJob('w5', { triggeredBy: 'weekly' });
    await processCohortJob(job, MONDAY, SHORT_WAIT);

    expect(callOrder).toEqual(['exists', 'compute']);
  });
});

// ── processCohortJob — cohort membership evaluation ───────────────────────────

describe('processCohortJob — cohort membership evaluation', () => {
  it('calls computeCohorts with the correct organizationId', async () => {
    const job = makeJob('e1', { organizationId: 'org-abc', triggeredBy: 'manual' });
    await processCohortJob(job, TUESDAY);
    expect(cohortService.computeCohorts).toHaveBeenCalledWith('org-abc');
  });

  it('calls computeCohorts with undefined for a global recompute', async () => {
    const job = makeJob('e2', { triggeredBy: 'manual' });
    await processCohortJob(job, TUESDAY);
    expect(cohortService.computeCohorts).toHaveBeenCalledWith(undefined);
  });

  it('returns a summary containing segment counts from the result', async () => {
    const job = makeJob('e3', { organizationId: 'org-1', triggeredBy: 'manual' });
    const summary = await processCohortJob(job, TUESDAY) as any;
    expect(summary.totalUsers).toBe(mockResult.totalUsers);
    expect(summary.segments).toEqual([{ cohort: 'power', count: 10 }]);
  });

  it('includes the organizationId in the returned summary', async () => {
    const job = makeJob('e4', { organizationId: 'org-42', triggeredBy: 'manual' });
    const summary = await processCohortJob(job, TUESDAY) as any;
    expect(summary.organizationId).toBe('org-42');
  });
});

// ── processCohortJob — incremental update (cache invalidation) ────────────────

describe('processCohortJob — incremental update', () => {
  it('invalidates the cache before computing cohorts', async () => {
    const callOrder: string[] = [];
    (cohortService.invalidateCache as jest.Mock).mockImplementationOnce(() => callOrder.push('invalidate'));
    (cohortService.computeCohorts as jest.Mock).mockImplementationOnce(async () => {
      callOrder.push('compute');
      return mockResult;
    });
    const job = makeJob('i1', { organizationId: 'org-1', triggeredBy: 'manual' });
    await processCohortJob(job, TUESDAY);
    expect(callOrder).toEqual(['invalidate', 'compute']);
  });

  it('invalidates cache with the correct organizationId', async () => {
    const job = makeJob('i2', { organizationId: 'org-xyz', triggeredBy: 'manual' });
    await processCohortJob(job, TUESDAY);
    expect(cohortService.invalidateCache).toHaveBeenCalledWith('org-xyz');
  });
});

// ── processCohortJob — DLQ on permanent failure ───────────────────────────────

describe('processCohortJob — DLQ on permanent failure', () => {
  it('propagates the error so BullMQ can route to DLQ after retries', async () => {
    (cohortService.computeCohorts as jest.Mock).mockRejectedValueOnce(new Error('DB unavailable'));
    const job = makeJob('q1', { organizationId: 'org-1', triggeredBy: 'manual' });
    await expect(processCohortJob(job, TUESDAY)).rejects.toThrow('DB unavailable');
  });

  it('does not write the daily-complete key when computeCohorts fails', async () => {
    (cohortService.computeCohorts as jest.Mock).mockRejectedValueOnce(new Error('fail'));
    const job = makeJob('q2', { organizationId: 'org-1', triggeredBy: 'daily' });
    await expect(processCohortJob(job, TUESDAY)).rejects.toThrow();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('does not block other jobs — each job throw is independent', async () => {
    (cohortService.computeCohorts as jest.Mock)
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(mockResult);
    const job1 = makeJob('q3', { triggeredBy: 'manual' });
    const job2 = makeJob('q4', { triggeredBy: 'manual' });
    await expect(processCohortJob(job1, TUESDAY)).rejects.toThrow();
    await expect(processCohortJob(job2, TUESDAY)).resolves.toBeDefined();
  });
});
