/**
 * Unit tests for processPayoutJob
 *
 * Covers:
 *   - Payout amount calculation / validation
 *   - Transfer initiation (crypto / wallet path)
 *   - Idempotency key derivation and duplicate-payment prevention
 *   - Permanent error moves the payout to a failed state
 *   - Successful transfer marks the transaction as completed
 *
 * Closes #1111
 */

// ── Mocks ─────────────────────────────────────────────────────────────────

jest.mock('../queues/queueManager', () => ({
  queueManager: {
    createQueue: jest.fn(() => ({ name: 'payout' })),
    createWorker: jest.fn(),
    addJob: jest.fn().mockResolvedValue('job-id'),
    addBulkJobs: jest.fn().mockResolvedValue([]),
  },
}));

const mockPayoutTransactionFindUnique = jest.fn();
const mockPayoutTransactionCreate = jest.fn();
const mockPayoutTransactionUpdate = jest.fn();
const mockPayoutFailureCreate = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    payoutTransaction: {
      findUnique: mockPayoutTransactionFindUnique,
      create: mockPayoutTransactionCreate,
      update: mockPayoutTransactionUpdate,
    },
    payoutFailure: {
      create: mockPayoutFailureCreate,
    },
  },
}));

// ── Imports ────────────────────────────────────────────────────────────────

import { Job } from 'bullmq';
import { processPayoutJob } from '../jobs/payoutJob';
import { PayoutJobData } from '../queues/payoutQueue';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeJob(data: Partial<PayoutJobData>, id = 'job-001'): Job<PayoutJobData> {
  return {
    id,
    data: {
      groupId: 'group-1',
      amount: 500,
      recipient: 'stellar-addr-abc123',
      recipientType: 'crypto',
      currency: 'XLM',
      ...data,
    },
    updateProgress: jest.fn().mockResolvedValue(undefined),
  } as unknown as Job<PayoutJobData>;
}

// ── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // Default: no existing transaction (no duplicate)
  mockPayoutTransactionFindUnique.mockResolvedValue(null);
  mockPayoutTransactionCreate.mockResolvedValue({ id: 'tx-1' });
  mockPayoutTransactionUpdate.mockResolvedValue({ id: 'tx-1', status: 'confirmed' });
  mockPayoutFailureCreate.mockResolvedValue({});
  // Speed up setTimeout calls
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

// ── Payout amount validation ───────────────────────────────────────────────

describe('processPayoutJob – amount validation', () => {
  it('rejects a zero amount (treated as missing field) and persists a failure record', async () => {
    // amount: 0 is falsy — the code validates !amount so 0 = "Missing required payout fields"
    const job = makeJob({ amount: 0 });
    // Wrap in Promise.allSettled to avoid unhandled rejection before we assert
    const [settled] = await Promise.allSettled([processPayoutJob(job)]);
    expect(settled.status).toBe('rejected');
    expect((settled as PromiseRejectedResult).reason.message).toContain('Failed to process payout');
    expect(mockPayoutFailureCreate).toHaveBeenCalledTimes(1);
    expect(mockPayoutFailureCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobId: 'job-001',
          reason: 'Missing required payout fields',
        }),
      }),
    );
  });

  it('rejects a negative amount and persists a failure record', async () => {
    // amount: -100 passes !amount but fails amount <= 0
    const job = makeJob({ amount: -100 });
    const [settled] = await Promise.allSettled([processPayoutJob(job)]);
    expect(settled.status).toBe('rejected');
    expect((settled as PromiseRejectedResult).reason.message).toContain(
      'Payout amount must be greater than 0',
    );
    expect(mockPayoutFailureCreate).toHaveBeenCalledTimes(1);
    expect(mockPayoutFailureCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reason: 'Payout amount must be greater than 0',
        }),
      }),
    );
  });

  it('rejects when required fields are missing', async () => {
    const job = makeJob({ groupId: '' });
    const [settled] = await Promise.allSettled([processPayoutJob(job)]);
    expect(settled.status).toBe('rejected');
    expect(mockPayoutFailureCreate).toHaveBeenCalledTimes(1);
    expect(mockPayoutFailureCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reason: 'Missing required payout fields',
        }),
      }),
    );
  });

  it('accepts a positive amount and completes successfully', async () => {
    const job = makeJob({ amount: 250, recipientType: 'paypal' });
    const promise = processPayoutJob(job);
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.amount).toBe(250);
  });
});

// ── Transfer initiation ────────────────────────────────────────────────────

