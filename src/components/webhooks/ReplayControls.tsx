import React, { useState } from 'react';
import { RotateCw, Send, X, AlertTriangle } from 'lucide-react';
import { WebhooksService } from '../../api/services/WebhooksService';
import { ApiError } from '../../api/core/ApiError';
import type { WebhookDelivery } from '../../api/models/WebhookDelivery';

/** Minimum gap, in ms, enforced client-side between replay clicks for the same delivery. */
const REPLAY_RATE_LIMIT_MS = 5000;

const DEFAULT_EVENT_TYPES = [
  'post.published',
  'post.failed',
  'account.connected',
  'account.disconnected',
  'billing.subscription_updated',
];

type ActionResult = {
  statusCode?: number;
  latencyMs?: number;
  excerpt?: string;
  error?: string;
};

function excerptOf(body: unknown): string {
  if (body == null) return '';
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

function ResultPanel({ result }: { result: ActionResult }) {
  const ok = typeof result.statusCode === 'number' && result.statusCode < 400;
  return (
    <div
      className={`mt-2 rounded-lg border px-3 py-2 text-xs ${
        result.error
          ? 'border-primary-rose/40 bg-primary-rose/10 text-primary-rose'
          : ok
            ? 'border-trend-up/30 bg-trend-up/10 text-trend-up'
            : 'border-primary-rose/30 bg-primary-rose/10 text-primary-rose'
      }`}
    >
      {result.error ? (
        <div className="flex items-center gap-1.5">
          <AlertTriangle size={14} />
          <span>{result.error}</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-mono font-semibold">{result.statusCode}</span>
          {typeof result.latencyMs === 'number' && (
            <span className="text-gray-subtext">{result.latencyMs}ms</span>
          )}
          {result.excerpt && (
            <span className="w-full break-all font-mono text-gray-subtext">{result.excerpt}</span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Inline controls for replaying a past webhook delivery, and for sending a
 * synthetic test event to a subscription. Both actions render their result
 * (status code, latency, response excerpt) inline, right where they were
 * triggered.
 */
export function ReplayControls({
  subscriptionId,
  deliveries,
  eventTypes = DEFAULT_EVENT_TYPES,
}: {
  subscriptionId: string;
  deliveries: WebhookDelivery[];
  eventTypes?: string[];
}) {
  const [pendingReplayId, setPendingReplayId] = useState<string | null>(null);
  const [inFlightReplayId, setInFlightReplayId] = useState<string | null>(null);
  const [lastReplayAt, setLastReplayAt] = useState<Record<string, number>>({});
  const [replayResults, setReplayResults] = useState<Record<string, ActionResult>>({});

  const [selectedEventType, setSelectedEventType] = useState(eventTypes[0] ?? '');
  const [testInFlight, setTestInFlight] = useState(false);
  const [testResult, setTestResult] = useState<ActionResult | null>(null);

  const isRateLimited = (deliveryId: string) => {
    const last = lastReplayAt[deliveryId];
    return typeof last === 'number' && Date.now() - last < REPLAY_RATE_LIMIT_MS;
  };

  const runReplay = async (deliveryId: string) => {
    if (inFlightReplayId || isRateLimited(deliveryId)) return;
    setPendingReplayId(null);
    setInFlightReplayId(deliveryId);
    setLastReplayAt((prev) => ({ ...prev, [deliveryId]: Date.now() }));
    const startedAt = Date.now();
    try {
      const response: any = await WebhooksService.postWebhooksDeliveriesReplay({
        id: subscriptionId,
        deliveryId,
      });
      setReplayResults((prev) => ({
        ...prev,
        [deliveryId]: {
          statusCode: response?.statusCode ?? response?.status ?? 200,
          latencyMs: response?.latencyMs ?? Date.now() - startedAt,
          excerpt: excerptOf(response?.body ?? response),
        },
      }));
    } catch (err) {
      const apiErr = err as ApiError;
      setReplayResults((prev) => ({
        ...prev,
        [deliveryId]: {
          statusCode: apiErr?.status,
          latencyMs: Date.now() - startedAt,
          error: apiErr?.message ?? 'Replay failed',
        },
      }));
    } finally {
      setInFlightReplayId(null);
    }
  };

  const sendTest = async () => {
    if (testInFlight || !selectedEventType) return;
    setTestInFlight(true);
    setTestResult(null);
    const startedAt = Date.now();
    try {
      const response: any = await WebhooksService.postWebhooksTest({
        id: subscriptionId,
        requestBody: { eventType: selectedEventType },
      });
      setTestResult({
        statusCode: response?.statusCode ?? response?.status ?? 200,
        latencyMs: response?.latencyMs ?? Date.now() - startedAt,
        excerpt: excerptOf(response?.body ?? response),
      });
    } catch (err) {
      const apiErr = err as ApiError;
      setTestResult({
        statusCode: apiErr?.status,
        latencyMs: Date.now() - startedAt,
        error: apiErr?.message ?? 'Test send failed',
      });
    } finally {
      setTestInFlight(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Send test event */}
      <div className="rounded-xl border border-dark-border bg-dark-surface p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-white">Send test event</span>
          <select
            value={selectedEventType}
            onChange={(e) => setSelectedEventType(e.target.value)}
            disabled={testInFlight}
            className="rounded-md border border-dark-border bg-dark-elev px-2 py-1 text-sm text-white disabled:opacity-50"
          >
            {eventTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={sendTest}
            disabled={testInFlight || !selectedEventType}
            className="flex items-center gap-1.5 rounded-md bg-primary-blue px-3 py-1.5 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send size={14} className={testInFlight ? 'animate-pulse' : ''} />
            {testInFlight ? 'Sending…' : 'Send test event'}
          </button>
        </div>
        {testResult && <ResultPanel result={testResult} />}
      </div>

      {/* Per-delivery replay */}
      <ul className="space-y-2">
        {deliveries.map((delivery) => {
          const id = delivery.id as string;
          const rateLimited = isRateLimited(id);
          const disabled =
            inFlightReplayId === id ||
            rateLimited ||
            (!!inFlightReplayId && inFlightReplayId !== id);
          return (
            <li key={id} className="rounded-xl border border-dark-border bg-dark-surface p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-white">
                  <span className="font-mono">{delivery.eventType}</span>{' '}
                  <span className="text-gray-subtext">· {delivery.status}</span>
                </div>

                {pendingReplayId === id ? (
                  <div className="flex items-center gap-2 text-xs text-gray-subtext">
                    <span>The receiver will get a duplicate event. Replay anyway?</span>
                    <button
                      type="button"
                      onClick={() => runReplay(id)}
                      className="rounded-md bg-primary-rose px-2 py-1 font-medium text-white"
                    >
                      Confirm replay
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingReplayId(null)}
                      className="flex items-center gap-1 rounded-md border border-dark-border px-2 py-1 text-gray-subtext"
                    >
                      <X size={12} /> Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPendingReplayId(id)}
                    disabled={disabled}
                    title={rateLimited ? 'Please wait before replaying again' : undefined}
                    className="flex items-center gap-1.5 rounded-md border border-dark-border px-3 py-1.5 text-sm text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RotateCw size={14} className={inFlightReplayId === id ? 'animate-spin' : ''} />
                    {inFlightReplayId === id ? 'Replaying…' : 'Replay'}
                  </button>
                )}
              </div>
              {replayResults[id] && <ResultPanel result={replayResults[id]} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default ReplayControls;
