import rateLimit, { Options, RateLimitRequestHandler } from 'express-rate-limit';
import { Request, Response } from 'express';
import { getRedisConnection } from '../config/runtime';

// ---------------------------------------------------------------------------
// Optional Redis store — only loaded in production to keep dev simple
// ---------------------------------------------------------------------------

/** True once initRateLimiters() resolves — indicates Redis store is active. */
export let rateLimitRedisEnabled = false;

async function buildStore() {
  if (process.env.NODE_ENV !== 'production') return undefined;

  try {
    // rate-limit-redis is a peer-optional dep; gracefully skip if absent
    const { default: RedisStore } = await import('rate-limit-redis');
    const { default: Redis } = await import('ioredis');
    const client = new Redis(getRedisConnection());
    rateLimitRedisEnabled = true;
    return new RedisStore({ sendCommand: (...args: string[]) => (client as any).call(...args) });
  } catch {
    // If rate-limit-redis isn't installed, fall back to memory store
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Shared handler — returns a consistent 429 JSON body
// ---------------------------------------------------------------------------
const handler = (_req: Request, res: Response): void => {
  const retryAfter = Math.ceil(Number(res.getHeader('Retry-After') ?? 60));

  res.status(429).json({
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests. Please slow down and try again later.',
    retryAfter,
    timestamp: new Date().toISOString(),
  });
};

// ---------------------------------------------------------------------------
// Factory — creates a limiter with sensible defaults + caller overrides
// ---------------------------------------------------------------------------
let storePromise: Promise<Options['store'] | undefined> | null = null;

function getStore() {
  if (!storePromise) storePromise = buildStore();
  return storePromise;
}

async function createLimiter(overrides: Partial<Options>): Promise<RateLimitRequestHandler> {
  const store = await getStore();
  return rateLimit({
    standardHeaders: true, // RateLimit-* headers (RFC 6585)
    legacyHeaders: false, // disable X-RateLimit-* legacy headers
    handler,
    store,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Pre-built limiters (resolved at startup via initRateLimiters)
// ---------------------------------------------------------------------------
export let authLimiter: RateLimitRequestHandler;
export let aiLimiter: RateLimitRequestHandler;
export let generalLimiter: RateLimitRequestHandler;

/**
 * Call once during app bootstrap (before routes are registered).
 * Resolves the Redis store (if production) and wires up all limiters.
 */
export async function initRateLimiters(): Promise<void> {
  [authLimiter, aiLimiter, generalLimiter] = await Promise.all([
    // Auth endpoints — strict: 10 attempts per 15 minutes
    createLimiter({
      windowMs: 15 * 60 * 1000,
      max: 10,
      message: 'Too many authentication attempts. Please try again in 15 minutes.',
    }),

    // AI / high-cost endpoints — 30 requests per minute
    createLimiter({
      windowMs: 60 * 1000,
      max: 30,
      message: 'AI generation rate limit reached. Please wait before making more requests.',
    }),

    // General API — 100 requests per minute
    createLimiter({
      windowMs: 60 * 1000,
      max: 100,
    }),
  ]);
}
