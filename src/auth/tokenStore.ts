/**
 * FE-046 — Module-scoped in-memory access token store
 *
 * Design decisions:
 *  - The access token is held exclusively in a module-level variable; it is
 *    NEVER written to localStorage or sessionStorage (XSS exfiltration surface).
 *  - A non-sensitive boolean flag (`sf_session`) is persisted in sessionStorage
 *    so that other parts of the app can detect whether a session exists without
 *    touching the token itself.
 *  - When the store is cleared (logout), a separate localStorage flag
 *    (`sf_logout`) is set to a unique timestamp.  Other tabs listen for the
 *    `storage` event on that key and call their own `clear()`, achieving
 *    cross-tab logout without ever transmitting the token between tabs.
 *  - Subscribers are notified synchronously on every set/clear so callers can
 *    react immediately (e.g. re-render, update OpenAPI.TOKEN).
 */

// ---------------------------------------------------------------------------
// Storage key constants
// ---------------------------------------------------------------------------

/**
 * Non-sensitive flag written to sessionStorage to indicate an active session.
 * Contains `"1"` when a session exists, removed when cleared.
 */
export const SESSION_FLAG_KEY = 'sf_session';

/**
 * Key written to localStorage when the user logs out.  Other tabs observe this
 * via the `storage` event to coordinate cross-tab logout.  The value is a
 * timestamp so that every logout dispatch produces a unique value and the event
 * reliably fires even if the key was already present.
 */
export const LOGOUT_FLAG_KEY = 'sf_logout';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenEntry {
  /** Raw JWT access token. */
  token: string;
  /**
   * Absolute Unix timestamp (ms) at which the token expires, derived from the
   * JWT `exp` claim.  `null` when the expiry cannot be determined.
   */
  expiresAt: number | null;
}

/** Signature of a subscriber callback registered via `subscribe()`. */
export type TokenSubscriber = (entry: TokenEntry | null) => void;

// ---------------------------------------------------------------------------
// Module-level state (the store itself)
// ---------------------------------------------------------------------------

/** The in-memory token entry.  Never written to any storage API. */
let _entry: TokenEntry | null = null;

/** Set of subscriber callbacks notified on every mutation. */
const _subscribers = new Set<TokenSubscriber>();

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Decode the `exp` claim from a JWT payload.  No signature verification —
 * we only need the timestamp, and we issued the token ourselves.
 */
function _decodeExp(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    let payload: string;
    try {
      payload = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    } catch {
      // Node / test environments may not have `atob`.
      payload = Buffer.from(parts[1], 'base64').toString('utf8');
    }
    const { exp } = JSON.parse(payload) as { exp?: number };
    return typeof exp === 'number' ? exp * 1000 : null; // convert to ms
  } catch {
    return null;
  }
}

/** Notify all registered subscribers with the current entry. */
function _notify(): void {
  for (const sub of _subscribers) {
    try {
      sub(_entry);
    } catch {
      // Subscriber errors must not disrupt other subscribers.
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the current in-memory token entry, or `null` if no session exists.
 */
export function getToken(): TokenEntry | null {
  return _entry;
}

/**
 * Store a new access token in memory.
 *
 * Side-effects:
 *  - Sets `sf_session = "1"` in sessionStorage (non-sensitive flag only).
 *  - Notifies all subscribers.
 */
export function setToken(token: string): void {
  _entry = { token, expiresAt: _decodeExp(token) };
  try {
    sessionStorage.setItem(SESSION_FLAG_KEY, '1');
  } catch {
    // Ignore storage errors (e.g. private browsing quota exceeded).
  }
  _notify();
}

/**
 * Clear the in-memory token and signal logout.
 *
 * Side-effects:
 *  - Removes `sf_session` from sessionStorage.
 *  - Writes a timestamp to `sf_logout` in localStorage so other tabs detect
 *    the logout via the `storage` event.
 *  - Notifies all subscribers.
 */
export function clearToken(): void {
  _entry = null;
  try {
    sessionStorage.removeItem(SESSION_FLAG_KEY);
  } catch {
    // Ignore storage errors.
  }
  try {
    // Write a unique value so the `storage` event fires unconditionally.
    localStorage.setItem(LOGOUT_FLAG_KEY, String(Date.now()));
  } catch {
    // Ignore storage errors (e.g. Safari ITP / private browsing).
  }
  _notify();
}

/**
 * Register a subscriber that is called whenever the token changes.
 *
 * Returns an unsubscribe function — call it to remove the subscription.
 *
 * @example
 * const unsub = subscribe((entry) => {
 *   OpenAPI.TOKEN = entry ? async () => entry.token : undefined;
 * });
 * // Later:
 * unsub();
 */
export function subscribe(fn: TokenSubscriber): () => void {
  _subscribers.add(fn);
  return () => {
    _subscribers.delete(fn);
  };
}

// ---------------------------------------------------------------------------
// Cross-tab logout listener
// ---------------------------------------------------------------------------

/**
 * Handle a `storage` event from another tab.  When the other tab sets
 * `sf_logout` we clear our local session without broadcasting again (to avoid
 * an infinite loop across tabs).
 */
function _handleStorageEvent(event: StorageEvent): void {
  if (event.key !== LOGOUT_FLAG_KEY || event.storageArea !== localStorage) {
    return;
  }
  // Another tab logged out — clear our in-memory token and session flag,
  // but do NOT write back to localStorage (that would re-trigger other tabs).
  _entry = null;
  try {
    sessionStorage.removeItem(SESSION_FLAG_KEY);
  } catch {
    // Ignore.
  }
  _notify();
}

// Register the listener once at module load time.  In test environments
// `window` may not exist, so we guard.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', _handleStorageEvent);
}

// ---------------------------------------------------------------------------
// Test helpers (not exported as public API surface)
// ---------------------------------------------------------------------------

/**
 * Reset all module state.  Exported only for test isolation — do not call in
 * production code.
 * @internal
 */
export function _resetStore(): void {
  _entry = null;
  _subscribers.clear();
  try {
    sessionStorage.removeItem(SESSION_FLAG_KEY);
  } catch {
    // Ignore.
  }
  try {
    localStorage.removeItem(LOGOUT_FLAG_KEY);
  } catch {
    // Ignore.
  }
}
