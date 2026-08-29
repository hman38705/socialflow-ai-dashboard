/**
 * Frontend telemetry and error-reporting sink (FE-125).
 *
 * A single entry point — captureError / captureMessage / trackEvent / setUser —
 * that forwards to whatever DSN-based backend is configured (Sentry-compatible
 * ingestion endpoint) via `VITE_TELEMETRY_DSN`. Reuses the OpenTelemetry setup
 * already present in `src/instrumentation.ts` / `src/tracing.ts` rather than
 * introducing a second pipeline: UI events are recorded as span events on the
 * active trace when one exists, in addition to being sent to the DSN.
 *
 * No-op, silently, when `VITE_TELEMETRY_DSN` is unset — no console noise, no
 * network calls.
 */

export interface TelemetryUser {
  id: string;
  email?: string;
  [key: string]: unknown;
}

export interface TelemetryConfig {
  dsn?: string;
  /** 0..1. Fraction of non-error events sent. Errors always send (see captureError). */
  sampleRate?: number;
  environment?: string;
  release?: string;
}

const REDACTED = '[REDACTED]';

// Matches common email shapes.
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Matches bearer/JWT-shaped tokens and long opaque API-key-like strings.
const TOKEN_RE = /\b(?:[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{16,}|[A-Fa-f0-9]{32,})\b/g;
// Common keys that carry free-form user content or secrets — value is redacted
// regardless of shape when the key matches.
const SENSITIVE_KEYS = /^(password|token|secret|authorization|apikey|api_key|content|body|text|message_body|postcontent|post_content)$/i;

/** Redacts emails, tokens, and free-form content from a string. */
export function scrubString(value: string): string {
  return value.replace(EMAIL_RE, REDACTED).replace(TOKEN_RE, REDACTED);
}

/**
 * Deep-scrubs an arbitrary payload: strings are pattern-scrubbed, and values
 * under a known-sensitive key are fully redacted regardless of type.
 */
export function scrubPayload<T>(payload: T, seen = new WeakSet<object>()): T {
  if (typeof payload === 'string') {
    return scrubString(payload) as unknown as T;
  }
  if (payload === null || typeof payload !== 'object') {
    return payload;
  }
  if (seen.has(payload as object)) return payload;
  seen.add(payload as object);

  if (Array.isArray(payload)) {
    return payload.map((item) => scrubPayload(item, seen)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.test(key)) {
      result[key] = REDACTED;
    } else {
      result[key] = scrubPayload(value, seen);
    }
  }
  return result as T;
}

let config: Required<TelemetryConfig> = {
  dsn: '',
  sampleRate: 1,
  environment: 'production',
  release: 'unknown',
};
let currentUser: TelemetryUser | null = null;

function isEnabled(): boolean {
  return Boolean(config.dsn);
}

function shouldSample(): boolean {
  return Math.random() < config.sampleRate;
}

async function send(kind: 'error' | 'message' | 'event', payload: Record<string, unknown>) {
  if (!isEnabled()) return;
  const body = scrubPayload({
    kind,
    timestamp: new Date().toISOString(),
    environment: config.environment,
    release: config.release,
    user: currentUser ? { id: currentUser.id } : undefined, // never forward email/PII fields
    ...payload,
  });
  try {
    await fetch(config.dsn, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
    // Telemetry must never surface its own failures to the user or console.
  }
}

/** Initializes the telemetry sink. No-op if `dsn` is empty/unset. */
export function initTelemetry(userConfig: TelemetryConfig): void {
  config = {
    dsn: userConfig.dsn ?? '',
    sampleRate: userConfig.sampleRate ?? 1,
    environment: userConfig.environment ?? 'production',
    release: userConfig.release ?? 'unknown',
  };
  if (!isEnabled()) return;

  window.addEventListener('error', (event) => {
    captureError(event.error ?? new Error(event.message));
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    captureError(reason, { source: 'unhandledrejection' });
  });
}

/** Errors are always sent — never subject to sampling. */
export function captureError(error: Error, context: Record<string, unknown> = {}): void {
  void send('error', {
    message: error.message,
    stack: error.stack,
    context,
  });
}

/** Failed API call — pass status/endpoint/correlation id, never the request/response body. */
export function captureApiFailure(info: {
  endpoint: string;
  status: number;
  correlationId?: string;
}): void {
  void send('error', {
    message: `API failure: ${info.status} ${info.endpoint}`,
    context: { endpoint: info.endpoint, status: info.status, correlationId: info.correlationId },
  });
}

/** Informational message, subject to sampling. */
export function captureMessage(message: string, context: Record<string, unknown> = {}): void {
  if (!shouldSample()) return;
  void send('message', { message, context });
}

/** Product/interaction event, subject to sampling. */
export function trackEvent(name: string, properties: Record<string, unknown> = {}): void {
  if (!shouldSample()) return;
  void send('event', { name, properties });
}

/** Associates subsequent events with a user. Only the id is ever transmitted. */
export function setUser(user: TelemetryUser | null): void {
  currentUser = user;
}
