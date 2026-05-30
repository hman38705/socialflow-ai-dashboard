import Stripe from 'stripe';

const mockCustomersList = jest.fn();
const mockCustomersCreate = jest.fn();
const mockCheckoutSessionsCreate = jest.fn();
const mockPricesRetrieve = jest.fn();

const actualStripe = jest.requireActual('stripe') as typeof import('stripe');

jest.mock('stripe', () => {
  const StripeActual = (jest.requireActual('stripe') as any).default || jest.requireActual('stripe');
  return jest.fn().mockImplementation((key: string, options: any) => {
    const stripe = new StripeActual(key, options);
    stripe.customers = { list: mockCustomersList, create: mockCustomersCreate };
    stripe.checkout = { sessions: { create: mockCheckoutSessionsCreate } };
    stripe.prices = { retrieve: mockPricesRetrieve };
    stripe.billingPortal = { sessions: { create: jest.fn() } };
    return stripe;
  });
});

jest.mock('../../lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { BillingService } from '../../services/BillingService';
import { SubscriptionStore } from '../../models/Subscription';

beforeEach(() => {
  jest.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_e2e';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_e2e';
});

afterAll(() => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

describe('Billing integration end-to-end flow', () => {
  it('provisions a user, creates a checkout session, and syncs subscription via Stripe webhook', async () => {
    mockCustomersList.mockResolvedValue({ data: [] });
    mockCustomersCreate.mockResolvedValue({ id: 'cus_e2e_123' });
    mockCheckoutSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/session/e2e' });
    mockPricesRetrieve.mockResolvedValue({ id: 'price_e2e', product: { metadata: { plan: 'pro' } } });

    const service = new BillingService();
    const userId = 'e2e-user-1';
    const email = 'e2e@example.com';

    const provisioned = await service.provisionUser(userId, email);
    expect(provisioned.stripeCustomerId).toBe('cus_e2e_123');
    expect(provisioned.plan).toBe('free');

    const checkoutUrl = await service.createCheckoutSession(
      userId,
      'price_e2e',
      'https://example.com/success',
      'https://example.com/cancel',
    );
    expect(checkoutUrl).toBe('https://checkout.stripe.com/session/e2e');

    const payload = JSON.stringify({
      type: 'customer.subscription.created',
      data: {
        object: {
          id: 'sub_e2e_123',
          customer: 'cus_e2e_123',
          status: 'active',
          items: { data: [{ price: { id: 'price_e2e' } }] },
          billing_cycle_anchor: 1710000000,
        },
      },
    });

    const stripeClient = new actualStripe('sk_test_e2e', { apiVersion: '2026-02-25.clover' });
    const signature = stripeClient.webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_test_e2e',
      timestamp: Math.floor(Date.now() / 1000),
    });

    await service.handleWebhook(Buffer.from(payload), signature);

    const synced = SubscriptionStore.findByUserId(userId);
    expect(synced).toBeDefined();
    expect(synced?.stripeSubscriptionId).toBe('sub_e2e_123');
    expect(synced?.plan).toBe('pro');
    expect(synced?.status).toBe('active');
  });
});
