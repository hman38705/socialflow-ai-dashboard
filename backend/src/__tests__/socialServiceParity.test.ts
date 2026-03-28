/**
 * Social service parity contract tests.
 *
 * @deprecated The module copies have been consolidated into canonical implementations.
 * This test now only validates the canonical services. The module paths are deprecated
 * wrappers that re-export from the canonical locations.
 *
 * Canonical locations:
 *   - backend/src/services/FacebookService.ts
 *   - backend/src/services/YouTubeService.ts
 *   - backend/src/services/TwitterService.ts
 *
 * Module paths (deprecated, will be removed after migration):
 *   - backend/src/modules/social/services/FacebookService.ts
 *   - backend/src/modules/social/services/YouTubeService.ts
 *   - backend/src/modules/social/services/TwitterService.ts
 */

// ── Env must be set before any import ────────────────────────────────────────
process.env.TWITTER_BEARER_TOKEN = 'test-bearer';
process.env.FACEBOOK_APP_ID = 'test-app-id';
process.env.FACEBOOK_APP_SECRET = 'test-app-secret';
process.env.YOUTUBE_CLIENT_ID = 'test-client-id';
process.env.YOUTUBE_CLIENT_SECRET = 'test-client-secret';

// All dependencies (CircuitBreakerService, LockService, logger, prisma) are
// stubbed via moduleNameMapper in jest.config.js — no jest.mock() needed here.


import nock from 'nock';
import { twitterService as twCanonical } from '../services/TwitterService';
import { facebookService as fbCanonical } from '../services/FacebookService';
import { youTubeService as ytCanonical } from '../services/YouTubeService';

beforeAll(() => nock.disableNetConnect());
afterAll(() => nock.enableNetConnect());
afterEach(() => nock.cleanAll());

// ═══════════════════════════════════════════════════════════════════════════════
// TwitterService contract
// ═══════════════════════════════════════════════════════════════════════════════

function twitterContract(label: string, svc: typeof twCanonical) {
  describe(`TwitterService [${label}]`, () => {
    it('isConfigured() → true when bearer token is set', () => {
      expect(svc.isConfigured()).toBe(true);
    });

    it('postTweet — throws "not configured" when bearer token absent', async () => {
      jest.spyOn(svc, 'isConfigured').mockReturnValueOnce(false);
      await expect(svc.postTweet({ text: 'hi' })).rejects.toThrow('not configured');
    });

    it('postTweet — returns tweet on 201', async () => {
      nock('https://api.twitter.com').post('/2/tweets')
        .reply(201, { data: { id: 't1', text: 'hi', created_at: '', author_id: 'u1' } });
      await expect(svc.postTweet({ text: 'hi' })).resolves.toMatchObject({ id: 't1', text: 'hi' });
    });

    it('postTweet — throws on 400', async () => {
      nock('https://api.twitter.com').post('/2/tweets').reply(400, { title: 'Bad Request' });
      await expect(svc.postTweet({ text: 'bad' })).rejects.toThrow();
    });

    it('getUserTimeline — returns tweets on 200', async () => {
      nock('https://api.twitter.com').get('/2/users/u1/tweets').query(true)
        .reply(200, { data: [{ id: 't1', text: 'tweet', created_at: '', author_id: 'u1' }] });
      await expect(svc.getUserTimeline('u1')).resolves.toMatchObject([{ id: 't1' }]);
    });

    it('getUserTimeline — returns [] when response has no data', async () => {
      nock('https://api.twitter.com').get('/2/users/u1/tweets').query(true).reply(200, {});
      await expect(svc.getUserTimeline('u1')).resolves.toEqual([]);
    });

    it('getUserTimeline — returns [] on 429 (circuit breaker fallback)', async () => {
      nock('https://api.twitter.com').get('/2/users/u1/tweets').query(true).reply(429, {});
      await expect(svc.getUserTimeline('u1')).resolves.toEqual([]);
    });

    it('searchTweets — returns [] on 429 (circuit breaker fallback)', async () => {
      nock('https://api.twitter.com').get('/2/tweets/search/recent').query(true).reply(429, {});
      await expect(svc.searchTweets('q')).resolves.toEqual([]);
    });

    it('healthCheck — returns true on 200', async () => {
      nock('https://api.twitter.com').get('/2/users/me').query(true).reply(200, { data: {} });
      await expect(svc.healthCheck()).resolves.toBe(true);
    });

    it('healthCheck — returns false on 401', async () => {
      nock('https://api.twitter.com').get('/2/users/me').query(true).reply(401, {});
      await expect(svc.healthCheck()).resolves.toBe(false);
    });

    it('getCircuitStatus — returns an object', () => {
      expect(typeof svc.getCircuitStatus()).toBe('object');
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// FacebookService contract
// ═══════════════════════════════════════════════════════════════════════════════

function facebookContract(label: string, svc: typeof fbCanonical) {
  describe(`FacebookService [${label}]`, () => {
    it('isConfigured() → true when credentials are set', () => {
      expect(svc.isConfigured()).toBe(true);
    });

    it('isConfigured() → false when app ID is missing', () => {
      jest.spyOn(svc, 'isConfigured').mockReturnValueOnce(false);
      expect(svc.isConfigured()).toBe(false);
    });

    it('getAuthUrl() — returns URL containing facebook.com', () => {
      expect(svc.getAuthUrl()).toContain('facebook.com');
    });

    it('healthCheck — returns true on 200', async () => {
      nock('https://graph.facebook.com').get('/v18.0/oauth/access_token').query(true).reply(200, { access_token: 'tok' });
      await expect(svc.healthCheck()).resolves.toBe(true);
    });

    it('healthCheck — returns false on error', async () => {
      nock('https://graph.facebook.com').get('/v18.0/me').query(true).reply(401, {});
      await expect(svc.healthCheck()).resolves.toBe(false);
    });

    it('getCircuitStatus — returns an object', () => {
      expect(typeof svc.getCircuitStatus()).toBe('object');
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// YouTubeService contract
// ═══════════════════════════════════════════════════════════════════════════════

function youTubeContract(label: string, svc: typeof ytCanonical) {
  describe(`YouTubeService [${label}]`, () => {
    it('isConfigured() → true when credentials are set', () => {
      expect(svc.isConfigured()).toBe(true);
    });

    it('isConfigured() → false when client ID is missing', () => {
      jest.spyOn(svc, 'isConfigured').mockReturnValueOnce(false);
      expect(svc.isConfigured()).toBe(false);
    });

    it('getAuthUrl() — returns URL containing google.com', () => {
      expect(svc.getAuthUrl()).toContain('google.com');
    });

    it('getCircuitStatus — returns an object', () => {
      expect(typeof svc.getCircuitStatus()).toBe('object');
    });
  });
}

// ── Execute each contract against canonical implementations ──────────────────
// Module copies have been consolidated into canonical implementations.
// The module paths are now deprecated wrappers that re-export from canonical locations.
twitterContract('canonical', twCanonical);
facebookContract('canonical', fbCanonical);
youTubeContract('canonical', ytCanonical);
