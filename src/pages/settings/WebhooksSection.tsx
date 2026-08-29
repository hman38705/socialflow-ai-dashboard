import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, ChevronLeft, Copy, Webhook } from 'lucide-react';
import { WebhooksService } from '../../api/services/WebhooksService';
import type { WebhookSubscription } from '../../api/models/WebhookSubscription';
import type { WebhookDelivery } from '../../api/models/WebhookDelivery';
import { ReplayControls } from '../../components/webhooks/ReplayControls';
import { useDeliveryStream } from '../../components/webhooks/useDeliveryStream';

const SIGNATURE_SNIPPET = `import crypto from 'crypto';

function verifySignature(rawBody: string, signatureHeader: string, secret: string) {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}`;

const PAYLOAD_SHAPES: Record<string, string> = {
  'post.published': `{
  "event": "post.published",
  "data": { "postId": "string", "platform": "string", "publishedAt": "ISO-8601" }
}`,
  'post.failed': `{
  "event": "post.failed",
  "data": { "postId": "string", "platform": "string", "reason": "string" }
}`,
  'account.connected': `{
  "event": "account.connected",
  "data": { "accountId": "string", "platform": "string" }
}`,
  'account.disconnected': `{
  "event": "account.disconnected",
  "data": { "accountId": "string", "platform": "string" }
}`,
  'billing.subscription_updated': `{
  "event": "billing.subscription_updated",
  "data": { "subscriptionId": "string", "plan": "string", "status": "string" }
}`,
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — no-op.
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      className="flex items-center gap-1 rounded-md border border-dark-border px-2 py-1 text-xs text-gray-subtext hover:text-white"
    >
      {copied ? <Check size={12} className="text-trend-up" /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function DocumentationPanel() {
  const [eventType, setEventType] = useState(Object.keys(PAYLOAD_SHAPES)[0]);
  return (
    <div className="rounded-xl border border-dark-border bg-dark-surface p-4">
      <h3 className="text-sm font-semibold text-white">Documentation</h3>

      <div className="mt-3">
        <div className="flex items-center justify-between">
          <label className="text-xs text-gray-subtext">Payload shape</label>
          <select
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="rounded-md border border-dark-border bg-dark-elev px-2 py-1 text-xs text-white"
          >
            {Object.keys(PAYLOAD_SHAPES).map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        <div className="relative mt-2">
          <pre className="max-h-48 overflow-auto rounded-lg bg-dark-elev p-3 font-mono text-xs text-gray-subtext">
            {PAYLOAD_SHAPES[eventType]}
          </pre>
          <div className="absolute right-2 top-2">
            <CopyButton text={PAYLOAD_SHAPES[eventType]} />
          </div>
        </div>
      </div>

      <div className="mt-4">
        <label className="text-xs text-gray-subtext">Signature verification</label>
        <p className="mt-1 text-xs text-gray-subtext">
          Every delivery includes an <code className="font-mono">X-Webhook-Signature</code> header:
          an HMAC-SHA256 of the raw request body, keyed with your subscription secret.
        </p>
        <div className="relative mt-2">
          <pre className="max-h-56 overflow-auto rounded-lg bg-dark-elev p-3 font-mono text-xs text-gray-subtext">
            {SIGNATURE_SNIPPET}
          </pre>
          <div className="absolute right-2 top-2">
            <CopyButton text={SIGNATURE_SNIPPET} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SubscriptionDetail({
  subscription,
  onBack,
}: {
  subscription: WebhookSubscription;
  onBack: () => void;
}) {
  const id = subscription.id as string;
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAtTop, setIsAtTop] = useState(true);

  const fetchDeliveries = useCallback(() => WebhooksService.getWebhooksDeliveries({ id }), [id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchDeliveries()
      .then((result) => {
        if (!cancelled) setDeliveries(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchDeliveries]);

  const stream = useDeliveryStream(id, {
    initialDeliveries: deliveries,
    isAtTop,
    fetchDeliveries,
  });

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-gray-subtext hover:text-white"
      >
        <ChevronLeft size={16} /> Back to subscriptions
      </button>

      <div className="rounded-xl border border-dark-border bg-dark-surface p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-sm text-white">{subscription.url}</p>
            <p className="text-xs text-gray-subtext">
              Last delivery: {stream.lastDelivery?.eventType ?? '—'}
              {stream.lastDelivery?.status ? ` (${stream.lastDelivery.status})` : ''}
            </p>
          </div>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              subscription.isActive
                ? 'bg-trend-up/10 text-trend-up'
                : 'bg-white/5 text-gray-subtext'
            }`}
          >
            {subscription.isActive ? 'Active' : 'Paused'}
          </span>
        </div>
      </div>

      {stream.pendingCount > 0 && !isAtTop && (
        <button
          type="button"
          onClick={() => {
            setIsAtTop(true);
            stream.releasePending();
          }}
          className="w-full rounded-lg bg-primary-blue py-2 text-sm font-medium text-white"
        >
          {stream.pendingCount} new deliver{stream.pendingCount === 1 ? 'y' : 'ies'} — click to load
        </button>
      )}

      <div
        className="max-h-[60vh] space-y-2 overflow-y-auto"
        onScroll={(e) => setIsAtTop(e.currentTarget.scrollTop < 8)}
      >
        {loading ? (
          <p className="text-sm text-gray-subtext">Loading deliveries…</p>
        ) : (
          <ReplayControls subscriptionId={id} deliveries={stream.deliveries} />
        )}
      </div>
    </div>
  );
}

function SubscriptionList({
  subscriptions,
  onSelect,
}: {
  subscriptions: WebhookSubscription[];
  onSelect: (id: string) => void;
}) {
  if (subscriptions.length === 0) {
    return <p className="text-sm text-gray-subtext">No webhook subscriptions yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {subscriptions.map((sub) => (
        <li key={sub.id}>
          <button
            type="button"
            onClick={() => onSelect(sub.id as string)}
            className="flex w-full items-center justify-between rounded-xl border border-dark-border bg-dark-surface p-3 text-left hover:border-primary-blue/40"
          >
            <div>
              <p className="font-mono text-sm text-white">{sub.url}</p>
              <p className="text-xs text-gray-subtext">
                {(sub.events ?? []).join(', ') || 'No events selected'}
              </p>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                sub.isActive ? 'bg-trend-up/10 text-trend-up' : 'bg-white/5 text-gray-subtext'
              }`}
            >
              {sub.isActive ? 'Active' : 'Paused'}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Settings tab hosting webhook subscription management, docs, and (via
 * /settings/webhooks/:id) a deep link straight into one subscription's
 * delivery history.
 */
export function WebhooksSection() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [subscriptions, setSubscriptions] = useState<WebhookSubscription[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    WebhooksService.getWebhooks()
      .then((result) => {
        if (!cancelled) setSubscriptions(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = useMemo(() => subscriptions.find((s) => s.id === id), [subscriptions, id]);

  return (
    <section className="space-y-4">
      <header className="flex items-center gap-2">
        <Webhook size={18} className="text-primary-blue" />
        <h2 className="text-lg font-semibold text-white">Webhooks</h2>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {loading ? (
            <p className="text-sm text-gray-subtext">Loading subscriptions…</p>
          ) : id ? (
            selected ? (
              <SubscriptionDetail
                subscription={selected}
                onBack={() => navigate('/settings/webhooks')}
              />
            ) : (
              <p className="text-sm text-gray-subtext">
                Subscription not found.{' '}
                <button
                  type="button"
                  className="text-primary-blue underline"
                  onClick={() => navigate('/settings/webhooks')}
                >
                  Back to list
                </button>
              </p>
            )
          ) : (
            <SubscriptionList
              subscriptions={subscriptions}
              onSelect={(subId) => navigate(`/settings/webhooks/${subId}`)}
            />
          )}
        </div>
        <div>
          <DocumentationPanel />
        </div>
      </div>
    </section>
  );
}

export default WebhooksSection;
