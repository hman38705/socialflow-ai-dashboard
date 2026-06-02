import { Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import { AuthRequest } from '../middleware/authMiddleware';
import { NotFoundError, ForbiddenError } from '../lib/errors';
import { dispatchEvent } from '../services/WebhookDispatcher';
import { CreateWebhookInput, UpdateWebhookInput } from '../schemas/webhooks';
import { parsePageLimit, toSkipTake, buildPageResponse } from '../utils/pagination';

const logger = createLogger('WebhooksController');

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
    // Store a hashed secret — never return the raw value after creation
    const hashedSecret = crypto.createHash('sha256').update(secret).digest('hex');

    const sub = await prisma.webhookSubscription.create({
      data: { userId: req.user!.id, url, secret: hashedSecret, events },
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

    const data: Record<string, unknown> = {};
    if (body.url !== undefined) data.url = body.url;
    if (body.events !== undefined) data.events = body.events;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.secret !== undefined) {
      data.secret = crypto.createHash('sha256').update(body.secret).digest('hex');
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
