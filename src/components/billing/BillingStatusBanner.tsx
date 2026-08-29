import React from 'react';
import { useCredits } from '../../hooks/useCredits';

/**
 * App-wide, non-dismissible banner for past-due / cancelled subscriptions.
 * Mounted once in App.tsx above the router so it's visible from any route.
 */
export function BillingStatusBanner(): React.JSX.Element | null {
  const { subscription } = useCredits();

  if (!subscription || (subscription.status !== 'past_due' && subscription.status !== 'canceled')) {
    return null;
  }

  const isPastDue = subscription.status === 'past_due';

  return (
    <div
      role="alert"
      className={`w-full px-4 py-2.5 text-center text-sm font-semibold text-white ${
        isPastDue ? 'bg-trend-down' : 'bg-gray-700'
      }`}
    >
      {isPastDue
        ? 'Your last payment failed. Update your billing details to avoid losing access.'
        : 'Your subscription has been cancelled. Some features may be limited.'}{' '}
      <a href="/settings/billing" className="underline underline-offset-2">
        Manage billing
      </a>
    </div>
  );
}

export default BillingStatusBanner;
