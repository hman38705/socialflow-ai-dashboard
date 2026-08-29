/**
 * FE-047 — Silent token refresh with single-flight and request replay
 *
 * Guarantees:
 *  - At most one in-flight refresh at a time (single-flight / promise coalescing).
 *  - Concurrent callers all await the same promise.
 *  - Requests that 401'd are replayed once with the new token; a second 401 forces logout.
 *  - Proactive refresh fires 60 s before expiry when the tab is visible.
 *  - Refresh failure clears tokens, navigates to /login?next=…, and dispatches a
 *    "session:expired" event for toast notification.
 *  - The refresh call itself is marked so it is never intercepted again.
 */

import { AuthService } from '../api/services/AuthService';
import type { AuthTokens } from '../api/models/AuthTokens';

// ---------------------------------------------------------------------------
// Token storage helpers (thin wrappers so they are easily stubbed in tests)
// ---------------------------------------------------------------------------

export const TOKEN_KEY = 'accessToken';
export const REFRESH_KEY = 'refreshToken';
/** Special flag stored as a request header to exempt the refresh call. */
export const REFRESH_EXEMPT_HEADER = 'X-Refresh-Exempt';

export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function setTokens(tokens: AuthTokens): void {
  localStorage.setItem(TOKEN_KEY, tokens.accessToken);
  localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
}

export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

// ---------------------------------------------------------------------------
// Expiry helpers
// ---------------------------------------------------------------------------

/**
 * Decode the `exp` claim from a JWT (no signature verification needed here —
 * we trust the token we stored ourselves).
 */
