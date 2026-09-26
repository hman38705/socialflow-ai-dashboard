import request from 'supertest';
import express, { Response, NextFunction } from 'express';
import billingRouter from '../modules/billing/routes';

jest.mock('../middleware/authMiddleware', () => ({
  authMiddleware: (req: any, _res: Response, next: NextFunction) => {
    req.user = { id: 'user-1' };
    next();
  },
}));

jest.mock('../models/User', () => ({ UserStore: { findById: jest.fn() } }));
jest.mock('../models/Subscription', () => ({
  SubscriptionStore: { findByUserId: jest.fn() },
  CreditLogStore: { forUser: jest.fn() },
}));

const mockCreateCheckoutSession = jest.fn();
const mockCreatePortalSession = jest.fn();

jest.mock('../modules/billing/services/BillingService', () => ({
  billingService: {
    createCheckoutSession: (...args: unknown[]) => mockCreateCheckoutSession(...args),
    createPortalSession: (...args: unknown[]) => mockCreatePortalSession(...args),
  },
}));

jest.mock('../config/cors', () => ({
  allowedOrigins: ['https://socialflow.app'],
}));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/billing', billingRouter);
  return app;
}

describe('Module-tree billing redirect URL allow-list', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects /checkout with an external successUrl before calling Stripe', async () => {
    const res = await request(buildApp()).post('/billing/checkout').send({
      priceId: 'price_1',
      successUrl: 'https://evil.example.com/done',
      cancelUrl: 'https://socialflow.app/cancel',
    });
    expect(res.status).toBe(400);
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it('rejects /portal with an external returnUrl', async () => {
    const res = await request(buildApp())
      .post('/billing/portal')
      .send({ returnUrl: 'https://evil.example.com/back' });
    expect(res.status).toBe(400);
    expect(mockCreatePortalSession).not.toHaveBeenCalled();
  });

  it('allows allow-listed URLs', async () => {
    mockCreateCheckoutSession.mockResolvedValue('https://stripe.test/c');
    const res = await request(buildApp()).post('/billing/checkout').send({
      priceId: 'price_1',
      successUrl: 'https://socialflow.app/done',
      cancelUrl: 'https://socialflow.app/cancel',
    });
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://stripe.test/c');
  });
});
