import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate as authMiddleware, AuthRequest } from '../middleware/authenticate';
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
 * @openapi
 * /billing/provision:
 *   post:
 *     tags: [Billing]
 *     summary: Provision a Stripe customer and free subscription for the authenticated user
 *     responses:
 *       201:
 *         description: Subscription provisioned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Subscription'
 *       404:
 *         description: User not found
 *       502:
 *         description: Stripe error
 */
router.post('/provision', authMiddleware, async (req: AuthRequest, res: Response) => {
  const user = await UserStore.findById(req.user!.id);
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
 * @openapi
 * /billing/subscription:
 *   get:
 *     tags: [Billing]
 *     summary: Get the current user's subscription and credit balance
 *     responses:
 *       200:
 *         description: Subscription details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Subscription'
 *       404:
 *         description: No subscription found
 */
router.get('/subscription', authMiddleware, (req: AuthRequest, res: Response) => {
  const sub = SubscriptionStore.findByUserId(req.user!.id);
  if (!sub)
    return res.status(404).json({ message: 'No subscription found. Call /provision first.' });
  return res.json(sub);
});

/**
 * @openapi
 * /billing/credits:
 *   get:
 *     tags: [Billing]
 *     summary: Get the current user's credit log
 *     responses:
 *       200:
 *         description: Credit log entries
 */
router.get('/credits', authMiddleware, (req: AuthRequest, res: Response) => {
  const logs = CreditLogStore.forUser(req.user!.id);
  return res.json(logs);
});

/**
 * @openapi
 * /billing/checkout:
 *   post:
 *     tags: [Billing]
 *     summary: Create a Stripe Checkout session for upgrading to a paid plan
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [priceId, successUrl, cancelUrl]
 *             properties:
 *               priceId:
 *                 type: string
 *               successUrl:
 *                 type: string
 *                 format: uri
 *               cancelUrl:
 *                 type: string
 *                 format: uri
 *     responses:
 *       200:
 *         description: Checkout session URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url: { type: string, format: uri }
 *       502:
 *         description: Stripe error
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
 * @openapi
 * /billing/portal:
 *   post:
 *     tags: [Billing]
 *     summary: Create a Stripe Customer Portal session
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [returnUrl]
 *             properties:
 *               returnUrl:
 *                 type: string
 *                 format: uri
 *     responses:
 *       200:
 *         description: Portal session URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url: { type: string, format: uri }
 *       502:
 *         description: Stripe error
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
 * @openapi
 * /billing/webhook:
 *   post:
 *     tags: [Billing]
 *     summary: Stripe webhook receiver (raw body, HMAC-verified)
 *     security: []
 *     parameters:
 *       - in: header
 *         name: stripe-signature
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/octet-stream:
 *           schema:
 *             type: string
 *             format: binary
 *     responses:
 *       200:
 *         description: Event received
 *       400:
 *         description: Missing signature or invalid payload
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
