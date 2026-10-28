import crypto from 'crypto';
import { isIP } from 'net';
import dns from 'dns/promises';
import https from 'https';
import http from 'http';
import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import { webhookDispatchFailed, webhookDispatchTotal } from '../lib/metrics';
import { WebhookEventType } from '../schemas/webhooks';
import { decryptWebhookSecret } from '../lib/webhookSecretCrypto';
import ipaddr from 'ipaddr.js';

const logger = createLogger('WebhookDispatcher');

// ---------------------------------------------------------------------------
// SSRF protection — ipaddr.js-based range classification (#1776)
// ---------------------------------------------------------------------------

/**
 * ipaddr.js `range()` return values that indicate the address is NOT safe
 * for outbound webhook delivery. This covers:
 *
 *  IPv4: private, loopback, linkLocal, carrierGradeNat, reserved,
 *        multicast, broadcast, unspecified
 *  IPv6: loopback, uniqueLocal, linkLocal, ipv4Mapped, multicast,
 *        reserved, unspecified
 *
 * The previous hand-rolled CIDR list only covered 10/8, 172.16/12,
 * 192.168/16, 127/8, 169.254/16, 0/8 — omitting CGNAT (100.64/10),
 * 192.0.0/24, 198.18/15, multicast (224/4), and ALL IPv6 space.
 */
const BLOCKED_RANGES = new Set([
  // IPv4
  'private',
  'loopback',
  'linkLocal',
  'carrierGradeNat',
  'reserved',
  'multicast',
  'broadcast',
  'unspecified',
  // IPv6
  'uniqueLocal',
  'ipv4Mapped',
]);

/**
 * Classify a single IP address string as safe or blocked using ipaddr.js.
 * Handles both IPv4 and IPv6, including IPv4-mapped IPv6 addresses (which
 * are unwrapped to their IPv4 form before classification).
 */
function isBlockedIP(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return true; // treat unparseable as blocked (fail-closed)

  let addr = ipaddr.parse(ip);

  // IPv4-mapped IPv6 addresses (e.g. ::ffff:10.0.0.1) must be checked as IPv4
  if (addr instanceof ipaddr.IPv6 && addr.isIPv4MappedAddress()) {
    addr = addr.toIPv4Address();
  }

  return BLOCKED_RANGES.has(addr.range());
}

/**
 * Resolve a hostname to all A and AAAA records, returning the combined
 * list of IP addresses. Throws if resolution fails for both families.
 */
async function resolveAll(hostname: string): Promise<string[]> {
  const addresses: string[] = [];

  // Attempt IPv4 first (backward compat with existing callers), then IPv6
  try {
    const v4 = await dns.resolve4(hostname);
    addresses.push(...v4);
  } catch {
    // IPv4 resolution failed — will try IPv6 below
  }

  try {
    const v6 = await dns.resolve6(hostname);
    addresses.push(...v6);
  } catch {
    // IPv6 resolution failed
  }

  if (addresses.length === 0) {
    throw new Error(`Webhook URL hostname could not be resolved: ${hostname}`);
  }

  return addresses;
}

/**
 * Validate that a webhook URL is not HTTPS-to-a-blocked-address SSRF bait.
 * Resolves the hostname (both A and AAAA) and rejects private/loopback/
 * link-local/CGNAT/reserved/multicast addresses — including the
 * 169.254.169.254 cloud metadata endpoint — for both IPv4 and IPv6.
 *
 * Returns the first validated IP address so callers can connect to it
 * directly, preventing DNS rebinding (#1777).
 *
 * Exported so callers can re-run the same check at webhook creation/update
 * time, not only immediately before each delivery — DNS can change between
 * the two.
 */
export async function assertSafeUrl(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid webhook URL: ${url}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`Webhook URL must use https (got ${parsed.protocol}): ${url}`);
  }

  // URL.hostname keeps the brackets around IPv6 literals; strip them so isIP/ipaddr can parse
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

  // Literal IP in URL — validate directly
  if (isIP(hostname) !== 0) {
    if (isBlockedIP(hostname)) {
      throw new Error(`Webhook URL resolves to a blocked address: ${url}`);
    }
    return hostname;
  }

  // Hostname — resolve and validate all addresses
  const addresses = await resolveAll(hostname);

  let validatedIP: string | undefined;
  for (const addr of addresses) {
    if (isBlockedIP(addr)) {
      throw new Error(`Webhook URL resolves to a blocked address (${addr}): ${url}`);
    }
    // Use the first safe address for the connection
    if (!validatedIP) validatedIP = addr;
  }

  if (!validatedIP) {
    throw new Error(`Webhook URL hostname could not be resolved: ${hostname}`);
  }

  return validatedIP;
}

const MAX_ATTEMPTS = 5;
const MAX_RESPONSE_BODY_BYTES = 1000;

/**
 * Read at most `maxBytes` of a response body, then cancel the stream so a
 * hostile subscriber cannot make us buffer an arbitrarily large response.
 */
export async function readBodyCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8');
}

