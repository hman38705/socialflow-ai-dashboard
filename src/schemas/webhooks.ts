/**
 * Webhook form validation schemas.
 *
 * Shared by the WebhookManager create and edit forms so both stay in sync and
 * validation errors always map to a specific field rather than a form-level
 * blob.
 *
 * This repo has no `@socialflow/shared` package to import event constants
 * from, so `WEBHOOK_EVENT_TYPES` is derived once from the generated API
 * model's `WebhookEventType` union (src/api/models.ts, which itself is
 * generated from backend/openapi.yaml). Keeping a single derivation point
 * here — instead of re-declaring the list elsewhere — is what prevents
 * frontend/backend drift in this codebase.
 */
import type { WebhookEventType } from '../api/models';

export const WEBHOOK_EVENT_TYPES: WebhookEventType[] = [
  'post.published',
  'post.failed',
  'analytics.report_ready',
  'blockchain.transaction_completed',
  'blockchain.transaction_failed',
  'system.health_check',
];

const WEBHOOK_EVENT_TYPE_SET = new Set<string>(WEBHOOK_EVENT_TYPES);

export function isKnownEventType(value: string): value is WebhookEventType {
  return WEBHOOK_EVENT_TYPE_SET.has(value);
}

const MAX_DESCRIPTION_LENGTH = 280;

// Hosts that must never be accepted for an outbound webhook URL, mirroring
// the backend's SSRF hygiene checks so users get instant feedback instead of
// a round-trip failure.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return true;
  if (host.endsWith('.local')) return true;

  // IPv4 private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16 (link-local)
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 127) return true;
  }
  return false;
}

export function validateWebhookUrl(value: string): string | undefined {
  const url = value.trim();
  if (!url) return 'URL is required.';

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Enter a valid URL.';
  }

  if (parsed.protocol !== 'https:') {
    return 'URL must use https://.';
  }
  if (isPrivateOrLoopbackHost(parsed.hostname)) {
    return 'URL must not point to a private or loopback host.';
  }
  return undefined;
}

export function validateWebhookEvents(events: string[]): string | undefined {
  if (!events || events.length === 0) {
    return 'Select at least one event.';
  }
  const unknown = events.find(e => !isKnownEventType(e));
  if (unknown) {
    return `Unknown event type: ${unknown}.`;
  }
  return undefined;
}

export function validateWebhookDescription(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.length > MAX_DESCRIPTION_LENGTH) {
    return `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`;
  }
  return undefined;
}

export interface WebhookFormInput {
  url: string;
  events: string[];
  description?: string;
}

export interface WebhookFormErrors {
  url?: string;
  events?: string;
  description?: string;
}

export function validateWebhookForm(input: WebhookFormInput): WebhookFormErrors {
  const errors: WebhookFormErrors = {};
  const url = validateWebhookUrl(input.url);
  if (url) errors.url = url;
  const events = validateWebhookEvents(input.events);
  if (events) errors.events = events;
  const description = validateWebhookDescription(input.description);
  if (description) errors.description = description;
  return errors;
}

export function isWebhookFormValid(errors: WebhookFormErrors): boolean {
  return !errors.url && !errors.events && !errors.description;
}
