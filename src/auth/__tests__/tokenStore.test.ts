/**
 * Tests for src/auth/tokenStore.ts — FE-046 acceptance criteria:
 *
 *  AC-1  Access token is NOT written to localStorage or sessionStorage after
 *        login (only the non-sensitive session flag may be persisted).
 *  AC-2  Cross-tab logout: a synthetic `storage` event on LOGOUT_FLAG_KEY
 *        clears the in-memory store in the current tab.
 *  AC-3  Subscribers are notified synchronously on set and on clear.
 *  AC-4  clearToken() does not write the token value to any storage; only the
 *        LOGOUT_FLAG_KEY (a timestamp) is written to localStorage.
 *  AC-5  SESSION_FLAG_KEY is set in sessionStorage after setToken() and removed
 *        after clearToken().
 */

import {
  getToken,
  setToken,
  clearToken,
  subscribe,
  SESSION_FLAG_KEY,
  LOGOUT_FLAG_KEY,
  _resetStore,
} from '../tokenStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal JWT with the given exp (Unix seconds). */
function makeJwt(expOffsetMs = 300_000): string {
  const exp = Math.floor((Date.now() + expOffsetMs) / 1000);
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ sub: 'user-1', exp }));
  return `${header}.${payload}.sig`;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetStore();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  _resetStore();
  localStorage.clear();
  sessionStorage.clear();
});

// ---------------------------------------------------------------------------
// AC-1: Token never written to localStorage or sessionStorage
// ---------------------------------------------------------------------------

describe('AC-1 — access token is never written to any storage', () => {
  it('setToken() does not write the token value to localStorage', () => {
    const jwt = makeJwt();
    setToken(jwt);

    // Check every key in localStorage; none should contain the token value.
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      const value = localStorage.getItem(key) ?? '';
      expect(value).not.toContain(jwt);
      // The raw token string should not appear under ANY key.
      expect(value).not.toBe(jwt);
    }
  });

  it('setToken() does not write the token value to sessionStorage', () => {
    const jwt = makeJwt();
    setToken(jwt);

    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)!;
      const value = sessionStorage.getItem(key) ?? '';
      // The session flag ("1") is allowed; the actual JWT must not appear.
      if (key === SESSION_FLAG_KEY) {
        expect(value).toBe('1');
      } else {
        expect(value).not.toContain(jwt);
        expect(value).not.toBe(jwt);
      }
    }
  });

  it('setToken() does not write "accessToken" or "token" keys to localStorage', () => {
    setToken(makeJwt());
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('access_token')).toBeNull();
  });

  it('getToken() returns the token from memory (not from storage)', () => {
    const jwt = makeJwt();
    setToken(jwt);

    // Simulate what would happen if storage had been cleared externally
    // (e.g. browser privacy feature): the in-memory store should still hold it.
    localStorage.clear();
    sessionStorage.clear();

    expect(getToken()?.token).toBe(jwt);
  });
});

// ---------------------------------------------------------------------------
// AC-2: Cross-tab logout via synthetic `storage` event
// ---------------------------------------------------------------------------

describe('AC-2 — cross-tab logout via storage event', () => {
  it('a storage event on LOGOUT_FLAG_KEY clears the in-memory token', () => {
    setToken(makeJwt());
    expect(getToken()).not.toBeNull();

    // Simulate another tab writing to the logout flag.
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: LOGOUT_FLAG_KEY,
        newValue: String(Date.now()),
        storageArea: localStorage,
      }),
    );

    expect(getToken()).toBeNull();
  });

  it('a storage event on LOGOUT_FLAG_KEY removes the session flag from sessionStorage', () => {
    setToken(makeJwt());
    expect(sessionStorage.getItem(SESSION_FLAG_KEY)).toBe('1');

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: LOGOUT_FLAG_KEY,
        newValue: String(Date.now()),
        storageArea: localStorage,
      }),
    );

    expect(sessionStorage.getItem(SESSION_FLAG_KEY)).toBeNull();
  });

  it('a storage event on an unrelated key does NOT clear the token', () => {
    setToken(makeJwt());

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'unrelated_key',
        newValue: 'some-value',
        storageArea: localStorage,
      }),
    );

    expect(getToken()).not.toBeNull();
  });

  it('a storage event on LOGOUT_FLAG_KEY with sessionStorage as area does NOT clear the token', () => {
    setToken(makeJwt());

    // Cross-tab events always arrive with storageArea === localStorage.
    // Verify we only react to the right store.
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: LOGOUT_FLAG_KEY,
        newValue: String(Date.now()),
        storageArea: sessionStorage,
      }),
    );

    expect(getToken()).not.toBeNull();
  });

  it('the current tab does NOT re-broadcast the logout flag when receiving a cross-tab event', () => {
    setToken(makeJwt());

    const initialTimestamp = String(Date.now() - 1000);
    localStorage.setItem(LOGOUT_FLAG_KEY, initialTimestamp);

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: LOGOUT_FLAG_KEY,
        newValue: initialTimestamp,
        storageArea: localStorage,
      }),
    );

    // The value in localStorage must not change — we do not re-write it.
    expect(localStorage.getItem(LOGOUT_FLAG_KEY)).toBe(initialTimestamp);
  });
});

