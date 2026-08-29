/**
 * CSRF-protection helper for the OAuth / social sign-in flow.
 *
 * The provider button generates a random `state`, stores it here (in
 * sessionStorage — it must not survive a tab close, and must not be
 * readable from other origins), and hands it to the provider's authorize
 * URL. When the provider redirects back to /auth/callback, we compare the
 * `state` it returns against what we stored: a mismatch means the redirect
 * wasn't initiated by us and the flow must abort. The stored value is
 * single-use — it is deleted the moment it's read, whether the comparison
 * passes or fails, so a replayed callback can never be verified twice.
 */

const STORAGE_KEY = 'sf_oauth_state';

/** Generates a new, unguessable state token. */
export function generateState(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/g, '');
  }
  // Fallback for environments without crypto.randomUUID.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Persists a freshly generated state before redirecting to the provider. */
export function storeState(state: string): void {
  sessionStorage.setItem(STORAGE_KEY, state);
}

/**
 * Reads and immediately deletes the stored state — single-use regardless of
 * whether the caller goes on to find it valid or invalid.
 */
function consumeStoredState(): string | null {
  const stored = sessionStorage.getItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
  return stored;
}

/**
 * Verifies a `state` value returned by the OAuth provider against the one
 * we stored before redirecting. Always consumes the stored value as a side
 * effect. Returns false (never throws) for a missing, mismatched, or
 * already-consumed state.
 */
export function verifyState(returnedState: string | null | undefined): boolean {
  const stored = consumeStoredState();
  if (!stored || !returnedState) return false;
  return stored === returnedState;
}
