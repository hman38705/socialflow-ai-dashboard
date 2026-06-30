/**
 * processBatchPayoutJob – partial failure re-enqueue tests
 *
 * Verifies that failed payout items are re-enqueued individually and the
 * batch job is marked as failed when any item fails.
 */

jest.mock('../queues/queueManager', () => ({
  queueManager: {
    createQueue: jest.fn(() => ({ name: 'payout' })),
    createWorker: jest.fn(),
    addJob: jest.fn().mockResolvedValue('job-id'),
    addBulkJobs: jest.fn().mockResolvedValue(['re-job-1']),
  },
}));

jest.mock('../lib/prisma', () => ({
  prisma: { payoutFailure: { create: jest.fn().mockResolvedValue({}) } },
}));

import { Job } from 'bullmq';
import { queueManager } from '../queues/queueManager';
import { processBatchPayoutJob } from '../jobs/payoutJob';
import { PayoutJobData } from '../queues/payoutQueue';

const addBulkJobs = queueManager.addBulkJobs as jest.Mock;

function makeJob(payouts: PayoutJobData[]): Job<{ payouts: PayoutJobData[] }> {
  return {
    id: 'batch-1',
    data: { payouts },
    updateProgress: jest.fn().mockResolvedValue(undefined),
  } as unknown as Job<{ payouts: PayoutJobData[] }>;
}

const validPayout: PayoutJobData = {
  groupId: 'g1',
  amount: 100,
  recipient: 'alice@example.com',
  recipientType: 'paypal',
  currency: 'USD',
};

const invalidPayout: PayoutJobData = {
  groupId: '', // missing — triggers validation error
  amount: 50,
  recipient: 'bob@example.com',
  recipientType: 'bank',
  currency: 'USD',
};

beforeEach(() => addBulkJobs.mockClear());

describe('processBatchPayoutJob – partial failure', () => {
  it('re-enqueues failed items after a partial batch failure', async () => {
    await expect(processBatchPayoutJob(makeJob([validPayout, invalidPayout]))).rejects.toThrow();

    expect(addBulkJobs).toHaveBeenCalledTimes(1);
    const [queueName, jobs] = addBulkJobs.mock.calls[0];
    expect(queueName).toBe('payout');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data.recipient).toBe('bob@example.com');
  });

  it('throws so BullMQ marks the batch job as failed', async () => {
    await expect(processBatchPayoutJob(makeJob([validPayout, invalidPayout]))).rejects.toThrow(
      /failed payouts/i,
    );
  });

  it('does not re-enqueue anything when all items succeed', async () => {
    await processBatchPayoutJob(makeJob([validPayout]));
    expect(addBulkJobs).not.toHaveBeenCalled();
  });

  it('re-enqueues all items when the entire batch fails', async () => {
    await expect(
      processBatchPayoutJob(
        makeJob([invalidPayout, { ...invalidPayout, recipient: 'carol@example.com' }]),
      ),
    ).rejects.toThrow();

    const [, jobs] = addBulkJobs.mock.calls[0];
    expect(jobs).toHaveLength(2);
  });
});

// ── Lock acquisition tests (issue #1127) ──────────────────────────────────

jest.mock('../utils/LockService', () => ({
  LockService: {
    withLock: jest.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
  },
}));

import { LockService } from '../utils/LockService';
import { processPayoutJob } from '../jobs/payoutJob';

const withLock = LockService.withLock as jest.Mock;

jest.mock('../lib/prisma', () => ({
  prisma: {
    payoutFailure: { create: jest.fn().mockResolvedValue({}) },
    payoutTransaction: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
  },
}));

function makePayoutJob(data: Partial<PayoutJobData> = {}): Job<PayoutJobData> {
  return {
    id: 'payout-job-1',
    data: {
      groupId: 'grp-1',
      amount: 50,
      recipient: 'dave@example.com',
      recipientType: 'paypal',
      currency: 'USD',
      ...data,
    },
    updateProgress: jest.fn().mockResolvedValue(undefined),
  } as unknown as Job<PayoutJobData>;
}

describe('processPayoutJob – row-level lock (issue #1127)', () => {
  beforeEach(() => withLock.mockClear());

  it('acquires a lock scoped to the payout group and job id', async () => {
    await processPayoutJob(makePayoutJob());

    expect(withLock).toHaveBeenCalledTimes(1);
    const [lockKey] = withLock.mock.calls[0];
    expect(lockKey).toMatch(/^payout:grp-1:/);
  });

  it('does not process the payout if the lock callback is never invoked', async () => {
    // Simulate a lock contention — withLock resolves without calling fn
    withLock.mockResolvedValueOnce(undefined);
    const { prisma } = require('../lib/prisma');

    await processPayoutJob(makePayoutJob());

    // No DB write should have happened since fn was not called
    expect(prisma.payoutTransaction.create).not.toHaveBeenCalled();
  });
});
