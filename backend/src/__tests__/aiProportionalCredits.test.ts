/**
 * Tests for proportional AI credit deduction (#627)
 *
 * Covers:
 *  1. deductCreditsForTokens deducts exactly the token count (short output)
 *  2. deductCreditsForTokens deducts exactly the token count (long output)
 *  3. deductCreditsForTokens throws on insufficient credits
 *  4. generateContent calls deductCreditsForTokens with actual token count (short output)
 *  5. generateContent calls deductCreditsForTokens with actual token count (long output)
 *  6. generateContent skips deduction when no userId is provided
 */

// ── Mocks for AIService tests ─────────────────────────────────────────────────

const mockDeductCreditsForTokens = jest.fn().mockResolvedValue(900);

jest.mock('../services/BillingService', () => ({
  billingService: { deductCreditsForTokens: mockDeductCreditsForTokens },
  BillingService: jest.fn(),
}));

// ── In-memory Prisma mock for the real-BillingService tests below ────────────
// deductCreditsForTokens runs inside prisma.$transaction, so `$transaction`
// just invokes its callback with this same mock (acting as `tx`).

let mockSubscriptionState: Record<string, unknown> | null = null;

interface MockPrisma {
  subscription: {
    findUnique: jest.Mock;
    updateMany: jest.Mock;
  };
  creditLog: {
    create: jest.Mock;
  };
  $transaction: jest.Mock;
}

const mockPrisma: MockPrisma = {
  subscription: {
    findUnique: jest.fn(() =>
      Promise.resolve(mockSubscriptionState ? { ...mockSubscriptionState } : null),
    ),
    updateMany: jest.fn(({ where, data }: any) => {
      if (
        mockSubscriptionState &&
        (mockSubscriptionState.creditsRemaining as number) >= where.creditsRemaining.gte
      ) {
        mockSubscriptionState.creditsRemaining =
          (mockSubscriptionState.creditsRemaining as number) - data.creditsRemaining.decrement;
        return Promise.resolve({ count: 1 });
      }
      return Promise.resolve({ count: 0 });
    }),
  },
  creditLog: {
    create: jest.fn().mockResolvedValue({}),
  },
  $transaction: jest.fn((cb: (tx: MockPrisma) => unknown) => cb(mockPrisma)),
};

jest.mock('../lib/prisma', () => ({ prisma: mockPrisma }));

jest.mock('../services/CircuitBreakerService', () => ({
  circuitBreakerService: {
    execute: jest.fn((_name: string, fn: () => unknown) => fn()),
  },
}));

jest.mock('../lib/eventBus', () => ({ eventBus: { emitJobProgress: jest.fn() } }));
jest.mock('../lib/logger', () => ({ createLogger: () => ({ warn: jest.fn(), info: jest.fn() }) }));
jest.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: () => ({
      startSpan: () => ({
        setAttribute: jest.fn(),
        setStatus: jest.fn(),
        recordException: jest.fn(),
        end: jest.fn(),
      }),
    }),
  },
  SpanStatusCode: { OK: 'OK', ERROR: 'ERROR' },
}));

const mockGeminiGenerateContent = jest.fn();
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: mockGeminiGenerateContent },
  })),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { PLAN_CREDITS } from '../models/Subscription';

// ── Helpers ───────────────────────────────────────────────────────────────────

function provisionUser(userId: string, credits: number) {
  mockSubscriptionState = {
    id: userId,
    userId,
    plan: 'pro',
    status: 'active',
    stripeCustomerId: 'cus_test',
    stripeSubscriptionId: null,
    creditsRemaining: credits,
    creditsMonthly: PLAN_CREDITS.pro,
    currentPeriodEnd: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ── BillingService unit tests (real implementation) ───────────────────────────

describe('BillingService.deductCreditsForTokens', () => {
  // Bypass the top-level mock by requiring the real module directly
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { BillingService: RealBillingService } = jest.requireActual('../services/BillingService') as typeof import('../services/BillingService');
  const service = new RealBillingService();

  it('deducts exactly the token count from the user balance (short: 50 tokens)', async () => {
    const userId = 'user-short';
    provisionUser(userId, 500);

    const balance = await service.deductCreditsForTokens(userId, 50);

    expect(balance).toBe(450);
    expect((mockSubscriptionState as { creditsRemaining: number }).creditsRemaining).toBe(450);
  });

  it('deducts exactly the token count from the user balance (long: 800 tokens)', async () => {
    const userId = 'user-long';
    provisionUser(userId, 1000);

    const balance = await service.deductCreditsForTokens(userId, 800);

    expect(balance).toBe(200);
    expect((mockSubscriptionState as { creditsRemaining: number }).creditsRemaining).toBe(200);
  });

  it('throws when credits are insufficient', async () => {
    const userId = 'user-broke';
    provisionUser(userId, 10);

    await expect(service.deductCreditsForTokens(userId, 50)).rejects.toThrow(
      'Insufficient credits. Required: 50, available: 10',
    );
  });
});

// ── AIService integration tests ───────────────────────────────────────────────

describe('AIService.generateContent — proportional credit deduction', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    mockDeductCreditsForTokens.mockClear();
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  it('calls deductCreditsForTokens with actual token count for short output (50 tokens)', async () => {
    mockGeminiGenerateContent.mockResolvedValue({
      text: 'Short reply.',
      usageMetadata: { totalTokenCount: 50 },
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { aiService } = require('../services/AIService');
    const result = await aiService.generateContent('hello', undefined, 'user-1');

    expect(result.text).toBe('Short reply.');
    expect(result.totalTokens).toBe(50);
    expect(mockDeductCreditsForTokens).toHaveBeenCalledWith('user-1', 50);
  });

  it('calls deductCreditsForTokens with actual token count for long output (800 tokens)', async () => {
    mockGeminiGenerateContent.mockResolvedValue({
      text: 'A very long response...',
      usageMetadata: { totalTokenCount: 800 },
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { aiService } = require('../services/AIService');
    const result = await aiService.generateContent('write me an essay', undefined, 'user-2');

    expect(result.totalTokens).toBe(800);
    expect(mockDeductCreditsForTokens).toHaveBeenCalledWith('user-2', 800);
  });

  it('skips credit deduction when no userId is provided', async () => {
    mockGeminiGenerateContent.mockResolvedValue({
      text: 'No user.',
      usageMetadata: { totalTokenCount: 100 },
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { aiService } = require('../services/AIService');
    await aiService.generateContent('anonymous prompt');

    expect(mockDeductCreditsForTokens).not.toHaveBeenCalled();
  });
});
