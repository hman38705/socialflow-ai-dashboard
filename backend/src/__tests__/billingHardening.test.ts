/**
 * Billing hardening tests
 *
 * Covers four issues:
 *  1. createCheckoutSession always includes payment_method_types
 *  2. Credits are refunded when the platform publish call fails
 *  3. provisionUser is idempotent — a second call returns the existing Stripe customer
 *  4. processPayoutJob writes a PayoutFailure record on failure
 */

// ── Stripe mock ───────────────────────────────────────────────────────────────

const mockSessionCreate = jest.fn();
const mockCustomerCreate = jest.fn();
const mockCustomerList = jest.fn();

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    checkout: {
      sessions: { create: mockSessionCreate },
    },
    customers: {
      create: mockCustomerCreate,
      list: mockCustomerList,
    },
    billingPortal: {
      sessions: { create: jest.fn().mockResolvedValue({ url: 'https://portal.example.com' }) },
    },
    webhooks: {
      constructEvent: jest.fn(),
    },
  }));
});

// ── Prisma mock ───────────────────────────────────────────────────────────────
// Subscription state lives in-memory here; $transaction just invokes its
// callback with this same mock object (acting as `tx`).

const mockPayoutFailureCreate = jest.fn();
const mockPayoutTransactionFindUnique = jest.fn().mockResolvedValue(null);
const mockPayoutTransactionCreate = jest.fn().mockResolvedValue({});
const mockPayoutTransactionUpdate = jest.fn().mockResolvedValue({});

let mockSubscriptionState: Record<string, unknown> | null = null;

interface MockPrisma {
  subscription: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  creditLog: { create: jest.Mock };
  payoutFailure: { create: jest.Mock };
  payoutTransaction: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  $transaction: jest.Mock;
}

const mockPrisma: MockPrisma = {
  subscription: {
    findUnique: jest.fn(({ where }: any) =>
      Promise.resolve(
        mockSubscriptionState && mockSubscriptionState.userId === where.userId
          ? { ...mockSubscriptionState }
          : null,
      ),
    ),
    create: jest.fn(({ data }: any) => {
      mockSubscriptionState = { ...data };
      return Promise.resolve({ ...mockSubscriptionState });
    }),
    update: jest.fn(({ where, data }: any) => {
      if (!mockSubscriptionState || mockSubscriptionState.userId !== where.userId) {
        return Promise.reject(new Error('Record to update not found.'));
      }
      mockSubscriptionState = { ...mockSubscriptionState, ...data };
      return Promise.resolve({ ...mockSubscriptionState });
    }),
    updateMany: jest.fn(({ where, data }: any) => {
      if (
        mockSubscriptionState &&
        mockSubscriptionState.userId === where.userId &&
        (mockSubscriptionState.creditsRemaining as number) >= where.creditsRemaining.gte
      ) {
        mockSubscriptionState.creditsRemaining =
          (mockSubscriptionState.creditsRemaining as number) - data.creditsRemaining.decrement;
        return Promise.resolve({ count: 1 });
      }
      return Promise.resolve({ count: 0 });
    }),
  },
  creditLog: { create: jest.fn().mockResolvedValue({}) },
  payoutFailure: { create: mockPayoutFailureCreate },
  payoutTransaction: {
    findUnique: mockPayoutTransactionFindUnique,
    create: mockPayoutTransactionCreate,
    update: mockPayoutTransactionUpdate,
  },
  $transaction: jest.fn((cb: (tx: MockPrisma) => unknown) => cb(mockPrisma)),
};

jest.mock('../lib/prisma', () => ({ prisma: mockPrisma }));

// ── Queue manager mock (needed by payoutJob import) ───────────────────────────

jest.mock('../queues/queueManager', () => ({
  queueManager: {
    createWorker: jest.fn(),
    createQueue: jest.fn(() => ({ name: 'mock-queue' })),
    addJob: jest.fn(),
  },
}));

// ── imports (after mocks) ─────────────────────────────────────────────────────

import { BillingService } from '../services/BillingService';
import { PLAN_CREDITS } from '../models/Subscription';
import { processPayoutJob } from '../jobs/payoutJob';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeJob(id: string, data: Record<string, unknown>): any {
  return {
    id,
    name: 'job',
    data,
    updateProgress: jest.fn().mockResolvedValue(undefined),
    attemptsMade: 0,
  };
}

const STRIPE_KEY = 'sk_test_fake';

