import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../lib/logger';

const logger = createLogger('middleware:csrfProtection');

const CSRF_SECRET = process.env.CSRF_SECRET ?? 'dev-csrf-secret-change-me';
const SESSION_COOKIE = 'csrf_sid';
const TOKEN_COOKIE = 'csrf_token';
const TOKEN_HEADER = 'x-csrf-token';

/**
 * Minimal cookie-header parser — the app doesn't depend on cookie-parser,
 * so we read the raw `Cookie` header directly rather than adding a dependency.
 */
function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key) out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/** Derive the CSRF token from the session ID — binds the token to its session. */
function signSessionId(sessionId: string): string {
  return crypto.createHmac('sha256', CSRF_SECRET).update(sessionId).digest('hex');
}

/**
 * Double-submit CSRF token, bound to a session ID.
 *
 * - `csrf_sid` (httpOnly): random session identifier, established on first contact.
 * - `csrf_token` (readable): HMAC(sessionId, secret) — mirrored by the client via the
 *   `x-csrf-token` header on state-changing requests.
 *
 * A token copied from one session's cookie jar into another fails the HMAC check
 * because it was derived from a different session ID, so cross-session replay is
 * rejected with 403.
 */
function ensureCsrfSession(req: Request, res: Response, isProduction: boolean): void {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE] ?? crypto.randomBytes(32).toString('hex');

  if (!cookies[SESSION_COOKIE]) {
    res.cookie(SESSION_COOKIE, sessionId, { httpOnly: true, sameSite: 'lax', secure: isProduction });
  }
  res.cookie(TOKEN_COOKIE, signSessionId(sessionId), { httpOnly: false, sameSite: 'lax', secure: isProduction });
}

/**
 * Validates a double-submit CSRF token against the session that minted it.
 * Returns true when there's nothing to validate yet (first contact — the
 * session/token pair is being established) or when the token is valid for
 * the current session. Returns false when a token is present but does not
 * match the session it's being presented with (cross-session reuse).
 */
function isCsrfTokenValidForSession(req: Request): boolean {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE];
  const cookieToken = cookies[TOKEN_COOKIE];
  const headerToken = req.headers[TOKEN_HEADER] as string | undefined;

  if (!sessionId && !cookieToken) {
    // Fresh client — no prior session/token to replay.
    return true;
  }

  if (!sessionId || !cookieToken) {
    // A token without its session (or vice versa) is incomplete/suspicious.
    return false;
  }

  const expected = signSessionId(sessionId);
  const presentedToken = headerToken ?? cookieToken;
  return cookieToken === expected && presentedToken === expected;
}

/**
 * Allowed origins per environment — mirrors the list in config/cors.ts so
 * both layers stay in sync without coupling them at import time.
 */
const ALLOWED_ORIGINS: Record<string, string[]> = {
  development: ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000'],
  test: ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000'],
  staging: ['https://staging.socialflow.app'],
  production: ['https://socialflow.app', 'https://www.socialflow.app'],
};

function resolveAllowedOrigins(): string[] {
  const env = process.env.NODE_ENV ?? 'development';
  return ALLOWED_ORIGINS[env] ?? ALLOWED_ORIGINS.development;
}

/**
 * Extract the scheme+host origin from a full URL string.
 * Returns null if the URL is unparseable.
 */
function originFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.origin; // e.g. "https://socialflow.app"
  } catch {
    return null;
  }
}

/**
 * CSRF origin-check middleware for state-changing auth endpoints.
 *
 * Strategy:
 *  1. Requests that carry an `Authorization: Bearer` header are API / mobile
 *     clients — they are not susceptible to CSRF (no cookie-based auth) and
 *     are passed through unconditionally.
 *  2. For all other requests the `Origin` header is checked first; if absent
 *     the `Referer` header is used as a fallback.
 *  3. In non-production environments a missing origin is allowed (server-to-
 *     server calls, curl, Postman, etc.).  In production a missing origin is
 *     rejected to prevent blind CSRF from same-site navigations.
 *  4. If the resolved origin is not in the allow-list the request is rejected
 *     with 403.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  // Bearer-token clients are not CSRF-vulnerable — skip the check entirely.
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return next();
  }

  const allowedOrigins = resolveAllowedOrigins();
  const isProduction = (process.env.NODE_ENV ?? 'development') === 'production';

  // A token presented for a session other than the one it was minted for is
  // a cross-session CSRF replay — reject before even looking at the origin.
  if (!isCsrfTokenValidForSession(req)) {
    logger.warn('CSRF: token not bound to current session', {
      method: req.method,
      path: req.path,
      ip: req.ip,
    });
    res.status(403).json({ message: 'CSRF check failed: token not bound to session' });
    return;
  }

  // Prefer the Origin header; fall back to the origin portion of Referer.
  const rawOrigin = req.headers.origin as string | undefined;
  const rawReferer = req.headers.referer as string | undefined;

  let requestOrigin: string | null = null;

  if (rawOrigin) {
    requestOrigin = rawOrigin;
  } else if (rawReferer) {
    requestOrigin = originFromUrl(rawReferer);
  }

  // No origin information at all.
  if (!requestOrigin) {
    if (isProduction) {
      logger.warn('CSRF: missing Origin/Referer in production', {
        method: req.method,
        path: req.path,
        ip: req.ip,
      });
      res.status(403).json({ message: 'CSRF check failed: missing origin' });
      return;
    }
    // Non-production: allow server-to-server / tooling requests.
    ensureCsrfSession(req, res, isProduction);
    return next();
  }

  if (allowedOrigins.includes(requestOrigin)) {
    ensureCsrfSession(req, res, isProduction);
    return next();
  }

  logger.warn('CSRF: cross-origin request blocked', {
    requestOrigin,
    allowedOrigins,
    method: req.method,
    path: req.path,
    ip: req.ip,
  });

  res.status(403).json({ message: 'CSRF check failed: origin not allowed' });
}
