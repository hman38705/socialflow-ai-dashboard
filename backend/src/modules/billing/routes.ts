import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import { billingService } from '../services/BillingService';
import { SubscriptionStore, CreditLogStore } from '../models/Subscription';
import { UserStore } from '../models/User';
import { createLogger } from '../lib/logger';

const router = Router();
const logger = createLogger('billing-routes');

const checkoutSchema = z.object({
  priceId: z.string().min(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

const portalSchema = z.object({
  returnUrl: z.string().url(),
});

/**
 * POST /api/billing/provision
 * Provision a Stripe customer + free subscription for the authenticated user.
 */
router.post('/provision', authMiddleware, async (req: AuthRequest, res: Response) => {
  const user = UserStore.findById(req.user!.id);
  if (!user) return res.status(404).json({ message: 'User not found' });

  try {
    const sub = await billingService.provisionUser(user.id, user.email);
    return res.status(201).json(sub);
  } catch (err) {
    logger.error('Provision failed', { error: (err as Error).message });
    return res.status(502).json({ message: (err as Error).message });
  }
});

/**
 * GET /api/billing/subscription
 * Get the current user's subscription and credit balance.
 */
router.get('/subscription', authMiddleware, (req: AuthRequest, res: Response) => {
  const sub = SubscriptionStore.findByUserId(req.user!.id);
  if (!sub)
    return res.status(404).json({ message: 'No subscription found. Call /provision first.' });
  return res.json(sub);
});

/**
 * GET /api/billing/credits
 * Get the current user's credit log.
 */
router.get('/credits', authMiddleware, (req: AuthRequest, res: Response) => {
  const logs = CreditLogStore.forUser(req.user!.id);
  return res.json(logs);
});

/**
 * POST /api/billing/checkout
 * Create a Stripe Checkout session for upgrading to a paid plan.
 */
router.post(
  '/checkout',
  authMiddleware,
  validate(checkoutSchema),
  async (req: AuthRequest, res: Response) => {
    const { priceId, successUrl, cancelUrl } = req.body;
    try {
      const url = await billingService.createCheckoutSession(
        req.user!.id,
        priceId,
        successUrl,
        cancelUrl,
      );
      return res.json({ url });
    } catch (err) {
      logger.error('Checkout session failed', { error: (err as Error).message });
      return res.status(502).json({ message: (err as Error).message });
    }
  },
);

/**
 * POST /api/billing/portal
 * Create a Stripe Customer Portal session.
 */
router.post(
  '/portal',
  authMiddleware,
  validate(portalSchema),
  async (req: AuthRequest, res: Response) => {
    const { returnUrl } = req.body;
    try {
      const url = await billingService.createPortalSession(req.user!.id, returnUrl);
      return res.json({ url });
    } catch (err) {
      logger.error('Portal session failed', { error: (err as Error).message });
      return res.status(502).json({ message: (err as Error).message });
    }
  },
);

/**
 * POST /api/billing/webhook
 * Stripe webhook endpoint — must use raw body (no JSON parsing).
 */
router.post('/webhook', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;
  if (!sig) return res.status(400).json({ message: 'Missing stripe-signature header' });

  try {
    await billingService.handleWebhook(req.body as Buffer, sig);
    return res.json({ received: true });
  } catch (err) {
    logger.error('Webhook error', { error: (err as Error).message });
    return res.status(400).json({ message: (err as Error).message });
  }
});

export default router;
