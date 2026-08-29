import { useEffect, useMemo, useState } from 'react';
import { AnalyticsService } from '../../api/services/AnalyticsService';

const STORAGE_KEY = 'socialflow.scheduler.best-time-overlay';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Slot = {
  day: number;
  hour: number;
  value: number;
};

type BestTimeOverlayProps = {
  className?: string;
  storageKey?: string;
};

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const dayNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6)
    return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.slice(0, 3).toLowerCase();
  const index = DAYS.findIndex((day) => day.toLowerCase() === normalized);
  return index >= 0 ? index : undefined;
};

function readHistoryWeeks(payload: any): number {
  const explicit = [payload?.historyWeeks, payload?.weeksOfHistory, payload?.metadata?.historyWeeks]
    .map(asNumber)
    .find((value): value is number => value !== undefined);
  if (explicit !== undefined) return explicit;

  const dates = (payload?.timeSeries ?? payload?.history ?? [])
    .map((item: any) => item?.date ?? item?.day)
    .filter((value: unknown): value is string => typeof value === 'string')
    .map((value: string) => value.slice(0, 10));
  return new Set(dates).size >= 28 ? 4 : 0;
}

function readSlots(payload: any): Slot[] {
  const source =
    payload?.engagementByDayAndHour ?? payload?.bestTimeSlots ?? payload?.engagementBySlot;
  if (Array.isArray(source)) {
    return source.flatMap((item: any) => {
      const day = dayNumber(item?.day ?? item?.dayOfWeek ?? item?.weekday);
      const hour = asNumber(item?.hour);
      const value = asNumber(item?.engagement ?? item?.value ?? item?.score);
      return day !== undefined &&
        hour !== undefined &&
        hour >= 0 &&
        hour <= 23 &&
        value !== undefined
        ? [{ day, hour, value }]
        : [];
    });
  }

  if (Array.isArray(payload?.engagementByHour)) {
    return payload.engagementByHour.flatMap((item: any) => {
      const hour = asNumber(item?.hour);
      const value = asNumber(item?.engagement ?? item?.value ?? item?.score);
      return hour !== undefined && hour >= 0 && hour <= 23 && value !== undefined
        ? DAYS.map((_, day) => ({ day, hour, value }))
        : [];
    });
  }
  return [];
}

function intensity(value: number, minimum: number, maximum: number): number {
  if (maximum === minimum) return value > 0 ? 0.75 : 0;
  return 0.15 + ((value - minimum) / (maximum - minimum)) * 0.75;
}

export function BestTimeOverlay({ className, storageKey = STORAGE_KEY }: BestTimeOverlayProps) {
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(storageKey) === 'true';
  });
  const [payload, setPayload] = useState<any>();
  const [error, setError] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(storageKey, String(enabled));
  }, [enabled, storageKey]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setError(false);
    AnalyticsService.getAnalytics({ from: Date.now() - 28 * 24 * 60 * 60 * 1000, to: Date.now() })
      .then((result) => active && setPayload(result?.data ?? result))
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, [enabled]);

  const slots = useMemo(() => readSlots(payload), [payload]);
  const values = slots.map((slot) => slot.value);
  const minimum = values.length ? Math.min(...values) : 0;
  const maximum = values.length ? Math.max(...values) : 0;
  const bySlot = new Map(slots.map((slot) => [`${slot.day}-${slot.hour}`, slot.value]));
  const insufficientHistory = !payload || readHistoryWeeks(payload) < 4;

  return (
    <section className={className} aria-label="Best time to post recommendations">
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        Show best times to post
      </label>
      {enabled && (
        <div role="region" aria-label="Best time heatmap">
          {error ? (
            <p>Recommendations are unavailable right now.</p>
          ) : insufficientHistory ? (
            <p>Best-time recommendations need at least 4 weeks of posting history.</p>
          ) : (
            <>
              <div
                role="grid"
                aria-label="Engagement by day and hour"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '3rem repeat(7, minmax(2rem, 1fr))',
                }}
              >
                <span aria-hidden="true" />
                {DAYS.map((day) => (
                  <span key={day} role="columnheader">
                    {day}
                  </span>
                ))}
                {Array.from({ length: 24 }, (_, hour) => (
                  <div key={`row-${hour}`} style={{ display: 'contents' }}>
                    <span key={`hour-${hour}`} role="rowheader">
                      {String(hour).padStart(2, '0')}:00
                    </span>
                    {DAYS.map((_, day) => {
                      const value = bySlot.get(`${day}-${hour}`) ?? 0;
                      const level =
                        value === 0
                          ? 'No data'
                          : value >= minimum + (maximum - minimum) * 0.66
                            ? 'High'
                            : value >= minimum + (maximum - minimum) * 0.33
                              ? 'Moderate'
                              : 'Low';
                      return (
                        <span
                          key={`${day}-${hour}`}
                          role="gridcell"
                          aria-label={`${DAYS[day]} ${hour}:00: ${level}`}
                          style={{
                            backgroundColor: value
                              ? `rgba(20, 110, 90, ${intensity(value, minimum, maximum)})`
                              : 'transparent',
                            minHeight: '1.25rem',
                            border: '1px solid #d9e2df',
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
              <div aria-label="Heatmap legend">
                <span>Legend:</span> <span>Low (light)</span> <span>Moderate (medium)</span>{' '}
                <span>High (dark)</span>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export default BestTimeOverlay;
