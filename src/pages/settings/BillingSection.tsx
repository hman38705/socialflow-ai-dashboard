import React, { useState } from 'react';
import { BillingService } from '../../api/services/BillingService';
import { useCredits, type SubscriptionPlan } from '../../hooks/useCredits';
import { UsageMeters } from '../../components/billing/UsageMeters';

interface PlanDef {
  id: SubscriptionPlan;
  name: string;
  price: string;
  credits: string;
  features: string[];
  priceId?: string;
}

// Credit amounts mirror backend/src/models/Subscription.ts PLAN_CREDITS.
const PLAN_CATALOG: PlanDef[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0/mo',
    credits: '20 AI credits / mo',
    features: ['1 seat', 'Community support', 'Core scheduling'],
  },
  {
    id: 'starter',
    name: 'Starter',
    price: '$19/mo',
    credits: '200 AI credits / mo',
    features: ['Up to 5 seats', 'Email support', 'Webhooks'],
    priceId: import.meta.env.VITE_STRIPE_PRICE_STARTER,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$49/mo',
    credits: '1,000 AI credits / mo',
    features: ['Up to 20 seats', 'Priority support', 'Advanced analytics'],
    priceId: import.meta.env.VITE_STRIPE_PRICE_PRO,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Contact us',
    credits: 'Unlimited AI credits',
    features: ['Unlimited seats', 'Dedicated support', 'SSO & audit logs'],
    priceId: import.meta.env.VITE_STRIPE_PRICE_ENTERPRISE,
  },
];

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  trialing: 'Trial',
  past_due: 'Past due',
  canceled: 'Cancelled',
};

const ACTIVE_ORG_STORAGE_KEY = 'sf.activeOrgId';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

