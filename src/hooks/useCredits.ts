/**
 * Single shared source of truth for subscription + credit-usage data.
 *
 * Backed by a module-level store (not React Context) so every consumer — the
 * billing status banner, BillingSection, UsageMeters, and any future
 * AI-consuming surface — reads the same balance without a Provider, and a
 * refresh from one consumer updates all the others.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { BillingService } from '../api/services/BillingService';
import { ApiError } from '../api/core/ApiError';

export type SubscriptionPlan = 'free' | 'starter' | 'pro' | 'enterprise';
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing';

export interface BillingSubscription {
  id: string;
  userId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  creditsRemaining: number;
  creditsMonthly: number;
  currentPeriodEnd: string | null;
}

interface CreditLogEntry {
  action: string;
  delta: number;
  balanceAfter: number;
  createdAt: string;
}

export interface CreditMeter {
  key: string;
  label: string;
  used: number;
  /** null means unlimited (enterprise plan) */
  included: number | null;
  resetsAt: string | null;
  /** Actions that stop working once this meter is exhausted. */
  blockedActions: string[];
}

interface BillingState {
  subscription: BillingSubscription | null;
  creditLog: CreditLogEntry[];
  isLoading: boolean;
  error: string | null;
}

let state: BillingState = { subscription: null, creditLog: [], isLoading: false, error: null };
let hasStarted = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setState(patch: Partial<BillingState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): BillingState {
  return state;
}

async function load(): Promise<void> {
  if (inflight) return inflight;
  setState({ isLoading: true, error: null });
  inflight = (async () => {
    try {
      let subscription: BillingSubscription;
      try {
        subscription =
          (await BillingService.getBillingSubscription()) as unknown as BillingSubscription;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          subscription =
            (await BillingService.postBillingProvision()) as unknown as BillingSubscription;
        } else {
          throw err;
        }
      }
      const creditLog = (await BillingService.getBillingCredits()) as CreditLogEntry[];
      setState({
        subscription,
        creditLog: Array.isArray(creditLog) ? creditLog : [],
        isLoading: false,
        error: null,
      });
    } catch (err) {
      setState({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load billing data',
      });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Call after any credit-consuming action completes (AI generation, translation,
 * TTS, video render, ...) so every mounted meter refreshes to the true balance.
 */
export function notifyCreditsConsumed(): void {
  void load();
}

// Friendly labels for known credit-log actions. Extend as new metered features
// (translations, TTS characters, video minutes) start tagging distinct actions —
// today they all draw from the same `ai:*` pool tracked by the overall meter.
const ACTION_LABELS: Record<string, string> = {
  'ai:generate': 'AI generations',
  'ai:analyze': 'AI analysis',
  'post:publish': 'Post publishing',
};

function deriveMeters(s: BillingState): CreditMeter[] {
  const sub = s.subscription;
  if (!sub) return [];

  const unlimited = sub.plan === 'enterprise';
  const included = unlimited ? null : sub.creditsMonthly;
  const used = unlimited ? 0 : Math.max(0, sub.creditsMonthly - sub.creditsRemaining);

  const byAction = new Map<string, number>();
  for (const entry of s.creditLog) {
    if (entry.delta < 0) {
      byAction.set(entry.action, (byAction.get(entry.action) ?? 0) + Math.abs(entry.delta));
    }
  }
  const blockedActions = Array.from(byAction.keys()).map((a) => ACTION_LABELS[a] ?? a);

  const overall: CreditMeter = {
    key: 'credits:total',
    label: 'AI credits',
    used,
    included,
    resetsAt: sub.currentPeriodEnd,
    blockedActions: blockedActions.length ? blockedActions : ['AI-powered actions'],
  };

  const breakdown: CreditMeter[] = Array.from(byAction.entries()).map(([action, usedAmount]) => ({
    key: `action:${action}`,
    label: ACTION_LABELS[action] ?? action,
    used: usedAmount,
    included, // drawn from the same shared pool as the overall meter
    resetsAt: sub.currentPeriodEnd,
    blockedActions: [ACTION_LABELS[action] ?? action],
  }));

  return [overall, ...breakdown];
}

export function useCredits() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    if (!hasStarted) {
      hasStarted = true;
      void load();
    }
  }, []);

  const refresh = useCallback(() => load(), []);

  return {
    subscription: snapshot.subscription,
    meters: deriveMeters(snapshot),
    isLoading: snapshot.isLoading,
    error: snapshot.error,
    refresh,
  };
}
