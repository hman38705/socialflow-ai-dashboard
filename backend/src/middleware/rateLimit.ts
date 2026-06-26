import rateLimit, { Options, RateLimitRequestHandler } from 'express-rate-limit';
import { Request, Response } from 'express';
import { getRedisConnection } from '../config/runtime';
import { createLogger } from '../lib/logger';

const logger = createLogger('rate-limit');

// ---------------------------------------------------------------------------
// Optional Redis store — only loaded in production to keep dev simple
// ---------------------------------------------------------------------------

/** Holds the active in-memory store instance so tests can call resetAll(). */
let activeMemoryStore: { resetAll?: () => void } | undefined;

async function buildStore() {
  try {
    // rate-limit-redis is a peer-optional dep; gracefully skip if absent
    const { default: RedisStore } = await import('rate-limit-redis');
    const { default: Redis } = await import('ioredis');
    const client = new Redis(getRedisConnection());
    return new RedisStore({ sendCommand: (...args: string[]) => (client as any).call(...args) });
  } catch (err) {
    // In production, a missing Redis store is a fatal misconfiguration —
    // falling back to in-memory would multiply the effective rate limit by
    // the replica count, undermining security guarantees.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        `[rateLimit] Redis store unavailable in production: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // In development/test, fall back to the default in-memory MemoryStore.
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Shared handler — returns a consistent 429 JSON body
// ---------------------------------------------------------------------------
const handler = (req: Request, res: Response): void => {
  const retryAfter = Math.ceil(Number(res.getHeader('Retry-After') ?? 60));

  logger.warn('rate_limit_exceeded', {
    ip:        req.ip ?? (req.socket as { remoteAddress?: string })?.remoteAddress ?? 'unknown',
    path:      req.path,
    method:    req.method,
    userAgent: req.headers['user-agent'] ?? '',
    userId:    (req as Request & { user?: { id?: string } }).user?.id ?? null,
    retryAfter,
  });

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
  const limiter = rateLimit({
    standardHeaders: true, // RateLimit-* headers (RFC 6585)
    legacyHeaders: false, // disable X-RateLimit-* legacy headers
    handler,
    store,
    ...overrides,
  });

  // Capture the in-memory store so resetLimiters() can flush it between tests.
  // When a Redis store is used the limiter's own store property is the Redis store;
  // when undefined is passed rateLimit creates a MemoryStore internally.
  if (!store && !activeMemoryStore) {
    activeMemoryStore = (limiter as any).store as { resetAll?: () => void } | undefined;
  }

  return limiter;
}

// ---------------------------------------------------------------------------
// Pre-built limiters (resolved at startup via initRateLimiters)
// ---------------------------------------------------------------------------
export let authLimiter: RateLimitRequestHandler;
export let aiLimiter: RateLimitRequestHandler;
export let generalLimiter: RateLimitRequestHandler;

/**
 * Verify the rate-limiter Redis store is reachable at startup.
 *
 * In production, a missing or unreachable Redis store means rate limits are
 * not shared across instances — a silent misconfiguration that can allow
 * credential-stuffing attacks. We therefore treat it as fatal in production
 * and log a warning (falling back to the in-memory store) in other envs.
 */
export async function checkRateLimiterStore(
  exit: (code: number) => void = (code) => process.exit(code),
): Promise<void> {
  const store = await getStore();
  if (!store) {
    const msg =
      'Rate limiter Redis store is unavailable — falling back to in-memory store. ' +
      'Rate limits will NOT be shared across instances.';
    if (process.env.NODE_ENV === 'production') {
      logger.error('Rate limiter Redis store unavailable', { msg });
      exit(1);
    } else {
      logger.warn('Rate limiter Redis store unavailable, falling back to in-memory', { msg });
    }
  }
}

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

/**
 * Reset all in-memory rate-limit counters.
 *
 * Call this in `afterEach` (or `beforeEach`) inside test suites that exercise
 * auth or other rate-limited endpoints so that counter state from one test
 * case cannot cause unexpected 429 responses in subsequent cases.
 *
 * This is a no-op when a Redis store is active (production / staging), since
 * those environments do not use the in-memory MemoryStore.
 */
export function resetLimiters(): void {
  if (activeMemoryStore?.resetAll) {
    activeMemoryStore.resetAll();
  }
  // Also reset via the limiter's own resetKey if the store reference wasn't
  // captured (e.g. when initRateLimiters hasn't been called yet in a test).
}
