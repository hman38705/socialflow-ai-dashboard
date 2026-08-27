/**
 * Tests for src/auth/refresh.ts — FE-047 acceptance criteria:
 *
 *  AC-1  5 parallel 401s → exactly 1 refresh call
 *  AC-2  Replay succeeds after refresh
 *  AC-3  Double-401 (replay also 401) forces logout + session:expired event
 *  AC-4  Refresh endpoint is exempt from interception (no recursion)
 *  AC-5  Proactive refresh fires 60 s before expiry when tab is visible
 *  AC-6  Proactive refresh defers when tab is hidden until it becomes visible
 *  AC-7  Refresh failure clears tokens + navigates to /login + dispatches session:expired
 *  AC-8  No second refresh when one is already in-flight
 */

import {
  refreshTokens,
  withRefreshInterceptor,
  setTokens,
  clearTokens,
  getAccessToken,
  getRefreshToken,
  scheduleProactiveRefresh,
  msUntilExpiry,
  decodeExp,
  isRefreshUrl,
  _resetRefreshState,
  _setNavigate,
} from '../refresh';
import { AuthService } from '../../api/services/AuthService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal JWT with the given exp (Unix timestamp in seconds). */
function makeJwt(exp: number): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ sub: 'user-1', exp }));
  return `${header}.${payload}.sig`;
}

function expAt(offsetMs: number): number {
  return Math.floor((Date.now() + offsetMs) / 1000);
}

/** Seed tokens in localStorage for tests that need them. */
function seedTokens(accessExp?: number): void {
  const accessToken = makeJwt(accessExp ?? expAt(300_000)); // default: 5 min from now
  setTokens({ accessToken, refreshToken: 'rt-seed' });
}

// ---------------------------------------------------------------------------
// Navigation spy
// ---------------------------------------------------------------------------

