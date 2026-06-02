import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import { WebhookEventType } from '../schemas/webhooks';

const logger = createLogger('WebhookDispatcher');

const MAX_ATTEMPTS = 5;
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
      // Fire-and-forget; errors are caught and persisted inside
      attemptDelivery(delivery.id, sub.url, sub.secret, payload, 1).catch((err) => {
        logger.error('Webhook dispatch failed', { err, deliveryId: delivery.id, url: sub.url });
      });
    }),
  );
}

/**
 * Attempt a single delivery. On failure, schedule a retry up to MAX_ATTEMPTS.
 */
export async function attemptDelivery(
  deliveryId: string,
  url: string,
  secret: string,
  payload: string,
  attempt: number,
): Promise<void> {
  const signature = sign(secret, payload);

  let responseStatus: number | undefined;
  let responseBody: string | undefined;
  let errorMessage: string | undefined;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, {
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
    responseBody = (await res.text()).slice(0, 1000); // cap stored body

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
    errorMessage = err instanceof Error ? err.message : String(err);
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
    due.map((d) =>
      attemptDelivery(
        d.id,
        d.subscription.url,
        d.subscription.secret,
        d.payload,
        d.attempts + 1,
      ).catch((err) => {
        logger.error('Webhook retry failed', {
          err,
          deliveryId: d.id,
          url: d.subscription.url,
        });
      }),
    ),
  );
}
