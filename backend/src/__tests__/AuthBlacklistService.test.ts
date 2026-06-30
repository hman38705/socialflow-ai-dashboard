/**
 * Unit tests for AuthBlacklistService
 *
 * Covers:
 *  - blacklistToken: normal path, already-expired token, Redis error fallback
 *  - isBlacklisted: token found in Redis, not found, Redis error → LRU fallback
 *  - keyFromPayload: prefers jti, falls back to sub:iat
 *  - accessTokenTTL: default (15 min) and custom JWT_EXPIRES_IN values
 *  - LRU eviction when the in-memory cache reaches its capacity
 */

// ─── Mock the Redis singleton BEFORE the module under test is imported ────────
const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();

jest.mock('../lib/redis', () => ({
  redis: {
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  },
}));

jest.mock('../lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// ─── Import AFTER mocks are in place ─────────────────────────────────────────
import { AuthBlacklistService } from '../services/AuthBlacklistService';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const BLACKLIST_PREFIX = 'jwt:blacklist:';

beforeEach(() => {
  jest.clearAllMocks();
  // Default: Redis is healthy and returns null (token not blacklisted)
  mockRedisGet.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue('OK');
});

// ─────────────────────────────────────────────────────────────────────────────
// blacklistToken
// ─────────────────────────────────────────────────────────────────────────────
describe('AuthBlacklistService.blacklistToken', () => {
  it('writes the token to Redis with the correct key and TTL', async () => {
    await AuthBlacklistService.blacklistToken('token-abc', 900);

    expect(mockRedisSet).toHaveBeenCalledWith(
      `${BLACKLIST_PREFIX}token-abc`,
      '1',
      'EX',
      900,
    );
  });

  it('does NOT write to Redis when ttlSeconds is 0 (already expired)', async () => {
    await AuthBlacklistService.blacklistToken('expired-token', 0);

    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('does NOT write to Redis when ttlSeconds is negative', async () => {
    await AuthBlacklistService.blacklistToken('negative-ttl', -1);

    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('resolves without throwing when Redis set fails', async () => {
    mockRedisSet.mockRejectedValue(new Error('Redis connection refused'));

    await expect(
      AuthBlacklistService.blacklistToken('token-redis-down', 300),
    ).resolves.toBeUndefined();
  });

  it('populates the LRU cache so isBlacklisted works offline after a Redis write failure', async () => {
    mockRedisSet.mockRejectedValue(new Error('Redis down'));
    mockRedisGet.mockRejectedValue(new Error('Redis down'));

    await AuthBlacklistService.blacklistToken('lru-fallback-token', 60);

    // Even though Redis is down, the LRU cache should have been populated
    const result = await AuthBlacklistService.isBlacklisted('lru-fallback-token');
    expect(result).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isBlacklisted
// ─────────────────────────────────────────────────────────────────────────────
describe('AuthBlacklistService.isBlacklisted', () => {
  it('returns true when Redis contains the blacklisted token key', async () => {
    mockRedisGet.mockResolvedValue('1');

    const result = await AuthBlacklistService.isBlacklisted('blacklisted-token');

    expect(result).toBe(true);
    expect(mockRedisGet).toHaveBeenCalledWith(`${BLACKLIST_PREFIX}blacklisted-token`);
  });

  it('returns false when the token is not in Redis', async () => {
    mockRedisGet.mockResolvedValue(null);

    const result = await AuthBlacklistService.isBlacklisted('clean-token');

    expect(result).toBe(false);
  });

  it('returns false on a token that was never blacklisted (Redis healthy)', async () => {
    const result = await AuthBlacklistService.isBlacklisted('random-token-xyz');

    expect(result).toBe(false);
  });

  it('falls back to LRU cache and returns true when Redis throws', async () => {
    // First blacklist the token while Redis is healthy
    await AuthBlacklistService.blacklistToken('lru-check-token', 60);

    // Now simulate Redis going down
    mockRedisGet.mockRejectedValue(new Error('Redis timeout'));

    const result = await AuthBlacklistService.isBlacklisted('lru-check-token');

    expect(result).toBe(true);
  });

  it('falls back to LRU cache and returns false for clean token when Redis throws', async () => {
    mockRedisGet.mockRejectedValue(new Error('Redis timeout'));

    const result = await AuthBlacklistService.isBlacklisted('never-blacklisted-token');

    expect(result).toBe(false);
  });

  it('does not block valid tokens when Redis is unavailable and token is not in LRU', async () => {
    mockRedisGet.mockRejectedValue(new Error('Redis unavailable'));

    // This token was never added to the LRU cache
    const result = await AuthBlacklistService.isBlacklisted('valid-token-no-lru');

    expect(result).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// keyFromPayload
// ─────────────────────────────────────────────────────────────────────────────
describe('AuthBlacklistService.keyFromPayload', () => {
  it('returns jti when present', () => {
    const key = AuthBlacklistService.keyFromPayload({
      jti: 'unique-jti-123',
      sub: 'user-1',
      iat: 1700000000,
    });

    expect(key).toBe('unique-jti-123');
  });

  it('returns "sub:iat" when jti is absent', () => {
    const key = AuthBlacklistService.keyFromPayload({
      sub: 'user-42',
      iat: 1700000000,
    });

    expect(key).toBe('user-42:1700000000');
  });

  it('uses "unknown" for sub when sub is absent', () => {
    const key = AuthBlacklistService.keyFromPayload({ iat: 1700000000 });

    expect(key).toBe('unknown:1700000000');
  });

  it('uses 0 for iat when iat is absent', () => {
    const key = AuthBlacklistService.keyFromPayload({ sub: 'user-7' });

    expect(key).toBe('user-7:0');
  });

  it('returns "unknown:0" when payload is completely empty', () => {
    const key = AuthBlacklistService.keyFromPayload({});

    expect(key).toBe('unknown:0');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// accessTokenTTL
// ─────────────────────────────────────────────────────────────────────────────
describe('AuthBlacklistService.accessTokenTTL', () => {
  const ORIGINAL_JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN;

  afterEach(() => {
    // Restore the env var after each test
    if (ORIGINAL_JWT_EXPIRES_IN === undefined) {
      delete process.env.JWT_EXPIRES_IN;
    } else {
      process.env.JWT_EXPIRES_IN = ORIGINAL_JWT_EXPIRES_IN;
    }
  });

  it('returns 900 (15 min) when JWT_EXPIRES_IN is not set', () => {
    delete process.env.JWT_EXPIRES_IN;

    expect(AuthBlacklistService.accessTokenTTL()).toBe(900);
  });

  it('parses "15m" correctly', () => {
    process.env.JWT_EXPIRES_IN = '15m';

    expect(AuthBlacklistService.accessTokenTTL()).toBe(900);
  });

  it('parses "1h" correctly', () => {
    process.env.JWT_EXPIRES_IN = '1h';

    expect(AuthBlacklistService.accessTokenTTL()).toBe(3600);
  });

  it('parses "7d" correctly', () => {
    process.env.JWT_EXPIRES_IN = '7d';

    expect(AuthBlacklistService.accessTokenTTL()).toBe(604800);
  });

  it('parses "30s" correctly', () => {
    process.env.JWT_EXPIRES_IN = '30s';

    expect(AuthBlacklistService.accessTokenTTL()).toBe(30);
  });

  it('falls back to 900 for an unrecognised format', () => {
    process.env.JWT_EXPIRES_IN = 'invalid-value';

    expect(AuthBlacklistService.accessTokenTTL()).toBe(900);
  });

  it('falls back to 900 for an empty string', () => {
    process.env.JWT_EXPIRES_IN = '';

    expect(AuthBlacklistService.accessTokenTTL()).toBe(900);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LRU eviction behaviour
// ─────────────────────────────────────────────────────────────────────────────
describe('LRU cache eviction', () => {
  it('evicts the oldest entry when the cache reaches LRU_MAX (1000) capacity', async () => {
    // Fill the LRU to its maximum by blacklisting 1000 tokens
    for (let i = 0; i < 1000; i++) {
      await AuthBlacklistService.blacklistToken(`eviction-token-${i}`, 3600);
    }

    // Adding one more should evict the first entry ("eviction-token-0")
    await AuthBlacklistService.blacklistToken('eviction-overflow-token', 3600);

    // Simulate Redis being down so the LRU cache is the only source of truth
    mockRedisGet.mockRejectedValue(new Error('Redis down'));

    // The evicted token should no longer be in the LRU cache
    const evictedResult = await AuthBlacklistService.isBlacklisted('eviction-token-0');
    expect(evictedResult).toBe(false);

    // The overflow token should still be in the LRU cache
    const overflowResult = await AuthBlacklistService.isBlacklisted('eviction-overflow-token');
    expect(overflowResult).toBe(true);
  });
});
