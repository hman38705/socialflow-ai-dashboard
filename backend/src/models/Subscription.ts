/**
 * Subscription & CreditLog types and constants.
 * Persistence is handled by Prisma (see schema.prisma).
 */

export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing';
export type SubscriptionPlan = 'free' | 'starter' | 'pro' | 'enterprise';

export interface Subscription {
  id: string;
  userId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  creditsRemaining: number;
  creditsMonthly: number; // reset amount each billing cycle
  currentPeriodEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CreditAction =
  | 'ai:generate'
  | 'ai:analyze'
  | 'post:publish'
  | 'credit:topup'
  | 'credit:reset';

export interface CreditLog {
  id: string;
  userId: string;
  action: CreditAction;
  delta: number; // negative = deduction, positive = addition
  balanceAfter: number;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

/** Credits granted per plan per billing cycle */
export const PLAN_CREDITS: Record<SubscriptionPlan, number> = {
  free: 20,
  starter: 200,
  pro: 1000,
  enterprise: 10000,
};

/** Credit cost per action */
export const ACTION_COST: Record<string, number> = {
  'ai:generate': 5,
  'ai:analyze': 2,
  'post:publish': 1,
};
