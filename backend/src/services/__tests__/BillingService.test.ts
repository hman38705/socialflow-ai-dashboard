import { BillingService } from '../BillingService';
import { prisma } from '../../lib/prisma';
import Stripe from 'stripe';
import { randomUUID } from 'crypto';

// Mock Prisma
jest.mock('../../lib/prisma', () => ({
  prisma: {
    subscription: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    creditLog: {
      create: jest.fn(),
    },
  },
}));

// Mock Stripe
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    customers: {
      list: jest.fn(),
      create: jest.fn(),
    },
    checkout: {
      sessions: {
        create: jest.fn(),
      },
    },
    billingPortal: {
      sessions: {
        create: jest.fn(),
      },
    },
    prices: {
      retrieve: jest.fn(),
    },
    webhooks: {
      constructEvent: jest.fn(),
    },
  }));
});

// Mock logger
jest.mock('../../lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

describe('BillingService', () => {
  let service: BillingService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    service = new BillingService();
  });

  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });

  describe('isConfigured', () => {
    it('should return true when STRIPE_SECRET_KEY is set', () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_123';
      expect(service.isConfigured()).toBe(true);
    });

    it('should return false when STRIPE_SECRET_KEY is not set', () => {
      delete process.env.STRIPE_SECRET_KEY;
      expect(service.isConfigured()).toBe(false);
    });
  });

  describe('provisionUser', () => {
    it('should return existing subscription if user is already provisioned', async () => {
      const mockSubscription = {
        id: 'sub-123',
        userId: 'user-123',
        plan: 'free',
        status: 'active',
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: null,
        creditsRemaining: 1000,
        creditsMonthly: 1000,
        currentPeriodEnd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(mockSubscription);

      const result = await service.provisionUser('user-123', 'user@example.com');

      expect(result).toEqual(mockSubscription);
      expect(prisma.subscription.findUnique).toHaveBeenCalledWith({ where: { userId: 'user-123' } });
    });

    it('should create new subscription if user does not exist', async () => {
      const mockCustomer = { id: 'cus_123' };
      const mockSubscription = {
        id: 'sub-123',
        userId: 'user-123',
        plan: 'free',
        status: 'active',
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: null,
        creditsRemaining: 1000,
        creditsMonthly: 1000,
        currentPeriodEnd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(null);
      (require('stripe') as jest.Mock).mock.results[0].value.customers.list.mockResolvedValue({
        data: [],
      });
      (require('stripe') as jest.Mock).mock.results[0].value.customers.create.mockResolvedValue(
        mockCustomer,
      );
      (prisma.subscription.create as jest.Mock).mockResolvedValue(mockSubscription);

      const result = await service.provisionUser('user-123', 'user@example.com');

      expect(result.userId).toBe('user-123');
      expect(prisma.subscription.create).toHaveBeenCalled();
      expect(prisma.creditLog.create).toHaveBeenCalled();
    });
  });

  describe('createCheckoutSession', () => {
    it('should throw error when user is not provisioned', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createCheckoutSession('user-123', 'price_123', 'https://success.com', 'https://cancel.com'),
      ).rejects.toThrow('User not provisioned for billing');
    });

    it('should create checkout session successfully', async () => {
      const mockSubscription = {
        id: 'sub-123',
        userId: 'user-123',
        plan: 'free',
        status: 'active',
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: null,
        creditsRemaining: 1000,
        creditsMonthly: 1000,
        currentPeriodEnd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(mockSubscription);
      (require('stripe') as jest.Mock).mock.results[0].value.checkout.sessions.create.mockResolvedValue({
        url: 'https://checkout.stripe.com/pay/123',
      });

      const result = await service.createCheckoutSession(
        'user-123',
        'price_123',
        'https://success.com',
        'https://cancel.com',
      );

      expect(result).toBe('https://checkout.stripe.com/pay/123');
    });
  });

  describe('createPortalSession', () => {
    it('should throw error when user is not provisioned', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.createPortalSession('user-123', 'https://return.com')).rejects.toThrow(
        'User not provisioned for billing',
      );
    });

    it('should create portal session successfully', async () => {
      const mockSubscription = {
        id: 'sub-123',
        userId: 'user-123',
        plan: 'free',
        status: 'active',
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: null,
        creditsRemaining: 1000,
        creditsMonthly: 1000,
        currentPeriodEnd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(mockSubscription);
      (require('stripe') as jest.Mock).mock.results[0].value.billingPortal.sessions.create.mockResolvedValue({
        url: 'https://billing.stripe.com/session/123',
      });

      const result = await service.createPortalSession('user-123', 'https://return.com');

      expect(result).toBe('https://billing.stripe.com/session/123');
    });
  });

  describe('deductCredits', () => {
    const mockSubscription = {
      id: 'sub-123',
      userId: 'user-123',
      plan: 'free',
      status: 'active',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: null,
      creditsRemaining: 1000,
      creditsMonthly: 1000,
      currentPeriodEnd: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should throw error when user has no subscription', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.deductCredits('user-123', 'tweet:publish')).rejects.toThrow(
        'No subscription found for user',
      );
    });

    it('should throw error when subscription is not active', async () => {
      const inactiveSub = { ...mockSubscription, status: 'canceled' };
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(inactiveSub);

      await expect(service.deductCredits('user-123', 'tweet:publish')).rejects.toThrow(
        'Subscription is not active',
      );
    });

    it('should throw error when insufficient credits', async () => {
      const lowCreditSub = { ...mockSubscription, creditsRemaining: 0 };
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(lowCreditSub);

      await expect(service.deductCredits('user-123', 'tweet:publish')).rejects.toThrow(
        'Insufficient credits',
      );
    });

    it('should successfully deduct credits', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(mockSubscription);
      (prisma.subscription.update as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        creditsRemaining: 990,
      });

      const result = await service.deductCredits('user-123', 'tweet:publish');

      expect(result).toBe(990);
      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        data: { creditsRemaining: 990 },
      });
      expect(prisma.creditLog.create).toHaveBeenCalled();
    });
  });

  describe('deductCreditsForTokens', () => {
    const mockSubscription = {
      id: 'sub-123',
      userId: 'user-123',
      plan: 'free',
      status: 'active',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: null,
      creditsRemaining: 1000,
      creditsMonthly: 1000,
      currentPeriodEnd: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should throw error when insufficient credits for tokens', async () => {
      const lowCreditSub = { ...mockSubscription, creditsRemaining: 50 };
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(lowCreditSub);

      await expect(service.deductCreditsForTokens('user-123', 100)).rejects.toThrow(
        'Insufficient credits',
      );
    });

    it('should successfully deduct credits for tokens', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(mockSubscription);
      (prisma.subscription.update as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        creditsRemaining: 850,
      });

      const result = await service.deductCreditsForTokens('user-123', 150);

      expect(result).toBe(850);
      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        data: { creditsRemaining: 850 },
      });
    });
  });

  describe('refundCredits', () => {
    const mockSubscription = {
      id: 'sub-123',
      userId: 'user-123',
      plan: 'free',
      status: 'active',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: null,
      creditsRemaining: 990,
      creditsMonthly: 1000,
      currentPeriodEnd: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should throw error when user has no subscription', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.refundCredits('user-123', 'tweet:publish')).rejects.toThrow(
        'No subscription found for user',
      );
    });

    it('should successfully refund credits', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(mockSubscription);
      (prisma.subscription.update as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        creditsRemaining: 1000,
      });

      const result = await service.refundCredits('user-123', 'tweet:publish', 'operation_failed');

      expect(result).toBe(1000);
      expect(prisma.subscription.update).toHaveBeenCalled();
      expect(prisma.creditLog.create).toHaveBeenCalled();
    });
  });

  describe('handleWebhook', () => {
    it('should throw error when webhook secret is not set', async () => {
      delete process.env.STRIPE_WEBHOOK_SECRET;

      await expect(
        service.handleWebhook(Buffer.from('test'), 'signature'),
      ).rejects.toThrow('STRIPE_WEBHOOK_SECRET is not set');
    });

    it('should throw error when signature is invalid', async () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_123';
      (require('stripe') as jest.Mock).mock.results[0].value.webhooks.constructEvent.mockImplementation(
        () => {
          throw new Error('Invalid signature');
        },
      );

      await expect(
        service.handleWebhook(Buffer.from('test'), 'invalid_signature'),
      ).rejects.toThrow('Webhook signature verification failed');
    });
  });
});
