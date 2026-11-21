import { Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import { AuthRequest } from '../middleware/authMiddleware';
import { NotFoundError, ForbiddenError, BadRequestError } from '../lib/errors';
import { dispatchEvent, assertSafeUrl } from '../services/WebhookDispatcher';
import { encryptWebhookSecret } from '../lib/webhookSecretCrypto';
import { CreateWebhookInput, UpdateWebhookInput } from '../schemas/webhooks';
import { parsePageLimit, toSkipTake, buildPageResponse } from '../utils/pagination';

const logger = createLogger('WebhooksController');

// Maximum number of characters of a webhook response body that are stored
// alongside a delivery record. Exported so tests can reference the limit
// instead of hard-coding the number.
export const WEBHOOK_RESPONSE_BODY_LIMIT = 1000;

// Marker appended when a response body is truncated.
export const WEBHOOK_RESPONSE_BODY_TRUNCATION_MARKER = '…[truncated]';

/**
 * Truncate a webhook response body to {@link WEBHOOK_RESPONSE_BODY_LIMIT}
 * characters without splitting a surrogate pair (emoji, CJK, etc.).
 *
 * A naive `slice` can cut a UTF-16 surrogate pair in half and leave a lone
 * surrogate in the stored text, which breaks JSON serialisation downstream.
 * When truncation happens the marker is appended exactly once at the end.
 */
export function truncateResponseBody(body: string): string {
  if (body.length <= WEBHOOK_RESPONSE_BODY_LIMIT) return body;

  let end = WEBHOOK_RESPONSE_BODY_LIMIT;
  // If the cut point lands between a high and low surrogate, back off by one
  // so the pair is never split.
  const code = body.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) {
    end -= 1;
  }

  return body.slice(0, end) + WEBHOOK_RESPONSE_BODY_TRUNCATION_MARKER;
}

// ── List subscriptions ────────────────────────────────────────────────────────
export async function listWebhooks(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const params = parsePageLimit(req);
    const where = { userId: req.user!.id };
    const select = {
      id: true,
      url: true,
      events: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    };

    const [total, subs] = await Promise.all([
      prisma.webhookSubscription.count({ where }),
      prisma.webhookSubscription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select,
        ...toSkipTake(params),
      }),
    ]);

    res.json(buildPageResponse(req, subs, total, params));
  } catch (err) {
    next(err);
  }
}

// ── Create subscription ───────────────────────────────────────────────────────
export async function createWebhook(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { url, secret, events } = req.body as CreateWebhookInput;
    try {
      await assertSafeUrl(url);
    } catch (err) {
      throw new BadRequestError(err instanceof Error ? err.message : 'Invalid webhook URL');
    }
    // Store the secret encrypted (reversibly) — never return the raw value
    // after creation, but keep it recoverable so it can be used as the
    // actual HMAC signing key for outbound/inbound webhook verification.
    const encryptedSecret = encryptWebhookSecret(secret);

    const sub = await prisma.webhookSubscription.create({
      data: { userId: req.user!.id, url, secret: encryptedSecret, events },
      select: { id: true, url: true, events: true, isActive: true, createdAt: true },
    });

    // Return the raw secret once so the user can store it
    res.status(201).json({ ...sub, secret });
  } catch (err) {
    next(err);
  }
}

// ── Get single subscription ───────────────────────────────────────────────────
export async function getWebhook(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const sub = await findOwned(req.params.id, req.user!.id);
    res.json({
      id: sub.id,
      url: sub.url,
      events: sub.events,
      isActive: sub.isActive,
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt,
    });
  } catch (err) {
    next(err);
  }
}

// ── Update subscription ───────────────────────────────────────────────────────
export async function updateWebhook(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await findOwned(req.params.id, req.user!.id);
    const body = req.body as UpdateWebhookInput;

    if (body.url !== undefined) {
      try {
        await assertSafeUrl(body.url);
      } catch (err) {
        throw new BadRequestError(err instanceof Error ? err.message : 'Invalid webhook URL');
      }
    }

    const data: Record<string, unknown> = {};
    if (body.url !== undefined) data.url = body.url;
    if (body.events !== undefined) data.events = body.events;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.secret !== undefined) {
      data.secret = encryptWebhookSecret(body.secret);
    }

    const updated = await prisma.webhookSubscription.update({
      where: { id: req.params.id },
      data,
      select: { id: true, url: true, events: true, isActive: true, updatedAt: true },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

// ── Delete subscription ───────────────────────────────────────────────────────
export async function deleteWebhook(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await findOwned(req.params.id, req.user!.id);
    await prisma.webhookSubscription.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// ── Test delivery ─────────────────────────────────────────────────────────────
export async function testWebhook(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const sub = await findOwned(req.params.id, req.user!.id);
    const { eventType } = req.body;

    if (!sub.events.includes(eventType)) {
      res.status(400).json({ message: `Subscription does not listen for event '${eventType}'` });
      return;
    }

    await dispatchEvent(
      eventType as any,
      { test: true, triggeredBy: req.user!.id },
      'socialflow-test',
    );
    res.json({ message: 'Test event dispatched' });
  } catch (err) {
    next(err);
  }
}

// ── Delivery history ──────────────────────────────────────────────────────────
export async function listDeliveries(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await findOwned(req.params.id, req.user!.id);
    const params = parsePageLimit(req);
    const where = { subscriptionId: req.params.id };
    const select = {
      id: true,
      eventType: true,
      status: true,
      attempts: true,
      responseStatus: true,
      errorMessage: true,
      createdAt: true,
      nextRetryAt: true,
    };

    const [total, deliveries] = await Promise.all([
      prisma.webhookDelivery.count({ where }),
      prisma.webhookDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select,
        ...toSkipTake(params),
      }),
    ]);

    res.json(buildPageResponse(req, deliveries, total, params));
  } catch (err) {
    next(err);
  }
}

// ── Replay a failed delivery ──────────────────────────────────────────────────
export async function replayDelivery(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const delivery = await prisma.webhookDelivery.findUnique({
      where: { id: req.params.deliveryId },
      include: { subscription: true },
    });
    if (!delivery) throw new NotFoundError('Delivery not found');
    if (delivery.subscription.userId !== req.user!.id) throw new ForbiddenError();

    // Reset to pending and re-attempt immediately
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: 'pending', nextRetryAt: null },
    });

    dispatchEvent(delivery.eventType as any, JSON.parse(delivery.payload)).catch((err) => {
      logger.error('Webhook replay dispatch failed', { err, deliveryId: delivery.id });
    });
    res.json({ message: 'Delivery replay queued' });
  } catch (err) {
    next(err);
  }
}

// ── Helper ────────────────────────────────────────────────────────────────────
async function findOwned(id: string, userId: string) {
  const sub = await prisma.webhookSubscription.findUnique({ where: { id } });
  if (!sub) throw new NotFoundError('Webhook subscription not found');
  if (sub.userId !== userId) throw new ForbiddenError();
  return sub;
}
