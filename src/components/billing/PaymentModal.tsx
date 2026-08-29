import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, X } from 'lucide-react';
import { BillingService } from '../../api/services/BillingService';
import { ApiError } from '../../api/core/ApiError';

export interface BillingPlan {
  id: string;
  name: string;
  /** Price in the plan's currency, per month, when billed monthly. */
  priceMonthly: number;
  /** Price in the plan's currency, per month, when billed annually. */
  priceAnnual: number;
  currency?: string;
}

export interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  plan: BillingPlan;
  /** True when the user already has a paid subscription — routes to the billing portal instead of checkout. */
  isExistingSubscriber?: boolean;
  successUrl?: string;
  cancelUrl?: string;
}

type CheckoutReturnState = 'success' | 'cancelled' | 'pending' | null;

function formatPrice(amount: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
  }).format(amount);
}

function ReturnState({
  state,
  onClose,
}: {
  state: Exclude<CheckoutReturnState, null>;
  onClose: () => void;
}) {
  const copy = {
    success: {
      icon: <CheckCircle2 size={28} className="text-trend-up" />,
      title: 'Payment successful',
      body: 'Your plan is now active. It may take a few seconds to reflect everywhere.',
    },
    cancelled: {
      icon: <AlertTriangle size={28} className="text-primary-rose" />,
      title: 'Checkout cancelled',
      body: 'No changes were made. You can try again whenever you’re ready.',
    },
    pending: {
      icon: <Clock size={28} className="text-primary-teal" />,
      title: 'Payment received, finishing up',
      body: 'We’re waiting on confirmation from the payment provider. This updates automatically once it arrives.',
    },
  }[state];

  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      {copy.icon}
      <h3 className="text-base font-semibold text-white">{copy.title}</h3>
      <p className="max-w-sm text-sm text-gray-subtext">{copy.body}</p>
      <button
        type="button"
        onClick={onClose}
        className="mt-2 rounded-md bg-primary-blue px-4 py-2 text-sm font-medium text-white"
      >
        Done
      </button>
    </div>
  );
}

/**
 * Plan purchase / upgrade modal. Never renders a card field — payment
 * details are always collected on Stripe's hosted checkout, not in this app.
 */
export function PaymentModal({
  isOpen,
  onClose,
  plan,
  isExistingSubscriber = false,
  successUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/settings/billing?checkout=success`,
  cancelUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/settings/billing?checkout=cancelled`,
}: PaymentModalProps) {
  const [searchParams] = useSearchParams();
  const [interval, setInterval] = useState<'monthly' | 'annual'>('monthly');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const returnState = useMemo<CheckoutReturnState>(() => {
    const value = searchParams.get('checkout');
    return value === 'success' || value === 'cancelled' || value === 'pending' ? value : null;
  }, [searchParams]);

  const annualSavingsPct = useMemo(() => {
    if (!plan.priceMonthly) return 0;
    const savings = 1 - plan.priceAnnual / plan.priceMonthly;
    return Math.round(savings * 100);
  }, [plan.priceMonthly, plan.priceAnnual]);

  if (!isOpen) return null;

  const priceForInterval = interval === 'monthly' ? plan.priceMonthly : plan.priceAnnual;

  const handleUpgrade = async () => {
    setLoading(true);
    setError(null);
    try {
      if (isExistingSubscriber) {
        const { url } = await BillingService.postBillingPortal({
          requestBody: { returnUrl: successUrl },
        });
        if (!url) throw new Error('No portal URL returned');
        window.location.assign(url);
        return;
      }
      const { url } = await BillingService.postBillingCheckout({
        requestBody: {
          priceId: `${plan.id}_${interval}`,
          successUrl,
          cancelUrl,
        },
      });
      if (!url) throw new Error('No checkout URL returned');
      window.location.assign(url);
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr?.message || 'Something went wrong starting checkout. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-dark-border bg-dark-elev p-5 shadow-elev-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">
            {isExistingSubscriber ? 'Update plan' : 'Upgrade plan'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-gray-subtext hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {returnState ? (
          <ReturnState state={returnState} onClose={onClose} />
        ) : (
          <>
            <div className="mt-4 rounded-xl border border-dark-border bg-dark-surface p-4">
              <p className="text-sm text-gray-subtext">Plan</p>
              <p className="text-lg font-semibold text-white">{plan.name}</p>
              <p className="mt-1 text-2xl font-bold text-white">
                {formatPrice(priceForInterval, plan.currency)}
                <span className="text-sm font-normal text-gray-subtext"> /mo</span>
              </p>
            </div>

            <div className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-dark-border p-1">
              <button
                type="button"
                onClick={() => setInterval('monthly')}
                className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
                  interval === 'monthly' ? 'bg-primary-blue text-white' : 'text-gray-subtext'
                }`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setInterval('annual')}
                className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
                  interval === 'annual' ? 'bg-primary-blue text-white' : 'text-gray-subtext'
                }`}
              >
                Annual
                {annualSavingsPct > 0 && (
                  <span className="ml-1 text-xs font-normal text-trend-up">
                    save {annualSavingsPct}%
                  </span>
                )}
              </button>
            </div>

            {isExistingSubscriber && (
              <p className="mt-3 text-xs text-gray-subtext">
                You’ll be redirected to the billing portal to change your plan, update payment
                details, or cancel.
              </p>
            )}

            {error && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-primary-rose/40 bg-primary-rose/10 px-3 py-2 text-sm text-primary-rose">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="button"
              onClick={handleUpgrade}
              disabled={loading}
              className="mt-4 w-full rounded-lg bg-primary-blue py-2.5 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading
                ? 'Redirecting…'
                : error
                  ? 'Retry'
                  : isExistingSubscriber
                    ? 'Manage plan'
                    : `Continue to checkout`}
            </button>

            <p className="mt-2 text-center text-xs text-gray-subtext">
              Payment details are entered on our payment provider’s secure page — never here.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default PaymentModal;