/**
 * Read at most `maxBytes` from an IncomingMessage stream, then destroy it.
 * Mirrors readBodyCapped but for the http.IncomingMessage used by safeFetch.
 */
export async function readBodyCappedFromStream(
  stream: http.IncomingMessage,
  maxBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    received += chunks[chunks.length - 1].byteLength;
    if (received >= maxBytes) break;
  }
  stream.destroy();
  return Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8');
}
const TIMEOUT_MS = 10_000; // 10 s per request
// Exponential back-off delays in ms: 1 min, 5 min, 30 min, 2 h, 8 h
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 28_800_000];

export interface WebhookEventPayload {
  id: string;
  version: '1.0';
  event: WebhookEventType;
  createdAt: string;
  source: string;
  data: Record<string, unknown>;
}

/**
 * Build an HMAC-SHA256 signature header value.
 * Format: sha256=<hex-digest>
 */
function sign(secret: string, body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Decrypt a subscription's stored (encrypted) signing secret. If decryption
 * fails — e.g. the encryption key was rotated — the delivery is marked
 * failed instead of throwing, so a single bad secret can't crash the
 * fire-and-forget dispatch/retry loops.
 */
export async function resolveSigningSecret(
  deliveryId: string,
  encryptedSecret: string,
): Promise<string | null> {
  try {
    return decryptWebhookSecret(encryptedSecret);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(`Delivery ${deliveryId} blocked — could not decrypt signing secret`, {
      errorMessage,
    });
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'failed',
        nextRetryAt: null,
        errorMessage: 'Unable to decrypt webhook secret',
      },
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// safeFetch — DNS-rebinding-safe HTTP client (#1775 + #1777)
// ---------------------------------------------------------------------------

/**
 * Response shape returned by safeFetch. Mirrors a subset of the global
 * fetch Response so readBodyCapped and existing call sites keep working.
 */
export interface SafeFetchResponse {
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}

/**
 * Make an HTTPS POST request that:
 *  - Does NOT follow redirects (#1775 — redirect: 'manual' equivalent).
 *    Any 3xx response is returned as-is so the caller can treat it as a
 *    failed delivery.
 *  - Connects to the pre-validated `ipAddress` instead of re-resolving the
 *    hostname, preventing DNS rebinding (#1777). SNI and Host header are
 *    preserved by setting `servername` and the `Host` header to the
 *    original hostname.
 *
 * Returns a fetch-compatible response object (ok, status, body, text()).
 */
export function safeFetch(
  url: string,
  validatedIP: string,
  options: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
): Promise<SafeFetchResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    const path = parsed.pathname + parsed.search;

    // Build request headers, preserving the original Host header
    const reqHeaders: Record<string, string> = { ...options.headers };
    reqHeaders['Host'] = hostname;

    // Create an agent with a custom lookup that always returns the validated
    // IP — this prevents DNS rebinding because the connection target is
    // pinned to the IP we validated, not re-resolved.
    const agent = new https.Agent({
      keepAlive: false,
      // Custom DNS lookup — always resolve to the validated IP
      lookup: (
        _hostname: string,
        _opts: dns.LookupOneOptions,
        callback: (err: Error | null, address: string, family: number) => void,
      ) => {
        const family = isIP(validatedIP);
        callback(null, validatedIP, family === 6 ? 6 : 4);
      },
    });

    const req = https.request(
      {
        method: options.method,
        hostname: hostname, // Connect using hostname for SNI
        port: port,
        path: path,
        headers: reqHeaders,
        agent: agent,
        servername: hostname, // Preserve SNI for TLS certificate verification
        // The custom agent lookup forces the TCP connection to validatedIP
      },
      (res: http.IncomingMessage) => {
        // Convert IncomingMessage to a fetch-compatible response
        const status = res.statusCode ?? 0;
        const ok = status >= 200 && status < 300;

        // Wrap the IncomingMessage stream as a ReadableStream for body
        const body = res.readable
          ? new ReadableStream<Uint8Array>({
              start(controller) {
                res.on('data', (chunk: Buffer) => {
                  controller.enqueue(new Uint8Array(chunk));
                });
                res.on('end', () => controller.close());
                res.on('error', (err) => controller.error(err));
              },
              cancel() {
                res.destroy();
              },
            })
          : null;

        const text = async (): Promise<string> => {
          const chunks: Buffer[] = [];
          for await (const chunk of res) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          return Buffer.concat(chunks).toString('utf8');
        };

        resolve({ ok, status, body, text });
      },
    );

    req.on('error', (err) => reject(err));

    // Handle abort signal
    if (options.signal.aborted) {
      req.destroy();
      reject(new Error('The operation was aborted'));
      return;
    }
    options.signal.addEventListener('abort', () => {
      req.destroy();
      reject(new Error('The operation was aborted'));
    });

    req.write(options.body);
    req.end();
  });
}

/** Indirection so tests can stub the transport (internal calls bypass module-export spies). */
export const deliveryTransport = { safeFetch };

/**
 * Dispatch a webhook event to all active subscribers for that event type.
 * Each delivery is persisted so retries survive restarts.
 */
