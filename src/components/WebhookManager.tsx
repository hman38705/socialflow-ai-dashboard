import React, { useCallback, useEffect, useReducer, useState } from 'react';
import { WebhooksService } from '../api/services/WebhooksService';
import type { WebhookDelivery, WebhookEventType, WebhookSubscription } from '../api/models';

// Event types sourced from src/schemas/webhooks.ts (frontend mirror)
const SUPPORTED_EVENTS: WebhookEventType[] = [
  'post.published',
  'post.failed',
  'analytics.report_ready',
  'blockchain.transaction_completed',
  'blockchain.transaction_failed',
  'system.health_check',
];

// ── State ─────────────────────────────────────────────────────────────────────

interface State {
  webhooks: WebhookSubscription[];
  loading: boolean;
  error: string | null;
  // deliveries keyed by webhook id
  deliveries: Record<string, WebhookDelivery[]>;
  expandedId: string | null;
  // track in-flight replay requests: key is "webhookId:deliveryId"
  replayingDeliveries: Set<string>;
}

type Action =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_OK'; webhooks: WebhookSubscription[] }
  | { type: 'LOAD_ERR'; error: string }
  | { type: 'ADD'; webhook: WebhookSubscription }
  | { type: 'REMOVE'; id: string }
  | { type: 'DELIVERIES_OK'; id: string; deliveries: WebhookDelivery[] }
  | { type: 'TOGGLE_EXPAND'; id: string }
  | { type: 'REPLAY_START'; webhookId: string; deliveryId: string }
  | { type: 'REPLAY_END'; webhookId: string; deliveryId: string };

// ── One-time secret modal ─────────────────────────────────────────────────────

function OneTimeSecretModal({ secret, onClose }: { secret: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="secret-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl space-y-4">
        <div>
          <h3 id="secret-modal-title" className="text-base font-semibold text-gray-900">
            Webhook Signing Secret
          </h3>
          <p className="mt-1 text-sm text-amber-600">
            Copy this secret now — it will not be shown again.
          </p>
        </div>

        <div className="rounded-lg border bg-gray-50 px-4 py-3 font-mono text-sm break-all text-gray-800 select-all">
          {secret}
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleCopy}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
          >
            {copied ? '✓ Copied!' : 'Copy to Clipboard'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            I&apos;ve Saved It
          </button>
        </div>
      </div>
    </div>
  );
}

function generateSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'LOAD_START':  return { ...state, loading: true, error: null };
    case 'LOAD_OK':     return { ...state, loading: false, webhooks: action.webhooks };
    case 'LOAD_ERR':    return { ...state, loading: false, error: action.error };
    case 'ADD':         return { ...state, webhooks: [...state.webhooks, action.webhook] };
    case 'REMOVE':      return { ...state, webhooks: state.webhooks.filter(w => w.id !== action.id) };
    case 'DELIVERIES_OK':
      return { ...state, deliveries: { ...state.deliveries, [action.id]: action.deliveries } };
    case 'TOGGLE_EXPAND':
      return { ...state, expandedId: state.expandedId === action.id ? null : action.id };
    case 'REPLAY_START': {
      const key = `${action.webhookId}:${action.deliveryId}`;
      return { ...state, replayingDeliveries: new Set([...state.replayingDeliveries, key]) };
    }
    case 'REPLAY_END': {
      const key = `${action.webhookId}:${action.deliveryId}`;
      const next = new Set(state.replayingDeliveries);
      next.delete(key);
      return { ...state, replayingDeliveries: next };
    }
    default: return state;
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

const DELIVERY_COLORS: Record<string, string> = {
  success: 'bg-green-100 text-green-700',
  failed:  'bg-red-100  text-red-700',
  pending: 'bg-gray-100 text-gray-600',
};