let navTarget = '';
const navSpy = jest.fn((url: string) => {
  navTarget = url;
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPostAuthRefresh = jest.spyOn(AuthService, 'postAuthRefresh');
const mockPostAuthLogout = jest.spyOn(AuthService, 'postAuthLogout');

beforeEach(() => {
  localStorage.clear();
  navTarget = '';
  navSpy.mockClear();
  jest.useFakeTimers();
  _resetRefreshState();
  _setNavigate(navSpy);
  mockPostAuthRefresh.mockReset();
  mockPostAuthLogout.mockReset();
  mockPostAuthLogout.mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// Utility: decodeExp / msUntilExpiry
// ---------------------------------------------------------------------------

describe('decodeExp', () => {
  it('returns the exp claim from a valid JWT', () => {
    const exp = expAt(60_000);
    expect(decodeExp(makeJwt(exp))).toBe(exp);
  });

  it('returns null for a malformed token', () => {
    expect(decodeExp('not.a.token')).toBeNull();
    expect(decodeExp('')).toBeNull();
  });
});

describe('msUntilExpiry', () => {
  it('returns positive ms for a future token', () => {
    const token = makeJwt(expAt(120_000));
    const ms = msUntilExpiry(token);
    expect(ms).toBeGreaterThan(100_000);
    expect(ms).toBeLessThanOrEqual(120_000);
  });

  it('returns 0 for an expired token', () => {
    const token = makeJwt(expAt(-5_000));
    expect(msUntilExpiry(token)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isRefreshUrl
// ---------------------------------------------------------------------------

describe('isRefreshUrl', () => {
  it('detects the refresh endpoint', () => {
    expect(isRefreshUrl('https://api.example.com/api/v1/auth/refresh')).toBe(true);
    expect(isRefreshUrl('/auth/refresh')).toBe(true);
  });

  it('does not match other endpoints', () => {
    expect(isRefreshUrl('/auth/login')).toBe(false);
    expect(isRefreshUrl('/users')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-1 + AC-8: 5 parallel 401s → exactly 1 refresh call (single-flight)
// ---------------------------------------------------------------------------

describe('refreshTokens — single-flight coalescing', () => {
  it('AC-1: 5 parallel calls share a single refresh request', async () => {
    seedTokens();

    let resolveRefresh!: (t: { accessToken: string; refreshToken: string }) => void;
    const refreshPromise = new Promise<{ accessToken: string; refreshToken: string }>((res) => {
      resolveRefresh = res;
    });
    mockPostAuthRefresh.mockReturnValue(refreshPromise as never);

    // Fire 5 concurrent refresh calls
    const calls = [
      refreshTokens(),
      refreshTokens(),
      refreshTokens(),
      refreshTokens(),
      refreshTokens(),
    ];

    // Resolve the single underlying network call
    resolveRefresh({ accessToken: 'new-at', refreshToken: 'new-rt' });

    const results = await Promise.all(calls);

    // Exactly 1 network call
    expect(mockPostAuthRefresh).toHaveBeenCalledTimes(1);
    // All callers received the same new tokens
    for (const r of results) {
      expect(r.accessToken).toBe('new-at');
      expect(r.refreshToken).toBe('new-rt');
    }
  });

  it('AC-8: after the first refresh settles a second call triggers a new request', async () => {
    seedTokens();
    mockPostAuthRefresh.mockResolvedValueOnce({ accessToken: 'at1', refreshToken: 'rt1' });

    await refreshTokens();

    // Set new refresh token so the second call has one to use
    setTokens({ accessToken: 'at1', refreshToken: 'rt1' });
    mockPostAuthRefresh.mockResolvedValueOnce({ accessToken: 'at2', refreshToken: 'rt2' });

    const result = await refreshTokens();

    expect(mockPostAuthRefresh).toHaveBeenCalledTimes(2);
    expect(result.accessToken).toBe('at2');
  });
});

// ---------------------------------------------------------------------------
// AC-7: Refresh failure path
// ---------------------------------------------------------------------------

describe('refreshTokens — failure', () => {
  it('AC-7: clears tokens, dispatches session:expired, and navigates to /login on failure', async () => {
    seedTokens();
    mockPostAuthRefresh.mockRejectedValueOnce(new Error('401 Unauthorized'));

    const expired: Event[] = [];
    const handler = (e: Event): void => {
      expired.push(e);
    };
    window.addEventListener('session:expired', handler);

    await expect(refreshTokens()).rejects.toThrow();

    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(expired).toHaveLength(1);
    expect(navSpy).toHaveBeenCalledWith(expect.stringMatching(/^\/login/));

    window.removeEventListener('session:expired', handler);
  });
});

// ---------------------------------------------------------------------------
// withRefreshInterceptor
// ---------------------------------------------------------------------------

describe('withRefreshInterceptor', () => {
  function makeResponse(status: number): Response {
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({}),
      text: async () => '{}',
      clone: function () {
        return this;
      },
    } as unknown as Response;
  }

  it('AC-4: passes through the refresh endpoint without interception', async () => {
    const baseFetch = jest.fn().mockResolvedValue(makeResponse(401));
    const wrapped = withRefreshInterceptor(baseFetch);

    const resp = await wrapped('/api/v1/auth/refresh', {});

    expect(resp.status).toBe(401);
    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(mockPostAuthRefresh).not.toHaveBeenCalled();
  });

  it('passes through non-401 responses untouched', async () => {
    const baseFetch = jest.fn().mockResolvedValue(makeResponse(200));
    const wrapped = withRefreshInterceptor(baseFetch);

    const resp = await wrapped('/api/v1/users', {});

    expect(resp.status).toBe(200);
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it('AC-2: replays the request with new token after successful refresh', async () => {
    seedTokens();
    mockPostAuthRefresh.mockResolvedValueOnce({
      accessToken: 'fresh-at',
      refreshToken: 'fresh-rt',
    });

    // First call → 401, replay → 200
    const baseFetch = jest
      .fn()
      .mockResolvedValueOnce(makeResponse(401))
      .mockResolvedValueOnce(makeResponse(200));

    const wrapped = withRefreshInterceptor(baseFetch);
    const resp = await wrapped('/api/v1/posts', {});

    expect(resp.status).toBe(200);
    expect(mockPostAuthRefresh).toHaveBeenCalledTimes(1);
    expect(baseFetch).toHaveBeenCalledTimes(2);

    // The replayed request must carry the new token
    const [, replayInit] = baseFetch.mock.calls[1];
    const replayHeaders = replayInit?.headers as Headers;
    expect(replayHeaders.get('Authorization')).toBe('Bearer fresh-at');
  });

  it('AC-3: double-401 (replay also 401) forces logout and dispatches session:expired', async () => {
    seedTokens();
    mockPostAuthRefresh.mockResolvedValueOnce({
      accessToken: 'new-at',
      refreshToken: 'new-rt',
    });

    // Both original and replay return 401
    const baseFetch = jest.fn().mockResolvedValue(makeResponse(401));

    const expired: Event[] = [];
    const handler = (e: Event): void => {
      expired.push(e);
    };
    window.addEventListener('session:expired', handler);

    const wrapped = withRefreshInterceptor(baseFetch);
    const resp = await wrapped('/api/v1/posts', {});

    expect(resp.status).toBe(401);
    expect(expired.length).toBeGreaterThanOrEqual(1);
    expect(getAccessToken()).toBeNull();
    expect(navSpy).toHaveBeenCalledWith(expect.stringMatching(/^\/login/));

    window.removeEventListener('session:expired', handler);
  });

  it('AC-1: 5 parallel intercepted 401s result in exactly 1 refresh call', async () => {
    seedTokens();

    let resolveRefresh!: (t: { accessToken: string; refreshToken: string }) => void;
    const sharedRefreshPromise = new Promise<{ accessToken: string; refreshToken: string }>(
      (res) => {
        resolveRefresh = res;
      },
    );
    mockPostAuthRefresh.mockReturnValue(sharedRefreshPromise as never);

    let callCount = 0;
    const baseFetch = jest.fn().mockImplementation(async () => {
      callCount += 1;
      // Initial 5 calls → 401, replays → 200
      if (callCount <= 5) return makeResponse(401);
      return makeResponse(200);
    });

    const wrapped = withRefreshInterceptor(baseFetch);

    const promises = Array.from({ length: 5 }, () => wrapped('/api/v1/posts', {}));

    // Resolve the single shared refresh
    resolveRefresh({ accessToken: 'new-at', refreshToken: 'new-rt' });

    await Promise.all(promises);

    expect(mockPostAuthRefresh).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// AC-5 + AC-6: Proactive refresh
// ---------------------------------------------------------------------------

describe('scheduleProactiveRefresh', () => {
  it('AC-5: fires a refresh ~60s before the token expires when tab is visible', async () => {
    // Simulate visible tab
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });

    // Token expires in 90 s → proactive fires in 30 s (90 000 - 60 000)
    const token = makeJwt(expAt(90_000));
    setTokens({ accessToken: token, refreshToken: 'rt' });
    mockPostAuthRefresh.mockResolvedValue({ accessToken: 'new-at', refreshToken: 'new-rt' });

    scheduleProactiveRefresh();

    // Nothing should fire yet
    expect(mockPostAuthRefresh).not.toHaveBeenCalled();

    // Advance to just past 30 s
    jest.advanceTimersByTime(30_001);

    // Allow microtasks to settle
    await Promise.resolve();
    await Promise.resolve();

    expect(mockPostAuthRefresh).toHaveBeenCalledTimes(1);
  });

  it('AC-6: defers when tab is hidden, fires when tab becomes visible', async () => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });

    // Token already within the lead window (5 s left)
    const token = makeJwt(expAt(5_000));
    setTokens({ accessToken: token, refreshToken: 'rt' });
    mockPostAuthRefresh.mockResolvedValue({ accessToken: 'new-at', refreshToken: 'new-rt' });

    scheduleProactiveRefresh();
    jest.advanceTimersByTime(6_000);

    await Promise.resolve();

    // Still hidden — should not have refreshed
    expect(mockPostAuthRefresh).not.toHaveBeenCalled();

    // Tab becomes visible
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));

    await Promise.resolve();
    await Promise.resolve();

    expect(mockPostAuthRefresh).toHaveBeenCalledTimes(1);
  });

  it('fires immediately when the token is within the lead window on a visible tab', async () => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });

    // Token expires in 30 s — already inside the 60-s lead window
    const token = makeJwt(expAt(30_000));
    setTokens({ accessToken: token, refreshToken: 'rt' });
    mockPostAuthRefresh.mockResolvedValue({ accessToken: 'new-at', refreshToken: 'new-rt' });

    scheduleProactiveRefresh();

    await Promise.resolve();
    await Promise.resolve();

    expect(mockPostAuthRefresh).toHaveBeenCalledTimes(1);
  });
});
