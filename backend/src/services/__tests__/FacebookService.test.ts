/**
 * #1090 — Unit tests for FacebookService: OAuth token exchange, page-scoped
 * post publishing, media upload, paged Graph API traversal, and the circuit
 * breaker wrapping outbound calls.
 *
 * Outbound HTTP is intercepted with `nock` (the existing convention used by
 * every other *Service.test.ts in this repo for the native `fetch` client) —
 * no real network calls are made.
 *
 * Known gaps discovered while writing these tests (not fixed here, scope is
 * tests-only):
 *  - `getUserPages()` does not paginate via an `after` cursor; it returns
 *    only the first page from `data.data`. The issue's acceptance criteria
 *    describe cursor pagination that doesn't exist in the current
 *    implementation.
 *  - `postToPage()` always throws via the `getPageAccessTokenForPost`
 *    placeholder ("Page access token not found...") — it has never had a
 *    real page-token lookup wired in. Should be filed as a follow-up bug;
 *    `postToPageWithUserToken()` is the functional equivalent used today.
 */
import nock from 'nock';

const mockExecute = jest.fn<unknown, [string, () => unknown, (() => unknown)?]>(
  (_name, fn) => fn(),
);

jest.mock('../CircuitBreakerService', () => ({
  circuitBreakerService: {
    execute: mockExecute,
    getStats: jest.fn(() => ({ state: 'closed' })),
  },
}));

jest.mock('../../utils/LockService', () => ({
  LockService: { withLock: jest.fn((_k: string, fn: () => any) => fn()) },
}));

