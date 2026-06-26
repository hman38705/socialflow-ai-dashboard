import Stripe from 'stripe';
import { randomUUID } from 'crypto';
import { createLogger } from '../lib/logger';
import {
  Subscription,
  SubscriptionStore,
  CreditLogStore,
  PLAN_CREDITS,
  SubscriptionPlan,
  ACTION_COST,
  CreditAction,
} from '../models/Subscription';

const logger = createLogger('billing-service');

// Per-user mutex: serialises concurrent deductions for the same user.
const userLocks = new Map<string, Promise<void>>();

function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = userLocks.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  userLocks.set(userId, next);
  return prev.then(fn).finally(release);
}

function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  return new Stripe(key, { apiVersion: '2026-02-25.clover' });
}

export class BillingService {
  public isConfigured(): boolean {
    return !!process.env.STRIPE_SECRET_KEY;
  }

  /** Create or retrieve a Stripe customer and provision a free subscription */
  public async provisionUser(userId: string, email: string): Promise<Subscription> {
    const existing = SubscriptionStore.findByUserId(userId);
    if (existing) return existing;

    // Search for an existing Stripe customer by email before creating a new one
    // to prevent duplicate customers when provisionUser is called more than once.
    const existingCustomers = await stripe().customers.list({ email, limit: 1 });
    const customer =
      existingCustomers.data.length > 0
        ? existingCustomers.data[0]
        : await stripe().customers.create({ email, metadata: { userId } });

    const sub: Subscription = {
      id: randomUUID(),
      userId,
      plan: 'free',
      status: 'active',
      stripeCustomerId: customer.id,
      stripeSubscriptionId: null,
      creditsRemaining: PLAN_CREDITS.free,
      creditsMonthly: PLAN_CREDITS.free,
      currentPeriodEnd: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    SubscriptionStore.upsert(sub);
    CreditLogStore.append({
      userId,
      action: 'credit:reset',
      delta: PLAN_CREDITS.free,
      balanceAfter: PLAN_CREDITS.free,
      metadata: { reason: 'initial_provision' },
    });

    logger.info('User provisioned', { userId, customerId: customer.id });
    return sub;
  }

  /** Create a Stripe Checkout session for upgrading to a paid plan */
  public async createCheckoutSession(
    userId: string,
    priceId: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<string> {
    const sub = SubscriptionStore.findByUserId(userId);
    if (!sub) throw new Error('User not provisioned for billing');

    // Explicitly list accepted payment methods to prevent unexpected changes
    // caused by Stripe dashboard defaults. Configurable via STRIPE_PAYMENT_METHODS
    // (comma-separated, e.g. "card,link"). Defaults to card-only.
    const rawMethods = process.env.STRIPE_PAYMENT_METHODS ?? 'card';
    const paymentMethodTypes = rawMethods
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean) as Stripe.Checkout.SessionCreateParams.PaymentMethodType[];

    const session = await stripe().checkout.sessions.create({
      customer: sub.stripeCustomerId,
      mode: 'subscription',
      payment_method_types: paymentMethodTypes,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { userId },
    });

    return session.url!;
  }

  /** Create a Stripe Customer Portal session for managing billing */
  public async createPortalSession(userId: string, returnUrl: string): Promise<string> {
    const sub = SubscriptionStore.findByUserId(userId);
    if (!sub) throw new Error('User not provisioned for billing');

    const session = await stripe().billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: returnUrl,
    });

    return session.url;
  }

  /**
   * Atomically deduct credits for an action inside a per-user lock.
   * Throws if the subscription is missing, inactive, or has insufficient credits.
   * Returns updated balance.
   */
  public deductCredits(userId: string, action: CreditAction): Promise<number> {
    return withUserLock(userId, async () => {
      const cost = ACTION_COST[action] ?? 1;
      const newBalance = SubscriptionStore.checkAndDeduct(userId, cost);
      CreditLogStore.append({ userId, action, delta: -cost, balanceAfter: newBalance });
      return newBalance;
    });
  }

  /**
   * Refund credits for a previously deducted action (compensating transaction).
   * Used when a downstream operation (e.g. platform publish) fails after credits
   * have already been deducted, so the user is not left short-changed.
   * Returns the restored balance.
   */
  public refundCredits(userId: string, action: CreditAction, reason?: string): number {
    const sub = SubscriptionStore.findByUserId(userId);
    if (!sub) throw new Error('No subscription found for user');

    const cost = ACTION_COST[action] ?? 1;
    const newBalance = sub.creditsRemaining + cost;
    SubscriptionStore.patch(userId, { creditsRemaining: newBalance });
    CreditLogStore.append({
      userId,
      action: 'credit:topup',
      delta: cost,
      balanceAfter: newBalance,
      metadata: { reason: reason ?? 'refund', refundedAction: action },
    });

    logger.info('Credits refunded', { userId, action, cost, newBalance, reason });
    return newBalance;
  }

  /** Handle incoming Stripe webhook events */
  public async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');

    let event: Stripe.Event;
    try {
      event = stripe().webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      throw new Error(`Webhook signature verification failed: ${(err as Error).message}`);
    }

    logger.info('Stripe webhook received', { type: event.type });

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const stripeSub = event.data.object as Stripe.Subscription;
        await this.syncSubscription(stripeSub);
        break;
      }
      case 'customer.subscription.deleted': {
        const stripeSub = event.data.object as Stripe.Subscription;
        const sub = SubscriptionStore.findByStripeSubscriptionId(stripeSub.id);
        if (sub) {
          SubscriptionStore.patch(sub.userId, { status: 'canceled', stripeSubscriptionId: null });
        }
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        await this.onPaymentSucceeded(invoice);
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const sub = SubscriptionStore.findByStripeCustomerId(invoice.customer as string);
        if (sub) SubscriptionStore.patch(sub.userId, { status: 'past_due' });
        break;
      }
    }
  }

  private async syncSubscription(stripeSub: Stripe.Subscription): Promise<void> {
    const customerId = stripeSub.customer as string;
    const sub = SubscriptionStore.findByStripeCustomerId(customerId);
    if (!sub) {
      logger.warn('No local subscription for Stripe customer', { customerId });
      return;
    }

    // Derive plan from price metadata or product name (convention: metadata.plan)
    const priceId = stripeSub.items.data[0]?.price.id ?? '';
    const price = await stripe().prices.retrieve(priceId, { expand: ['product'] });
    const product = price.product as Stripe.Product;
    const plan = (product.metadata?.plan as SubscriptionPlan) ?? 'starter';

    SubscriptionStore.patch(sub.userId, {
      plan,
      status: stripeSub.status as Subscription['status'],
      stripeSubscriptionId: stripeSub.id,
      currentPeriodEnd: stripeSub.billing_cycle_anchor
        ? new Date(stripeSub.billing_cycle_anchor * 1000)
        : null,
    });
  }

  private async onPaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    // Only reset credits on subscription renewals (not one-off invoices)
    if (invoice.billing_reason !== 'subscription_cycle') return;

    const sub = SubscriptionStore.findByStripeCustomerId(invoice.customer as string);
    if (!sub) return;

    const monthly = PLAN_CREDITS[sub.plan];
    SubscriptionStore.patch(sub.userId, { creditsRemaining: monthly, creditsMonthly: monthly });
    CreditLogStore.append({
      userId: sub.userId,
      action: 'credit:reset',
      delta: monthly,
      balanceAfter: monthly,
      metadata: { reason: 'billing_cycle_renewal', invoiceId: invoice.id },
    });

    logger.info('Credits reset on renewal', { userId: sub.userId, credits: monthly });
  }
}

export const billingService = new BillingService();
