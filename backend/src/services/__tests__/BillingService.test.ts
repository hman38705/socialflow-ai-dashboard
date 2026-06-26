import { BillingService } from '../BillingService';
import { prisma } from '../../lib/prisma';
import { ACTION_COST } from '../../models/Subscription';

jest.mock('stripe', () => jest.fn().mockImplementation(() => ({})));

jest.mock('../../lib/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    subscription: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    creditLog: {
      create: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma> & {
  $transaction: jest.Mock;
  subscription: { findUnique: jest.Mock; updateMany: jest.Mock };
  creditLog: { create: jest.Mock };
};

function buildTx(opts: {
  creditsRemaining: number;
  status?: string;
  updateCount?: number;
}) {
  const sub = {
    userId: 'u1',
    status: opts.status ?? 'active',
    creditsRemaining: opts.creditsRemaining,
  };
  return {
    subscription: {
      findUnique: jest.fn().mockResolvedValue(sub),
      updateMany: jest.fn().mockResolvedValue({ count: opts.updateCount ?? 1 }),
    },
    creditLog: { create: jest.fn().mockResolvedValue({}) },
    _sub: sub,
  };
}

describe('BillingService.deductCredits – atomic transaction', () => {
  let service: BillingService;

  beforeEach(() => {
    service = new BillingService();
    jest.clearAllMocks();
  });

  it('returns the new balance after a successful deduction', async () => {
    const tx = buildTx({ creditsRemaining: 10 });
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

    const balance = await service.deductCredits('u1', 'ai:generate'); // cost = 5
    expect(balance).toBe(5);
  });

  it('passes a creditsRemaining gte guard to updateMany', async () => {
    const tx = buildTx({ creditsRemaining: 10 });
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await service.deductCredits('u1', 'ai:generate');

    expect(tx.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ creditsRemaining: { gte: ACTION_COST['ai:generate'] } }),
        data: { creditsRemaining: { decrement: ACTION_COST['ai:generate'] } },
      }),
    );
  });

  it('throws Insufficient when updateMany returns count 0 (concurrent deduction already won)', async () => {
    // Simulate another concurrent request already having deducted the balance
    const tx = buildTx({ creditsRemaining: 5, updateCount: 0 });
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await expect(service.deductCredits('u1', 'ai:generate')).rejects.toThrow(/Insufficient/);
  });

  it('throws when subscription is missing', async () => {
    const tx = {
      subscription: { findUnique: jest.fn().mockResolvedValue(null), updateMany: jest.fn() },
      creditLog: { create: jest.fn() },
    };
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await expect(service.deductCredits('u1', 'ai:generate')).rejects.toThrow(
      'No subscription found for user',
    );
    expect(tx.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('throws when subscription is inactive', async () => {
    const tx = buildTx({ creditsRemaining: 100, status: 'canceled' });
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await expect(service.deductCredits('u1', 'ai:generate')).rejects.toThrow(
      'Subscription is not active',
    );
  });

  it('prevents over-deduction under concurrent requests – only one call succeeds when balance covers exactly one', async () => {
    const COST = ACTION_COST['ai:generate']; // 5
    let balance = COST; // exactly enough for a single deduction

    mockPrisma.$transaction.mockImplementation((fn: any) => {
      const tx = {
        subscription: {
          findUnique: jest.fn().mockImplementation(() =>
            Promise.resolve({ userId: 'u-race', status: 'active', creditsRemaining: balance }),
          ),
          updateMany: jest.fn().mockImplementation(({ where }: any) => {
            if (balance >= where.creditsRemaining.gte) {
              balance -= COST;
              return Promise.resolve({ count: 1 });
            }
            return Promise.resolve({ count: 0 });
          }),
        },
        creditLog: { create: jest.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });

    const results = await Promise.allSettled([
      service.deductCredits('u-race', 'ai:generate'),
      service.deductCredits('u-race', 'ai:generate'),
      service.deductCredits('u-race', 'ai:generate'),
    ]);

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(2);
    // Balance must never go below zero
    expect(balance).toBeGreaterThanOrEqual(0);
  });
});

describe('BillingService.deductCreditsForTokens – atomic transaction', () => {
  let service: BillingService;

  beforeEach(() => {
    service = new BillingService();
    jest.clearAllMocks();
  });

  it('returns new balance after token deduction', async () => {
    const tx = buildTx({ creditsRemaining: 50 });
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

    const balance = await service.deductCreditsForTokens('u1', 20);
    expect(balance).toBe(30);
  });

  it('throws Insufficient when updateMany returns count 0', async () => {
    const tx = buildTx({ creditsRemaining: 10, updateCount: 0 });
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await expect(service.deductCreditsForTokens('u1', 10)).rejects.toThrow(/Insufficient/);
  });
});