beforeEach(() => {
  mockSubscriptionState = null;
  jest.clearAllMocks();
  mockPayoutTransactionFindUnique.mockResolvedValue(null);
  mockPayoutTransactionCreate.mockResolvedValue({});
  mockPayoutTransactionUpdate.mockResolvedValue({});

  process.env.STRIPE_SECRET_KEY = STRIPE_KEY;
  delete process.env.STRIPE_PAYMENT_METHODS;
});

afterAll(() => {
  delete process.env.STRIPE_SECRET_KEY;
});

// ═══════════════════════════════════════════════════════════════════════════════
// Issue 1 — createCheckoutSession always includes payment_method_types
// ═══════════════════════════════════════════════════════════════════════════════

describe('createCheckoutSession — payment_method_types', () => {
  const userId = 'user-checkout';
  const stripeCustomerId = 'cus_test_checkout';

  beforeEach(() => {
    // Pre-seed a subscription so the service doesn't call provisionUser
    mockSubscriptionState = {
      id: 'sub-1',
      userId,
      plan: 'free',
      status: 'active',
      stripeCustomerId,
      stripeSubscriptionId: null,
      creditsRemaining: PLAN_CREDITS.free,
      creditsMonthly: PLAN_CREDITS.free,
      currentPeriodEnd: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockSessionCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/session_url' });
  });

  it('includes payment_method_types defaulting to ["card"]', async () => {
    const service = new BillingService();
    await service.createCheckoutSession(userId, 'price_123', 'https://ok', 'https://cancel');

    expect(mockSessionCreate).toHaveBeenCalledTimes(1);
    const callArg = mockSessionCreate.mock.calls[0][0];
    expect(callArg).toHaveProperty('payment_method_types');
    expect(callArg.payment_method_types).toEqual(['card']);
  });

  it('respects STRIPE_PAYMENT_METHODS env var', async () => {
    process.env.STRIPE_PAYMENT_METHODS = 'card,link';
    const service = new BillingService();
    await service.createCheckoutSession(userId, 'price_123', 'https://ok', 'https://cancel');

    const callArg = mockSessionCreate.mock.calls[0][0];
    expect(callArg.payment_method_types).toEqual(['card', 'link']);
  });

  it('payment_method_types is never omitted even with empty env var', async () => {
    process.env.STRIPE_PAYMENT_METHODS = '';
    const service = new BillingService();
    // Empty string falls back to default 'card' because filter(Boolean) removes empty strings
    // and the env var is falsy so the ?? 'card' default kicks in
    await service.createCheckoutSession(userId, 'price_123', 'https://ok', 'https://cancel');

    const callArg = mockSessionCreate.mock.calls[0][0];
    expect(callArg).toHaveProperty('payment_method_types');
    expect(Array.isArray(callArg.payment_method_types)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Issue 2 — Credits are refunded when the platform publish call fails
// ═══════════════════════════════════════════════════════════════════════════════

describe('BillingService.refundCredits — compensating transaction', () => {
  const userId = 'user-refund';

  beforeEach(() => {
    mockSubscriptionState = {
      id: 'sub-2',
      userId,
      plan: 'free',
      status: 'active',
      stripeCustomerId: 'cus_refund',
      stripeSubscriptionId: null,
      creditsRemaining: PLAN_CREDITS.free,
      creditsMonthly: PLAN_CREDITS.free,
      currentPeriodEnd: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });

  it('restores credits after a deduction', async () => {
    const service = new BillingService();
    const balanceAfterDeduct = await service.deductCredits(userId, 'post:publish');
    expect(balanceAfterDeduct).toBe(PLAN_CREDITS.free - 1);

    const balanceAfterRefund = await service.refundCredits(userId, 'post:publish', 'platform_failure:twitter');
    expect(balanceAfterRefund).toBe(PLAN_CREDITS.free);
  });

  it('appends a credit:topup log entry with the refund reason', async () => {
    const service = new BillingService();
    await service.deductCredits(userId, 'post:publish');
    await service.refundCredits(userId, 'post:publish', 'platform_failure:twitter');

    const refundCall = mockPrisma.creditLog.create.mock.calls.find(
      (call: any) => call[0].data.action === 'credit:topup',
    );
    expect(refundCall).toBeDefined();
    const refundLog = refundCall[0].data;
    expect(refundLog.metadata?.reason).toBe('platform_failure:twitter');
    expect(refundLog.metadata?.refundedAction).toBe('post:publish');
    expect(refundLog.delta).toBe(1); // post:publish costs 1 credit
  });

  it('throws when user has no subscription', async () => {
    const service = new BillingService();
    await expect(service.refundCredits('nonexistent-user', 'post:publish')).rejects.toThrow(
      'No subscription found for user',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Issue 3 — provisionUser is idempotent (no duplicate Stripe customers)
// ═══════════════════════════════════════════════════════════════════════════════

describe('provisionUser — idempotent Stripe customer creation', () => {
  const email = 'idempotent@example.com';
  const existingCustomerId = 'cus_existing_123';

  it('creates a new customer when none exists in Stripe', async () => {
    mockCustomerList.mockResolvedValue({ data: [] });
    mockCustomerCreate.mockResolvedValue({ id: 'cus_new_456' });

    const service = new BillingService();
    const sub = await service.provisionUser('user-idempotent-1', email);

    expect(mockCustomerList).toHaveBeenCalledWith({ email, limit: 1 });
    expect(mockCustomerCreate).toHaveBeenCalledTimes(1);
    expect(sub.stripeCustomerId).toBe('cus_new_456');
  });

  it('reuses the existing Stripe customer when one is found by email', async () => {
    mockCustomerList.mockResolvedValue({ data: [{ id: existingCustomerId }] });

    const service = new BillingService();
    const sub = await service.provisionUser('user-idempotent-2', email);

    expect(mockCustomerList).toHaveBeenCalledWith({ email, limit: 1 });
    expect(mockCustomerCreate).not.toHaveBeenCalled();
    expect(sub.stripeCustomerId).toBe(existingCustomerId);
  });

  it('returns the existing local subscription on a second call without hitting Stripe', async () => {
    mockCustomerList.mockResolvedValue({ data: [] });
    mockCustomerCreate.mockResolvedValue({ id: 'cus_once' });

    const service = new BillingService();
    const userId = 'user-idempotent-3';
    const first = await service.provisionUser(userId, email);
    const second = await service.provisionUser(userId, email);

    // Stripe should only have been called once
    expect(mockCustomerCreate).toHaveBeenCalledTimes(1);
    expect(first.stripeCustomerId).toBe(second.stripeCustomerId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Issue 4 — processPayoutJob writes a PayoutFailure record on failure
// ═══════════════════════════════════════════════════════════════════════════════

describe('processPayoutJob — payout failure audit', () => {
  const validPayout = {
    groupId: 'g-audit',
    amount: 50,
    recipient: 'wallet-0xabc',
    recipientType: 'wallet' as const,
    currency: 'USD',
    metadata: { userId: 'u-audit' },
  };

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockPayoutFailureCreate.mockResolvedValue({});
  });

  afterEach(() => jest.restoreAllMocks());

  it('writes a PayoutFailure record when the job fails due to missing fields', async () => {
    const job = makeJob('pf-1', { groupId: 'g-audit' }); // missing required fields
    await expect(processPayoutJob(job)).rejects.toThrow('Failed to process payout');

    expect(mockPayoutFailureCreate).toHaveBeenCalledTimes(1);
    const record = mockPayoutFailureCreate.mock.calls[0][0].data;
    expect(record.jobId).toBe('pf-1');
    expect(typeof record.reason).toBe('string');
    expect(record.reason.length).toBeGreaterThan(0);
  });

  it('writes a PayoutFailure record with the correct reason when amount is zero', async () => {
    const job = makeJob('pf-2', { ...validPayout, amount: 0 });
    await expect(processPayoutJob(job)).rejects.toThrow('Failed to process payout');

    expect(mockPayoutFailureCreate).toHaveBeenCalledTimes(1);
    const record = mockPayoutFailureCreate.mock.calls[0][0].data;
    expect(record.reason).toMatch(/greater than 0/i);
    expect(record.groupId).toBe('g-audit');
  });

  it('includes a failedAt-compatible timestamp (uses DB default, record has correct shape)', async () => {
    const job = makeJob('pf-3', { ...validPayout, amount: -1 });
    await expect(processPayoutJob(job)).rejects.toThrow();

    const record = mockPayoutFailureCreate.mock.calls[0][0].data;
    // The model uses @default(now()) so the application doesn't set failedAt explicitly;
    // verify the other required fields are present and correctly typed.
    expect(record).toMatchObject({
      jobId: 'pf-3',
      groupId: 'g-audit',
      recipient: 'wallet-0xabc',
      amount: -1,
      currency: 'USD',
    });
  });

  it('still throws the original error after writing the failure record', async () => {
    const job = makeJob('pf-4', { groupId: 'g-audit' });
    await expect(processPayoutJob(job)).rejects.toThrow(/Failed to process payout/);
  });

  it('does not write a failure record on success', async () => {
    const job = makeJob('pf-5', validPayout);
    const result = await processPayoutJob(job);
    expect(result.success).toBe(true);
    expect(mockPayoutFailureCreate).not.toHaveBeenCalled();
  });
});
