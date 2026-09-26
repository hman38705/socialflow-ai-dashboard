import { Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { aiLimiter } from '../../middleware/rateLimit';

/**
 * Rate limiters for routes mounted through the module tree (registerModules).
 *
 * Limits are configurable via environment variables with safe defaults.
 */
function envInt(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const tooManyRequests = (_req: Request, res: Response): void => {
  const retryAfter = Math.ceil(Number(res.getHeader('Retry-After') ?? 60));
  res.status(429).json({
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests. Please slow down and try again later.',
    retryAfter,
    timestamp: new Date().toISOString(),
  });
};

/** Maximum number of texts accepted by POST /api/translation/batch. */
export const TRANSLATION_BATCH_MAX_TEXTS = envInt('TRANSLATION_BATCH_MAX_TEXTS', 20);

/**
 * Translation routes hit metered third-party APIs, so they share the existing
 * AI/high-cost limiter. The limiter is resolved lazily because it is created
 * asynchronously by initRateLimiters() at startup.
 */
export const translationLimiter: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => (aiLimiter ? aiLimiter(req, res, next) : next());

/** POST /api/facebook/post — write-heavy, per authenticated user (falls back to IP). */
export const facebookPostLimiter: RequestHandler = rateLimit({
  windowMs: envInt('FACEBOOK_POST_RATE_LIMIT_WINDOW_MS', 60 * 1000),
  max: envInt('FACEBOOK_POST_RATE_LIMIT_MAX', 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) =>
    (req as Request & { user?: { id?: string } }).user?.id ?? req.ip ?? 'unknown',
  handler: tooManyRequests,
});

/** POST /api/auth/login and /register — strict, per IP. */
export const loginRegisterLimiter: RequestHandler = rateLimit({
  windowMs: envInt('AUTH_LOGIN_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  max: envInt('AUTH_LOGIN_RATE_LIMIT_MAX', 10),
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequests,
});

/** POST /api/auth/refresh — more permissive than login, keyed per IP. */
export const refreshLimiter: RequestHandler = rateLimit({
  windowMs: envInt('AUTH_REFRESH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  max: envInt('AUTH_REFRESH_RATE_LIMIT_MAX', 30),
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequests,
});