jest.mock('../../lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { facebookService, AuthRefreshError } from '../FacebookService';

const GRAPH = 'https://graph.facebook.com';

describe('FacebookService', () => {
  beforeAll(() => nock.disableNetConnect());
  afterAll(() => nock.enableNetConnect());
  afterEach(() => {
    nock.cleanAll();
    jest.clearAllMocks();
    mockExecute.mockImplementation((_name: string, fn: () => unknown) => fn());
  });

  // ── OAuth token exchange ───────────────────────────────────────────────

  describe('exchangeCode', () => {
    it('exchanges an auth code for a user access token', async () => {
      nock(GRAPH)
        .get('/v18.0/oauth/access_token')
        .query(true)
        .reply(200, { access_token: 'short-lived-token', expires_in: 3600 });

      const result = await facebookService.exchangeCode('auth-code-123');

      expect(result.userAccessToken).toBe('short-lived-token');
      expect(result.expiresAt).toBeGreaterThan(Date.now());
    });

    it('throws when the token exchange request fails', async () => {
      nock(GRAPH)
        .get('/v18.0/oauth/access_token')
        .query(true)
        .reply(400, { error: { message: 'Invalid authorization code' } });

      await expect(facebookService.exchangeCode('bad-code')).rejects.toThrow(
        /Facebook OAuth token exchange failed/,
      );
    });
  });

  // ── Long-lived token exchange ──────────────────────────────────────────

  describe('getLongLivedUserToken', () => {
    it('exchanges a short-lived token for a long-lived one', async () => {
      nock(GRAPH)
        .get('/v18.0/oauth/access_token')
        .query(true)
        .reply(200, { access_token: 'long-lived-token', expires_in: 5_184_000 });

      const result = await facebookService.getLongLivedUserToken('short-lived-token');

      expect(result.accessToken).toBe('long-lived-token');
      expect(result.expiresAt).toBeGreaterThan(Date.now());
    });

    it('throws when the long-lived exchange fails', async () => {
      nock(GRAPH)
        .get('/v18.0/oauth/access_token')
        .query(true)
        .reply(400, { error: { message: 'Invalid token' } });

      await expect(facebookService.getLongLivedUserToken('bad-token')).rejects.toThrow(
        /Facebook long-lived token exchange failed/,
      );
    });
  });

  // ── getUserPages (page listing) ────────────────────────────────────────

  describe('getUserPages', () => {
    it('fetches managed pages successfully', async () => {
      const response = {
        data: [
          { id: 'page-1', name: 'Test Page', access_token: 'page-token-1', category: 'Business' },
        ],
      };

      nock(GRAPH).get('/v18.0/me/accounts').query(true).reply(200, response);

      const pages = await facebookService.getUserPages('user-token');

      expect(pages).toEqual(response.data);
      expect(mockExecute).toHaveBeenCalledWith('facebook', expect.any(Function), expect.any(Function));
    });

    it('throws when Facebook page fetch returns 401', async () => {
      nock(GRAPH)
        .get('/v18.0/me/accounts')
        .query(true)
        .reply(401, { error: { message: 'Invalid OAuth access token.' } });

      await expect(facebookService.getUserPages('bad-token')).rejects.toThrow(
        /Failed to fetch Facebook pages/,
      );
    });

    it('rejects via the circuit-breaker fallback when the breaker is open', async () => {
      mockExecute.mockImplementationOnce((_name: string, _fn: () => unknown, fallback?: () => unknown) =>
        fallback!(),
      );

      await expect(facebookService.getUserPages('user-token')).rejects.toThrow(
        /Facebook API temporarily unavailable/,
      );
    });
  });

  // ── getPageAccessToken ──────────────────────────────────────────────────

  describe('getPageAccessToken', () => {
    it('fetches a page access token', async () => {
      nock(GRAPH).get('/v18.0/1234').query(true).reply(200, { access_token: 'page-token' });

      const token = await facebookService.getPageAccessToken('user-token', '1234');

      expect(token).toBe('page-token');
    });

    it('throws when the page token lookup fails', async () => {
      nock(GRAPH).get('/v18.0/1234').query(true).reply(404, { error: { message: 'Not found' } });

      await expect(facebookService.getPageAccessToken('user-token', '1234')).rejects.toThrow(
        /Failed to fetch page access token/,
      );
    });
  });

  // ── postToPage (page-token publishing — known broken placeholder) ──────

  describe('postToPage', () => {
    it('throws because the page-token lookup is an unimplemented placeholder', async () => {
      await expect(
        facebookService.postToPage({ pageId: '1234', message: 'Hello' }),
      ).rejects.toThrow(/Page access token not found/);
    });
  });

  // ── postToPageWithUserToken (publishPost equivalent) ────────────────────

  describe('postToPageWithUserToken', () => {
    it('posts text-only content to a page', async () => {
      const svc = facebookService as any;
      svc.getPageAccessToken = jest.fn().mockResolvedValue('page-token');
      svc.getPostPermalink = jest.fn().mockResolvedValue('https://facebook.com/post/123');

      nock(GRAPH).post('/v18.0/1234/feed').query(true).reply(200, { id: 'post-123' });

      const result = await facebookService.postToPageWithUserToken('user-token', {
        pageId: '1234',
        message: 'Hello Facebook!',
      });

      expect(result.id).toBe('post-123');
      expect(result.permalink_url).toBe('https://facebook.com/post/123');
      expect(svc.getPageAccessToken).toHaveBeenCalledWith('user-token', '1234');
    });

    it('posts media content via the /photos endpoint when imageUrl is set', async () => {
      const svc = facebookService as any;
      svc.getPageAccessToken = jest.fn().mockResolvedValue('page-token');
      svc.getPostPermalink = jest.fn().mockResolvedValue(undefined);

      const scope = nock(GRAPH)
        .post('/v18.0/1234/photos', (body) => body.includes('url=') && body.includes('message='))
        .query(true)
        .reply(200, { id: 'media-post-1' });

      const result = await facebookService.postToPageWithUserToken('user-token', {
        pageId: '1234',
        message: 'Check out this photo',
        imageUrl: 'https://example.com/photo.jpg',
      });

      expect(result.id).toBe('media-post-1');
      expect(scope.isDone()).toBe(true);
    });

    it('sets published=false and scheduled_publish_time for scheduled posts', async () => {
      const svc = facebookService as any;
      svc.getPageAccessToken = jest.fn().mockResolvedValue('page-token');
      svc.getPostPermalink = jest.fn().mockResolvedValue(undefined);

      const scheduledTime = new Date(Date.now() + 60 * 60 * 1000);
      const expectedEpoch = String(Math.floor(scheduledTime.getTime() / 1000));

      const scope = nock(GRAPH)
        .post(
          '/v18.0/1234/feed',
          (body) => body.includes('published=false') && body.includes(`scheduled_publish_time=${expectedEpoch}`),
        )
        .query(true)
        .reply(200, { id: 'scheduled-post-1' });

      const result = await facebookService.postToPageWithUserToken('user-token', {
        pageId: '1234',
        message: 'Scheduled post',
        scheduledTime,
      });

      expect(result.id).toBe('scheduled-post-1');
      expect(scope.isDone()).toBe(true);
    });

    it('throws when the Graph API post request fails', async () => {
      const svc = facebookService as any;
      svc.getPageAccessToken = jest.fn().mockResolvedValue('page-token');

      nock(GRAPH)
        .post('/v18.0/1234/feed')
        .query(true)
        .reply(500, { error: { message: 'Internal error' } });

      await expect(
        facebookService.postToPageWithUserToken('user-token', { pageId: '1234', message: 'Hi' }),
      ).rejects.toThrow(/Failed to post to Facebook page/);
    });

    it('rejects via the circuit-breaker fallback when the breaker is open', async () => {
      mockExecute.mockImplementationOnce((_name: string, _fn: () => unknown, fallback?: () => unknown) =>
        fallback!(),
      );

      await expect(
        facebookService.postToPageWithUserToken('user-token', { pageId: '1234', message: 'Hi' }),
      ).rejects.toThrow(/Facebook API temporarily unavailable/);
    });
  });

  // ── getPostComments (getComments equivalent) ────────────────────────────

  describe('getPostComments', () => {
    it('fetches comments for a post', async () => {
      const comments = [
        { id: 'c1', message: 'Nice!', from: { id: 'u1', name: 'Alice' }, created_time: '2024-01-01T00:00:00Z' },
        { id: 'c2', message: 'Great post', from: { id: 'u2', name: 'Bob' }, created_time: '2024-01-02T00:00:00Z' },
      ];
      nock(GRAPH).get('/v18.0/post-123/comments').query(true).reply(200, { data: comments });

      const result = await facebookService.getPostComments('1234', 'post-123', 'page-token');

      expect(result).toEqual(comments);
    });

    it('throws on Facebook rate limit when fetching comments', async () => {
      nock(GRAPH)
        .get('/v18.0/post-123/comments')
        .query(true)
        .reply(429, { error: { message: 'Too many requests' } });

      await expect(
        facebookService.getPostComments('1234', 'post-123', 'page-token'),
      ).rejects.toThrow(/Failed to fetch comments/);
    });

    it('degrades gracefully when the circuit breaker is open', async () => {
      mockExecute.mockImplementationOnce((_name: string, _fn: () => unknown, fallback?: () => unknown) =>
        fallback!(),
      );

      const result: any = await facebookService.getPostComments('1234', 'post-123', 'page-token');

      expect(result.data).toEqual([]);
      expect(result.degraded).toBe(true);
    });
  });

  // ── replyToComment ───────────────────────────────────────────────────────

  describe('replyToComment', () => {
    it('posts a reply to a comment', async () => {
      nock(GRAPH).post('/v18.0/comment-1/comments').query(true).reply(200, { id: 'reply-1' });

      const result = await facebookService.replyToComment('1234', 'comment-1', 'Thanks!', 'page-token');

      expect(result.id).toBe('reply-1');
    });

    it('throws when the reply request fails', async () => {
      nock(GRAPH)
        .post('/v18.0/comment-1/comments')
        .query(true)
        .reply(500, { error: { message: 'Internal error' } });

      await expect(
        facebookService.replyToComment('1234', 'comment-1', 'Thanks!', 'page-token'),
      ).rejects.toThrow(/Failed to reply to comment/);
    });
  });

  // ── deleteComment ────────────────────────────────────────────────────────

  describe('deleteComment', () => {
    it('returns true when the comment is deleted', async () => {
      nock(GRAPH).delete('/v18.0/comment-1').query(true).reply(200, { success: true });

      const result = await facebookService.deleteComment('comment-1', 'page-token');

      expect(result).toBe(true);
    });

    it('returns false when the delete request fails', async () => {
      nock(GRAPH).delete('/v18.0/comment-1').query(true).reply(403);

      const result = await facebookService.deleteComment('comment-1', 'page-token');

      expect(result).toBe(false);
    });
  });

  // ── getPageInsights ──────────────────────────────────────────────────────

  describe('getPageInsights', () => {
    it('fetches page insights', async () => {
      const insights = { data: [{ name: 'page_impressions', values: [{ value: 100 }] }] };
      nock(GRAPH).get('/v18.0/page-1/insights').query(true).reply(200, insights);

      const result = await facebookService.getPageInsights('page-1', 'page-token');

      expect(result).toEqual(insights);
    });

    it('throws when the insights request fails', async () => {
      nock(GRAPH)
        .get('/v18.0/page-1/insights')
        .query(true)
        .reply(400, { error: { message: 'Bad request' } });

      await expect(facebookService.getPageInsights('page-1', 'page-token')).rejects.toThrow(
        /Failed to fetch page insights/,
      );
    });

    it('degrades gracefully when the circuit breaker is open', async () => {
      mockExecute.mockImplementationOnce((_name: string, _fn: () => unknown, fallback?: () => unknown) =>
        fallback!(),
      );

      const result: any = await facebookService.getPageInsights('page-1', 'page-token');

      expect(result.data.data).toEqual([]);
      expect(result.data.degraded).toBe(true);
    });
  });

  // ── healthCheck ──────────────────────────────────────────────────────────

  describe('healthCheck', () => {
    it('returns false when the service is not configured', async () => {
      jest.spyOn(facebookService, 'isConfigured').mockReturnValueOnce(false);

      const result = await facebookService.healthCheck();

      expect(result).toBe(false);
    });

    it('returns false when the health-check request throws', async () => {
      jest.spyOn(facebookService, 'isConfigured').mockReturnValueOnce(true);
      nock(GRAPH).get('/v18.0/oauth/access_token').query(true).replyWithError('network down');

      const result = await facebookService.healthCheck();

      expect(result).toBe(false);
    });
  });

  // ── getAuthUrl ───────────────────────────────────────────────────────────

  describe('getAuthUrl', () => {
    it('builds an OAuth authorization URL with the expected params', () => {
      const url = facebookService.getAuthUrl();

      expect(url).toContain('https://www.facebook.com/v18.0/dialog/oauth');
      expect(url).toContain('response_type=code');
    });
  });

  describe('ensureFreshToken', () => {
    const baseTokens = {
      accessToken: 'old-token',
      expiresAt: 0,
      pages: [],
    };

    it('returns the same tokens unchanged when not near expiry', async () => {
      const tokens = { ...baseTokens, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 };
      const result = await facebookService.ensureFreshToken(tokens);
      expect(result).toEqual(tokens);
    });

    it('refreshes the token when within the refresh window', async () => {
      const tokens = { ...baseTokens, expiresAt: Date.now() + 60 * 1000 };
      const newExpiresAt = Date.now() + 5184000 * 1000;

      nock('https://graph.facebook.com')
        .get('/v18.0/oauth/access_token')
        .query(true)
        .reply(200, { access_token: 'new-token', expires_in: 5184000 });

      const result = await facebookService.ensureFreshToken(tokens);
      expect(result.accessToken).toBe('new-token');
      expect(result.expiresAt).toBeGreaterThanOrEqual(newExpiresAt - 1000);
    });

    it('throws AuthRefreshError when the refresh attempt fails', async () => {
      const tokens = { ...baseTokens, expiresAt: Date.now() + 60 * 1000 };

      nock('https://graph.facebook.com')
        .get('/v18.0/oauth/access_token')
        .query(true)
        .reply(400, { error: { message: 'Invalid token' } });

      await expect(facebookService.ensureFreshToken(tokens)).rejects.toThrow(AuthRefreshError);
    });
  });
});
