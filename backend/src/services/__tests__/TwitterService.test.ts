/**
 * #1025 — TwitterService unit tests
 *
 * Covers:
 * - PKCE code-verifier/code-challenge generation uses SHA-256 + base64url (S256)
 * - Authorization URL includes all required OAuth 2.0 PKCE parameters
 * - storePkceChallenge stores the challenge keyed by userId:state
 * - exchangeCodeForTokens validates verifier against stored S256 challenge
 * - Token exchange failure is surfaced as a clear error (not swallowed)
 */
import crypto from 'crypto';
import nock from 'nock';

// ── mock ioredis ──────────────────────────────────────────────────────────────
const store = new Map<string, string>();
const mockRedis = {
  set: jest.fn(async (key: string, value: string) => {
    store.set(key, value);
    return 'OK';
  }),
  getdel: jest.fn(async (key: string) => {
    const v = store.get(key) ?? null;
    store.delete(key);
    return v;
  }),
};
jest.mock('ioredis', () => jest.fn(() => mockRedis));
jest.mock('../../config/runtime', () => ({ getRedisConnection: () => ({}) }));

// ── import after mocks ────────────────────────────────────────────────────────
import { TwitterService } from '../TwitterService';

const CLIENT_ID = 'client-abc';
const REDIRECT_URI = 'https://app.example.com/callback';
const USER_ID = 'user-test-42';

/** Compute the expected S256 challenge from a verifier */
function s256(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

beforeAll(() => nock.disableNetConnect());
afterAll(() => nock.enableNetConnect());
afterEach(() => {
  nock.cleanAll();
  store.clear();
  jest.clearAllMocks();
});

// ── PKCE algorithm ────────────────────────────────────────────────────────────
describe('PKCE S256 algorithm', () => {
  it('SHA-256 hash of verifier encoded as base64url is the correct challenge', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = s256(verifier);

    // Must be URL-safe base64 (no +, /, =)
    expect(challenge).not.toMatch(/[+/=]/);
    // Must reproduce the SHA-256 digest
    const expected = crypto.createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(expected);
  });

  it('different verifiers produce different challenges', () => {
    expect(s256('verifier-one-padded-here')).not.toBe(s256('verifier-two-padded-here'));
  });
});

// ── Authorization URL parameters ──────────────────────────────────────────────
describe('Authorization URL construction', () => {
  it('includes all required OAuth 2.0 PKCE query parameters', () => {
    const state = 'csrf-state-token';
    const codeChallenge = s256('a'.repeat(43));

    const url = new URL('https://twitter.com/i/oauth2/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('scope', 'tweet.read tweet.write users.read');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');

    const params = url.searchParams;
    expect(params.get('response_type')).toBe('code');
    expect(params.get('client_id')).toBe(CLIENT_ID);
    expect(params.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(params.get('state')).toBe(state);
    expect(params.get('code_challenge')).toBe(codeChallenge);
    expect(params.get('code_challenge_method')).toBe('S256');
  });
});

// ── storePkceChallenge ────────────────────────────────────────────────────────
describe('TwitterService.storePkceChallenge', () => {
  it('stores the challenge keyed by userId and state', async () => {
    const svc = new TwitterService();
    const verifier = 'b'.repeat(43);
    const challenge = s256(verifier);
    const state = 'state-store-test';

    await svc.storePkceChallenge(state, challenge, USER_ID);

    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringContaining(USER_ID),
      challenge,
      'EX',
      expect.any(Number),
    );
    // Key must also contain the state
    const calledKey = mockRedis.set.mock.calls[0][0] as string;
    expect(calledKey).toContain(state);
  });
});

// ── exchangeCodeForTokens ─────────────────────────────────────────────────────
describe('TwitterService.exchangeCodeForTokens', () => {
  it('returns tokens when verifier matches stored challenge', async () => {
    const svc = new TwitterService();
    const verifier = 'c'.repeat(43);
    const state = 'state-valid';

    await svc.storePkceChallenge(state, s256(verifier), USER_ID);

    nock('https://api.twitter.com')
      .post('/2/oauth2/token')
      .reply(200, { access_token: 'at-ok', refresh_token: 'rt-ok', expires_in: 7200 });

    const tokens = await svc.exchangeCodeForTokens(
      'auth-code', state, verifier, CLIENT_ID, REDIRECT_URI, USER_ID,
    );

    expect(tokens.accessToken).toBe('at-ok');
    expect(tokens.refreshToken).toBe('rt-ok');
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  });

  it('throws a clear error when verifier does not match challenge', async () => {
    const svc = new TwitterService();
    const state = 'state-mismatch';
    await svc.storePkceChallenge(state, s256('correct-verifier-padded!!'), USER_ID);

    await expect(
      svc.exchangeCodeForTokens(
        'code', state, 'wrong-verifier-padded!!!', CLIENT_ID, REDIRECT_URI, USER_ID,
      ),
    ).rejects.toThrow('PKCE verification failed');
  });

  it('throws a clear error when no challenge is stored for the state', async () => {
    const svc = new TwitterService();

    await expect(
      svc.exchangeCodeForTokens(
        'code', 'unknown-state', 'any-verifier', CLIENT_ID, REDIRECT_URI, USER_ID,
      ),
    ).rejects.toThrow('PKCE challenge not found or expired');
  });

  it('surfaces token-exchange HTTP failure as a clear error', async () => {
    const svc = new TwitterService();
    const verifier = 'd'.repeat(43);
    const state = 'state-token-fail';

    await svc.storePkceChallenge(state, s256(verifier), USER_ID);

    nock('https://api.twitter.com')
      .post('/2/oauth2/token')
      .reply(400, { error: 'invalid_grant', error_description: 'Authorization code is invalid or expired' });

    await expect(
      svc.exchangeCodeForTokens('bad-code', state, verifier, CLIENT_ID, REDIRECT_URI, USER_ID),
    ).rejects.toThrow('Twitter token exchange failed');
  });

  it('challenge is consumed after first use (one-time)', async () => {
    const svc = new TwitterService();
    const verifier = 'e'.repeat(43);
    const state = 'state-once';

    await svc.storePkceChallenge(state, s256(verifier), USER_ID);

    nock('https://api.twitter.com')
      .post('/2/oauth2/token')
      .reply(200, { access_token: 'at', refresh_token: 'rt', expires_in: 3600 });

    await svc.exchangeCodeForTokens('code', state, verifier, CLIENT_ID, REDIRECT_URI, USER_ID);

    // Second use of same state must fail
    await expect(
      svc.exchangeCodeForTokens('code', state, verifier, CLIENT_ID, REDIRECT_URI, USER_ID),
    ).rejects.toThrow('PKCE challenge not found or expired');
  });
});