// ---------------------------------------------------------------------------
// AC-3: Subscribers notified on change
// ---------------------------------------------------------------------------

describe('AC-3 — subscribers notified on set and clear', () => {
  it('subscribe() callback is called when setToken() is invoked', () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);

    const jwt = makeJwt();
    setToken(jwt);

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ token: jwt }));

    unsub();
  });

  it('subscribe() callback is called with null when clearToken() is invoked', () => {
    const jwt = makeJwt();
    setToken(jwt);

    const cb = vi.fn();
    const unsub = subscribe(cb);

    clearToken();

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(null);

    unsub();
  });

  it('multiple subscribers all receive the update', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const unsub1 = subscribe(cb1);
    const unsub2 = subscribe(cb2);

    setToken(makeJwt());

    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();

    unsub1();
    unsub2();
  });

  it('unsubscribing stops future notifications', () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);

    setToken(makeJwt());
    expect(cb).toHaveBeenCalledOnce();

    unsub();
    cb.mockClear();

    setToken(makeJwt());
    expect(cb).not.toHaveBeenCalled();
  });

  it('a subscriber that throws does not prevent other subscribers from being notified', () => {
    const throwing = vi.fn(() => {
      throw new Error('subscriber error');
    });
    const safe = vi.fn();

    const unsub1 = subscribe(throwing);
    const unsub2 = subscribe(safe);

    // Should not throw despite the first subscriber throwing.
    expect(() => setToken(makeJwt())).not.toThrow();
    expect(safe).toHaveBeenCalledOnce();

    unsub1();
    unsub2();
  });
});

// ---------------------------------------------------------------------------
// AC-4: clearToken() token value does not appear in storage
// ---------------------------------------------------------------------------

describe('AC-4 — clearToken() does not leak the token value to any storage', () => {
  it('clearToken() does not write the JWT value to localStorage', () => {
    const jwt = makeJwt();
    setToken(jwt);
    clearToken();

    for (let i = 0; i < localStorage.length; i++) {
      const value = localStorage.getItem(localStorage.key(i)!) ?? '';
      expect(value).not.toContain(jwt);
    }
  });

  it('clearToken() writes only a timestamp to the LOGOUT_FLAG_KEY', () => {
    setToken(makeJwt());
    const before = Date.now();
    clearToken();
    const after = Date.now();

    const raw = localStorage.getItem(LOGOUT_FLAG_KEY);
    expect(raw).not.toBeNull();
    const ts = Number(raw);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// AC-5: SESSION_FLAG_KEY lifecycle
// ---------------------------------------------------------------------------

describe('AC-5 — SESSION_FLAG_KEY lifecycle in sessionStorage', () => {
  it('SESSION_FLAG_KEY is "1" in sessionStorage after setToken()', () => {
    setToken(makeJwt());
    expect(sessionStorage.getItem(SESSION_FLAG_KEY)).toBe('1');
  });

  it('SESSION_FLAG_KEY is removed from sessionStorage after clearToken()', () => {
    setToken(makeJwt());
    clearToken();
    expect(sessionStorage.getItem(SESSION_FLAG_KEY)).toBeNull();
  });

  it('getToken() returns null after clearToken()', () => {
    setToken(makeJwt());
    clearToken();
    expect(getToken()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Additional: expiresAt is decoded from JWT
// ---------------------------------------------------------------------------

describe('expiresAt is populated from JWT exp claim', () => {
  it('expiresAt reflects the exp claim in milliseconds', () => {
    const expOffsetMs = 300_000; // 5 minutes
    const jwt = makeJwt(expOffsetMs);
    setToken(jwt);

    const entry = getToken();
    expect(entry).not.toBeNull();
    expect(entry!.expiresAt).not.toBeNull();
    // Allow ±2 s tolerance for timing differences.
    const expected = Math.floor((Date.now() + expOffsetMs) / 1000) * 1000;
    expect(Math.abs(entry!.expiresAt! - expected)).toBeLessThan(2000);
  });

  it('expiresAt is null for a malformed token', () => {
    setToken('not.a.real.jwt');
    expect(getToken()?.expiresAt).toBeNull();
  });
});