describe('processPayoutJob – transfer initiation', () => {
  it('initiates a crypto transfer with the correct recipient, amount, and currency', async () => {
    const job = makeJob({
      recipient: 'GCEZW...',
      amount: 1000,
      currency: 'XLM',
      recipientType: 'crypto',
    });
    const promise = processPayoutJob(job);
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result.recipient).toBe('GCEZW...');
    expect(result.amount).toBe(1000);
    expect(result.currency).toBe('XLM');
    expect(result.status).toBe('completed');
  });

  it('updates the payout transaction to confirmed after a successful crypto transfer', async () => {
    const job = makeJob({ recipientType: 'crypto' });
    const promise = processPayoutJob(job);
    await jest.runAllTimersAsync();
    await promise;

    expect(mockPayoutTransactionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'confirmed' }),
      }),
    );
  });

  it('does not call payoutTransaction methods for non-crypto recipients', async () => {
    const job = makeJob({ recipientType: 'paypal' });
    const promise = processPayoutJob(job);
    await jest.runAllTimersAsync();
    await promise;

    expect(mockPayoutTransactionFindUnique).not.toHaveBeenCalled();
    expect(mockPayoutTransactionCreate).not.toHaveBeenCalled();
    expect(mockPayoutTransactionUpdate).not.toHaveBeenCalled();
  });

  it('reports correct recipient type in the result', async () => {
    const job = makeJob({ recipientType: 'wallet', recipient: 'wallet-addr-xyz' });
    const promise = processPayoutJob(job);
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result.recipientType).toBe('wallet');
    expect(result.recipient).toBe('wallet-addr-xyz');
  });
});

// ── Idempotency key handling ───────────────────────────────────────────────

describe('processPayoutJob – idempotency key handling', () => {
  it('generates a deterministic transaction hash and stores it before submission', async () => {
    const job = makeJob({ recipientType: 'crypto', groupId: 'grp-42', recipient: 'addr-abc', amount: 777, currency: 'XLM' }, 'job-idem-1');
    const promise = processPayoutJob(job);
    await jest.runAllTimersAsync();
    const result = await promise;

    // Hash must be present and stable
    expect(result.transactionHash).toBeDefined();
    expect(typeof result.transactionHash).toBe('string');
    expect(result.transactionHash).toMatch(/^stellar-tx-[a-f0-9]{64}$/);

    // Create was called with the hash BEFORE any submission
    expect(mockPayoutTransactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          transactionHash: result.transactionHash,
          status: 'pending',
        }),
      }),
    );
  });

  it('produces the same hash for identical job parameters (deterministic)', async () => {
    // Run two jobs with identical parameters
    mockPayoutTransactionFindUnique.mockResolvedValue(null);

    const jobA = makeJob({ groupId: 'grp-1', recipient: 'addr-1', amount: 100, currency: 'XLM', recipientType: 'crypto' }, 'job-det-1');
    const promiseA = processPayoutJob(jobA);
    await jest.runAllTimersAsync();
    const resultA = await promiseA;

    jest.clearAllMocks();
    mockPayoutTransactionFindUnique.mockResolvedValue(null);
    mockPayoutTransactionCreate.mockResolvedValue({ id: 'tx-2' });
    mockPayoutTransactionUpdate.mockResolvedValue({ id: 'tx-2', status: 'confirmed' });

    const jobB = makeJob({ groupId: 'grp-1', recipient: 'addr-1', amount: 100, currency: 'XLM', recipientType: 'crypto' }, 'job-det-1');
    const promiseB = processPayoutJob(jobB);
    await jest.runAllTimersAsync();
    const resultB = await promiseB;

    expect(resultA.transactionHash).toBe(resultB.transactionHash);
  });

  it('skips submission when the transaction hash already exists (duplicate prevention)', async () => {
    // Simulate an existing transaction (retry scenario)
    mockPayoutTransactionFindUnique.mockResolvedValue({ id: 'existing-tx-99' });

    const job = makeJob({ recipientType: 'crypto' });
    const promise = processPayoutJob(job);
    await jest.runAllTimersAsync();
    const result = await promise;

    // Should not create a new record or update it
    expect(mockPayoutTransactionCreate).not.toHaveBeenCalled();
    expect(mockPayoutTransactionUpdate).not.toHaveBeenCalled();
    // Result should indicate this was a skip
    expect(result.skipped).toBe(true);
    expect(result.success).toBe(true);
  });

  it('checks for duplicates before creating a new transaction', async () => {
    const job = makeJob({ recipientType: 'crypto' });
    const promise = processPayoutJob(job);
    await jest.runAllTimersAsync();
    await promise;

    // findUnique must be called before create
    const findOrder = mockPayoutTransactionFindUnique.mock.invocationCallOrder[0];
    const createOrder = mockPayoutTransactionCreate.mock.invocationCallOrder[0];
    expect(findOrder).toBeLessThan(createOrder);
  });

  it('persists the transaction hash with status=pending before submitting', async () => {
    const job = makeJob({ recipientType: 'wallet', amount: 200 });
    const promise = processPayoutJob(job);
    await jest.runAllTimersAsync();
    await promise;

    expect(mockPayoutTransactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'pending' }),
      }),
    );
    // After success, the status must be updated to confirmed
    expect(mockPayoutTransactionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'confirmed' }),
      }),
    );
  });
});