export function BillingSection(): React.JSX.Element {
  const { subscription, isLoading, error, refresh } = useCredits();
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const hasActiveOrg =
    typeof window !== 'undefined' && !!window.localStorage.getItem(ACTIVE_ORG_STORAGE_KEY);

  async function handleManageBilling(): Promise<void> {
    setActionError(null);
    setPendingAction('portal');
    try {
      const { url } = await BillingService.postBillingPortal({
        requestBody: { returnUrl: window.location.href },
      });
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        setActionError('Billing portal did not return a URL.');
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not open the billing portal.');
    } finally {
      setPendingAction(null);
    }
  }

  async function handleUpgrade(plan: PlanDef): Promise<void> {
    if (!plan.priceId) {
      setActionError(`Checkout for ${plan.name} isn't configured yet.`);
      return;
    }
    setActionError(null);
    setPendingAction(plan.id);
    try {
      const { url } = await BillingService.postBillingCheckout({
        requestBody: {
          priceId: plan.priceId,
          successUrl: window.location.href,
          cancelUrl: window.location.href,
        },
      });
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        setActionError('Checkout did not return a URL.');
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not start checkout.');
    } finally {
      setPendingAction(null);
    }
  }

  if (isLoading && !subscription) {
    return <p className="text-sm text-gray-subtext">Loading subscription…</p>;
  }

  if (error && !subscription) {
    return (
      <div className="text-sm text-trend-down">
        Couldn't load billing details: {error}{' '}
        <button onClick={() => refresh()} className="underline">
          Retry
        </button>
      </div>
    );
  }

  if (!subscription) return <></>;

  const isFree = subscription.plan === 'free';
  const isCancelled = subscription.status === 'canceled';
  const isPastDue = subscription.status === 'past_due';

  return (
    <div className="space-y-8 max-w-4xl">
      {(isPastDue || isCancelled) && (
        <div
          role="alert"
          className="rounded-xl border border-trend-down/40 bg-trend-down/10 px-4 py-3 text-sm font-semibold text-trend-down"
        >
          {isPastDue
            ? 'Your last payment failed. Update your payment method to keep your plan active.'
            : 'Your subscription is cancelled. Resubscribe to restore full access.'}
        </div>
      )}

      {/* Current plan card */}
      <div className="rounded-xl border border-dark-border bg-dark-surface p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-gray-subtext">
              Current plan
            </p>
            <p className="text-2xl font-black text-white capitalize">{subscription.plan}</p>
          </div>
          <span
            className={`px-3 py-1 rounded-full text-xs font-bold ${
              subscription.status === 'active'
                ? 'bg-trend-up/20 text-trend-up'
                : subscription.status === 'trialing'
                  ? 'bg-primary-blue/20 text-primary-blue'
                  : 'bg-trend-down/20 text-trend-down'
            }`}
          >
            {STATUS_LABEL[subscription.status] ?? subscription.status}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-gray-subtext text-xs uppercase tracking-wide">Renews</p>
            <p className="text-white font-semibold">{formatDate(subscription.currentPeriodEnd)}</p>
          </div>
          <div>
            <p className="text-gray-subtext text-xs uppercase tracking-wide">Seats</p>
            <p className="text-white font-semibold">{hasActiveOrg ? 'Org-based' : '1'}</p>
          </div>
          <div>
            <p className="text-gray-subtext text-xs uppercase tracking-wide">Cancellation</p>
            <p className="text-white font-semibold">
              {isCancelled ? 'Cancelled' : 'Not scheduled'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 pt-2">
          <button
            onClick={handleManageBilling}
            disabled={pendingAction === 'portal'}
            className="px-5 py-2.5 rounded-xl border border-dark-border text-sm font-bold text-gray-200 hover:text-white hover:border-white/20 transition-all disabled:opacity-50"
          >
            {pendingAction === 'portal' ? 'Opening…' : 'Manage billing'}
          </button>
        </div>
        {actionError && <p className="text-xs text-trend-down">{actionError}</p>}
      </div>

      {isFree && (
        <div className="rounded-xl border border-primary-blue/40 bg-primary-blue/10 p-5">
          <p className="text-sm font-bold text-white">You're on the Free plan</p>
          <p className="text-sm text-gray-subtext mt-1">
            Upgrade for more AI credits, more seats, and priority support.
          </p>
        </div>
      )}

      {/* Plan comparison */}
      <div className="overflow-x-auto rounded-xl border border-dark-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-dark-surface text-left">
              <th className="p-4 text-gray-subtext font-bold uppercase text-xs tracking-wide">
                Plan
              </th>
              <th className="p-4 text-gray-subtext font-bold uppercase text-xs tracking-wide">
                Price
              </th>
              <th className="p-4 text-gray-subtext font-bold uppercase text-xs tracking-wide">
                Credits
              </th>
              <th className="p-4 text-gray-subtext font-bold uppercase text-xs tracking-wide">
                Features
              </th>
              <th className="p-4" />
            </tr>
          </thead>
          <tbody>
            {PLAN_CATALOG.map((plan) => {
              const isCurrent = plan.id === subscription.plan;
              return (
                <tr
                  key={plan.id}
                  className={`border-t border-dark-border ${isCurrent ? 'bg-primary-blue/5' : ''}`}
                >
                  <td className="p-4 font-bold text-white">
                    {plan.name}
                    {isCurrent && (
                      <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary-blue/20 text-primary-blue align-middle">
                        CURRENT
                      </span>
                    )}
                  </td>
                  <td className="p-4 text-gray-subtext">{plan.price}</td>
                  <td className="p-4 text-gray-subtext">{plan.credits}</td>
                  <td className="p-4 text-gray-subtext">
                    <ul className="list-disc list-inside space-y-0.5">
                      {plan.features.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </td>
                  <td className="p-4">
                    {!isCurrent && plan.id !== 'enterprise' && (
                      <button
                        onClick={() => handleUpgrade(plan)}
                        disabled={pendingAction === plan.id}
                        className="px-4 py-2 rounded-lg bg-primary-blue text-white text-xs font-bold hover:bg-primary-blue/80 transition-all disabled:opacity-50"
                      >
                        {pendingAction === plan.id ? 'Redirecting…' : 'Upgrade'}
                      </button>
                    )}
                    {!isCurrent && plan.id === 'enterprise' && (
                      <a
                        href="mailto:sales@socialflow.ai"
                        className="px-4 py-2 rounded-lg border border-dark-border text-xs font-bold text-gray-200 hover:text-white transition-all inline-block"
                      >
                        Contact sales
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Usage */}
      <div>
        <h3 className="text-lg font-bold text-white mb-4">Usage this cycle</h3>
        <UsageMeters />
      </div>
    </div>
  );
}

export default BillingSection;
