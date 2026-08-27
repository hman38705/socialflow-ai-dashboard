import React from 'react';
import { useCredits, type CreditMeter } from '../../hooks/useCredits';

function formatResetDate(iso: string | null): string {
  if (!iso) return 'No scheduled reset';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'No scheduled reset';
  return `Resets ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function Meter({ meter }: { meter: CreditMeter }): React.JSX.Element {
  const unlimited = meter.included === null;
  const pct =
    unlimited || !meter.included
      ? unlimited
        ? 0
        : 100
      : Math.min(100, Math.round((meter.used / meter.included) * 100));
  const isBlocked = !unlimited && pct >= 100;
  const isWarning = !unlimited && pct >= 80 && pct < 100;

  const barColor = isBlocked ? 'bg-trend-down' : isWarning ? 'bg-amber-400' : 'bg-primary-blue';

  return (
    <div className="rounded-xl border border-dark-border bg-dark-surface p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-white">{meter.label}</span>
        <span className="text-xs text-gray-subtext">{formatResetDate(meter.resetsAt)}</span>
      </div>

      {unlimited ? (
        <p className="text-2xl font-black text-primary-teal">&#8734;</p>
      ) : (
        <>
          <div
            role="meter"
            aria-valuenow={meter.used}
            aria-valuemin={0}
            aria-valuemax={meter.included ?? 0}
            aria-label={meter.label}
            className="h-2.5 w-full rounded-full bg-dark-bg overflow-hidden"
          >
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-gray-subtext">
            <span>
              {meter.used.toLocaleString()} / {meter.included?.toLocaleString()} used
            </span>
            <span>{pct}%</span>
          </div>
        </>
      )}

      {isWarning && (
        <p className="text-xs font-semibold text-amber-400">
          You've used {pct}% of this cycle's credits — consider upgrading before you run out.
        </p>
      )}
      {isBlocked && (
        <p className="text-xs font-semibold text-trend-down">
          Out of credits: {meter.blockedActions.join(', ')}{' '}
          {meter.blockedActions.length > 1 ? 'are' : 'is'} unavailable until your credits reset or
          you upgrade.
        </p>
      )}
    </div>
  );
}

export function UsageMeters(): React.JSX.Element {
  const { meters, isLoading, error, refresh } = useCredits();

  if (isLoading && meters.length === 0) {
    return <p className="text-sm text-gray-subtext">Loading usage…</p>;
  }

  if (error) {
    return (
      <div className="text-sm text-trend-down">
        Couldn't load usage data: {error}{' '}
        <button onClick={() => refresh()} className="underline">
          Retry
        </button>
      </div>
    );
  }

  if (meters.length === 0) {
    return <p className="text-sm text-gray-subtext">No usage yet this cycle.</p>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {meters.map((meter) => (
        <Meter key={meter.key} meter={meter} />
      ))}
    </div>
  );
}

export default UsageMeters;