export async function dispatchEvent(
  eventType: WebhookEventType,
  data: Record<string, unknown>,
  source = 'socialflow',
): Promise<void> {
  const subscriptions = await prisma.webhookSubscription.findMany({
    where: { isActive: true, events: { has: eventType } },
  });

  if (subscriptions.length === 0) return;

  const envelope: WebhookEventPayload = {
    id: crypto.randomUUID(),
    version: '1.0',
    event: eventType,
    createdAt: new Date().toISOString(),
    source,
    data,
  };

  const payload = JSON.stringify(envelope);

  await Promise.all(
    subscriptions.map(async (sub) => {
      const delivery = await prisma.webhookDelivery.create({
        data: {
          subscriptionId: sub.id,
          eventType,
          payload,
          status: 'pending',
        },
      });
      const secret = await resolveSigningSecret(delivery.id, sub.secret);
      if (secret === null) return;

      // Fire-and-forget; errors are caught and persisted inside
      attemptDelivery(delivery.id, sub.url, secret, payload, 1).catch((err) => {
        logger.error('Unexpected error in fire-and-forget delivery', {
          deliveryId: delivery.id,
          subscriptionId: sub.id,
          err,
        });
        webhookDispatchFailed.inc({ subscription_id: sub.id });
      });
    }),
  );
}

/**
 * Attempt a single delivery. On failure, schedule a retry up to MAX_ATTEMPTS.
 *
 * Security measures:
 *  - assertSafeUrl validates the URL and resolves the hostname once,
 *    returning the validated IP (prevents DNS rebinding — #1777).
 *  - safeFetch connects to the validated IP, preserving Host/SNI.
 *  - Redirects are not followed (3xx treated as failure — #1775).
 */
export async function attemptDelivery(
  deliveryId: string,
  url: string,
  secret: string,
  payload: string,
  attempt: number,
): Promise<void> {
  webhookDispatchTotal.inc();

  let validatedIP: string;
  try {
    validatedIP = await assertSafeUrl(url);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(`Delivery ${deliveryId} blocked — unsafe URL`, { url, errorMessage });
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'failed', attempts: attempt, nextRetryAt: null, errorMessage },
    });
    return;
  }

  const signature = sign(secret, payload);

  let responseStatus: number | undefined;
  let responseBody: string | undefined;
  let errorMessage: string | undefined;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await deliveryTransport.safeFetch(url, validatedIP, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SocialFlow-Signature': signature,
        'X-SocialFlow-Delivery': deliveryId,
      },
      body: payload,
      signal: controller.signal,
    });

    clearTimeout(timer);
    responseStatus = res.status;
    responseBody = await readBodyCapped(res as unknown as Response, MAX_RESPONSE_BODY_BYTES); // cap stored body

    if (res.ok) {
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'success',
          attempts: attempt,
          responseStatus,
          responseBody,
          nextRetryAt: null,
        },
      });
      logger.info(`Delivery ${deliveryId} succeeded`, { attempt, url });
      return;
    }

    errorMessage = `HTTP ${responseStatus}`;
  } catch (err) {
    errorMessage = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
    logger.warn(`Delivery ${deliveryId} attempt ${attempt} error`, { errorMessage, url });
  }

  // Delivery failed — schedule retry or mark as permanently failed
  if (attempt < MAX_ATTEMPTS) {
    const nextRetryAt = new Date(Date.now() + RETRY_DELAYS_MS[attempt - 1]);
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'pending',
        attempts: attempt,
        nextRetryAt,
        responseStatus: responseStatus ?? null,
        responseBody: responseBody ?? null,
        errorMessage,
      },
    });
    logger.info(`Delivery ${deliveryId} scheduled for retry`, { nextRetryAt, attempt });
  } else {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'failed',
        attempts: attempt,
        nextRetryAt: null,
        responseStatus: responseStatus ?? null,
        responseBody: responseBody ?? null,
        errorMessage,
      },
    });
    logger.error(`Delivery ${deliveryId} permanently failed after ${attempt} attempts`, { url });
  }
}

/**
 * Retry worker — call this on a cron/interval to re-attempt pending deliveries.
 */
export async function retryPendingDeliveries(): Promise<void> {
  const due = await prisma.webhookDelivery.findMany({
    where: { status: 'pending', nextRetryAt: { lte: new Date() } },
    include: { subscription: true },
    take: 50,
  });

  logger.info(`Retrying ${due.length} pending deliveries`);

  await Promise.all(
    due.map(async (d) => {
      const secret = await resolveSigningSecret(d.id, d.subscription.secret);
      if (secret === null) return;

      await attemptDelivery(d.id, d.subscription.url, secret, d.payload, d.attempts + 1).catch(
        (err) => {
          logger.error('Unexpected error in fire-and-forget retry delivery', {
            deliveryId: d.id,
            subscriptionId: d.subscription.id,
            err,
          });
          webhookDispatchFailed.inc({ subscription_id: d.subscription.id });
        },
      );
    }),
  );
}
