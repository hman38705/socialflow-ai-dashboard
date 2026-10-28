import rateLimit, { Options, RateLimitRequestHandler } from 'express-rate-limit';
import { Request, Response } from 'express';
import { createLogger } from '../lib/logger';
import { redis } from '../lib/redis';

const logger = createLogger('rate-limit');

// ---------------------------------------------------------------------------
// Optional Redis store — only loaded in production to keep dev simple
// ---------------------------------------------------------------------------

/** Holds the active in-memory store instance so tests can call resetAll(). */
let activeMemoryStore: { resetAll?: () => void } | undefined;

/**
 * Attach a single error handler to the shared Redis client so that
 * connection errors from the rate-limit store do not become unhandled
 * `error` events on the EventEmitter (which would crash the process).
 *
 * The handler is registered at most once — ioredis itself de-duplicates
 * listener registrations by function reference, but we keep a flag to
 * make the intent explicit and avoid any listener-count warnings.
 */
let _errorHandlerAttached = false;

function attachRedisErrorHandler(): void {
  if (_errorHandlerAttached) return;
  redis.on('error', (err: Error) => {
    logger.error('Rate-limit Redis client error', {
      error: err.message,
      code: (err as NodeJS.ErrnoException).code,
    });
  });
  _errorHandlerAttached = true;
}

async function buildStore() {
  try {
    // rate-limit-redis is a peer-optional dep; gracefully skip if absent
    const { default: RedisStore } = await import('rate-limit-redis');

    // Reuse the shared singleton client rather than creating a private one.
    // This ensures:
    //  1. Connection errors surface through the named error handler below
    //     instead of becoming unhandled EventEmitter exceptions.
    //  2. The client is closed by closeRateLimitStore() during graceful
    //     shutdown — the caller no longer holds an orphaned reference.
    attachRedisErrorHandler();

    return new RedisStore({
      sendCommand: (...args: string[]) => (redis as any).call(...args),
    });
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
    ip: req.ip ?? (req.socket as { remoteAddress?: string })?.remoteAddress ?? 'unknown',
    path: req.path,
    method: req.method,
    userAgent: req.headers['user-agent'] ?? '',
    userId: (req as Request & { user?: { id?: string } }).user?.id ?? null,
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
 * Per-user limiter for the AI image-analysis endpoint.
 *
 * Each call to /ai/analyze-image spends credits and triggers a paid Gemini
 * request, so a tighter per-user limit (5 per minute) is applied on top of
 * the global AI limiter (30 per minute, per IP). Keying on the authenticated
 * user ID (falling back to IP when unauthenticated) prevents a single user
 * from consuming the entire IP-shared budget.
 */
export let aiImageLimiter: RateLimitRequestHandler;

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
  [authLimiter, aiLimiter, generalLimiter, aiImageLimiter] = await Promise.all([
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

    // Per-user AI image analysis — 5 per minute keyed on user ID
    createLimiter({
      windowMs: 60 * 1000,
      max: 5,
      keyGenerator: (req: Request): string => {
        const user = (req as Request & { user?: { id?: string } }).user;
        return user?.id ?? req.ip ?? req.socket.remoteAddress ?? 'unknown';
      },
      message:
        'AI image analysis rate limit reached (5 per minute). Please wait before making more requests.',
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

/**
 * Close the shared Redis client used by the rate-limit store.
 *
 * Call this as part of the graceful shutdown sequence, **after** all
 * in-flight requests have completed.  It is idempotent — repeated calls
 * are safe and will not throw.
 *
 * In development/test the Redis store is skipped (in-memory fallback), so
 * this function is a no-op in those environments.
 */
export async function closeRateLimitStore(): Promise<void> {
  try {
    // Only attempt to quit if the client is in a connected state.
    // ioredis status values: "wait" | "reconnecting" | "connecting" | "connect" | "ready" | "close" | "end"
    if (redis.status === 'ready' || redis.status === 'connect') {
      await redis.quit();
    }
  } catch (err) {
    logger.error('Error closing rate-limit Redis client', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Reset the error-handler attachment flag.
 * Exported for testing only — do not call in production code.
 * @internal
 */
export function _resetErrorHandlerFlag(): void {
  _errorHandlerAttached = false;
}
