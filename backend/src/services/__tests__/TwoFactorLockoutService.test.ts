/**
 * #1026 — TwoFactorLockoutService unit tests
 *
 * Scope: 2FA-specific policy layered on top of the Redis lockout store.
 * The generic store primitive is covered by src/__tests__/twoFactorLockoutRedis.test.ts.
 * These tests focus on:
 * - Lockout does NOT trigger before the configured threshold (5 attempts)
 * - Lockout triggers exactly at the threshold
 * - resetFailedAttempts (simulating a successful 2FA verification) clears both the
 *   failure counter and the lockout flag
 * - getLockoutRemainingMs returns a positive value while locked, 0 after reset
 * - Attempting beyond the threshold keeps the lockout in place
 */

// ── Mock ioredis with an in-process store ──────────────────────────────────────
const redisData = new Map<string, { value: string; expiresAt: number }>();

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    incr: async (key: string) => {
      const entry = redisData.get(key);
      const next = entry ? parseInt(entry.value, 10) + 1 : 1;
      redisData.set(key, { value: String(next), expiresAt: Infinity });
      return next;
    },
    expire: async (key: string, ttlSeconds: number) => {
      const entry = redisData.get(key);
      if (entry) entry.expiresAt = Date.now() + ttlSeconds * 1000;
    },
    set: async (key: string, value: string, _ex: string, ttlSeconds: number) => {
      redisData.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    get: async (key: string) => {
      const entry = redisData.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        redisData.delete(key);
        return null;
      }
      return entry.value;
    },
    pttl: async (key: string) => {
      const entry = redisData.get(key);
      if (!entry) return -2;
      const remaining = entry.expiresAt - Date.now();
      return remaining > 0 ? remaining : -2;
    },
    del: async (...keys: string[]) => {
      keys.forEach((k) => redisData.delete(k));
    },
  })),
);

jest.mock('../../config/runtime', () => ({
  getRedisConnection: () => ({ host: '127.0.0.1', port: 6379 }),
}));

import { redisTwoFactorLockoutStore } from '../TwoFactorLockoutService';

const THRESHOLD = 5; // must match LOCKOUT_THRESHOLD in the service

beforeEach(() => redisData.clear());

// ── Lockout threshold policy ──────────────────────────────────────────────────
describe('TwoFactorLockoutService — lockout threshold', () => {
  it('is not locked out before any failed attempts', async () => {
    expect(await redisTwoFactorLockoutStore.isLockedOut('user-a')).toBe(false);
  });

  it('is not locked out after fewer than threshold attempts', async () => {
    for (let i = 0; i < THRESHOLD - 1; i++) {
      await redisTwoFactorLockoutStore.recordFailedAttempt('user-b');
    }
    expect(await redisTwoFactorLockoutStore.isLockedOut('user-b')).toBe(false);
  });

  it('locks out exactly at the threshold attempt', async () => {
    for (let i = 0; i < THRESHOLD; i++) {
      await redisTwoFactorLockoutStore.recordFailedAttempt('user-c');
    }
    expect(await redisTwoFactorLockoutStore.isLockedOut('user-c')).toBe(true);
  });

  it('remains locked out after further attempts beyond threshold', async () => {
    for (let i = 0; i < THRESHOLD + 3; i++) {
      await redisTwoFactorLockoutStore.recordFailedAttempt('user-d');
    }
    expect(await redisTwoFactorLockoutStore.isLockedOut('user-d')).toBe(true);
  });
});

// ── Counter reset on successful verification ──────────────────────────────────
describe('TwoFactorLockoutService — reset on successful 2FA', () => {
  it('clears lockout after resetFailedAttempts (simulates successful verification)', async () => {
    for (let i = 0; i < THRESHOLD; i++) {
      await redisTwoFactorLockoutStore.recordFailedAttempt('user-e');
    }
    expect(await redisTwoFactorLockoutStore.isLockedOut('user-e')).toBe(true);

    // Successful 2FA verification resets the counter
    await redisTwoFactorLockoutStore.resetFailedAttempts('user-e');

    expect(await redisTwoFactorLockoutStore.isLockedOut('user-e')).toBe(false);
  });

  it('allows new attempts to accumulate from zero after reset', async () => {
    for (let i = 0; i < THRESHOLD; i++) {
      await redisTwoFactorLockoutStore.recordFailedAttempt('user-f');
    }
    await redisTwoFactorLockoutStore.resetFailedAttempts('user-f');

    // One new failure after reset should NOT trigger lockout
    await redisTwoFactorLockoutStore.recordFailedAttempt('user-f');
    expect(await redisTwoFactorLockoutStore.isLockedOut('user-f')).toBe(false);
  });
});

// ── Lockout expiry / cool-down window ─────────────────────────────────────────
describe('TwoFactorLockoutService — lockout duration', () => {
  it('reports remaining lockout time > 0 while locked', async () => {
    for (let i = 0; i < THRESHOLD; i++) {
      await redisTwoFactorLockoutStore.recordFailedAttempt('user-g');
    }
    const remaining = await redisTwoFactorLockoutStore.getLockoutRemainingMs('user-g');
    expect(remaining).toBeGreaterThan(0);
    // Should be within the 5-minute window
    expect(remaining).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  it('returns 0 remaining time when not locked', async () => {
    const remaining = await redisTwoFactorLockoutStore.getLockoutRemainingMs('user-h');
    expect(remaining).toBe(0);
  });

  it('simulates expiry: returns 0 remaining after lock entry is removed', async () => {
    for (let i = 0; i < THRESHOLD; i++) {
      await redisTwoFactorLockoutStore.recordFailedAttempt('user-i');
    }
    // Simulate TTL expiry by removing the locked_until key from the in-memory store
    const lockedKey = `2fa:lockout:user-i:locked_until`;
    redisData.delete(lockedKey);

    expect(await redisTwoFactorLockoutStore.isLockedOut('user-i')).toBe(false);
    expect(await redisTwoFactorLockoutStore.getLockoutRemainingMs('user-i')).toBe(0);
  });
});

// ── User isolation ────────────────────────────────────────────────────────────
describe('TwoFactorLockoutService — per-user isolation', () => {
  it('lockout for one user does not affect another', async () => {
    for (let i = 0; i < THRESHOLD; i++) {
      await redisTwoFactorLockoutStore.recordFailedAttempt('user-x');
    }
    expect(await redisTwoFactorLockoutStore.isLockedOut('user-x')).toBe(true);
    expect(await redisTwoFactorLockoutStore.isLockedOut('user-y')).toBe(false);
  });
});