export function decodeExp(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    // atob / Buffer.from for Node.js environments (tests)
    let payload: string;
    try {
      payload = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    } catch {
      payload = Buffer.from(parts[1], 'base64').toString('utf8');
    }
    const { exp } = JSON.parse(payload) as { exp?: number };
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

/** Milliseconds remaining before the access token expires. Returns 0 if expired/unknown. */
export function msUntilExpiry(token: string): number {
  const exp = decodeExp(token);
  if (exp === null) return 0;
  return Math.max(0, exp * 1000 - Date.now());
}

/** Seconds before expiry at which we should proactively refresh. */
export const PROACTIVE_REFRESH_LEAD_MS = 60_000; // 60 s

// ---------------------------------------------------------------------------
// Single-flight state
// ---------------------------------------------------------------------------

/** The current in-flight refresh promise (shared across all concurrent callers). */
let _refreshPromise: Promise<AuthTokens> | null = null;
/** Timer handle for proactive refresh. */
let _proactiveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Reset module-level state — used only in tests.
 */
export function _resetRefreshState(): void {
  _refreshPromise = null;
  _navigate = (url: string) => {
    window.location.assign(url);
  };
  if (_proactiveTimer !== null) {
    clearTimeout(_proactiveTimer);
    _proactiveTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Core: single-flight token refresh
// ---------------------------------------------------------------------------

/**
 * Perform a token refresh.  If a refresh is already in progress every caller
 * awaits the same promise (single-flight / promise coalescing).
 *
 * On success: stores new tokens, schedules the next proactive refresh, and
 *   resolves with the new AuthTokens.
 * On failure: clears tokens, navigates to /login, dispatches
 *   "session:expired", and rejects.
 */
export async function refreshTokens(): Promise<AuthTokens> {
  // Return the existing in-flight promise if there is one.
  if (_refreshPromise !== null) {
    return _refreshPromise;
  }

  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return Promise.reject(new Error('No refresh token available'));
  }

  _refreshPromise = (async (): Promise<AuthTokens> => {
    try {
      const tokens = await AuthService.postAuthRefresh({
        requestBody: { refreshToken },
      });

      setTokens(tokens);
      scheduleProactiveRefresh();
      return tokens;
    } catch (err) {
      handleRefreshFailure();
      throw err;
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
}

// ---------------------------------------------------------------------------
// Logout & failure handling
// ---------------------------------------------------------------------------

/**
 * Internal navigation function — overridable in tests.
 * @internal
 */
export let _navigate: (url: string) => void = (url: string) => {
  window.location.assign(url);
};

/**
 * Override the navigation function — used only in tests to avoid actual
 * browser navigation.
 * @internal
 */
export function _setNavigate(fn: (url: string) => void): void {
  _navigate = fn;
}

/**
 * Perform a full logout: revoke the server-side refresh token (best-effort),
 * clear local storage, and navigate to /login.
 */
export async function logout(reason?: string): Promise<void> {
  const refreshToken = getRefreshToken();
  if (refreshToken) {
    try {
      await AuthService.postAuthLogout({ requestBody: { refreshToken } });
    } catch {
      // Best-effort — ignore errors so local state is always cleared.
    }
  }
  clearTokens();
  navigateToLogin(reason);
}

/** Called when a refresh attempt fails. */
function handleRefreshFailure(): void {
  clearTokens();
  dispatchSessionExpired();
  navigateToLogin(window.location.pathname + window.location.search);
}

function navigateToLogin(next?: string): void {
  const nextParam =
    next && next !== '/' && next !== '/login' ? `?next=${encodeURIComponent(next)}` : '';
  _navigate(`/login${nextParam}`);
}

function dispatchSessionExpired(): void {
  window.dispatchEvent(new CustomEvent('session:expired'));
}

// ---------------------------------------------------------------------------
// Proactive refresh
// ---------------------------------------------------------------------------

/**
 * Schedule a proactive refresh 60 s before the current access token expires,
 * but only when the tab is visible.  If the tab is hidden the browser may
 * throttle timers anyway, so we defer until the tab becomes visible.
 */
export function scheduleProactiveRefresh(): void {
  if (_proactiveTimer !== null) {
    clearTimeout(_proactiveTimer);
    _proactiveTimer = null;
  }

  const token = getAccessToken();
  if (!token) return;

  const remaining = msUntilExpiry(token);
  const delay = remaining - PROACTIVE_REFRESH_LEAD_MS;

  if (delay <= 0) {
    // Token already within the lead window — refresh now if tab is visible.
    tryProactiveRefresh();
    return;
  }

  _proactiveTimer = setTimeout(() => {
    _proactiveTimer = null;
    tryProactiveRefresh();
  }, delay);
}

function tryProactiveRefresh(): void {
  if (document.visibilityState === 'hidden') {
    // Defer until the tab becomes visible.
    const onVisible = (): void => {
      document.removeEventListener('visibilitychange', onVisible);
      tryProactiveRefresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return;
  }

  // Fire and forget — errors handled inside refreshTokens().
  refreshTokens().catch(() => {
    /* handled by handleRefreshFailure inside refreshTokens */
  });
}

// ---------------------------------------------------------------------------
// Request interceptor helpers (used by configure.ts)
// ---------------------------------------------------------------------------

/**
 * Returns true if the given URL is the refresh endpoint — these requests
 * must never be intercepted to avoid infinite recursion.
 */
export function isRefreshUrl(url: string): boolean {
  return url.includes('/auth/refresh');
}

/**
 * Given a `fetch`-compatible call site, wrap it so that:
 *  1. If the response is 401 and the URL is not the refresh endpoint,
 *     a single-flight token refresh is attempted.
 *  2. The original request is replayed once with the new token.
 *  3. If the replay also returns 401, logout is forced.
 *  4. The refresh call itself is never intercepted (exempt header check).
 */
export type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function withRefreshInterceptor(originalFetch: FetchFn): FetchFn {
  return async function interceptedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

    // Never intercept the refresh endpoint itself.
    if (isRefreshUrl(url)) {
      return originalFetch(input, init);
    }

    let response = await originalFetch(input, init);

    if (response.status !== 401) {
      return response;
    }

    // --- First 401: attempt single-flight refresh ---
    try {
      await refreshTokens();
    } catch {
      // Refresh failed — handleRefreshFailure() already ran inside refreshTokens().
      return response;
    }

    // Rebuild headers with the new access token.
    const newToken = getAccessToken();
    const newInit = injectAuthHeader(init, newToken);

    // Replay the original request.
    response = await originalFetch(input, newInit);

    if (response.status === 401) {
      // Double-401 — force logout.
      clearTokens();
      dispatchSessionExpired();
      navigateToLogin(window.location.pathname + window.location.search);
    }

    return response;
  };
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/** Clone RequestInit and inject (or replace) the Authorization header. */
function injectAuthHeader(init: RequestInit | undefined, token: string | null): RequestInit {
  const existing = init ?? {};
  const headersInit = existing.headers;

  let headers: Headers;
  if (headersInit instanceof Headers) {
    headers = new Headers(headersInit);
  } else if (Array.isArray(headersInit)) {
    headers = new Headers(headersInit);
  } else if (headersInit && typeof headersInit === 'object') {
    headers = new Headers(headersInit as Record<string, string>);
  } else {
    headers = new Headers();
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  } else {
    headers.delete('Authorization');
  }

  return { ...existing, headers };
}
