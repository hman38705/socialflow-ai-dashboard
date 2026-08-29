import React, { useEffect, useMemo, useState } from 'react';
import { WebhooksService } from '../../api/services/WebhooksService';
import type { WebhookDelivery, WebhookEventType } from '../../api/models';

// The generated `WebhookDelivery` model (src/api/models.ts) only carries the
// summary fields the backend currently returns. Request/response detail and
// duration are optional here so the UI degrades gracefully — rendering "—"
// or a raw fallback — instead of crashing when a delivery lacks them.
export interface DeliveryDetail extends WebhookDelivery {
  durationMs?: number;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  responseBody?: unknown;
}

const SENSITIVE_HEADER_PATTERN = /signature|authorization/i;
const MASK = '••••••••';
const PAGE_SIZE = 10;

function maskHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  if (!headers) return {};
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    masked[key] = SENSITIVE_HEADER_PATTERN.test(key) ? MASK : value;
  }
  return masked;
}

// Renders any body value as pretty-printed JSON. Falls back to the raw
// string (or String(value)) instead of throwing when the payload isn't
// valid JSON.
function prettyPrint(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API unavailable (e.g. insecure context) — nothing else to do.
  }
}

type StatusFilter = 'all' | 'pending' | 'success' | 'failed';

interface DeliveryHistoryProps {
  webhookId: string;
}

const DeliveryHistory: React.FC<DeliveryHistoryProps> = ({ webhookId }) => {
  const [deliveries, setDeliveries] = useState<DeliveryDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [eventFilter, setEventFilter] = useState<WebhookEventType | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    WebhooksService.listDeliveries(webhookId)
      .then(result => {
        if (!cancelled) setDeliveries((result ?? []) as DeliveryDetail[]);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load delivery history.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [webhookId]);

  const eventTypes = useMemo(
    () => Array.from(new Set(deliveries.map(d => d.eventType).filter(Boolean))) as WebhookEventType[],
    [deliveries]
  );

  const filtered = useMemo(() => {
    return deliveries.filter(d => {
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (eventFilter !== 'all' && d.eventType !== eventFilter) return false;
      return true;
    });
  }, [deliveries, statusFilter, eventFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [statusFilter, eventFilter, webhookId]);

  if (loading) return <p className="text-sm text-gray-500 py-2">Loading delivery history…</p>;
  if (error) return <p className="text-sm text-red-600 py-2">{error}</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as StatusFilter)}
          className="text-sm border border-gray-300 rounded-md px-2 py-1"
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
        </select>
        <select
          value={eventFilter}
          onChange={e => setEventFilter(e.target.value as WebhookEventType | 'all')}
          className="text-sm border border-gray-300 rounded-md px-2 py-1"
          aria-label="Filter by event type"
        >
          <option value="all">All events</option>
          {eventTypes.map(evt => (
            <option key={evt} value={evt}>
              {evt}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-500 py-2">No deliveries match the current filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-1 pr-4">Timestamp</th>
                <th className="py-1 pr-4">Event</th>
                <th className="py-1 pr-4">Status</th>
                <th className="py-1 pr-4">Response</th>
                <th className="py-1 pr-4">Duration</th>
                <th className="py-1 pr-4">Attempt</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {pageItems.map(delivery => {
                const id = delivery.id ?? `${delivery.eventType}-${delivery.createdAt}`;
                const isExpanded = expandedId === id;
                return (
                  <React.Fragment key={id}>
                    <tr className="border-b border-gray-100">
                      <td className="py-1.5 pr-4 whitespace-nowrap">
                        {delivery.createdAt ? new Date(delivery.createdAt).toLocaleString() : '—'}
                      </td>
                      <td className="py-1.5 pr-4">{delivery.eventType ?? '—'}</td>
                      <td className="py-1.5 pr-4">
                        <span
                          className={
                            delivery.status === 'success'
                              ? 'text-green-700'
                              : delivery.status === 'failed'
                              ? 'text-red-700'
                              : 'text-yellow-700'
                          }
                        >
                          {delivery.status ?? '—'}
                        </span>
                      </td>
                      <td className="py-1.5 pr-4">{delivery.responseStatus ?? '—'}</td>
                      <td className="py-1.5 pr-4">
                        {typeof delivery.durationMs === 'number' ? `${delivery.durationMs}ms` : '—'}
                      </td>
                      <td className="py-1.5 pr-4">{delivery.attempts ?? '—'}</td>
                      <td className="py-1.5">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : id)}
                          className="text-blue-600 hover:underline text-xs"
                        >
                          {isExpanded ? 'Hide' : 'Details'}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <td colSpan={7} className="py-3 px-2">
                          <DeliveryDetailPanel delivery={delivery} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-2 py-1 border border-gray-300 rounded-md disabled:opacity-50"
          >
            Prev
          </button>
          <span>
            Page {page + 1} of {pageCount}
          </span>
          <button
            onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1}
            className="px-2 py-1 border border-gray-300 rounded-md disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};

const DeliveryDetailPanel: React.FC<{ delivery: DeliveryDetail }> = ({ delivery }) => {
  const maskedHeaders = maskHeaders(delivery.requestHeaders);
  const hasHeaders = Object.keys(maskedHeaders).length > 0;
  const requestBodyText = prettyPrint(delivery.requestBody);
  const responseBodyText = prettyPrint(delivery.responseBody ?? delivery.errorMessage);

  return (
    <div className="space-y-3">
      <DetailBlock title="Request headers" text={hasHeaders ? JSON.stringify(maskedHeaders, null, 2) : '—'} />
      <DetailBlock title="Request body" text={requestBodyText} />
      <DetailBlock title="Response" text={responseBodyText} />
    </div>
  );
};

const DetailBlock: React.FC<{ title: string; text: string }> = ({ title, text }) => (
  <div>
    <div className="flex items-center justify-between mb-1">
      <span className="text-xs font-semibold text-gray-600">{title}</span>
      <button onClick={() => copyToClipboard(text)} className="text-xs text-blue-600 hover:underline">
        Copy
      </button>
    </div>
    <pre className="bg-white border border-gray-200 rounded-md p-2 text-xs overflow-x-auto whitespace-pre-wrap">
      {text}
    </pre>
  </div>
);

export default DeliveryHistory;
