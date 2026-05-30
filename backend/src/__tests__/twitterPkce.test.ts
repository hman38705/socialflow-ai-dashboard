/**
 * #617 — TwitterService.exchangeCodeForTokens PKCE verification
 */
import crypto from 'crypto';
import nock from 'nock';

// ── env ──────────────────────────────────────────────────────────────────────
process.env.TWITTER_BEARER_TOKEN = 'test-bearer';

// ── mock ioredis ─────────────────────────────────────────────────────────────
const store = new Map<string, string>();
const mockRedis = {
  set: jest.fn(async (key: string, value: string) => { store.set(key, value); return 'OK'; }),
  getdel: jest.fn(async (key: string) => {
    const v = store.get(key) ?? null;
    store.delete(key);
    return v;
  }),
};
jest.mock('ioredis', () => jest.fn(() => mockRedis));

// ── mock config/runtime ───────────────────────────────────────────────────────
jest.mock('../config/runtime', () => ({ getRedisConnection: () => ({}) }));

// ── mock CircuitBreakerService & LockService ──────────────────────────────────
jest.mock('../services/CircuitBreakerService', () => ({
  circuitBreakerService: {
    execute: jest.fn(async (_n: string, fn: () => any) => fn()),
    getStats: jest.fn(() => ({})),
  },
}));
jest.mock('../utils/LockService', () => ({
  LockService: { withLock: jest.fn((_k: string, fn: () => any) => fn()) },
}));

import { twitterService } from '../services/TwitterService';

const CLIENT_ID = 'client-123';
const REDIRECT_URI = 'https://app.example.com/callback';
const USER_ID = 'user-test-1';

function makeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

beforeAll(() => nock.disableNetConnect());
afterAll(() => nock.enableNetConnect());
afterEach(() => { nock.cleanAll(); store.clear(); jest.clearAllMocks(); });

describe('TwitterService.exchangeCodeForTokens — PKCE verification', () => {
  it('succeeds when code_verifier matches stored challenge', async () => {
    const verifier = 'a'.repeat(43);
    const challenge = makeChallenge(verifier);
    const state = 'state-abc';

    await twitterService.storePkceChallenge(state, challenge, USER_ID);

    nock('https://api.twitter.com')
      .post('/2/oauth2/token')
      .reply(200, { access_token: 'at', refresh_token: 'rt', expires_in: 7200 });

    const tokens = await twitterService.exchangeCodeForTokens(
      'auth-code', state, verifier, CLIENT_ID, REDIRECT_URI, USER_ID,
    );

    expect(tokens.accessToken).toBe('at');
    expect(tokens.refreshToken).toBe('rt');
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  });

  it('throws when code_verifier does not match stored challenge', async () => {
    const state = 'state-xyz';
    await twitterService.storePkceChallenge(state, makeChallenge('correct-verifier-padded-here'), USER_ID);

    await expect(
      twitterService.exchangeCodeForTokens(
        'auth-code', state, 'wrong-verifier-padded-here!!', CLIENT_ID, REDIRECT_URI, USER_ID,
      ),
    ).rejects.toThrow('PKCE verification failed');
  });

  it('throws when no challenge is stored for the given state', async () => {
    await expect(
      twitterService.exchangeCodeForTokens(
        'auth-code', 'unknown-state', 'any-verifier', CLIENT_ID, REDIRECT_URI, USER_ID,
      ),
    ).rejects.toThrow('PKCE challenge not found or expired');
  });

  it('consumes the challenge (one-time use)', async () => {
    const verifier = 'b'.repeat(43);
    const state = 'state-once';
    await twitterService.storePkceChallenge(state, makeChallenge(verifier), USER_ID);

    nock('https://api.twitter.com')
      .post('/2/oauth2/token')
      .reply(200, { access_token: 'at2', refresh_token: 'rt2', expires_in: 3600 });

    await twitterService.exchangeCodeForTokens('code', state, verifier, CLIENT_ID, REDIRECT_URI, USER_ID);

    // Second attempt with same state must fail
    await expect(
      twitterService.exchangeCodeForTokens('code', state, verifier, CLIENT_ID, REDIRECT_URI, USER_ID),
    ).rejects.toThrow('PKCE challenge not found or expired');
  });
});
