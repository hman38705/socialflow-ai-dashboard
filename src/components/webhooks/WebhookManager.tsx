import React, { useEffect, useState } from 'react';
import { WebhooksService } from '../../api/services/WebhooksService';
import type { WebhookSubscription, WebhookEventType } from '../../api/models';
import {
  WEBHOOK_EVENT_TYPES,
  validateWebhookForm,
  isWebhookFormValid,
  type WebhookFormErrors,
} from '../../schemas/webhooks';
import DeliveryHistory from './DeliveryHistory';

interface FormState {
  url: string;
  events: WebhookEventType[];
  description: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = { url: '', events: [], description: '', isActive: true };

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API unavailable — nothing else to do.
  }
}

const WebhookManager: React.FC = () => {
  const [webhooks, setWebhooks] = useState<WebhookSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<WebhookFormErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<WebhookSubscription | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Set once, right after creation — the signing secret is never retrievable again.
  const [revealedSecret, setRevealedSecret] = useState<{ url: string; secret: string } | null>(null);

  const loadWebhooks = () => {
    setLoading(true);
    setLoadError(null);
    WebhooksService.listWebhooks()
      .then(result => setWebhooks(result ?? []))
      .catch(() => setLoadError('Failed to load webhooks.'))
      .finally(() => setLoading(false));
  };

  useEffect(loadWebhooks, []);

  const openCreateModal = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setSaveError(null);
    setModalOpen(true);
  };

  const openEditModal = (webhook: WebhookSubscription) => {
    setEditingId(webhook.id ?? null);
    setForm({
      url: webhook.url ?? '',
      events: webhook.events ?? [],
      description: '',
      isActive: webhook.isActive ?? true,
    });
    setFormErrors({});
    setSaveError(null);
    setModalOpen(true);
  };

  const toggleEvent = (evt: WebhookEventType) => {
    setForm(f => ({
      ...f,
      events: f.events.includes(evt) ? f.events.filter(e => e !== evt) : [...f.events, evt],
    }));
  };

  const handleSubmit = async () => {
    const errors = validateWebhookForm(form);
    setFormErrors(errors);
    if (!isWebhookFormValid(errors)) return;

    setSaving(true);
    setSaveError(null);
    try {
      if (editingId) {
        await WebhooksService.updateWebhook(editingId, {
          url: form.url,
          events: form.events,
          isActive: form.isActive,
        });
      } else {
        const created = await WebhooksService.createWebhook({
          url: form.url,
          events: form.events,
          secret: crypto.randomUUID(),
        });
        if (created.secret) {
          setRevealedSecret({ url: created.url ?? form.url, secret: created.secret });
        }
      }
      setModalOpen(false);
      loadWebhooks();
    } catch {
      setSaveError('Failed to save webhook. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete?.id) return;
    setDeleting(true);
    try {
      await WebhooksService.deleteWebhook(pendingDelete.id);
      setWebhooks(prev => prev.filter(w => w.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch {
      setLoadError('Failed to delete webhook.');
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleActive = async (webhook: WebhookSubscription) => {
    if (!webhook.id) return;
    const id = webhook.id;
    const previous = webhook.isActive ?? true;

    setWebhooks(prev => prev.map(w => (w.id === id ? { ...w, isActive: !previous } : w)));
    setTogglingIds(prev => new Set(prev).add(id));

    try {
      await WebhooksService.updateWebhook(id, { isActive: !previous });
    } catch {
      // Roll back on failure.
      setWebhooks(prev => prev.map(w => (w.id === id ? { ...w, isActive: previous } : w)));
      setLoadError('Failed to update webhook status.');
    } finally {
      setTogglingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Webhooks</h2>
        <button
          onClick={openCreateModal}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          New webhook
        </button>
      </div>

      {loadError && <p className="text-red-600 text-sm">{loadError}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">Loading webhooks…</p>
      ) : webhooks.length === 0 ? (
        <p className="text-sm text-gray-500">No webhooks configured yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-4">URL</th>
                <th className="py-2 pr-4">Events</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Created</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {webhooks.map(webhook => {
                const isExpanded = expandedId === webhook.id;
                return (
                  <React.Fragment key={webhook.id ?? webhook.url}>
                    <tr className="border-b border-gray-100 align-top">
                      <td className="py-2 pr-4 font-mono text-xs break-all max-w-[220px]">{webhook.url}</td>
                      <td className="py-2 pr-4">
                        <div className="flex flex-wrap gap-1">
                          {(webhook.events ?? []).map(evt => (
                            <span key={evt} className="bg-gray-100 text-gray-700 rounded px-1.5 py-0.5 text-xs">
                              {evt}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2 pr-4">
                        <button
                          onClick={() => handleToggleActive(webhook)}
                          disabled={togglingIds.has(webhook.id ?? '')}
                          className={`text-xs px-2 py-1 rounded-md disabled:opacity-50 ${
                            webhook.isActive
                              ? 'bg-green-100 text-green-700 hover:bg-green-200'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {webhook.isActive ? 'Active' : 'Inactive'}
                        </button>
                      </td>
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {webhook.createdAt ? new Date(webhook.createdAt).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-2 space-x-2 whitespace-nowrap">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : webhook.id ?? null)}
                          className="text-blue-600 hover:underline text-xs"
                        >
                          {isExpanded ? 'Hide history' : 'History'}
                        </button>
                        <button onClick={() => openEditModal(webhook)} className="text-blue-600 hover:underline text-xs">
                          Edit
                        </button>
                        <button
                          onClick={() => setPendingDelete(webhook)}
                          className="text-red-600 hover:underline text-xs"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                    {isExpanded && webhook.id && (
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <td colSpan={5} className="py-3 px-2">
                          <DeliveryHistory webhookId={webhook.id} />
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

      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-semibold">{editingId ? 'Edit webhook' : 'New webhook'}</h3>

            <div>
              <label className="block text-sm font-medium mb-1">URL</label>
              <input
                type="text"
                value={form.url}
                onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                placeholder="https://example.com/webhooks/socialflow"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {formErrors.url && <p className="text-red-600 text-xs mt-1">{formErrors.url}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Events</label>
              <div className="grid grid-cols-1 gap-1">
                {WEBHOOK_EVENT_TYPES.map(evt => (
                  <label key={evt} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.events.includes(evt)} onChange={() => toggleEvent(evt)} />
                    {evt}
                  </label>
                ))}
              </div>
              {formErrors.events && <p className="text-red-600 text-xs mt-1">{formErrors.events}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Description (optional)</label>
              <textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={2}
              />
              {formErrors.description && <p className="text-red-600 text-xs mt-1">{formErrors.description}</p>}
            </div>

            {editingId && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                />
                Active
              </label>
            )}

            {saveError && <p className="text-red-600 text-sm">{saveError}</p>}

            <div className="flex gap-3">
              <button
                onClick={() => setModalOpen(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm space-y-4">
            <h3 className="text-lg font-semibold">Delete webhook?</h3>
            <p className="text-sm text-gray-600 break-all">
              This will permanently delete the webhook for <span className="font-mono">{pendingDelete.url}</span>.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setPendingDelete(null)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {revealedSecret && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-semibold">Signing secret</h3>
            <p className="text-sm text-gray-600">
              Copy this secret now — for <span className="font-mono break-all">{revealedSecret.url}</span> — it will
              not be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-xs break-all">
                {revealedSecret.secret}
              </code>
              <button
                onClick={() => copyToClipboard(revealedSecret.secret)}
                className="px-3 py-2 border border-gray-300 rounded-md hover:bg-gray-50 text-sm"
              >
                Copy
              </button>
            </div>
            <button
              onClick={() => setRevealedSecret(null)}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default WebhookManager;