function DeliveryRow({ d, webhookId, onReplay, isReplaying }: {
  d: WebhookDelivery;
  webhookId: string;
  onReplay: (webhookId: string, deliveryId: string) => void;
  isReplaying: boolean;
}) {
  return (
    <tr className="text-xs border-t">
      <td className="py-1 px-2 font-mono text-gray-500">{d.id?.slice(0, 8)}…</td>
      <td className="py-1 px-2">{d.eventType}</td>
      <td className="py-1 px-2">
        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${DELIVERY_COLORS[d.status ?? 'pending']}`}>
          {d.status}
        </span>
      </td>
      <td className="py-1 px-2 text-gray-500">{d.responseStatus ?? '—'}</td>
      <td className="py-1 px-2 text-gray-400">{d.attempts}</td>
      <td className="py-1 px-2">
        <button
          onClick={() => onReplay(webhookId, d.id!)}
          className="text-blue-600 hover:underline disabled:opacity-40"
          disabled={!d.id || isReplaying}
          aria-label="Replay delivery"
        >
          {isReplaying ? 'Replaying…' : 'Replay'}
        </button>
      </td>
    </tr>
  );
}

function WebhookRow({ webhook, deliveries, expanded, onExpand, onDelete, onTest, onReplay, replayingDeliveries }: {
  webhook: WebhookSubscription;
  deliveries: WebhookDelivery[];
  expanded: boolean;
  onExpand: () => void;
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
  onReplay: (webhookId: string, deliveryId: string) => void;
  replayingDeliveries: Set<string>;
}) {
  const last = deliveries[0];

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-white">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate">{webhook.url}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {webhook.events?.join(', ')}
          </p>
        </div>

        <div className="flex items-center gap-3 ml-4 shrink-0">
          {/* last delivery badge */}
          {last ? (
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${DELIVERY_COLORS[last.status ?? 'pending']}`}>
              {last.status} {last.responseStatus ? `(${last.responseStatus})` : ''}
            </span>
          ) : (
            <span className="text-xs text-gray-400">no deliveries</span>
          )}

          <span className={`w-2 h-2 rounded-full ${webhook.isActive ? 'bg-green-400' : 'bg-gray-300'}`}
                title={webhook.isActive ? 'Active' : 'Inactive'} />

          <button onClick={() => onTest(webhook.id!)}
                  className="text-xs text-blue-600 hover:underline"
                  aria-label="Send test event">
            Test
          </button>
          <button onClick={onExpand}
                  className="text-xs text-gray-500 hover:text-gray-800"
                  aria-expanded={expanded}
                  aria-label="Toggle delivery log">
            {expanded ? '▲ Hide' : '▼ Logs'}
          </button>
          <button onClick={() => onDelete(webhook.id!)}
                  className="text-xs text-red-500 hover:text-red-700"
                  aria-label="Delete webhook">
            Delete
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t bg-gray-50 px-4 py-2 overflow-x-auto">
          {deliveries.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">No delivery records.</p>
          ) : (
            <table className="w-full text-left" aria-label="Delivery log">
              <thead>
                <tr className="text-xs text-gray-500">
                  <th className="py-1 px-2">ID</th>
                  <th className="py-1 px-2">Event</th>
                  <th className="py-1 px-2">Status</th>
                  <th className="py-1 px-2">HTTP</th>
                  <th className="py-1 px-2">Attempts</th>
                  <th className="py-1 px-2" />
                </tr>
              </thead>
              <tbody>
                {deliveries.map(d => (
                  <DeliveryRow 
                    key={d.id} 
                    d={d} 
                    webhookId={webhook.id!} 
                    onReplay={onReplay}
                    isReplaying={replayingDeliveries.has(`${webhook.id}:${d.id}`)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ── Create form ───────────────────────────────────────────────────────────────

interface CreateFormProps {
  onCreated: (w: WebhookSubscription, secret: string) => void;
}

function CreateForm({ onCreated }: CreateFormProps) {
  const [url, setUrl]     = useState('');
  const [events, setEvents] = useState<WebhookEventType[]>([]);
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState<string | null>(null);

  function toggleEvent(e: WebhookEventType) {
    setEvents(prev => prev.includes(e) ? prev.filter(x => x !== e) : [...prev, e]);
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!url || events.length === 0) {
      setErr('URL and at least one event are required.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      // Generate a secure random secret — shown once to the user after creation
      const secret = generateSecret();
      const created = await WebhooksService.createWebhook({ url, secret, events });
      onCreated(created, secret);
      setUrl(''); setEvents([]);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to create webhook.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border rounded-lg p-4 bg-white space-y-3" aria-label="Create webhook">
      <h3 className="text-sm font-semibold text-gray-700">New Webhook</h3>

      <div className="space-y-1">
        <label className="text-xs text-gray-600" htmlFor="wh-url">Endpoint URL (HTTPS)</label>
        <input id="wh-url" type="url" value={url} onChange={e => setUrl(e.target.value)}
               placeholder="https://example.com/webhook"
               className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
               required />
      </div>

      <fieldset>
        <legend className="text-xs text-gray-600 mb-1">Events</legend>
        <div className="grid grid-cols-2 gap-1">
          {SUPPORTED_EVENTS.map(ev => (
            <label key={ev} className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input type="checkbox" checked={events.includes(ev)} onChange={() => toggleEvent(ev)}
                     className="rounded" />
              {ev}
            </label>
          ))}
        </div>
      </fieldset>

      {err && <p className="text-xs text-red-600" role="alert">{err}</p>}

      <button type="submit" disabled={busy}
              className="w-full bg-blue-600 text-white text-sm rounded py-1.5 hover:bg-blue-700 disabled:opacity-50">
        {busy ? 'Creating…' : 'Create Webhook'}
      </button>
    </form>
  );
}

// ── Test event modal ──────────────────────────────────────────────────────────

function TestModal({ webhookId, onClose }: { webhookId: string; onClose: () => void }) {
  const [eventType, setEventType] = useState<WebhookEventType>(SUPPORTED_EVENTS[0]);
  const [result, setResult]       = useState<string | null>(null);
  const [busy, setBusy]           = useState(false);

  async function send() {
    setBusy(true);
    setResult(null);
    try {
      const res = await WebhooksService.testWebhook(webhookId, { eventType });
      setResult(res.message ?? 'Test event sent.');
    } catch (e: any) {
      setResult(`Error: ${e?.message ?? 'unknown'}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" role="dialog" aria-modal="true" aria-label="Send test event">
      <div className="bg-white rounded-lg shadow-xl p-6 w-80 space-y-4">
        <h3 className="font-semibold text-gray-800">Send Test Event</h3>

        <label className="block text-xs text-gray-600">
          Event type
          <select value={eventType} onChange={e => setEventType(e.target.value as WebhookEventType)}
                  className="mt-1 w-full border rounded px-2 py-1.5 text-sm">
            {SUPPORTED_EVENTS.map(ev => <option key={ev} value={ev}>{ev}</option>)}
          </select>
        </label>

        {result && <p className="text-xs text-gray-700 bg-gray-50 rounded p-2">{result}</p>}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
          <button onClick={send} disabled={busy}
                  className="bg-blue-600 text-white text-sm rounded px-4 py-1.5 hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function WebhookManager() {
  const [state, dispatch] = useReducer(reducer, {
    webhooks: [], loading: false, error: null, deliveries: {}, expandedId: null, replayingDeliveries: new Set(),
  });
  const [testingId, setTestingId]       = useState<string | null>(null);
  const [pendingSecret, setPendingSecret] = useState<string | null>(null);

  const load = useCallback(async () => {
    dispatch({ type: 'LOAD_START' });
    try {
      const webhooks = await WebhooksService.listWebhooks();
      dispatch({ type: 'LOAD_OK', webhooks });
    } catch (e: any) {
      dispatch({ type: 'LOAD_ERR', error: e?.message ?? 'Failed to load webhooks.' });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleExpand(id: string) {
    dispatch({ type: 'TOGGLE_EXPAND', id });
    if (state.expandedId !== id && !state.deliveries[id]) {
      try {
        const deliveries = await WebhooksService.listDeliveries(id);
        dispatch({ type: 'DELIVERIES_OK', id, deliveries });
      } catch {
        dispatch({ type: 'DELIVERIES_OK', id, deliveries: [] });
      }
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this webhook?')) return;
    try {
      await WebhooksService.deleteWebhook(id);
      dispatch({ type: 'REMOVE', id });
    } catch (e: any) {
      alert(e?.message ?? 'Delete failed.');
    }
  }

  async function handleReplay(webhookId: string, deliveryId: string) {
    dispatch({ type: 'REPLAY_START', webhookId, deliveryId });
    try {
      await WebhooksService.replayDelivery(webhookId, deliveryId);
      // Refresh deliveries for this webhook
      const deliveries = await WebhooksService.listDeliveries(webhookId);
      dispatch({ type: 'DELIVERIES_OK', id: webhookId, deliveries });
    } catch (e: any) {
      alert(e?.message ?? 'Replay failed.');
    } finally {
      dispatch({ type: 'REPLAY_END', webhookId, deliveryId });
    }
  }

  return (
    <section className="space-y-6" aria-label="Webhook Manager">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">Webhooks</h2>
        <button onClick={load} className="text-xs text-blue-600 hover:underline" aria-label="Refresh webhooks">
          Refresh
        </button>
      </div>

      <CreateForm onCreated={(w, secret) => { dispatch({ type: 'ADD', webhook: w }); setPendingSecret(secret); }} />

      {state.loading && <p className="text-sm text-gray-500">Loading…</p>}
      {state.error   && <p className="text-sm text-red-600" role="alert">{state.error}</p>}

      {!state.loading && state.webhooks.length === 0 && !state.error && (
        <p className="text-sm text-gray-400">No webhooks registered yet.</p>
      )}

      <div className="space-y-3">
        {state.webhooks.map(w => (
          <WebhookRow
            key={w.id}
            webhook={w}
            deliveries={state.deliveries[w.id!] ?? []}
            expanded={state.expandedId === w.id}
            onExpand={() => handleExpand(w.id!)}
            onDelete={handleDelete}
            onTest={id => setTestingId(id)}
            onReplay={handleReplay}
            replayingDeliveries={state.replayingDeliveries}
          />
        ))}
      </div>

      {testingId && (
        <TestModal webhookId={testingId} onClose={() => setTestingId(null)} />
      )}

      {pendingSecret && (
        <OneTimeSecretModal secret={pendingSecret} onClose={() => setPendingSecret(null)} />
      )}
    </section>
  );
}
