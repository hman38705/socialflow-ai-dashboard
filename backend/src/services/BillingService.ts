import Stripe from 'stripe';
import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import {
  Subscription,
  PLAN_CREDITS,
  SubscriptionPlan,
  ACTION_COST,
  CreditAction,
} from '../models/Subscription';

const logger = createLogger('billing-service');


function stripe(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-02-25.clover' });
}

function toSubscription(row: {
  id: string;
  userId: string;
  plan: string;
  status: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  creditsRemaining: number;
  creditsMonthly: number;
  currentPeriodEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Subscription {
  return {
    id: row.id,
    userId: row.userId,
    plan: row.plan as SubscriptionPlan,
    status: row.status as Subscription['status'],
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    creditsRemaining: row.creditsRemaining,
    creditsMonthly: row.creditsMonthly,
    currentPeriodEnd: row.currentPeriodEnd,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class BillingService {
  public isConfigured(): boolean {
    return !!process.env.STRIPE_SECRET_KEY;
  }

  /** Create or retrieve a Stripe customer and provision a free subscription */
  public async provisionUser(userId: string, email: string): Promise<Subscription> {
    const existing = await prisma.subscription.findUnique({ where: { userId } });
    if (existing) return toSubscription(existing);

    const existingCustomers = await stripe().customers.list({ email, limit: 1 });
    const customer =
      existingCustomers.data.length > 0
        ? existingCustomers.data[0]
        : await stripe().customers.create({ email, metadata: { userId } });

    const sub = await prisma.subscription.create({
      data: {
        id: randomUUID(),
        userId,
        plan: 'free',
        status: 'active',
        stripeCustomerId: customer.id,
        stripeSubscriptionId: null,
        creditsRemaining: PLAN_CREDITS.free,
        creditsMonthly: PLAN_CREDITS.free,
        currentPeriodEnd: null,
      },
    });

    await prisma.creditLog.create({
      data: {
        userId,
        action: 'credit:reset',
        delta: PLAN_CREDITS.free,
        balanceAfter: PLAN_CREDITS.free,
        metadata: { reason: 'initial_provision' },
      },
    });

    logger.info('User provisioned', { userId, customerId: customer.id });
    return toSubscription(sub);
  }

  /** Create a Stripe Checkout session for upgrading to a paid plan */
  public async createCheckoutSession(
    userId: string,
    priceId: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<string> {
    const sub = await prisma.subscription.findUnique({ where: { userId } });
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
    const sub = await prisma.subscription.findUnique({ where: { userId } });
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
  public async deductCredits(userId: string, action: CreditAction): Promise<number> {
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    if (!sub) throw new Error('No subscription found for user');
    if (sub.status !== 'active' && sub.status !== 'trialing') {
      throw new Error('Subscription is not active');
    }

    const cost = ACTION_COST[action] ?? 1;
    if (sub.creditsRemaining < cost) {
      throw new Error(
        `Insufficient credits. Required: ${cost}, available: ${sub.creditsRemaining}`,
      );
    }

    const newBalance = sub.creditsRemaining - cost;
    await prisma.subscription.update({ where: { userId }, data: { creditsRemaining: newBalance } });
    await prisma.creditLog.create({
      data: { userId, action, delta: -cost, balanceAfter: newBalance },
    });

    return newBalance;
  }

  /**
   * Atomically deduct credits proportional to actual token usage (1 credit per token).
   * Throws if the user has insufficient credits.
   * Returns updated balance.
   */
  public async deductCreditsForTokens(userId: string, tokens: number): Promise<number> {
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    if (!sub) throw new Error('No subscription found for user');
    if (sub.status !== 'active' && sub.status !== 'trialing') {
      throw new Error('Subscription is not active');
    }

    if (sub.creditsRemaining < tokens) {
      throw new Error(
        `Insufficient credits. Required: ${tokens}, available: ${sub.creditsRemaining}`,
      );
    }

    const newBalance = sub.creditsRemaining - tokens;
    await prisma.subscription.update({ where: { userId }, data: { creditsRemaining: newBalance } });
    await prisma.creditLog.create({
      data: { userId, action: 'ai:generate', delta: -tokens, balanceAfter: newBalance },
    });

    return newBalance;
  }

  /**
   * Refund credits for a previously deducted action (compensating transaction).
   * Used when a downstream operation fails after credits have already been deducted.
   * Returns the restored balance.
   */
  public async refundCredits(userId: string, action: CreditAction, reason?: string): Promise<number> {
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    if (!sub) throw new Error('No subscription found for user');

    const cost = ACTION_COST[action] ?? 1;
    const newBalance = sub.creditsRemaining + cost;
    await prisma.subscription.update({ where: { userId }, data: { creditsRemaining: newBalance } });
    await prisma.creditLog.create({
      data: {
        userId,
        action: 'credit:topup',
        delta: cost,
        balanceAfter: newBalance,
        metadata: { reason: reason ?? 'refund', refundedAction: action },
      },
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
        const sub = await prisma.subscription.findFirst({
          where: { stripeSubscriptionId: stripeSub.id },
        });
        if (sub) {
          await prisma.subscription.update({
            where: { userId: sub.userId },
            data: { status: 'canceled', stripeSubscriptionId: null },
          });
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
        const sub = await prisma.subscription.findFirst({
          where: { stripeCustomerId: invoice.customer as string },
        });
        if (sub) {
          await prisma.subscription.update({
            where: { userId: sub.userId },
            data: { status: 'past_due' },
          });
        }
        break;
      }
    }
  }

  private async syncSubscription(stripeSub: Stripe.Subscription): Promise<void> {
    const customerId = stripeSub.customer as string;
    const sub = await prisma.subscription.findFirst({ where: { stripeCustomerId: customerId } });
    if (!sub) {
      logger.warn('No local subscription for Stripe customer', { customerId });
      return;
    }

    const priceId = stripeSub.items.data[0]?.price.id ?? '';
    const price = await stripe().prices.retrieve(priceId, { expand: ['product'] });
    const product = price.product as Stripe.Product;
    const plan = (product.metadata?.plan as SubscriptionPlan) ?? 'starter';

    await prisma.subscription.update({
      where: { userId: sub.userId },
      data: {
        plan,
        status: stripeSub.status,
        stripeSubscriptionId: stripeSub.id,
        currentPeriodEnd: stripeSub.items.data[0]?.current_period_end
          ? new Date(stripeSub.items.data[0].current_period_end * 1000)
          : null,
      },
    });
  }

  private async onPaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    if (invoice.billing_reason !== 'subscription_cycle') return;

    const sub = await prisma.subscription.findFirst({
      where: { stripeCustomerId: invoice.customer as string },
    });
    if (!sub) return;

    const monthly = PLAN_CREDITS[sub.plan as SubscriptionPlan];
    await prisma.subscription.update({
      where: { userId: sub.userId },
      data: { creditsRemaining: monthly, creditsMonthly: monthly },
    });
    await prisma.creditLog.create({
      data: {
        userId: sub.userId,
        action: 'credit:reset',
        delta: monthly,
        balanceAfter: monthly,
        metadata: { reason: 'billing_cycle_renewal', invoiceId: invoice.id },
      },
    });

    logger.info('Credits reset on renewal', { userId: sub.userId, credits: monthly });
  }
}

export const billingService = new BillingService();