// ── Failure handling ───────────────────────────────────────────────────────

describe('processPayoutJob – failure handling', () => {
  it('moves the payout to failed state and throws on a permanent error', async () => {
    // Simulate DB failure after validation passes (create fails immediately, no timers needed)
    mockPayoutTransactionCreate.mockRejectedValueOnce(new Error('DB write failed'));

    const job = makeJob({ recipientType: 'crypto' });
    const [settled] = await Promise.allSettled([processPayoutJob(job)]);

    expect(settled.status).toBe('rejected');
    expect((settled as PromiseRejectedResult).reason.message).toBe(
      'Failed to process payout: DB write failed',
    );
    expect(mockPayoutFailureCreate).toHaveBeenCalledTimes(1);
    expect(mockPayoutFailureCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobId: 'job-001',
          reason: 'DB write failed',
        }),
      }),
    );
  });

  it('still throws the original error even when persisting the failure record also fails', async () => {
    mockPayoutTransactionCreate.mockRejectedValueOnce(new Error('original error'));
    mockPayoutFailureCreate.mockRejectedValueOnce(new Error('DB failure record write failed'));

    const job = makeJob({ recipientType: 'crypto' });
    const [settled] = await Promise.allSettled([processPayoutJob(job)]);

    expect(settled.status).toBe('rejected');
    // The original error should propagate, not the DB write failure
    expect((settled as PromiseRejectedResult).reason.message).toBe(
      'Failed to process payout: original error',
    );
  });

  it('records the correct job id and recipient in the failure record', async () => {
    mockPayoutTransactionCreate.mockRejectedValueOnce(new Error('tx creation failed'));

    const job = makeJob({ recipientType: 'crypto', recipient: 'recipient-xyz' }, 'job-fail-99');
    const [settled] = await Promise.allSettled([processPayoutJob(job)]);

    expect(settled.status).toBe('rejected');
    expect(mockPayoutFailureCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobId: 'job-fail-99',
          recipient: 'recipient-xyz',
        }),
      }),
    );
  });

  it('progresses through job stages before throwing on failure', async () => {
    mockPayoutTransactionCreate.mockRejectedValueOnce(new Error('deliberate failure'));

    const job = makeJob({ recipientType: 'crypto' });
    const [settled] = await Promise.allSettled([processPayoutJob(job)]);

    expect(settled.status).toBe('rejected');
    // updateProgress(10) and updateProgress(20) should have been called before the error
    expect(job.updateProgress).toHaveBeenCalled();
  });
});

// ── Successful transfer result shape ──────────────────────────────────────

describe('processPayoutJob – successful result shape', () => {
  it('returns a complete result object on success', async () => {
    const job = makeJob({
      groupId: 'group-99',
      amount: 1500,
      recipient: 'addr-final',
      recipientType: 'crypto',
      currency: 'USD',
      metadata: { campaignId: 'camp-1', userId: 'user-1' },
    });
    const promise = processPayoutJob(job);
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result).toMatchObject({
      success: true,
      groupId: 'group-99',
      amount: 1500,
      currency: 'USD',
      recipient: 'addr-final',
      recipientType: 'crypto',
      status: 'completed',
      skipped: false,
    });
    expect(result.processedAt).toBeDefined();
    expect(result.transactionId).toBe('job-001');
  });

  it('includes metadata in the result when provided', async () => {
    const job = makeJob({
      recipientType: 'paypal',
      metadata: { campaignId: 'camp-2', userId: 'user-42' },
    });
    const promise = processPayoutJob(job);
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result.metadata).toEqual({ campaignId: 'camp-2', userId: 'user-42' });
  });
});
